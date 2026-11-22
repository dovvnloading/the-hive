#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  FACILITY_PROPS,
  FACILITY_RESOURCES,
  activitiesForResource,
  inferToolCapability as inferFacilityToolCapability,
  worldEntityById,
  worldLocationById,
} from '../lib/arena/facility-protocol.mjs';

const QUALIFICATION_VERSION = 1;
const SCHEMA_VERSION = 1;
const MAX_RUN_MS = 30 * 60 * 1_000;
const QUALIFICATION_OBJECTIVE =
  'Produce one evidence-backed, implemented, independently verified improvement to the Hive while maintaining facility continuity.';
const RESIDENT_ASSIGNMENT =
  'Establish a life and pursue useful work from your resident charter.';
const PROFILES = Object.freeze(['Explorer', 'Maker', 'Critic', 'Steward']);
const PROFILE_BY_LOWER = new Map(
  PROFILES.map((profile) => [profile.toLowerCase(), profile]),
);
const TERMINAL_KINDS = new Set([
  'agent.completed',
  'agent.failed',
  'agent.stopped',
]);
const RECOVERABLE_REASON_CODES = new Set([
  'stale_observation',
  'path_yield',
  'path_reserved',
  'destination_occupied',
  'resource_capacity',
  'vision_limited',
  'light_stewardship',
]);
const RECEIPT_KEYS = new Set([
  'schemaVersion',
  'receiptId',
  'occurredAt',
  'runId',
  'agentId',
  'actionId',
  'action',
  'targetId',
  'submittedObservationId',
  'returnedObservationId',
  'currentEventSequence',
  'httpStatus',
  'reasonCode',
]);
const EVENT_KINDS = new Set([
  'sandbox.changed',
  'run.started',
  'run.completed',
  'run.canceled',
  'chat.ingress',
  'chat.relay',
  'agent.spawned',
  'task.assigned',
  'world.navigation',
  'world.interaction',
  'agent.activity',
  'tool.started',
  'tool.finished',
  'research.topic.selected',
  'research.topic.updated',
  'artifact.recorded',
  'agent.message',
  'proximity.spoken',
  'board.message',
  'board.acknowledged',
  'agent.blocked',
  'agent.resumed',
  'agent.completed',
  'agent.failed',
  'agent.stopped',
]);
const AGENT_EVENT_KINDS = new Set(
  [...EVENT_KINDS].filter(
    (kind) =>
      kind.startsWith('agent.') ||
      kind.startsWith('task.') ||
      kind.startsWith('tool.') ||
      kind.startsWith('research.') ||
      kind.startsWith('artifact.') ||
      kind.startsWith('world.') ||
      kind.startsWith('board.') ||
      kind.startsWith('proximity.'),
  ),
);
const ACTIVE_ASSIGNMENT_EVENT_KINDS = new Set(
  [...AGENT_EVENT_KINDS].filter(
    (kind) =>
      kind !== 'agent.spawned' &&
      kind !== 'task.assigned' &&
      !TERMINAL_KINDS.has(kind),
  ),
);
const ROOM_LIGHTS = Object.freeze(
  FACILITY_PROPS.filter((entity) => entity.kind === 'room-light').map(
    (entity) => ({ id: entity.id, initialPower: entity.initialState.power }),
  ),
);
const PLANT_PROP_IDS = new Set(
  FACILITY_PROPS.filter((entity) => entity.kind === 'plant').map(
    (entity) => entity.id,
  ),
);
const SEATED_RESOURCE_IDS = new Set(
  FACILITY_RESOURCES.filter(
    (resource) => resource.seatedPositions?.length > 0,
  ).map((resource) => resource.id),
);
const RESOURCE_BY_ID = new Map(
  FACILITY_RESOURCES.map((resource) => [resource.id, resource]),
);
const SAFE_RECEIPT_IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/u;
const OBSERVATION_ID = /^obs_[0-9a-f]{16}$/u;
const REJECTION_RECEIPT_ID =
  /^reject_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_PROCESS_ID = /^\/root(?:\/[a-z0-9_]+)*$/u;

export class ArenaEvalInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArenaEvalInputError';
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(record, key) {
  return typeof record?.[key] === 'string' && record[key].trim().length > 0;
}

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isTextArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function evidence({
  events = [],
  artifacts = [],
  messages = [],
  receipts = [],
}) {
  return {
    eventIds: unique(events.map((event) => event?.eventId)),
    artifactIds: unique(
      artifacts.map((artifact) => artifact?.payload?.artifactId ?? artifact),
    ),
    messageIds: unique(
      messages.map((message) => message?.payload?.messageId ?? message),
    ),
    receiptIds: unique(
      receipts.map((receipt) => receipt?.receiptId ?? receipt),
    ),
  };
}

function assertion(id, status, summary, support = evidence({}), details = []) {
  return { id, status, summary, evidence: support, details };
}

function requiredPayloadText(payload, keys, issues, prefix) {
  for (const key of keys) {
    if (!hasText(payload, key)) issues.push(`${prefix}.${key} is required`);
  }
}

/** Return structural issues for one authoritative RuntimeEvent record. */
export function validateEventRecord(event) {
  const issues = [];
  if (!isRecord(event)) return ['record must be a JSON object'];
  if (event.schemaVersion !== SCHEMA_VERSION)
    issues.push('schemaVersion must be 1');
  if (!hasText(event, 'eventId')) issues.push('eventId is required');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1)
    issues.push('sequence must be a positive safe integer');
  if (!isTimestamp(event.occurredAt))
    issues.push('occurredAt must be a valid timestamp');
  if (!new Set(['codex', 'operator']).has(event.source))
    issues.push('source must be codex or operator');
  if (!hasText(event, 'runId')) issues.push('runId is required');
  if (!EVENT_KINDS.has(event.kind)) issues.push('kind is not supported');
  if (!isRecord(event.payload)) issues.push('payload must be a JSON object');
  if (AGENT_EVENT_KINDS.has(event.kind) && !hasText(event, 'agentId'))
    issues.push(`${event.kind} requires agentId`);
  if (issues.length > 0 || !isRecord(event.payload)) return issues;

  const payload = event.payload;
  switch (event.kind) {
    case 'run.started':
      requiredPayloadText(payload, ['objective'], issues, 'payload');
      break;
    case 'run.completed':
    case 'agent.completed':
      requiredPayloadText(payload, ['summary'], issues, 'payload');
      break;
    case 'run.canceled':
    case 'agent.stopped':
      requiredPayloadText(payload, ['reason'], issues, 'payload');
      break;
    case 'agent.failed':
      requiredPayloadText(payload, ['error'], issues, 'payload');
      break;
    case 'agent.spawned':
      requiredPayloadText(payload, ['name', 'role'], issues, 'payload');
      break;
    case 'task.assigned':
      requiredPayloadText(payload, ['objective'], issues, 'payload');
      if (!hasText(event, 'taskId'))
        issues.push('task.assigned requires taskId');
      if (
        payload.mode !== undefined &&
        !new Set(['directed', 'self-directed']).has(payload.mode)
      )
        issues.push('payload.mode is invalid');
      break;
    case 'agent.activity':
      requiredPayloadText(
        payload,
        ['phase', 'status', 'summary'],
        issues,
        'payload',
      );
      break;
    case 'world.navigation':
      requiredPayloadText(
        payload,
        [
          'actionId',
          'observationId',
          'fromLocationId',
          'toLocationId',
          'startedAt',
          'arrivesAt',
        ],
        issues,
        'payload',
      );
      if (!isTimestamp(payload.startedAt) || !isTimestamp(payload.arrivesAt))
        issues.push('world navigation timestamps are invalid');
      break;
    case 'world.interaction':
      requiredPayloadText(
        payload,
        [
          'actionId',
          'observationId',
          'locationId',
          'entityId',
          'verb',
          'result',
        ],
        issues,
        'payload',
      );
      if (
        !Number.isSafeInteger(payload.stateVersion) ||
        payload.stateVersion < 0
      )
        issues.push('payload.stateVersion must be a non-negative safe integer');
      if (!isRecord(payload.state))
        issues.push('payload.state must be an object');
      break;
    case 'tool.started':
      requiredPayloadText(
        payload,
        ['toolCallId', 'tool', 'summary', 'resourceId'],
        issues,
        'payload',
      );
      if (payload.activityId !== undefined && !hasText(payload, 'activityId'))
        issues.push('payload.activityId must be a string');
      break;
    case 'tool.finished':
      requiredPayloadText(payload, ['toolCallId'], issues, 'payload');
      if (!new Set(['succeeded', 'failed']).has(payload.outcome))
        issues.push('payload.outcome is invalid');
      if (
        payload.artifactIds !== undefined &&
        !isTextArray(payload.artifactIds)
      )
        issues.push('payload.artifactIds must be an array of ids');
      break;
    case 'research.topic.selected':
      requiredPayloadText(
        payload,
        ['topicId', 'title', 'question'],
        issues,
        'payload',
      );
      break;
    case 'research.topic.updated':
      requiredPayloadText(payload, ['topicId'], issues, 'payload');
      if (
        !new Set(['active', 'blocked', 'complete', 'dropped']).has(
          payload.status,
        )
      )
        issues.push('payload.status is invalid');
      break;
    case 'artifact.recorded':
      requiredPayloadText(
        payload,
        ['artifactId', 'kind', 'title', 'summary'],
        issues,
        'payload',
      );
      if (
        !new Set(['source-note', 'change', 'test-result', 'decision']).has(
          payload.kind,
        )
      )
        issues.push('payload.kind is invalid');
      break;
    case 'board.message':
      requiredPayloadText(
        payload,
        [
          'messageId',
          'clientMessageId',
          'threadId',
          'topic',
          'messageType',
          'audience',
          'text',
        ],
        issues,
        'payload',
      );
      if (!Array.isArray(payload.recipientAgentIds))
        issues.push('payload.recipientAgentIds must be an array');
      if (
        payload.artifactIds !== undefined &&
        !isTextArray(payload.artifactIds)
      )
        issues.push('payload.artifactIds must be an array of ids');
      break;
    case 'board.acknowledged':
      requiredPayloadText(payload, ['messageId'], issues, 'payload');
      if (!new Set(['read', 'acknowledged', 'resolved']).has(payload.state))
        issues.push('payload.state is invalid');
      break;
    case 'agent.blocked':
      requiredPayloadText(
        payload,
        ['promptId', 'reason', 'request'],
        issues,
        'payload',
      );
      break;
    case 'agent.resumed':
      requiredPayloadText(payload, ['promptId'], issues, 'payload');
      break;
    case 'chat.ingress':
      requiredPayloadText(
        payload,
        ['ingressId', 'sessionId', 'turnId', 'prompt', 'capturedAt'],
        issues,
        'payload',
      );
      break;
    case 'chat.relay':
      requiredPayloadText(
        payload,
        ['ingressId', 'state', 'summary'],
        issues,
        'payload',
      );
      if (!Array.isArray(payload.targetAgentIds))
        issues.push('payload.targetAgentIds must be an array');
      break;
    case 'agent.message':
      requiredPayloadText(payload, ['channel', 'text'], issues, 'payload');
      break;
    case 'proximity.spoken':
      requiredPayloadText(
        payload,
        [
          'actionId',
          'observationId',
          'speechId',
          'speechAct',
          'speakerLocationId',
          'targetLocationId',
          'targetAgentId',
          'text',
          'preview',
        ],
        issues,
        'payload',
      );
      if (!Array.isArray(payload.heardByAgentIds))
        issues.push('payload.heardByAgentIds must be an array');
      break;
    default:
      break;
  }
  return issues;
}

/** Return structural and redaction issues for one rejection receipt. */
export function validateRejectionReceipt(receipt) {
  const issues = [];
  if (!isRecord(receipt)) return ['record must be a JSON object'];
  const extraKeys = Object.keys(receipt).filter(
    (key) => !RECEIPT_KEYS.has(key),
  );
  const missingKeys = [...RECEIPT_KEYS].filter((key) => !(key in receipt));
  if (extraKeys.length > 0)
    issues.push(`unexpected receipt fields: ${extraKeys.join(', ')}`);
  if (missingKeys.length > 0)
    issues.push(`missing receipt fields: ${missingKeys.join(', ')}`);
  if (receipt.schemaVersion !== SCHEMA_VERSION)
    issues.push('schemaVersion must be 1');
  for (const key of [
    'receiptId',
    'runId',
    'agentId',
    'actionId',
    'targetId',
    'submittedObservationId',
    'returnedObservationId',
  ]) {
    if (!hasText(receipt, key)) issues.push(`${key} is required`);
  }
  if (!REJECTION_RECEIPT_ID.test(receipt.receiptId ?? ''))
    issues.push('receiptId must be reject_<uuid-v4>');
  for (const key of ['runId', 'agentId', 'actionId', 'targetId']) {
    if (!SAFE_RECEIPT_IDENTIFIER.test(receipt[key] ?? ''))
      issues.push(`${key} must be a bounded safe identifier`);
  }
  for (const key of ['submittedObservationId', 'returnedObservationId']) {
    if (!OBSERVATION_ID.test(receipt[key] ?? ''))
      issues.push(`${key} must be an obs_<16 lowercase hex> identifier`);
  }
  if (!isTimestamp(receipt.occurredAt))
    issues.push('occurredAt must be a valid timestamp');
  if (!new Set(['move', 'interact']).has(receipt.action))
    issues.push('action must be move or interact');
  else if (
    receipt.action === 'move'
      ? !worldLocationById(receipt.targetId)
      : !worldEntityById(receipt.targetId)
  )
    issues.push('targetId is not valid for the submitted action');
  if (
    !Number.isSafeInteger(receipt.currentEventSequence) ||
    receipt.currentEventSequence < 0
  )
    issues.push('currentEventSequence must be a non-negative safe integer');
  if (
    !Number.isSafeInteger(receipt.httpStatus) ||
    receipt.httpStatus < 400 ||
    receipt.httpStatus > 599
  )
    issues.push('httpStatus must be a 4xx or 5xx integer');
  if (!RECOVERABLE_REASON_CODES.has(receipt.reasonCode))
    issues.push('reasonCode is not a stable recoverable code');
  return issues;
}

/**
 * Strictly parse JSONL. Blank interior records and invalid records are errors.
 * When selectedRunId is provided, every line must still be valid JSON and an
 * object with a textual runId, but records from other runs are excluded before
 * applying the run's full record schema. This preserves compatibility with
 * legacy runs sharing the append-only journal without weakening the selected
 * run's validation.
 */
export function parseJsonLines(
  text,
  { label = 'JSONL', validate, selectedRunId } = {},
) {
  if (typeof text !== 'string')
    throw new ArenaEvalInputError(`${label} must be UTF-8 text`);
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    if (lines[index].trim().length === 0)
      throw new ArenaEvalInputError(`${label}:${lineNumber} is blank`);
    let record;
    try {
      record = JSON.parse(lines[index]);
    } catch (error) {
      throw new ArenaEvalInputError(
        `${label}:${lineNumber} is not valid JSON: ${error.message}`,
      );
    }
    if (!isRecord(record))
      throw new ArenaEvalInputError(`${label}:${lineNumber} must be an object`);
    if (selectedRunId !== undefined) {
      if (!hasText(record, 'runId'))
        throw new ArenaEvalInputError(
          `${label}:${lineNumber} is invalid: runId is required`,
        );
      if (record.runId !== selectedRunId) continue;
    }
    const issues = validate?.(record) ?? [];
    if (issues.length > 0)
      throw new ArenaEvalInputError(
        `${label}:${lineNumber} is invalid: ${issues.join('; ')}`,
      );
    records.push(record);
  }
  return records;
}

/** Validate and normalize the versioned process-to-resident roster. */
export function validateRoster(roster) {
  const issues = [];
  const residents = [];
  if (!isRecord(roster))
    return { issues: ['roster must be a JSON object'], residents };
  const topKeys = new Set(['schemaVersion', 'runId', 'residents']);
  const extras = Object.keys(roster).filter((key) => !topKeys.has(key));
  if (extras.length > 0)
    issues.push(`unexpected roster fields: ${extras.join(', ')}`);
  if (roster.schemaVersion !== SCHEMA_VERSION)
    issues.push('roster.schemaVersion must be 1');
  if (!hasText(roster, 'runId')) issues.push('roster.runId is required');
  if (!Array.isArray(roster.residents)) {
    issues.push('roster.residents must be an array');
    return { issues, residents };
  }
  if (roster.residents.length !== 4)
    issues.push('roster must contain exactly four residents');
  const allowedEntryKeys = new Set([
    'processId',
    'agentId',
    'taskId',
    'profile',
    'charterPath',
  ]);
  for (const [index, entry] of roster.residents.entries()) {
    if (!isRecord(entry)) {
      issues.push(`residents[${index}] must be an object`);
      continue;
    }
    const entryExtras = Object.keys(entry).filter(
      (key) => !allowedEntryKeys.has(key),
    );
    if (entryExtras.length > 0)
      issues.push(
        `residents[${index}] has unexpected fields: ${entryExtras.join(', ')}`,
      );
    const missingFields = [...allowedEntryKeys].filter(
      (key) => !hasText(entry, key),
    );
    for (const key of missingFields)
      issues.push(`residents[${index}].${key} is required`);
    if (missingFields.length > 0) continue;
    const profile = PROFILE_BY_LOWER.get(entry.profile?.trim().toLowerCase());
    if (!profile) {
      issues.push(`residents[${index}].profile is invalid`);
      continue;
    }
    const expectedCharter = `.codex/residents/${profile.toUpperCase()}.md`;
    if (entry.charterPath !== expectedCharter) {
      issues.push(`residents[${index}].charterPath does not match ${profile}`);
    }
    if (!CANONICAL_PROCESS_ID.test(entry.processId)) {
      issues.push(
        `residents[${index}].processId must be a canonical /root collaboration process path`,
      );
    }
    residents.push({ ...entry, profile });
  }
  for (const field of ['processId', 'agentId', 'taskId']) {
    const values = residents.map((resident) => resident[field]);
    if (new Set(values).size !== values.length)
      issues.push(`resident ${field} values must be unique`);
  }
  const profileCounts = new Map(
    PROFILES.map((profile) => [
      profile,
      residents.filter((resident) => resident.profile === profile).length,
    ]),
  );
  for (const [profile, count] of profileCounts) {
    if (count !== 1) issues.push(`roster requires exactly one ${profile}`);
  }
  return { issues, residents };
}

function rosterProvenance(roster) {
  const profileOrder = new Map(
    PROFILES.map((profile, index) => [profile, index]),
  );
  const residents = Array.isArray(roster?.residents)
    ? roster.residents
        .filter(isRecord)
        .map((resident) => ({
          processId:
            typeof resident.processId === 'string' ? resident.processId : null,
          agentId:
            typeof resident.agentId === 'string' ? resident.agentId : null,
          taskId: typeof resident.taskId === 'string' ? resident.taskId : null,
          profile:
            typeof resident.profile === 'string' ? resident.profile : null,
          charterPath:
            typeof resident.charterPath === 'string'
              ? resident.charterPath
              : null,
        }))
        .sort((left, right) => {
          const leftRank = profileOrder.get(left.profile) ?? PROFILES.length;
          const rightRank = profileOrder.get(right.profile) ?? PROFILES.length;
          return (
            leftRank - rightRank ||
            JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')
          );
        })
    : [];
  const evaluatedRoster = {
    schemaVersion: Number.isSafeInteger(roster?.schemaVersion)
      ? roster.schemaVersion
      : null,
    runId: typeof roster?.runId === 'string' ? roster.runId : null,
    residents,
  };
  return {
    roster: evaluatedRoster,
    rosterSha256: createHash('sha256')
      .update(JSON.stringify(evaluatedRoster), 'utf8')
      .digest('hex'),
  };
}

function requireValidRecords(records, label, validate) {
  if (!Array.isArray(records))
    throw new ArenaEvalInputError(`${label} must be an array`);
  for (const [index, record] of records.entries()) {
    const issues = validate(record);
    if (issues.length > 0) {
      throw new ArenaEvalInputError(
        `${label}[${index}] is invalid: ${issues.join('; ')}`,
      );
    }
  }
}

/** Resolve `current` from the last authoritative run.started record. */
export function resolveRunId(events, requestedRun) {
  if (requestedRun !== 'current') return requestedRun;
  const started = [...events]
    .reverse()
    .find((event) => event.kind === 'run.started');
  if (!started)
    throw new ArenaEvalInputError('events.jsonl contains no run.started event');
  return started.runId;
}

function inferCapability(start) {
  if (hasText(start.payload, 'capability')) return start.payload.capability;
  return inferFacilityToolCapability(start.payload.tool);
}

function indexesFor(events) {
  const artifacts = new Map();
  const topics = new Map();
  const messages = new Map();
  const acknowledgements = new Map();
  const starts = new Map();
  const finishes = new Map();
  const pairs = [];

  for (const event of events) {
    if (event.kind === 'artifact.recorded')
      artifacts.set(event.payload.artifactId, event);
    if (event.kind === 'research.topic.selected') {
      topics.set(event.payload.topicId, { selection: event, updates: [] });
    }
    if (event.kind === 'research.topic.updated')
      topics.get(event.payload.topicId)?.updates.push(event);
    if (event.kind === 'board.message')
      messages.set(event.payload.messageId, event);
    if (event.kind === 'board.acknowledged') {
      const key = `${event.payload.messageId}\u0000${event.agentId}`;
      const list = acknowledgements.get(key) ?? [];
      list.push(event);
      acknowledgements.set(key, list);
    }
    if (event.kind === 'tool.started') {
      const key = `${event.agentId}\u0000${event.payload.toolCallId}`;
      const list = starts.get(key) ?? [];
      list.push(event);
      starts.set(key, list);
    }
    if (event.kind === 'tool.finished') {
      const key = `${event.agentId}\u0000${event.payload.toolCallId}`;
      const list = finishes.get(key) ?? [];
      list.push(event);
      finishes.set(key, list);
    }
  }
  for (const [key, startList] of starts) {
    const finishList = finishes.get(key) ?? [];
    if (startList.length === 1 && finishList.length === 1)
      pairs.push({ start: startList[0], finish: finishList[0] });
  }
  return {
    artifacts,
    topics,
    messages,
    acknowledgements,
    starts,
    finishes,
    pairs,
  };
}

function latestAcknowledgement(indexes, messageId, agentId) {
  return indexes.acknowledgements.get(`${messageId}\u0000${agentId}`)?.at(-1);
}

function acknowledgementBefore(
  indexes,
  messageId,
  agentId,
  afterSequence,
  beforeSequence,
) {
  return indexes.acknowledgements
    .get(`${messageId}\u0000${agentId}`)
    ?.filter(
      (event) =>
        event.sequence > afterSequence && event.sequence < beforeSequence,
    )
    .at(-1);
}

function linkedArtifacts(pair, indexes, kind, agentId, topicId) {
  return (pair.finish.payload.artifactIds ?? [])
    .map((id) => indexes.artifacts.get(id))
    .filter(
      (artifact) =>
        artifact &&
        pair.start.sequence < artifact.sequence &&
        artifact.sequence < pair.finish.sequence &&
        artifact.payload.kind === kind &&
        artifact.agentId === agentId &&
        (!topicId || artifact.payload.topicId === topicId),
    );
}

function successfulPairs(indexes, agentId, capabilities) {
  return indexes.pairs.filter(
    ({ start, finish }) =>
      start.agentId === agentId &&
      start.sequence < finish.sequence &&
      finish.payload.outcome === 'succeeded' &&
      capabilities.has(inferCapability(start)),
  );
}

function topicFinalEvent(topic) {
  return topic?.updates.at(-1);
}

function stateShowsNeed(state) {
  if (!isRecord(state)) return false;
  if (new Set(['dead', 'wilted', 'thirsty']).has(state.condition)) return true;
  return typeof state.hydration === 'number' && state.hydration < 55;
}

function stateShowsRecovery(before, after) {
  return (
    stateShowsNeed(before) &&
    !stateShowsNeed(after) &&
    (after.condition === 'healthy' ||
      (typeof after.hydration === 'number' && after.hydration >= 55))
  );
}

function acceptedActionFor(receipt, events) {
  return events.find((event) => {
    if (
      !new Set(['world.navigation', 'world.interaction']).has(event.kind) ||
      event.agentId !== receipt.agentId ||
      event.sequence <= receipt.currentEventSequence ||
      Date.parse(event.occurredAt) < Date.parse(receipt.occurredAt) ||
      event.payload.observationId === receipt.submittedObservationId
    )
      return false;
    return true;
  });
}

function causallyLinkedMessages(messages, origin) {
  const messageById = new Map(
    messages.map((message) => [message.payload.messageId, message]),
  );
  const adjacentIds = new Map(
    messages.map((message) => [message.payload.messageId, new Set()]),
  );
  for (const message of messages) {
    const parent = messageById.get(message.payload.replyToMessageId);
    if (!parent || parent.sequence >= message.sequence) continue;
    adjacentIds.get(message.payload.messageId).add(parent.payload.messageId);
    adjacentIds.get(parent.payload.messageId).add(message.payload.messageId);
  }
  const connectedIds = new Set([origin.payload.messageId]);
  const pendingIds = [origin.payload.messageId];
  while (pendingIds.length > 0) {
    const messageId = pendingIds.pop();
    for (const adjacentId of adjacentIds.get(messageId) ?? []) {
      if (connectedIds.has(adjacentId)) continue;
      connectedIds.add(adjacentId);
      pendingIds.push(adjacentId);
    }
  }
  return messages.filter((message) =>
    connectedIds.has(message.payload.messageId),
  );
}

function residentActivationLifecycles(events, residents, runCompletion) {
  const assignmentIssues = [];
  const terminalIssues = [];
  const cycles = [];
  const mappedAgentIds = new Set(residents.map((resident) => resident.agentId));
  const assignments = events.filter((event) => event.kind === 'task.assigned');
  const terminals = events.filter((event) => TERMINAL_KINDS.has(event.kind));
  const assignmentByTaskId = new Map();

  for (const assignment of assignments) {
    const prior = assignmentByTaskId.get(assignment.taskId);
    if (prior) {
      assignmentIssues.push(
        `taskId ${assignment.taskId} is assigned more than once`,
      );
    } else {
      assignmentByTaskId.set(assignment.taskId, assignment);
    }
    if (!mappedAgentIds.has(assignment.agentId))
      assignmentIssues.push('an assignment belongs to an unmapped identity');
  }
  if (terminals.some((event) => !mappedAgentIds.has(event.agentId)))
    terminalIssues.push('a terminal event belongs to an unmapped identity');

  for (const resident of residents) {
    const ownAssignments = assignments.filter(
      (event) => event.agentId === resident.agentId,
    );
    const canonicalAssignments = ownAssignments.filter(
      (event) => event.taskId === resident.taskId,
    );
    if (ownAssignments.length !== 1) {
      assignmentIssues.push(
        `${resident.agentId} must have exactly one qualification assignment`,
      );
    }
    if (canonicalAssignments.length !== 1) {
      assignmentIssues.push(
        `${resident.agentId} must have exactly one canonical roster assignment`,
      );
    }
    if (
      ownAssignments.length > 0 &&
      ownAssignments[0].taskId !== resident.taskId
    ) {
      assignmentIssues.push(
        `${resident.agentId} first assignment taskId does not match the roster`,
      );
    }
    for (const assignment of ownAssignments) {
      if (assignment.payload.mode !== 'self-directed') {
        assignmentIssues.push(
          `${resident.agentId} assignment ${assignment.taskId} is not self-directed`,
        );
      }
      if (assignment.payload.objective !== RESIDENT_ASSIGNMENT) {
        assignmentIssues.push(
          `${resident.agentId} assignment ${assignment.taskId} is not the neutral resident assignment`,
        );
      }
    }

    const ownEvents = events.filter(
      (event) => event.agentId === resident.agentId,
    );
    const openCycles = [];
    const residentCycles = [];
    let spawned = false;
    for (const event of ownEvents) {
      if (event.kind === 'agent.spawned') {
        spawned = true;
        continue;
      }
      if (event.kind === 'task.assigned') {
        if (!spawned) {
          assignmentIssues.push(
            `${resident.agentId} assignment ${event.taskId} occurs before its spawn`,
          );
        }
        if (openCycles.length > 0) {
          assignmentIssues.push(
            `${resident.agentId} assignment ${event.taskId} overlaps an unterminated activation`,
          );
        }
        const cycle = { resident, assignment: event, terminal: undefined };
        cycles.push(cycle);
        residentCycles.push(cycle);
        openCycles.push(cycle);
        continue;
      }

      if (ACTIVE_ASSIGNMENT_EVENT_KINDS.has(event.kind)) {
        if (openCycles.length === 0) {
          terminalIssues.push(
            `${resident.agentId} ${event.kind} ${event.eventId} occurs outside an active assignment`,
          );
        }
        continue;
      }

      if (!TERMINAL_KINDS.has(event.kind)) continue;

      let cycle;
      if (hasText(event, 'taskId')) {
        cycle = openCycles.find(
          (candidate) => candidate.assignment.taskId === event.taskId,
        );
      } else if (openCycles.length === 1) {
        [cycle] = openCycles;
      } else if (openCycles.length > 1) {
        terminalIssues.push(
          `${resident.agentId} terminal ${event.eventId} cannot be paired across overlapping activations`,
        );
        continue;
      }
      if (!cycle) {
        terminalIssues.push(
          `${resident.agentId} terminal ${event.eventId} is duplicate or unpaired`,
        );
        continue;
      }
      cycle.terminal = event;
      openCycles.splice(openCycles.indexOf(cycle), 1);
    }

    for (const cycle of residentCycles) {
      if (!cycle.terminal) {
        terminalIssues.push(
          `${resident.agentId} activation ${cycle.assignment.taskId} lacks a factual terminal`,
        );
      }
    }
    if (residentCycles.length === 0) {
      terminalIssues.push(
        `${resident.agentId} has no activation to reach a factual terminal`,
      );
    }
    const finalCycle = residentCycles.at(-1);
    if (
      finalCycle?.terminal &&
      runCompletion &&
      finalCycle.terminal.sequence >= runCompletion.sequence
    ) {
      terminalIssues.push(
        `${resident.agentId} final activation is not terminal before run.completed`,
      );
    }
  }

  return { assignments, terminals, cycles, assignmentIssues, terminalIssues };
}

function runIntegrity(events, receipts, runId) {
  const issues = [];
  if (events.length === 0) issues.push(`selected run ${runId} has no events`);
  const eventIds = new Set();
  const artifactIds = new Map();
  const topicIds = new Set();
  const messageIds = new Set();
  const engagedResources = new Map();
  let priorSequence = (events.at(0)?.sequence ?? 1) - 1;
  let priorTime = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    for (const issue of validateEventRecord(event))
      issues.push(`${event.eventId ?? 'unknown event'}: ${issue}`);
    if (event.runId !== runId)
      issues.push(`${event.eventId} has the wrong runId`);
    if (eventIds.has(event.eventId))
      issues.push(`duplicate eventId ${event.eventId}`);
    eventIds.add(event.eventId);
    if (event.sequence !== priorSequence + 1)
      issues.push(
        `expected sequence ${priorSequence + 1}, found ${event.sequence}`,
      );
    priorSequence = event.sequence;
    const time = Date.parse(event.occurredAt);
    if (time < priorTime)
      issues.push(`event ${event.eventId} timestamp is out of order`);
    priorTime = time;

    if (event.kind === 'agent.spawned' || event.kind === 'task.assigned')
      engagedResources.delete(event.agentId);
    if (event.kind === 'world.navigation')
      engagedResources.delete(event.agentId);
    if (
      event.kind === 'world.navigation' &&
      (!worldLocationById(event.payload.fromLocationId) ||
        !worldLocationById(event.payload.toLocationId))
    )
      issues.push(`${event.eventId} references an unknown world location`);
    if (
      event.kind === 'world.interaction' &&
      !worldEntityById(event.payload.entityId)
    )
      issues.push(`${event.eventId} references an unknown world entity`);
    if (
      event.kind === 'world.interaction' &&
      event.payload.verb === 'use' &&
      RESOURCE_BY_ID.has(event.payload.entityId)
    )
      engagedResources.set(event.agentId, event.payload.entityId);
    if (event.kind === 'tool.started') {
      const capability = inferCapability(event);
      const resource = RESOURCE_BY_ID.get(event.payload.resourceId);
      if (!resource)
        issues.push(
          `${event.eventId} names unknown resource ${event.payload.resourceId}`,
        );
      else if (!resource.capabilities.includes(capability))
        issues.push(
          `${event.eventId} resource ${resource.id} does not support ${capability}`,
        );
      if (resource && hasText(event.payload, 'activityId')) {
        const activity = activitiesForResource(resource.id).find(
          (candidate) => candidate.id === event.payload.activityId,
        );
        if (!activity) {
          issues.push(
            `${event.eventId} names unknown activity ${event.payload.activityId} for ${resource.id}`,
          );
        } else if (activity.capability !== capability) {
          issues.push(
            `${event.eventId} activity ${activity.id} requires ${activity.capability}, not ${capability}`,
          );
        }
      }
      if (engagedResources.get(event.agentId) !== event.payload.resourceId)
        issues.push(
          `${event.eventId} lacks a prior active use of its facility resource`,
        );
      if (event.payload.topicId && !topicIds.has(event.payload.topicId))
        issues.push(`${event.eventId} references an unknown topic`);
    }
    if (event.kind === 'tool.finished') {
      for (const artifactId of event.payload.artifactIds ?? []) {
        if (!artifactIds.has(artifactId))
          issues.push(
            `${event.eventId} references unknown artifact ${artifactId}`,
          );
      }
      engagedResources.delete(event.agentId);
    }
    if (TERMINAL_KINDS.has(event.kind)) engagedResources.delete(event.agentId);
    if (event.kind === 'research.topic.selected') {
      if (topicIds.has(event.payload.topicId))
        issues.push(`duplicate topicId ${event.payload.topicId}`);
      topicIds.add(event.payload.topicId);
    }
    if (
      event.kind === 'research.topic.updated' &&
      !topicIds.has(event.payload.topicId)
    )
      issues.push(`${event.eventId} updates an unknown topic`);
    if (event.kind === 'artifact.recorded') {
      if (artifactIds.has(event.payload.artifactId))
        issues.push(`duplicate artifactId ${event.payload.artifactId}`);
      if (event.payload.topicId && !topicIds.has(event.payload.topicId))
        issues.push(`${event.eventId} references an unknown topic`);
      artifactIds.set(event.payload.artifactId, event);
    }
    if (event.kind === 'board.message') {
      if (messageIds.has(event.payload.messageId))
        issues.push(`duplicate messageId ${event.payload.messageId}`);
      messageIds.add(event.payload.messageId);
      if (event.payload.topicId && !topicIds.has(event.payload.topicId))
        issues.push(`${event.eventId} references an unknown topic`);
      if (
        event.payload.messageType === 'handoff' &&
        (!hasText(event.payload, 'topicId') ||
          !event.payload.artifactIds?.length)
      )
        issues.push(
          `${event.eventId} handoff lacks topicId or linked artifacts`,
        );
      const linkedIds = event.payload.artifactIds ?? [];
      if (new Set(linkedIds).size !== linkedIds.length)
        issues.push(`${event.eventId} repeats a linked artifact`);
      for (const artifactId of linkedIds) {
        const artifact = artifactIds.get(artifactId);
        if (!artifact)
          issues.push(
            `${event.eventId} references unknown artifact ${artifactId}`,
          );
        else if (
          event.payload.topicId &&
          artifact.payload.topicId !== event.payload.topicId
        )
          issues.push(
            `${event.eventId} artifact ${artifactId} has a different topic`,
          );
      }
    }
    if (
      event.kind === 'board.acknowledged' &&
      !messageIds.has(event.payload.messageId)
    )
      issues.push(`${event.eventId} acknowledges an unknown message`);
  }
  const receiptIds = new Set();
  let receiptSequence = 0;
  let receiptTime = Number.NEGATIVE_INFINITY;
  for (const receipt of receipts) {
    for (const issue of validateRejectionReceipt(receipt))
      issues.push(`${receipt.receiptId ?? 'unknown receipt'}: ${issue}`);
    if (receipt.runId !== runId)
      issues.push(`${receipt.receiptId} has the wrong runId`);
    if (receiptIds.has(receipt.receiptId))
      issues.push(`duplicate receiptId ${receipt.receiptId}`);
    receiptIds.add(receipt.receiptId);
    if (receipt.currentEventSequence < receiptSequence)
      issues.push(
        `receipt ${receipt.receiptId} event sequence is out of order`,
      );
    receiptSequence = receipt.currentEventSequence;
    if (receiptSequence > (events.at(-1)?.sequence ?? 0))
      issues.push(
        `receipt ${receipt.receiptId} is ahead of the selected journal`,
      );
    const time = Date.parse(receipt.occurredAt);
    if (time < receiptTime)
      issues.push(`receipt ${receipt.receiptId} timestamp is out of order`);
    receiptTime = time;
  }
  return issues;
}

/**
 * Pure deterministic qualification evaluation. The function never reads files,
 * emits facility events, or examines private-journal content.
 */
export function evaluateArenaRun({ runId, events, receipts = [], roster }) {
  requireValidRecords(events, 'events', validateEventRecord);
  requireValidRecords(receipts, 'rejection receipts', validateRejectionReceipt);
  const selectedEvents = events.filter((event) => event.runId === runId);
  const selectedReceipts = receipts.filter(
    (receipt) => receipt.runId === runId,
  );
  const rosterResult = validateRoster(roster);
  const residents = rosterResult.residents;
  const residentByProfile = new Map(
    residents.map((resident) => [resident.profile, resident]),
  );
  const mappedAgentIds = new Set(residents.map((resident) => resident.agentId));
  const indexes = indexesFor(selectedEvents);
  const assertions = [];

  const integrityIssues = runIntegrity(selectedEvents, selectedReceipts, runId);
  assertions.push(
    assertion(
      'journal.integrity',
      integrityIssues.length === 0 ? 'pass' : 'fail',
      integrityIssues.length === 0
        ? 'Selected event and rejection journals are ordered and unique.'
        : 'Selected journal records are corrupt, duplicate, or out of order.',
      evidence({ events: selectedEvents, receipts: selectedReceipts }),
      integrityIssues,
    ),
  );

  const starts = selectedEvents.filter((event) => event.kind === 'run.started');
  const completedRuns = selectedEvents.filter(
    (event) => event.kind === 'run.completed',
  );
  const canceledRuns = selectedEvents.filter(
    (event) => event.kind === 'run.canceled',
  );
  const lifecycleOk =
    starts.length === 1 &&
    selectedEvents.at(0) === starts[0] &&
    completedRuns.length === 1 &&
    canceledRuns.length === 0 &&
    starts[0]?.payload.objective === QUALIFICATION_OBJECTIVE &&
    selectedEvents.at(-1) === completedRuns[0];
  assertions.push(
    assertion(
      'run.lifecycle',
      lifecycleOk ? 'pass' : 'fail',
      lifecycleOk
        ? 'The selected run has the exact qualification objective and one completed close.'
        : 'The selected run is missing the exact objective or a unique, factual completed lifecycle.',
      evidence({ events: [...starts, ...completedRuns, ...canceledRuns] }),
    ),
  );

  const spawnEvents = selectedEvents.filter(
    (event) => event.kind === 'agent.spawned',
  );
  const mappingIssues = [...rosterResult.issues];
  if (roster?.runId !== runId)
    mappingIssues.push('roster.runId does not match the selected run');
  if (spawnEvents.length !== 4)
    mappingIssues.push('the selected run must spawn exactly four identities');
  const stewardRoster = residents.find(
    (resident) => resident.profile === 'Steward',
  );
  if (stewardRoster?.processId !== '/root')
    mappingIssues.push('the Steward processId must be /root');
  const childResidents = residents.filter(
    (resident) => resident.profile !== 'Steward',
  );
  if (
    childResidents.length !== 3 ||
    childResidents.some(
      (resident) =>
        !resident.processId.startsWith('/root/') ||
        resident.processId.slice('/root/'.length).length === 0,
    )
  ) {
    mappingIssues.push(
      'Explorer, Maker, and Critic must map to canonical /root/... child processes',
    );
  }
  for (const resident of residents) {
    const spawns = spawnEvents.filter(
      (event) => event.agentId === resident.agentId,
    );
    if (spawns.length !== 1) {
      mappingIssues.push(
        `${resident.agentId} does not have exactly one spawn event`,
      );
      continue;
    }
    if (
      spawns[0].payload.role.trim().toLowerCase() !==
      resident.profile.toLowerCase()
    )
      mappingIssues.push(
        `${resident.agentId} spawn role does not match ${resident.profile}`,
      );
  }
  const unmappedSpawns = spawnEvents.filter(
    (event) => !mappedAgentIds.has(event.agentId),
  );
  if (unmappedSpawns.length > 0)
    mappingIssues.push('the run contains an identity absent from the roster');
  assertions.push(
    assertion(
      'roster.mapping',
      mappingIssues.length === 0 ? 'pass' : 'fail',
      mappingIssues.length === 0
        ? 'Exactly four unique processes map to Explorer, Maker, Critic, and Steward identities.'
        : 'The process-to-identity roster does not match the authoritative run.',
      evidence({ events: spawnEvents }),
      mappingIssues,
    ),
  );

  const activationLifecycles = residentActivationLifecycles(
    selectedEvents,
    residents,
    completedRuns.length === 1 ? completedRuns[0] : undefined,
  );
  const { assignments, assignmentIssues } = activationLifecycles;
  assertions.push(
    assertion(
      'resident.assignments',
      assignmentIssues.length === 0 ? 'pass' : 'fail',
      assignmentIssues.length === 0
        ? 'Each mapped identity has one canonical assignment and only neutral, non-overlapping reactivations.'
        : 'Assignments are missing, reused, directed, mismatched, or overlapping.',
      evidence({ events: assignments }),
      assignmentIssues,
    ),
  );

  const { terminals: terminalEvents, terminalIssues } = activationLifecycles;
  assertions.push(
    assertion(
      'resident.terminals',
      terminalIssues.length === 0 ? 'pass' : 'fail',
      terminalIssues.length === 0
        ? 'Every resident activation has one factual terminal before run completion.'
        : 'One or more resident activations has a missing, duplicate, unpaired, or late terminal.',
      evidence({ events: terminalEvents }),
      terminalIssues,
    ),
  );

  const toolIssues = [];
  const toolEvents = selectedEvents.filter((event) =>
    event.kind.startsWith('tool.'),
  );
  for (const [key, startList] of indexes.starts) {
    const finishList = indexes.finishes.get(key) ?? [];
    if (startList.length !== 1 || finishList.length !== 1)
      toolIssues.push(
        `${key.replace('\u0000', '/')} is not a one-to-one tool lifecycle`,
      );
    else if (startList[0].sequence >= finishList[0].sequence)
      toolIssues.push(
        `${key.replace('\u0000', '/')} finishes before it starts`,
      );
  }
  for (const key of indexes.finishes.keys()) {
    if (!indexes.starts.has(key))
      toolIssues.push(`${key.replace('\u0000', '/')} finishes without a start`);
  }
  assertions.push(
    assertion(
      'resident.tools_closed',
      toolIssues.length === 0 ? 'pass' : 'fail',
      toolIssues.length === 0
        ? 'Every authoritative tool call has one matching finish.'
        : 'The run contains orphaned, duplicate, or reversed tool calls.',
      evidence({ events: toolEvents }),
      toolIssues,
    ),
  );

  const topicEvents = selectedEvents.filter((event) =>
    event.kind.startsWith('research.topic.'),
  );
  const topicIssues = [];
  for (const [topicId, topic] of indexes.topics) {
    const final = topicFinalEvent(topic);
    if (!final || final.payload.status === 'active')
      topicIssues.push(`${topicId} remains active`);
  }
  const unknownTopicUpdates = topicEvents.filter(
    (event) =>
      event.kind === 'research.topic.updated' &&
      !indexes.topics.has(event.payload.topicId),
  );
  if (unknownTopicUpdates.length > 0)
    topicIssues.push('one or more topic updates lack a selected topic');
  assertions.push(
    assertion(
      'resident.topics_closed',
      topicIssues.length === 0 ? 'pass' : 'fail',
      topicIssues.length === 0
        ? 'No selected research topic remains active.'
        : 'The run contains an unfinished or orphaned research topic.',
      evidence({ events: topicEvents }),
      topicIssues,
    ),
  );

  const explorer = residentByProfile.get('Explorer');
  const explorerProofs = [];
  if (explorer) {
    for (const pair of successfulPairs(
      indexes,
      explorer.agentId,
      new Set(['search', 'browse']),
    )) {
      const topicId = pair.start.payload.topicId;
      if (!topicId) continue;
      const topic = indexes.topics.get(topicId);
      const sources = linkedArtifacts(
        pair,
        indexes,
        'source-note',
        explorer.agentId,
        topicId,
      ).filter((artifact) => /^https?:\/\//u.test(artifact.payload.uri ?? ''));
      const final = topicFinalEvent(topic);
      const factualClose =
        topic?.selection.agentId === explorer.agentId &&
        topic.selection.sequence < pair.start.sequence &&
        final &&
        final.agentId === explorer.agentId &&
        final.sequence > pair.finish.sequence &&
        (final.payload.status === 'complete' ||
          (final.payload.status === 'blocked' &&
            hasText(final.payload, 'summary')));
      if (sources.length > 0 && factualClose) {
        explorerProofs.push({ pair, topicId, sources, final });
      }
    }
  }
  const explorerProof = explorerProofs[0];
  assertions.push(
    assertion(
      'role.explorer',
      explorerProof ? 'pass' : 'fail',
      explorerProof
        ? 'Explorer completed linked search/browse evidence and closed the topic.'
        : 'Explorer lacks a successful source-linked web lifecycle and factual topic close.',
      explorerProof
        ? evidence({
            events: [
              explorerProof.pair.start,
              explorerProof.pair.finish,
              explorerProof.final,
            ],
            artifacts: explorerProof.sources,
          })
        : evidence({}),
    ),
  );

  const maker = residentByProfile.get('Maker');
  const makerProofs = [];
  if (maker) {
    for (const editPair of successfulPairs(
      indexes,
      maker.agentId,
      new Set(['edit', 'build']),
    )) {
      const topicId = editPair.start.payload.topicId;
      if (!topicId) continue;
      const changes = linkedArtifacts(
        editPair,
        indexes,
        'change',
        maker.agentId,
        topicId,
      );
      if (changes.length === 0) continue;
      const testPair = successfulPairs(
        indexes,
        maker.agentId,
        new Set(['test']),
      ).find((candidate) => {
        if (
          candidate.start.payload.topicId !== topicId ||
          candidate.start.sequence <= editPair.finish.sequence
        )
          return false;
        return (
          linkedArtifacts(
            candidate,
            indexes,
            'test-result',
            maker.agentId,
            topicId,
          ).length > 0
        );
      });
      if (!testPair) continue;
      makerProofs.push({
        editPair,
        testPair,
        topicId,
        changes,
        tests: linkedArtifacts(
          testPair,
          indexes,
          'test-result',
          maker.agentId,
          topicId,
        ),
      });
    }
  }
  const makerProof = makerProofs[0];
  assertions.push(
    assertion(
      'role.maker',
      makerProof ? 'pass' : 'fail',
      makerProof
        ? 'Maker linked a real edit/build change and its own successful test result.'
        : 'Maker lacks a topic-linked change plus its own linked test result.',
      makerProof
        ? evidence({
            events: [
              makerProof.editPair.start,
              makerProof.editPair.finish,
              makerProof.testPair.start,
              makerProof.testPair.finish,
            ],
            artifacts: [...makerProof.changes, ...makerProof.tests],
          })
        : evidence({}),
    ),
  );

  const critic = residentByProfile.get('Critic');
  const criticProofs = [];
  if (critic && maker) {
    const criticPairs = successfulPairs(
      indexes,
      critic.agentId,
      new Set(['test', 'review']),
    );
    for (const candidateMakerProof of makerProofs) {
      const makerHandoffs = selectedEvents.filter(
        (event) =>
          event.kind === 'board.message' &&
          event.agentId === maker.agentId &&
          event.payload.messageType === 'handoff' &&
          (event.payload.audience === 'broadcast' ||
            event.payload.recipientAgentIds.includes(critic.agentId)) &&
          event.payload.topicId === candidateMakerProof.topicId &&
          candidateMakerProof.changes.some((change) =>
            event.payload.artifactIds?.includes(change.payload.artifactId),
          ) &&
          candidateMakerProof.tests.some((testResult) =>
            event.payload.artifactIds?.includes(testResult.payload.artifactId),
          ),
      );
      for (const handoff of makerHandoffs) {
        if (
          handoff.sequence <= candidateMakerProof.editPair.finish.sequence ||
          handoff.sequence <= candidateMakerProof.testPair.finish.sequence
        )
          continue;
        for (const pair of criticPairs) {
          if (
            pair.start.sequence <= handoff.sequence ||
            pair.start.payload.topicId !== candidateMakerProof.topicId
          )
            continue;
          const tests = linkedArtifacts(
            pair,
            indexes,
            'test-result',
            critic.agentId,
            candidateMakerProof.topicId,
          );
          if (tests.length === 0) continue;
          const acknowledgement = acknowledgementBefore(
            indexes,
            handoff.payload.messageId,
            critic.agentId,
            handoff.sequence,
            pair.start.sequence,
          );
          if (
            !acknowledgement ||
            !new Set(['acknowledged', 'resolved']).has(
              acknowledgement.payload.state,
            )
          )
            continue;
          const resultMessage = selectedEvents.find(
            (event) =>
              event.kind === 'board.message' &&
              event.agentId === critic.agentId &&
              event.sequence > pair.finish.sequence &&
              new Set(['decision', 'update']).has(event.payload.messageType) &&
              event.payload.topicId === candidateMakerProof.topicId &&
              (event.payload.audience === 'broadcast' ||
                event.payload.recipientAgentIds.includes(maker.agentId)) &&
              tests.some((testResult) =>
                event.payload.artifactIds?.includes(
                  testResult.payload.artifactId,
                ),
              ),
          );
          if (!resultMessage) continue;
          criticProofs.push({
            pair,
            handoff,
            acknowledgement,
            resultMessage,
            tests,
            makerProof: candidateMakerProof,
          });
          break;
        }
      }
    }
  }
  criticProofs.sort(
    (left, right) =>
      left.resultMessage.sequence - right.resultMessage.sequence ||
      left.pair.start.sequence - right.pair.start.sequence,
  );
  const criticProof = criticProofs[0];
  assertions.push(
    assertion(
      'role.critic',
      criticProof ? 'pass' : 'fail',
      criticProof
        ? 'Critic acknowledged the Maker handoff, independently validated it, and reported the linked result.'
        : 'Critic lacks an acknowledged Maker handoff, independent linked validation, or artifact-backed result report.',
      criticProof
        ? evidence({
            events: [
              criticProof.pair.start,
              criticProof.pair.finish,
              criticProof.acknowledgement,
            ],
            artifacts: criticProof.tests,
            messages: [criticProof.handoff, criticProof.resultMessage],
          })
        : evidence({}),
    ),
  );

  const steward = residentByProfile.get('Steward');
  let stewardProof;
  if (steward) {
    const interactions = selectedEvents.filter(
      (event) =>
        event.kind === 'world.interaction' && event.agentId === steward.agentId,
    );
    for (const before of interactions.filter(
      (event) =>
        event.payload.verb === 'inspect' &&
        PLANT_PROP_IDS.has(event.payload.entityId),
    )) {
      if (!stateShowsNeed(before.payload.state)) continue;
      const action = interactions.find(
        (event) =>
          event.sequence > before.sequence &&
          event.payload.entityId === before.payload.entityId &&
          !new Set(['inspect', 'use']).has(event.payload.verb) &&
          stateShowsRecovery(before.payload.state, event.payload.state),
      );
      if (!action) continue;
      const verified = interactions.find(
        (event) =>
          event.sequence > action.sequence &&
          event.payload.entityId === before.payload.entityId &&
          event.payload.verb === 'inspect' &&
          stateShowsRecovery(before.payload.state, event.payload.state),
      );
      if (verified) {
        stewardProof = {
          kind: 'environment',
          events: [before, action, verified],
        };
        break;
      }
    }
    if (!stewardProof) {
      const coordinationMessages = selectedEvents.filter(
        (event) =>
          event.kind === 'board.message' &&
          hasText(event.payload, 'topicId') &&
          event.payload.artifactIds?.some((artifactId) => {
            const artifact = indexes.artifacts.get(artifactId);
            return (
              artifact &&
              artifact.sequence < event.sequence &&
              artifact.payload.topicId === event.payload.topicId &&
              indexes.topics.has(event.payload.topicId)
            );
          }),
      );
      const threads = new Map();
      for (const message of coordinationMessages) {
        const list = threads.get(message.payload.threadId) ?? [];
        list.push(message);
        threads.set(message.payload.threadId, list);
      }
      for (const messages of threads.values()) {
        for (const stewardMessage of messages.filter(
          (message) => message.agentId === steward.agentId,
        )) {
          const topicMessages = messages.filter(
            (message) =>
              message.payload.topicId === stewardMessage.payload.topicId,
          );
          const repliedTo = topicMessages.find(
            (prior) =>
              prior.payload.messageId ===
                stewardMessage.payload.replyToMessageId &&
              prior.sequence < stewardMessage.sequence &&
              prior.agentId !== steward.agentId,
          );
          if (!repliedTo) continue;
          const causalMessages = causallyLinkedMessages(
            topicMessages,
            stewardMessage,
          );
          if (
            new Set(causalMessages.map((message) => message.agentId)).size < 2
          )
            continue;
          const tail = causalMessages.at(-1);
          const acknowledgements = [
            ...indexes.acknowledgements.values(),
          ].flat();
          const resolved = acknowledgements.find(
            (ack) =>
              ack.payload.messageId === tail.payload.messageId &&
              ack.agentId !== tail.agentId &&
              ack.payload.state === 'resolved' &&
              ack.sequence > tail.sequence &&
              (tail.agentId === steward.agentId
                ? tail === stewardMessage &&
                  ack.agentId !== steward.agentId &&
                  causalMessages.some(
                    (message) =>
                      message.agentId === ack.agentId &&
                      message.sequence < ack.sequence,
                  )
                : ack.agentId === steward.agentId &&
                  stewardMessage.sequence < tail.sequence),
          );
          if (!resolved) continue;
          const artifacts = [stewardMessage, tail]
            .flatMap((message) => message.payload.artifactIds ?? [])
            .map((artifactId) => indexes.artifacts.get(artifactId))
            .filter(Boolean);
          stewardProof = {
            kind: 'coordination',
            messages: causalMessages,
            artifacts,
            resolved,
          };
          break;
        }
        if (stewardProof) break;
      }
    }
  }
  assertions.push(
    assertion(
      'role.steward',
      stewardProof ? 'pass' : 'fail',
      stewardProof?.kind === 'environment'
        ? 'Steward inspected a need, recovered its state, and independently verified it.'
        : stewardProof
          ? 'Steward materially resolved an artifact-backed coordination thread.'
          : 'Steward lacks verified environmental recovery or resolved coordination.',
      stewardProof?.kind === 'environment'
        ? evidence({ events: stewardProof.events })
        : stewardProof
          ? evidence({
              events: [stewardProof.resolved],
              artifacts: stewardProof.artifacts,
              messages: stewardProof.messages,
            })
          : evidence({}),
    ),
  );

  const chainCandidates = [];
  if (explorer && maker && critic) {
    for (const candidateCriticProof of criticProofs) {
      const candidateMakerProof = candidateCriticProof.makerProof;
      for (const candidateExplorerProof of explorerProofs) {
        if (candidateMakerProof.topicId !== candidateExplorerProof.topicId)
          continue;
        const evidenceHandoffs = selectedEvents.filter(
          (event) =>
            event.kind === 'board.message' &&
            event.agentId === explorer.agentId &&
            event.payload.messageType === 'handoff' &&
            (event.payload.audience === 'broadcast' ||
              event.payload.recipientAgentIds.includes(maker.agentId)) &&
            event.payload.topicId === candidateExplorerProof.topicId &&
            candidateExplorerProof.sources.some((source) =>
              event.payload.artifactIds?.includes(source.payload.artifactId),
            ) &&
            event.sequence > candidateExplorerProof.pair.finish.sequence &&
            event.sequence < candidateMakerProof.editPair.start.sequence,
        );
        for (const handoff of evidenceHandoffs) {
          const makerAck = acknowledgementBefore(
            indexes,
            handoff.payload.messageId,
            maker.agentId,
            handoff.sequence,
            candidateMakerProof.editPair.start.sequence,
          );
          if (
            !makerAck ||
            !new Set(['acknowledged', 'resolved']).has(makerAck.payload.state)
          )
            continue;
          chainCandidates.push({
            explorerProof: candidateExplorerProof,
            makerProof: candidateMakerProof,
            criticProof: candidateCriticProof,
            handoff,
            makerAck,
          });
        }
      }
    }
  }
  chainCandidates.sort(
    (left, right) =>
      left.criticProof.resultMessage.sequence -
        right.criticProof.resultMessage.sequence ||
      left.handoff.sequence - right.handoff.sequence,
  );
  const chainProof = chainCandidates[0];
  assertions.push(
    assertion(
      'team.evidence_change_validation_chain',
      chainProof ? 'pass' : 'fail',
      chainProof
        ? 'One acknowledged evidence-to-change-to-independent-validation chain is complete.'
        : 'No complete causal handoff chain connects evidence, change, and independent validation.',
      chainProof
        ? evidence({
            events: [
              chainProof.makerAck,
              chainProof.criticProof.acknowledgement,
            ],
            artifacts: [
              ...chainProof.explorerProof.sources,
              ...chainProof.makerProof.changes,
              ...chainProof.makerProof.tests,
              ...chainProof.criticProof.tests,
            ],
            messages: [
              chainProof.handoff,
              chainProof.criticProof.handoff,
              chainProof.criticProof.resultMessage,
            ],
          })
        : evidence({}),
    ),
  );

  const lightEvidence = [];
  const lightsLeftOn = [];
  for (const light of ROOM_LIGHTS) {
    const changes = selectedEvents.filter(
      (event) =>
        event.kind === 'world.interaction' &&
        event.payload.entityId === light.id,
    );
    const last = changes.at(-1);
    if (last) lightEvidence.push(last);
    const power = last?.payload.state?.power ?? light.initialPower;
    if (power !== 'off') lightsLeftOn.push(light.id);
  }
  assertions.push(
    assertion(
      'team.lights_off',
      lightsLeftOn.length === 0 ? 'pass' : 'fail',
      lightsLeftOn.length === 0
        ? 'All room lights are off at terminal state.'
        : 'One or more room lights remain on at terminal state.',
      evidence({ events: lightEvidence }),
      lightsLeftOn,
    ),
  );

  const completedAgentIds = new Set(
    terminalEvents
      .filter((event) => event.kind === 'agent.completed')
      .map((event) => event.agentId),
  );
  const unresolved = [];
  const directMessages = selectedEvents.filter(
    (event) =>
      event.kind === 'board.message' && event.payload.audience === 'direct',
  );
  for (const message of directMessages) {
    for (const recipient of message.payload.recipientAgentIds) {
      if (!completedAgentIds.has(recipient)) continue;
      const ack = latestAcknowledgement(
        indexes,
        message.payload.messageId,
        recipient,
      );
      if (ack?.payload.state !== 'resolved')
        unresolved.push(`${message.payload.messageId} -> ${recipient}`);
    }
  }
  assertions.push(
    assertion(
      'team.direct_messages_resolved',
      unresolved.length === 0 ? 'pass' : 'fail',
      unresolved.length === 0
        ? 'No completed resident has an unresolved direct board message.'
        : 'A completed resident still has unresolved direct board work.',
      evidence({
        events: [...indexes.acknowledgements.values()].flat(),
        messages: directMessages,
      }),
      unresolved,
    ),
  );

  let recoveryProof;
  for (const receipt of selectedReceipts) {
    const accepted = acceptedActionFor(receipt, selectedEvents);
    if (!accepted) continue;
    const completion = selectedEvents.find(
      (event) =>
        event.kind === 'agent.completed' &&
        event.agentId === receipt.agentId &&
        event.sequence > accepted.sequence,
    );
    if (completion) {
      recoveryProof = { receipt, accepted, completion };
      break;
    }
  }
  const recoveryStatus =
    selectedReceipts.length === 0
      ? 'inconclusive'
      : recoveryProof
        ? 'pass'
        : 'fail';
  assertions.push(
    assertion(
      'recovery.contention',
      recoveryStatus,
      recoveryStatus === 'inconclusive'
        ? 'No qualifying semantic action rejection occurred in this run.'
        : recoveryProof
          ? 'A recoverable rejection was followed by a fresh-observation action and meaningful completion.'
          : 'Contention occurred without a qualifying fresh-observation recovery and completion.',
      recoveryProof
        ? evidence({
            events: [recoveryProof.accepted, recoveryProof.completion],
            receipts: [recoveryProof.receipt],
          })
        : evidence({ receipts: selectedReceipts }),
    ),
  );

  const livenessIssues = [];
  const livenessEvents = [];
  for (const cycle of activationLifecycles.cycles) {
    const outcome = selectedEvents.find(
      (event) =>
        event.agentId === cycle.resident.agentId &&
        event.sequence > cycle.assignment.sequence &&
        (!cycle.terminal || event.sequence <= cycle.terminal.sequence) &&
        (event.kind === 'agent.blocked' || event === cycle.terminal),
    );
    if (!outcome) {
      livenessIssues.push(
        `${cycle.resident.agentId} activation ${cycle.assignment.taskId} has no terminal or factual blocker`,
      );
      continue;
    }
    livenessEvents.push(cycle.assignment, outcome);
    const assignmentTime = Date.parse(cycle.assignment.occurredAt);
    const outcomeTime = Date.parse(outcome.occurredAt);
    if (
      !Number.isFinite(assignmentTime) ||
      !Number.isFinite(outcomeTime) ||
      outcomeTime < assignmentTime ||
      outcomeTime - assignmentTime > MAX_RUN_MS
    ) {
      livenessIssues.push(
        `${cycle.resident.agentId} activation ${cycle.assignment.taskId} exceeded the 30 minute window`,
      );
    }
  }
  assertions.push(
    assertion(
      'liveness.thirty_minutes',
      livenessIssues.length === 0 ? 'pass' : 'fail',
      livenessIssues.length === 0
        ? 'Every resident activation finished or surfaced a factual blocker within 30 minutes of assignment.'
        : 'One or more resident activations exceeded or lacked its assignment-based liveness outcome.',
      evidence({ events: livenessEvents }),
      livenessIssues,
    ),
  );

  const failed = assertions.some((entry) => entry.status === 'fail');
  const inconclusive = assertions.some(
    (entry) => entry.status === 'inconclusive',
  );
  const status = failed ? 'fail' : inconclusive ? 'inconclusive' : 'pass';
  const speechEvents = selectedEvents.filter(
    (event) => event.kind === 'proximity.spoken',
  );
  const seatingEvents = selectedEvents.filter(
    (event) =>
      event.kind === 'world.interaction' &&
      event.payload.verb === 'use' &&
      SEATED_RESOURCE_IDS.has(event.payload.entityId),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    qualificationVersion: QUALIFICATION_VERSION,
    runId,
    provenance: rosterProvenance(roster),
    status,
    counts: {
      events: selectedEvents.length,
      rejectionReceipts: selectedReceipts.length,
      assertions: assertions.length,
      passed: assertions.filter((entry) => entry.status === 'pass').length,
      failed: assertions.filter((entry) => entry.status === 'fail').length,
      inconclusive: assertions.filter(
        (entry) => entry.status === 'inconclusive',
      ).length,
    },
    coverage: {
      situatedSpeech: evidence({ events: speechEvents }),
      seating: evidence({ events: seatingEvents }),
    },
    assertions,
  };
}

export function renderTerminalSummary(report) {
  const lines = [
    `Arena qualification ${report.status.toUpperCase()} — ${report.runId}`,
    `${report.counts.passed} pass, ${report.counts.failed} fail, ${report.counts.inconclusive} inconclusive`,
  ];
  for (const result of report.assertions.filter(
    (entry) => entry.status !== 'pass',
  ))
    lines.push(`- ${result.status}: ${result.id} — ${result.summary}`);
  return lines.join('\n');
}

function usage() {
  return `Usage: node scripts/arena-eval.mjs --run current|RUN_ID --roster PATH [--data-dir PATH]`;
}

function parseArgs(argv) {
  const options = { dataDir: resolve(process.cwd(), '.arena') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!new Set(['--run', '--roster', '--data-dir']).has(arg))
      throw new ArenaEvalInputError(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--'))
      throw new ArenaEvalInputError(`${arg} requires a value`);
    const key = arg === '--data-dir' ? 'dataDir' : arg.slice(2);
    if (options[key] !== undefined && key !== 'dataDir')
      throw new ArenaEvalInputError(`${arg} may be provided only once`);
    options[key] = value;
    index += 1;
  }
  if (!options.run) throw new ArenaEvalInputError('--run is required');
  if (!options.roster) throw new ArenaEvalInputError('--roster is required');
  options.dataDir = resolve(options.dataDir);
  options.roster = resolve(options.roster);
  return options;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const eventText = await readFile(
    resolve(options.dataDir, 'events.jsonl'),
    'utf8',
  );
  const receiptText = await readOptional(
    resolve(options.dataDir, 'action-rejections.jsonl'),
  );
  let roster;
  try {
    roster = JSON.parse(await readFile(options.roster, 'utf8'));
  } catch (error) {
    throw new ArenaEvalInputError(`Cannot read roster JSON: ${error.message}`);
  }
  let runId = options.run === 'current' ? undefined : options.run;
  if (runId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(runId))
    throw new ArenaEvalInputError(
      'selected run id is not safe for an output filename',
    );
  if (runId === undefined) {
    const eventEnvelopes = parseJsonLines(eventText, {
      label: resolve(options.dataDir, 'events.jsonl'),
      validate: (record) =>
        hasText(record, 'runId') ? [] : ['runId is required'],
    });
    runId = resolveRunId(eventEnvelopes, options.run);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(runId)) {
      throw new ArenaEvalInputError(
        'selected run id is not safe for an output filename',
      );
    }
  }
  const events = parseJsonLines(eventText, {
    label: resolve(options.dataDir, 'events.jsonl'),
    validate: validateEventRecord,
    selectedRunId: runId,
  });
  const receipts = parseJsonLines(receiptText, {
    label: resolve(options.dataDir, 'action-rejections.jsonl'),
    validate: validateRejectionReceipt,
    selectedRunId: runId,
  });
  const report = evaluateArenaRun({ runId, events, receipts, roster });
  const outputDir = resolve(process.cwd(), 'outputs', 'evaluations');
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `${runId}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(renderTerminalSummary(report));
  console.log(`Report: ${outputPath}`);
  return report.status === 'pass' ? 0 : 1;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    const prefix =
      error instanceof ArenaEvalInputError ? 'Input error' : 'Evaluation error';
    console.error(`${prefix}: ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
  }
}
