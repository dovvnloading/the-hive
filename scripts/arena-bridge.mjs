#!/usr/bin/env node

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  AUTONOMY_DIRECTIVE,
  SELF_DIRECTED_DIRECTIVE,
  FACILITY_PROPS,
  FACILITY_RESOURCES,
  FACILITY_ROOMS,
  LIGHT_SWITCH_REACH_PX,
  RESIDENT_BODY_CLEARANCE_PX,
  RESIDENT_CONVERSATION_RANGE_PX,
  RESEARCH_TRACKS,
  inferToolCapability,
  neighborsForLocation,
  residentPurposeProfile,
  resourceById,
  roomForLocation,
  worldEntityById,
  worldLocationById,
} from '../lib/arena/facility-protocol.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1024 * 1024;
const TRAVEL_SPEED_PX_PER_SECOND = Math.max(
  1,
  Number(process.env.ARENA_TRAVEL_SPEED_PX_PER_SECOND) || 96,
);
const MIN_TRAVEL_MS = Math.max(
  0,
  Number(process.env.ARENA_MIN_TRAVEL_MS) || 450,
);
const DEFAULT_BROWSER_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const EVENT_KINDS = new Set([
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

const BOARD_EVENT_KINDS = new Set(['board.message', 'board.acknowledged']);
const CHAT_EVENT_KINDS = new Set(['chat.ingress', 'chat.relay']);
const WORLD_EVENT_KINDS = new Set(['world.navigation', 'world.interaction']);
const SOCIAL_EVENT_KINDS = new Set(['proximity.spoken']);
const CHAT_RELAY_STATES = new Set([
  'claimed',
  'dispatched',
  'completed',
  'failed',
]);
const CHAT_TERMINAL_STATES = new Set(['completed', 'failed']);
const BOARD_MESSAGE_TYPES = new Set([
  'update',
  'question',
  'decision',
  'handoff',
]);
const BOARD_ACK_STATES = new Set(['read', 'acknowledged', 'resolved']);
const BOARD_ACK_RANK = { read: 1, acknowledged: 2, resolved: 3 };
const PROXIMITY_SPEECH_ACTS = new Set(['say', 'invite', 'accept', 'decline']);
const COLLABORATION_MODES = new Set(['collaborate', 'recruit']);
const ASSIGNMENT_MODES = new Set(['directed', 'self-directed']);
const TOOL_CAPABILITIES = new Set([
  'search',
  'browse',
  'read',
  'shell',
  'filesystem',
  'connector',
  'edit',
  'build',
  'test',
  'review',
  'publish',
  'communicate',
  'context',
]);
const RESEARCH_TOPIC_STATES = new Set([
  'active',
  'blocked',
  'complete',
  'dropped',
]);
const ARTIFACT_KINDS = new Set([
  'source-note',
  'change',
  'test-result',
  'decision',
]);
const MAX_BOARD_TEXT_LENGTH = 2_000;
const MAX_BOARD_TOPIC_LENGTH = 80;
const MAX_BOARD_RECIPIENTS = 8;
const MAX_PRIVATE_NOTE_TITLE_LENGTH = 120;
const MAX_PRIVATE_NOTE_TEXT_LENGTH = 4_000;
const PRIVATE_JOURNAL_RESOURCE_ID = 'context-kiosk';
const PRIVATE_JOURNAL_NOTICE =
  'This volume is private to you. Other residents cannot read its pages.';
const MAX_PROXIMITY_TEXT_LENGTH = 1_600;
const MAX_COLLABORATION_OBJECTIVE_LENGTH = 800;
const SOCIAL_RANGE_PX = Math.max(
  RESIDENT_BODY_CLEARANCE_PX + 8,
  Number(process.env.ARENA_SOCIAL_RANGE_PX) || RESIDENT_CONVERSATION_RANGE_PX,
);
const MAX_CHAT_PROMPT_LENGTH = 500_000;
const MAX_CHAT_SUMMARY_LENGTH = 800;
const MAX_CHAT_TARGETS = 8;

const AGENT_PHASES = new Set([
  'spawning',
  'planning',
  'delegating',
  'researching',
  'implementing',
  'tooling',
  'verifying',
  'synthesizing',
  'waiting',
  'completed',
  'failed',
  'canceled',
]);

const AGENT_EVENT_KINDS = new Set(
  [...EVENT_KINDS].filter(
    (kind) => !kind.startsWith('run.') && !kind.startsWith('chat.'),
  ),
);

const OPERATOR_INTENTS = new Set([
  'SubmitObjective',
  'ReplyToPrompt',
  'ApprovePrompt',
  'SendFollowUp',
  'InterruptAgent',
  'CancelRun',
  'RetryRun',
]);

function parseArguments(argv) {
  const options = {
    port: Number(process.env.ARENA_BRIDGE_PORT || DEFAULT_PORT),
    dataDir: process.env.ARENA_DATA_DIR || resolve(process.cwd(), '.arena'),
    allowedOrigins: new Set(
      (process.env.ARENA_ALLOWED_ORIGINS || DEFAULT_BROWSER_ORIGINS.join(','))
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const [name, inlineValue] = token.split(/=(.*)/s, 2);
    if (name === '--port') {
      const value = inlineValue ?? argv[++index];
      options.port = Number(value);
    } else if (name === '--data-dir') {
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error('--data-dir requires a path');
      options.dataDir = resolve(value);
    } else if (name === '--help' || name === '-h') {
      process.stdout.write(
        'Usage: node scripts/arena-bridge.mjs [--port 8787] [--data-dir .arena]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown bridge option: ${token}`);
    }
  }

  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  ) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(record, key) {
  return typeof record[key] === 'string' && record[key].trim().length > 0;
}

function optionalText(record, key) {
  return record[key] === undefined || typeof record[key] === 'string';
}

function optionalTextArray(record, key) {
  return (
    record[key] === undefined ||
    (Array.isArray(record[key]) &&
      record[key].every(
        (value) => typeof value === 'string' && value.trim().length > 0,
      ))
  );
}

function assertPayload(kind, payload) {
  if (!isRecord(payload)) return 'payload must be a JSON object';

  switch (kind) {
    case 'run.started':
      return hasText(payload, 'objective')
        ? undefined
        : 'payload.objective is required';
    case 'run.completed':
    case 'agent.completed':
      return hasText(payload, 'summary')
        ? undefined
        : 'payload.summary is required';
    case 'run.canceled':
    case 'agent.stopped':
      return hasText(payload, 'reason')
        ? undefined
        : 'payload.reason is required';
    case 'chat.ingress':
      if (
        !hasText(payload, 'ingressId') ||
        !hasText(payload, 'sessionId') ||
        !hasText(payload, 'turnId') ||
        !hasText(payload, 'prompt') ||
        !hasText(payload, 'capturedAt')
      ) {
        return 'payload.ingressId, payload.sessionId, payload.turnId, payload.prompt, and payload.capturedAt are required';
      }
      return Number.isNaN(Date.parse(payload.capturedAt))
        ? 'payload.capturedAt must be an ISO timestamp'
        : undefined;
    case 'chat.relay':
      if (!hasText(payload, 'ingressId') || !hasText(payload, 'summary')) {
        return 'payload.ingressId and payload.summary are required';
      }
      if (!CHAT_RELAY_STATES.has(payload.state)) {
        return 'payload.state is invalid';
      }
      return Array.isArray(payload.targetAgentIds) &&
        payload.targetAgentIds.every(
          (agentId) => typeof agentId === 'string' && agentId.trim(),
        )
        ? undefined
        : 'payload.targetAgentIds must be an array of agent ids';
    case 'agent.spawned':
      return hasText(payload, 'name') && hasText(payload, 'role')
        ? undefined
        : 'payload.name and payload.role are required';
    case 'task.assigned':
      if (!hasText(payload, 'objective'))
        return 'payload.objective is required';
      return payload.mode === undefined || ASSIGNMENT_MODES.has(payload.mode)
        ? undefined
        : 'payload.mode must be directed or self-directed';
    case 'world.navigation':
      if (
        !hasText(payload, 'actionId') ||
        !hasText(payload, 'observationId') ||
        !hasText(payload, 'fromLocationId') ||
        !hasText(payload, 'toLocationId') ||
        !hasText(payload, 'startedAt') ||
        !hasText(payload, 'arrivesAt')
      ) {
        return 'world navigation requires action, observation, location, and timing fields';
      }
      if (
        Number.isNaN(Date.parse(payload.startedAt)) ||
        Number.isNaN(Date.parse(payload.arrivesAt))
      ) {
        return 'world navigation timestamps must be valid ISO timestamps';
      }
      return optionalText(payload, 'reason')
        ? undefined
        : 'payload.reason must be a string';
    case 'world.interaction':
      if (
        !hasText(payload, 'actionId') ||
        !hasText(payload, 'observationId') ||
        !hasText(payload, 'locationId') ||
        !hasText(payload, 'entityId') ||
        !hasText(payload, 'verb') ||
        !hasText(payload, 'result') ||
        !Number.isSafeInteger(payload.stateVersion) ||
        !isRecord(payload.state)
      ) {
        return 'world interaction requires action, observation, entity, result, version, and state fields';
      }
      return Object.values(payload.state).every(
        (value) =>
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean',
      )
        ? undefined
        : 'payload.state values must be scalar';
    case 'agent.activity':
      if (!AGENT_PHASES.has(payload.phase)) return 'payload.phase is invalid';
      if (!new Set(['working', 'idle', 'blocked']).has(payload.status)) {
        return 'payload.status must be working, idle, or blocked';
      }
      return hasText(payload, 'summary')
        ? undefined
        : 'payload.summary is required';
    case 'tool.started':
      if (
        !hasText(payload, 'toolCallId') ||
        !hasText(payload, 'tool') ||
        !hasText(payload, 'summary') ||
        !hasText(payload, 'resourceId')
      ) {
        return 'payload.toolCallId, payload.tool, payload.summary, and payload.resourceId are required';
      }
      if (
        payload.capability !== undefined &&
        !TOOL_CAPABILITIES.has(payload.capability)
      ) {
        return 'payload.capability is invalid';
      }
      return optionalText(payload, 'topicId')
        ? undefined
        : 'payload.topicId must be a string';
    case 'tool.finished':
      if (!hasText(payload, 'toolCallId'))
        return 'payload.toolCallId is required';
      if (!new Set(['succeeded', 'failed']).has(payload.outcome)) {
        return 'payload.outcome must be succeeded or failed';
      }
      if (!optionalText(payload, 'summary'))
        return 'payload.summary must be a string';
      return optionalTextArray(payload, 'artifactIds')
        ? undefined
        : 'payload.artifactIds must be an array of ids';
    case 'research.topic.selected':
      if (
        !hasText(payload, 'topicId') ||
        !hasText(payload, 'title') ||
        !hasText(payload, 'question')
      ) {
        return 'payload.topicId, payload.title, and payload.question are required';
      }
      return optionalText(payload, 'parentTopicId') &&
        optionalText(payload, 'reason')
        ? undefined
        : 'payload.parentTopicId and payload.reason must be strings';
    case 'research.topic.updated':
      if (!hasText(payload, 'topicId')) return 'payload.topicId is required';
      if (!RESEARCH_TOPIC_STATES.has(payload.status))
        return 'payload.status is invalid';
      return optionalText(payload, 'summary')
        ? undefined
        : 'payload.summary must be a string';
    case 'artifact.recorded':
      if (
        !hasText(payload, 'artifactId') ||
        !hasText(payload, 'title') ||
        !hasText(payload, 'summary')
      ) {
        return 'payload.artifactId, payload.title, and payload.summary are required';
      }
      if (!ARTIFACT_KINDS.has(payload.kind)) return 'payload.kind is invalid';
      return optionalText(payload, 'uri') && optionalText(payload, 'topicId')
        ? undefined
        : 'payload.uri and payload.topicId must be strings';
    case 'agent.message':
      if (!new Set(['commentary', 'final']).has(payload.channel)) {
        return 'payload.channel must be commentary or final';
      }
      if (!hasText(payload, 'text')) return 'payload.text is required';
      return optionalText(payload, 'targetAgentId')
        ? undefined
        : 'payload.targetAgentId must be a string';
    case 'proximity.spoken':
      if (
        !hasText(payload, 'actionId') ||
        !hasText(payload, 'observationId') ||
        !hasText(payload, 'speechId') ||
        !hasText(payload, 'speakerLocationId') ||
        !hasText(payload, 'targetLocationId') ||
        !hasText(payload, 'targetAgentId') ||
        !hasText(payload, 'text') ||
        !hasText(payload, 'preview') ||
        typeof payload.distancePx !== 'number'
      ) {
        return 'proximity speech requires action, observation, speech, locations, target, distance, text, and preview fields';
      }
      if (!PROXIMITY_SPEECH_ACTS.has(payload.speechAct)) {
        return 'payload.speechAct is invalid';
      }
      if (!optionalText(payload, 'replyToSpeechId')) {
        return 'payload.replyToSpeechId must be a string';
      }
      if (!optionalText(payload, 'invitationId')) {
        return 'payload.invitationId must be a string';
      }
      if (
        payload.invitationMode !== undefined &&
        !COLLABORATION_MODES.has(payload.invitationMode)
      ) {
        return 'payload.invitationMode is invalid';
      }
      if (!optionalText(payload, 'objective')) {
        return 'payload.objective must be a string';
      }
      return Array.isArray(payload.heardByAgentIds) &&
        payload.heardByAgentIds.every(
          (agentId) => typeof agentId === 'string' && agentId.trim(),
        )
        ? undefined
        : 'payload.heardByAgentIds must be an array of identity ids';
    case 'board.message':
      if (
        !hasText(payload, 'messageId') ||
        !hasText(payload, 'clientMessageId') ||
        !hasText(payload, 'threadId') ||
        !hasText(payload, 'topic') ||
        !hasText(payload, 'text')
      ) {
        return 'payload.messageId, payload.clientMessageId, payload.threadId, payload.topic, and payload.text are required';
      }
      if (!BOARD_MESSAGE_TYPES.has(payload.messageType)) {
        return 'payload.messageType is invalid';
      }
      if (!new Set(['broadcast', 'direct']).has(payload.audience)) {
        return 'payload.audience must be broadcast or direct';
      }
      if (
        !Array.isArray(payload.recipientAgentIds) ||
        payload.recipientAgentIds.some(
          (agentId) => typeof agentId !== 'string' || !agentId.trim(),
        )
      ) {
        return 'payload.recipientAgentIds must be an array of agent ids';
      }
      if (!optionalText(payload, 'topicId')) {
        return 'payload.topicId must be a string';
      }
      if (!optionalTextArray(payload, 'artifactIds')) {
        return 'payload.artifactIds must be an array of ids';
      }
      if (
        payload.audience === 'broadcast' &&
        payload.recipientAgentIds.length > 0
      ) {
        return 'broadcast messages cannot declare recipients';
      }
      if (
        payload.audience === 'direct' &&
        payload.recipientAgentIds.length === 0
      ) {
        return 'direct messages require recipients';
      }
      return optionalText(payload, 'replyToMessageId')
        ? undefined
        : 'payload.replyToMessageId must be a string';
    case 'board.acknowledged':
      if (!hasText(payload, 'messageId')) {
        return 'payload.messageId is required';
      }
      return BOARD_ACK_STATES.has(payload.state)
        ? undefined
        : 'payload.state must be read, acknowledged, or resolved';
    case 'agent.blocked':
      if (!hasText(payload, 'promptId') || !hasText(payload, 'request')) {
        return 'payload.promptId and payload.request are required';
      }
      return new Set(['approval', 'question', 'error']).has(payload.reason)
        ? undefined
        : 'payload.reason must be approval, question, or error';
    case 'agent.resumed':
      if (!hasText(payload, 'promptId')) return 'payload.promptId is required';
      return optionalText(payload, 'response')
        ? undefined
        : 'payload.response must be a string';
    case 'agent.failed':
      return hasText(payload, 'error')
        ? undefined
        : 'payload.error is required';
    default:
      return `Unsupported event kind: ${kind}`;
  }
}

function validateIntent(intent) {
  if (!isRecord(intent) || !OPERATOR_INTENTS.has(intent.type)) {
    return 'intent.type is not supported';
  }

  switch (intent.type) {
    case 'SubmitObjective':
      return hasText(intent, 'objective')
        ? undefined
        : 'intent.objective is required';
    case 'ReplyToPrompt':
      return hasText(intent, 'promptId') && hasText(intent, 'content')
        ? undefined
        : 'intent.promptId and intent.content are required';
    case 'ApprovePrompt':
      return hasText(intent, 'promptId') && typeof intent.approved === 'boolean'
        ? undefined
        : 'intent.promptId and boolean intent.approved are required';
    case 'SendFollowUp':
      return hasText(intent, 'agentId') && hasText(intent, 'content')
        ? undefined
        : 'intent.agentId and intent.content are required';
    case 'InterruptAgent':
      return hasText(intent, 'agentId')
        ? undefined
        : 'intent.agentId is required';
    case 'CancelRun':
      return optionalText(intent, 'reason')
        ? undefined
        : 'intent.reason must be a string';
    case 'RetryRun':
      return undefined;
    default:
      return 'intent.type is not supported';
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readState(path, events, intents) {
  let saved = {};
  if (existsSync(path)) {
    try {
      saved = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      saved = {};
    }
  }

  const lastEvent = events.at(-1);
  const lastIntent = intents.at(-1);
  return {
    schemaVersion: 1,
    runId:
      typeof saved.runId === 'string'
        ? saved.runId
        : typeof lastEvent?.runId === 'string'
          ? lastEvent.runId
          : null,
    sequence: Math.max(
      Number(saved.sequence) || 0,
      Number(lastEvent?.sequence) || 0,
    ),
    intentSequence: Math.max(
      Number(saved.intentSequence) || 0,
      Number(lastIntent?.sequence) || 0,
    ),
    startedAt: typeof saved.startedAt === 'string' ? saved.startedAt : null,
    updatedAt: new Date().toISOString(),
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !options.allowedOrigins.has(origin))
    return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

function writeJson(request, response, status, body, extraHeaders = {}) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Content-Type, X-Arena-Agent-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(serialized),
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    ...extraHeaders,
  });
  response.end(serialized);
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('Request body exceeds 1 MiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(new Error('Request body must be valid JSON'));
      }
    });
    request.on('error', rejectBody);
  });
}

function parseAfter(url) {
  const raw = url.searchParams.get('after') ?? '0';
  const after = Number(raw);
  if (!Number.isSafeInteger(after) || after < 0) return undefined;
  return after;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertSafeBoardText(value, label, maximum) {
  const text = normalizedText(value);
  if (!text) throw httpError(400, `${label} is required`);
  if (text.length > maximum) {
    throw httpError(400, `${label} cannot exceed ${maximum} characters`);
  }
  if (/\p{Cc}/u.test(text.replace(/[\t\n\r]/g, ''))) {
    throw httpError(400, `${label} contains unsupported control characters`);
  }
  if (/[\u202a-\u202e\u2066-\u2069]/iu.test(text)) {
    throw httpError(400, `${label} contains unsupported direction controls`);
  }
  return text;
}

const options = parseArguments(process.argv.slice(2));
mkdirSync(options.dataDir, { recursive: true });

const statePath = resolve(options.dataDir, 'state.json');
const eventsPath = resolve(options.dataDir, 'events.jsonl');
const intentsPath = resolve(options.dataDir, 'intents.jsonl');
const chatIngressPath = resolve(options.dataDir, 'chat-ingress.jsonl');
const emitterTokenPath = resolve(options.dataDir, 'emitter-token');
const chatTokenPath = resolve(options.dataDir, 'chat-token');
const agentCredentialsPath = resolve(options.dataDir, 'agent-credentials.json');
const privateJournalPath = resolve(options.dataDir, 'private-journals.jsonl');

function loadLocalToken(path, configuredValue) {
  const configured = configuredValue?.trim();
  if (configured) return configured;

  if (existsSync(path)) {
    const saved = readFileSync(path, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }

  const created = randomBytes(32).toString('base64url');
  writeFileSync(path, `${created}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return created;
}

const emitterToken = loadLocalToken(
  emitterTokenPath,
  process.env.ARENA_EMITTER_TOKEN,
);
const chatToken = loadLocalToken(chatTokenPath, process.env.ARENA_CHAT_TOKEN);

function credentialHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readAgentCredentials() {
  if (!existsSync(agentCredentialsPath)) return {};
  try {
    const saved = JSON.parse(readFileSync(agentCredentialsPath, 'utf8'));
    return isRecord(saved) ? saved : {};
  } catch {
    return {};
  }
}

let agentCredentials = readAgentCredentials();

function persistAgentCredentials() {
  writeFileSync(
    agentCredentialsPath,
    `${JSON.stringify(agentCredentials, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function issueAgentCredential(agentId) {
  const token = randomBytes(32).toString('base64url');
  agentCredentials[agentId] = {
    hash: credentialHash(token),
    runId: state.runId,
    issuedAt: new Date().toISOString(),
  };
  persistAgentCredentials();
  return token;
}

function hasEmitterAuthority(request) {
  const raw = request.headers['x-arena-emitter-token'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(emitterToken);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function hasChatAuthority(request) {
  const raw = request.headers['x-arena-chat-token'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(chatToken);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function agentAuthority(request) {
  const raw = request.headers['x-arena-agent-token'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string' || candidate.length < 32) return undefined;
  const suppliedHash = Buffer.from(credentialHash(candidate));
  for (const [agentId, credential] of Object.entries(agentCredentials)) {
    if (
      !isRecord(credential) ||
      credential.runId !== state.runId ||
      typeof credential.hash !== 'string'
    ) {
      continue;
    }
    const expectedHash = Buffer.from(credential.hash);
    if (
      suppliedHash.length === expectedHash.length &&
      timingSafeEqual(suppliedHash, expectedHash)
    ) {
      return agentId;
    }
  }
  return undefined;
}

const events = readJsonLines(eventsPath);
const intents = readJsonLines(intentsPath);
const privateJournalEntries = readJsonLines(privateJournalPath);
const state = readState(statePath, events, intents);

function persistState() {
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function resetRun() {
  const now = new Date().toISOString();
  state.runId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  state.startedAt = now;
  agentCredentials = {};
  persistAgentCredentials();
  persistState();
}

function currentRunEvents() {
  return state.runId
    ? events.filter((event) => event.runId === state.runId)
    : [];
}

function currentRunIntents() {
  return state.runId
    ? intents.filter((intent) => intent.runId === state.runId)
    : [];
}

function currentBoardMessages() {
  return currentRunEvents().filter((event) => event.kind === 'board.message');
}

function currentBoardAcknowledgements() {
  return currentRunEvents().filter(
    (event) => event.kind === 'board.acknowledged',
  );
}

function privateJournalForAgent(agentId) {
  return privateJournalEntries.filter(
    (entry) =>
      isRecord(entry) &&
      entry.schemaVersion === 1 &&
      entry.runId === state.runId &&
      entry.agentId === agentId,
  );
}

function currentProximitySpeech() {
  return currentRunEvents().filter(
    (event) => event.kind === 'proximity.spoken',
  );
}

function speechById(speechId) {
  return currentProximitySpeech().find(
    (event) => event.payload.speechId === speechId,
  );
}

function invitationById(invitationId) {
  return currentProximitySpeech().find(
    (event) =>
      event.payload.speechAct === 'invite' &&
      event.payload.invitationId === invitationId,
  );
}

function invitationResponse(invitationId) {
  return currentProximitySpeech().find(
    (event) =>
      new Set(['accept', 'decline']).has(event.payload.speechAct) &&
      event.payload.invitationId === invitationId,
  );
}

function proximitySpeechVisibleTo(event, agentId) {
  return (
    event.agentId === agentId || event.payload.heardByAgentIds.includes(agentId)
  );
}

function currentResearchEvents() {
  return currentRunEvents().filter((event) =>
    new Set(['research.topic.selected', 'research.topic.updated']).has(
      event.kind,
    ),
  );
}

function researchSelection(topicId) {
  return currentResearchEvents().find(
    (event) =>
      event.kind === 'research.topic.selected' &&
      event.payload.topicId === topicId,
  );
}

function currentArtifacts() {
  return currentRunEvents().filter(
    (event) => event.kind === 'artifact.recorded',
  );
}

function artifactEvent(artifactId) {
  return currentArtifacts().find(
    (event) => event.payload.artifactId === artifactId,
  );
}

function spawnedAgentIds() {
  return new Set(
    currentRunEvents()
      .filter((event) => event.kind === 'agent.spawned')
      .map((event) => event.agentId),
  );
}

function currentRunIsClosed() {
  return currentRunEvents().some((event) =>
    new Set(['run.completed', 'run.canceled']).has(event.kind),
  );
}

function assertChatIdentifier(value, label) {
  const identifier = normalizedText(value);
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(identifier)) {
    throw httpError(
      400,
      `${label} must be 1-200 letters, digits, dots, colons, underscores, or hyphens`,
    );
  }
  return identifier;
}

function normalizeChatIngress(body) {
  if (!isRecord(body)) throw httpError(400, 'Request body must be an object');
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) throw httpError(400, 'prompt is required');
  if (prompt.length > MAX_CHAT_PROMPT_LENGTH) {
    throw httpError(
      400,
      `prompt cannot exceed ${MAX_CHAT_PROMPT_LENGTH} characters`,
    );
  }
  if (prompt.includes(String.fromCharCode(0))) {
    throw httpError(400, 'prompt contains an unsupported null character');
  }
  const capturedAt = normalizedText(body.capturedAt);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    throw httpError(400, 'capturedAt must be an ISO timestamp');
  }
  return {
    ingressId: assertChatIdentifier(body.ingressId, 'ingressId'),
    sessionId: assertChatIdentifier(body.sessionId, 'sessionId'),
    turnId: assertChatIdentifier(body.turnId, 'turnId'),
    prompt,
    capturedAt,
  };
}

function allChatIngressEvents() {
  return events.filter((event) => event.kind === 'chat.ingress');
}

function ingressEvent(ingressId) {
  return allChatIngressEvents().find(
    (event) => event.payload.ingressId === ingressId,
  );
}

function relayEvents(ingressId) {
  return events.filter(
    (event) =>
      event.kind === 'chat.relay' && event.payload.ingressId === ingressId,
  );
}

function sameChatIngress(existing, normalized) {
  const payload = existing.payload;
  return (
    payload.ingressId === normalized.ingressId &&
    payload.sessionId === normalized.sessionId &&
    payload.turnId === normalized.turnId &&
    payload.prompt === normalized.prompt &&
    payload.capturedAt === normalized.capturedAt
  );
}

function appendChatIngress(body) {
  const normalized = normalizeChatIngress(body);
  const prior = ingressEvent(normalized.ingressId);
  if (prior) {
    if (!sameChatIngress(prior, normalized)) {
      throw httpError(409, 'ingressId was already used for another chat turn');
    }
    return { event: prior, created: false };
  }

  if (!state.runId || currentRunIsClosed()) {
    appendEvent({
      kind: 'run.started',
      reset: true,
      payload: { objective: normalized.prompt },
      correlationId: normalized.ingressId,
    });
  }

  const event = appendEvent(
    {
      kind: 'chat.ingress',
      correlationId: normalized.ingressId,
      payload: normalized,
    },
    'operator',
  );
  return { event, created: true };
}

function normalizeChatTargets(value, { allowOmitted = false } = {}) {
  if (value === undefined && allowOmitted) return undefined;
  if (!Array.isArray(value)) {
    throw httpError(400, 'targetAgentIds must be an array');
  }
  const targets = value.map((agentId) =>
    assertChatIdentifier(agentId, 'targetAgentId'),
  );
  if (targets.length > MAX_CHAT_TARGETS) {
    throw httpError(
      400,
      `targetAgentIds cannot contain more than ${MAX_CHAT_TARGETS} agents`,
    );
  }
  if (new Set(targets).size !== targets.length) {
    throw httpError(400, 'targetAgentIds cannot contain duplicates');
  }
  return targets;
}

function chatStatus(ingressId) {
  const ingress = ingressEvent(ingressId);
  if (!ingress) return undefined;
  const relays = relayEvents(ingressId);
  const latest = relays.at(-1);
  return {
    schemaVersion: 1,
    ingress,
    relays,
    state: latest?.payload.state ?? 'received',
    summary: latest?.payload.summary,
    targetAgentIds: latest?.payload.targetAgentIds ?? [],
    terminal: latest ? CHAT_TERMINAL_STATES.has(latest.payload.state) : false,
  };
}

function appendChatRelay(body) {
  if (!isRecord(body)) throw httpError(400, 'Request body must be an object');
  const ingressId = assertChatIdentifier(body.ingressId, 'ingressId');
  const ingress = ingressEvent(ingressId);
  if (!ingress) throw httpError(404, 'ingressId is not journaled');
  if (ingress.runId !== state.runId) {
    throw httpError(409, 'ingressId does not belong to the current run');
  }
  if (!CHAT_RELAY_STATES.has(body.state)) {
    throw httpError(
      400,
      'state must be claimed, dispatched, completed, or failed',
    );
  }
  const summary = assertSafeBoardText(
    body.summary,
    'summary',
    MAX_CHAT_SUMMARY_LENGTH,
  );
  const prior = relayEvents(ingressId).at(-1);
  const priorState = prior?.payload.state ?? 'received';
  const requestedTargets = normalizeChatTargets(body.targetAgentIds, {
    allowOmitted: true,
  });
  const targetAgentIds =
    requestedTargets ?? prior?.payload.targetAgentIds ?? [];

  const allowedTransitions = {
    received: new Set(['claimed', 'failed']),
    claimed: new Set(['dispatched', 'completed', 'failed']),
    dispatched: new Set(['completed', 'failed']),
    completed: new Set(),
    failed: new Set(),
  };

  if (body.state === priorState) {
    if (
      prior &&
      prior.payload.summary === summary &&
      sameStringArray(prior.payload.targetAgentIds, targetAgentIds)
    ) {
      return { event: prior, created: false };
    }
    throw httpError(409, `chat relay is already ${priorState}`);
  }
  if (!allowedTransitions[priorState].has(body.state)) {
    throw httpError(
      409,
      `chat relay cannot move from ${priorState} to ${body.state}`,
    );
  }
  if (body.state === 'claimed' && targetAgentIds.length > 0) {
    throw httpError(400, 'claimed cannot declare target agents');
  }
  if (body.state === 'dispatched' && targetAgentIds.length === 0) {
    throw httpError(400, 'dispatched requires at least one target agent');
  }
  if (body.state === 'dispatched') {
    const known = spawnedAgentIds();
    const unknown = targetAgentIds.find((agentId) => !known.has(agentId));
    if (unknown)
      throw httpError(
        409,
        `Target agent ${unknown} is not spawned in this run`,
      );
  }

  const event = appendEvent({
    kind: 'chat.relay',
    correlationId: ingressId,
    payload: {
      ingressId,
      state: body.state,
      targetAgentIds,
      summary,
    },
  });
  return { event, created: true };
}

function syncChatIngressJournal() {
  for (const record of readJsonLines(chatIngressPath)) {
    try {
      appendChatIngress(record);
    } catch (error) {
      process.stderr.write(
        `[arena-bridge] skipped invalid chat ingress record: ${error.message}\n`,
      );
    }
  }
}

function agentIsTerminal(agentId) {
  const latest = [...currentRunEvents()]
    .reverse()
    .find((event) => event.agentId === agentId);
  return Boolean(
    latest &&
    new Set(['agent.completed', 'agent.failed', 'agent.stopped']).has(
      latest.kind,
    ),
  );
}

function assertActiveAgent(agentId) {
  if (!state.runId) throw httpError(409, 'No active run');
  if (!spawnedAgentIds().has(agentId)) {
    throw httpError(403, 'The authenticated agent is not spawned in this run');
  }

  if (currentRunIsClosed()) throw httpError(409, 'The current run is closed');

  if (agentIsTerminal(agentId)) {
    throw httpError(409, 'The authenticated agent is no longer active');
  }
}

function normalizeRecipientAgentIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw httpError(400, 'recipientAgentIds must be an array');
  }
  const recipients = value.map((agentId) => normalizedText(agentId));
  if (recipients.some((agentId) => !agentId)) {
    throw httpError(400, 'recipientAgentIds cannot contain empty ids');
  }
  if (recipients.length > MAX_BOARD_RECIPIENTS) {
    throw httpError(
      400,
      `recipientAgentIds cannot contain more than ${MAX_BOARD_RECIPIENTS} agents`,
    );
  }
  if (new Set(recipients).size !== recipients.length) {
    throw httpError(400, 'recipientAgentIds cannot contain duplicates');
  }
  return recipients;
}

function normalizeOptionalIds(value, label, maximum = 32) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw httpError(400, `${label} must be an array`);
  }
  const ids = value.map((item) => assertChatIdentifier(item, label));
  if (ids.length > maximum) {
    throw httpError(400, `${label} cannot contain more than ${maximum} ids`);
  }
  if (new Set(ids).size !== ids.length) {
    throw httpError(400, `${label} cannot contain duplicates`);
  }
  return ids;
}

function findBoardMessage(messageId) {
  return currentBoardMessages().find(
    (event) => event.payload.messageId === messageId,
  );
}

function messagesInThread(threadId) {
  return currentBoardMessages().filter(
    (event) => event.payload.threadId === threadId,
  );
}

function threadRoot(threadId) {
  return messagesInThread(threadId).at(0);
}

function threadParticipantIds(message) {
  const root = threadRoot(message.payload.threadId) ?? message;
  return new Set([root.agentId, ...root.payload.recipientAgentIds]);
}

function messageVisibleTo(message, agentId) {
  if (message.payload.audience === 'broadcast') return true;
  return threadParticipantIds(message).has(agentId);
}

function latestAcknowledgement(messageId, agentId) {
  return [...currentBoardAcknowledgements()]
    .reverse()
    .find(
      (event) =>
        event.agentId === agentId && event.payload.messageId === messageId,
    );
}

function assertClientMessageId(value) {
  const clientMessageId = normalizedText(value);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(clientMessageId)) {
    throw httpError(
      400,
      'clientMessageId must be 1-128 letters, digits, dots, colons, underscores, or hyphens',
    );
  }
  return clientMessageId;
}

function sameStringArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function boardRequestMatches(existing, body, normalized) {
  const payload = existing.payload;
  if (
    payload.text !== normalized.text ||
    payload.messageType !== normalized.messageType
  ) {
    return false;
  }
  if (
    body.threadId !== undefined &&
    normalizedText(body.threadId) !== payload.threadId
  ) {
    return false;
  }
  if (
    body.replyToMessageId !== undefined &&
    normalizedText(body.replyToMessageId) !== payload.replyToMessageId
  ) {
    return false;
  }
  if (
    body.topic !== undefined &&
    normalizedText(body.topic) !== payload.topic
  ) {
    return false;
  }
  if (body.audience !== undefined && body.audience !== payload.audience) {
    return false;
  }
  if (body.recipientAgentIds !== undefined) {
    const recipients = normalizeRecipientAgentIds(body.recipientAgentIds);
    if (!sameStringArray(recipients, payload.recipientAgentIds)) return false;
  }
  if (
    body.correlationId !== undefined &&
    normalizedText(body.correlationId) !== (existing.correlationId ?? '')
  ) {
    return false;
  }
  if (
    body.topicId !== undefined &&
    normalizedText(body.topicId) !== (payload.topicId ?? '')
  ) {
    return false;
  }
  if (body.artifactIds !== undefined) {
    const artifactIds = normalizeOptionalIds(body.artifactIds, 'artifactIds');
    if (!sameStringArray(artifactIds ?? [], payload.artifactIds ?? []))
      return false;
  }
  return true;
}

function postBoardMessage(agentId, body) {
  assertActiveAgent(agentId);
  assertLocalBoardAccess(agentId);
  if (!isRecord(body)) throw httpError(400, 'Request body must be an object');

  const normalized = {
    clientMessageId: assertClientMessageId(body.clientMessageId),
    text: assertSafeBoardText(body.text, 'text', MAX_BOARD_TEXT_LENGTH),
    messageType: normalizedText(body.messageType || 'update'),
    correlationId: body.correlationId
      ? assertChatIdentifier(body.correlationId, 'correlationId')
      : undefined,
    topicId: body.topicId
      ? assertChatIdentifier(body.topicId, 'topicId')
      : undefined,
    artifactIds: normalizeOptionalIds(body.artifactIds, 'artifactIds'),
  };
  if (!BOARD_MESSAGE_TYPES.has(normalized.messageType)) {
    throw httpError(400, 'messageType is invalid');
  }

  const prior = currentBoardMessages().find(
    (event) =>
      event.agentId === agentId &&
      event.payload.clientMessageId === normalized.clientMessageId,
  );
  if (prior) {
    if (!boardRequestMatches(prior, body, normalized)) {
      throw httpError(
        409,
        'clientMessageId was already used for another message',
      );
    }
    return { event: prior, created: false };
  }

  const requestedThreadId = normalizedText(body.threadId);
  const requestedReplyId = normalizedText(body.replyToMessageId);
  let parent;
  if (requestedReplyId) {
    parent = findBoardMessage(requestedReplyId);
    if (!parent) throw httpError(409, 'replyToMessageId is not in this run');
  } else if (requestedThreadId) {
    parent = messagesInThread(requestedThreadId).at(-1);
    if (!parent) throw httpError(409, 'threadId is not in this run');
  }
  if (
    parent &&
    requestedThreadId &&
    parent.payload.threadId !== requestedThreadId
  ) {
    throw httpError(409, 'replyToMessageId does not belong to threadId');
  }

  let audience;
  let recipientAgentIds;
  let threadId;
  let topic;
  let replyToMessageId;
  let topicId;
  let artifactIds;

  if (parent) {
    const root = threadRoot(parent.payload.threadId);
    const participants = threadParticipantIds(parent);
    if (root.payload.audience === 'direct' && !participants.has(agentId)) {
      throw httpError(403, 'The authenticated agent is not a thread member');
    }
    audience = root.payload.audience;
    recipientAgentIds =
      audience === 'direct'
        ? [...participants].filter((participantId) => participantId !== agentId)
        : [];
    threadId = root.payload.threadId;
    topic = root.payload.topic;
    replyToMessageId = parent.payload.messageId;
    topicId = root.payload.topicId;
    artifactIds = root.payload.artifactIds;

    if (body.audience !== undefined && body.audience !== audience) {
      throw httpError(409, 'Replies cannot change thread audience');
    }
    if (
      body.topic !== undefined &&
      assertSafeBoardText(body.topic, 'topic', MAX_BOARD_TOPIC_LENGTH) !== topic
    ) {
      throw httpError(409, 'Replies cannot change thread topic');
    }
    if (body.recipientAgentIds !== undefined) {
      const requestedRecipients = normalizeRecipientAgentIds(
        body.recipientAgentIds,
      );
      if (!sameStringArray(requestedRecipients, recipientAgentIds)) {
        throw httpError(409, 'Replies cannot change thread membership');
      }
    }
    if (
      body.topicId !== undefined &&
      normalized.topicId !== (topicId ?? undefined)
    ) {
      throw httpError(409, 'Replies cannot change the research topic');
    }
    if (body.artifactIds !== undefined) {
      if (!sameStringArray(normalized.artifactIds ?? [], artifactIds ?? [])) {
        throw httpError(409, 'Replies cannot change linked artifacts');
      }
    }
  } else {
    recipientAgentIds = normalizeRecipientAgentIds(body.recipientAgentIds);
    audience =
      body.audience ?? (recipientAgentIds.length > 0 ? 'direct' : 'broadcast');
    if (!new Set(['broadcast', 'direct']).has(audience)) {
      throw httpError(400, 'audience must be broadcast or direct');
    }
    if (audience === 'broadcast' && recipientAgentIds.length > 0) {
      throw httpError(400, 'Broadcast messages cannot declare recipients');
    }
    if (audience === 'direct' && recipientAgentIds.length === 0) {
      throw httpError(400, 'Direct messages require at least one recipient');
    }
    if (recipientAgentIds.includes(agentId)) {
      throw httpError(400, 'An agent cannot address itself');
    }
    const knownAgents = spawnedAgentIds();
    const unknownRecipient = recipientAgentIds.find(
      (recipientId) => !knownAgents.has(recipientId),
    );
    if (unknownRecipient) {
      throw httpError(400, `Unknown recipient agent: ${unknownRecipient}`);
    }
    threadId = `thread_${randomUUID()}`;
    topic = assertSafeBoardText(
      body.topic ?? 'General',
      'topic',
      MAX_BOARD_TOPIC_LENGTH,
    );
    topicId = normalized.topicId;
    artifactIds = normalized.artifactIds;
  }

  if (topicId && !researchSelection(topicId)) {
    throw httpError(409, 'topicId is not selected in this run');
  }
  const unknownArtifact = artifactIds?.find(
    (artifactId) => !artifactEvent(artifactId),
  );
  if (unknownArtifact) {
    throw httpError(409, `Unknown artifact: ${unknownArtifact}`);
  }

  const payload = {
    messageId: `msg_${randomUUID()}`,
    clientMessageId: normalized.clientMessageId,
    threadId,
    topic,
    messageType: normalized.messageType,
    audience,
    recipientAgentIds,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(artifactIds?.length ? { artifactIds } : {}),
    text: normalized.text,
  };
  const event = appendEvent({
    kind: 'board.message',
    agentId,
    ...(normalized.correlationId
      ? { correlationId: normalized.correlationId }
      : {}),
    payload,
  });
  return { event, created: true };
}

function acknowledgeBoardMessage(agentId, body) {
  assertActiveAgent(agentId);
  assertLocalBoardAccess(agentId);
  if (!isRecord(body)) throw httpError(400, 'Request body must be an object');
  const messageId = normalizedText(body.messageId);
  if (!messageId) throw httpError(400, 'messageId is required');
  if (!BOARD_ACK_STATES.has(body.state)) {
    throw httpError(400, 'state must be read, acknowledged, or resolved');
  }
  const message = findBoardMessage(messageId);
  if (!message) throw httpError(409, 'messageId is not in this run');
  if (message.agentId === agentId) {
    throw httpError(403, 'An agent cannot acknowledge its own message');
  }
  if (!messageVisibleTo(message, agentId)) {
    throw httpError(403, 'The message is not addressed to this agent');
  }

  const prior = latestAcknowledgement(messageId, agentId);
  if (prior?.payload.state === body.state) {
    return { event: prior, created: false };
  }
  if (
    prior &&
    BOARD_ACK_RANK[body.state] < BOARD_ACK_RANK[prior.payload.state]
  ) {
    throw httpError(409, 'Acknowledgement state cannot move backwards');
  }

  const event = appendEvent({
    kind: 'board.acknowledged',
    agentId,
    payload: { messageId, state: body.state },
  });
  return { event, created: true };
}

function readBoard(agentId, url) {
  assertActiveAgent(agentId);
  assertLocalBoardAccess(agentId);
  const after = parseAfter(url);
  if (after === undefined) {
    throw httpError(400, 'after must be a non-negative integer');
  }
  const threadId = normalizedText(
    url.searchParams.get('thread') ?? url.searchParams.get('threadId'),
  );
  const unreadParameter = url.searchParams.get('unread');
  if (
    unreadParameter !== null &&
    unreadParameter !== 'true' &&
    unreadParameter !== 'false'
  ) {
    throw httpError(400, 'unread must be true or false');
  }
  const unreadOnly = unreadParameter === 'true';

  const visibleMessages = currentBoardMessages().filter((message) =>
    messageVisibleTo(message, agentId),
  );
  const messages = visibleMessages
    .filter((message) => message.sequence > after)
    .filter((message) => !threadId || message.payload.threadId === threadId)
    .map((message) => {
      const acknowledgement = latestAcknowledgement(
        message.payload.messageId,
        agentId,
      );
      return {
        ...message,
        unread: message.agentId !== agentId && !acknowledgement,
        acknowledgement: acknowledgement
          ? {
              state: acknowledgement.payload.state,
              sequence: acknowledgement.sequence,
              occurredAt: acknowledgement.occurredAt,
            }
          : null,
      };
    })
    .filter((message) => !unreadOnly || message.unread);

  const visibleMessageIds = new Set(
    visibleMessages.map((message) => message.payload.messageId),
  );
  const acknowledgements = currentBoardAcknowledgements().filter(
    (event) =>
      event.sequence > after && visibleMessageIds.has(event.payload.messageId),
  );
  const threadMap = new Map();
  for (const message of visibleMessages) {
    const key = message.payload.threadId;
    const prior = threadMap.get(key) ?? {
      threadId: key,
      topic: message.payload.topic,
      audience: message.payload.audience,
      participantAgentIds: [...threadParticipantIds(message)],
      messageCount: 0,
      unreadCount: 0,
      latestSequence: 0,
    };
    prior.messageCount += 1;
    prior.latestSequence = Math.max(prior.latestSequence, message.sequence);
    if (
      message.agentId !== agentId &&
      !latestAcknowledgement(message.payload.messageId, agentId)
    ) {
      prior.unreadCount += 1;
    }
    threadMap.set(key, prior);
  }

  return {
    schemaVersion: 1,
    runId: state.runId,
    agentId,
    messages,
    acknowledgements,
    threads: [...threadMap.values()].sort(
      (left, right) => right.latestSequence - left.latestSequence,
    ),
    latestSequence: state.sequence,
    nextAfter: state.sequence,
    observation: compileObservation(agentId, after),
  };
}

function projectAgentStates() {
  const projected = new Map();
  for (const event of currentRunEvents()) {
    if (!event.agentId) continue;
    if (event.kind === 'agent.spawned') {
      projected.set(event.agentId, {
        id: event.agentId,
        name: event.payload.name,
        role: event.payload.role,
        objective: 'Waiting for an assignment',
        assignmentMode: 'directed',
        taskId: undefined,
        phase: 'spawning',
        status: 'idle',
        locationId: 'spawn-lift',
        engagedResourceId: undefined,
        currentTopicId: undefined,
        activeTool: undefined,
        activeToolCallId: undefined,
        capability: undefined,
        resourceQueued: false,
        inspectedEntityIds: new Set(),
        navigation: undefined,
        lastSequence: event.sequence,
      });
      continue;
    }
    const agent = projected.get(event.agentId);
    if (!agent) continue;
    agent.lastSequence = event.sequence;
    if (event.kind === 'task.assigned') {
      agent.objective = event.payload.objective;
      agent.assignmentMode = event.payload.mode ?? 'directed';
      agent.taskId = event.taskId;
      agent.phase = 'planning';
      agent.status = 'working';
      agent.activeTool = undefined;
      agent.activeToolCallId = undefined;
      agent.capability = undefined;
      agent.engagedResourceId = undefined;
      agent.resourceQueued = false;
    } else if (event.kind === 'agent.activity') {
      agent.phase = event.payload.phase;
      agent.status = event.payload.status;
    } else if (event.kind === 'world.navigation') {
      agent.locationId = event.payload.toLocationId;
      agent.engagedResourceId = undefined;
      agent.navigation = {
        actionId: event.payload.actionId,
        fromLocationId: event.payload.fromLocationId,
        toLocationId: event.payload.toLocationId,
        startedAt: event.payload.startedAt,
        arrivesAt: event.payload.arrivesAt,
        reason: event.payload.reason,
      };
    } else if (event.kind === 'world.interaction') {
      if (event.payload.verb === 'inspect') {
        agent.inspectedEntityIds.add(event.payload.entityId);
      }
      const resource = resourceById(event.payload.entityId);
      if (event.payload.verb === 'use' && resource) {
        agent.engagedResourceId = resource.id;
      }
    } else if (event.kind === 'research.topic.selected') {
      agent.currentTopicId = event.payload.topicId;
      agent.phase = 'researching';
      agent.status = 'working';
    } else if (event.kind === 'tool.started') {
      const capability =
        event.payload.capability ?? inferToolCapability(event.payload.tool);
      agent.activeTool = event.payload.tool;
      agent.activeToolCallId = event.payload.toolCallId;
      agent.capability = capability;
      agent.currentTopicId = event.payload.topicId ?? agent.currentTopicId;
      agent.engagedResourceId = event.payload.resourceId;
      agent.resourceQueued = false;
      agent.status = 'working';
    } else if (event.kind === 'tool.finished') {
      agent.activeTool = undefined;
      agent.activeToolCallId = undefined;
      agent.capability = undefined;
      agent.engagedResourceId = undefined;
      agent.resourceQueued = false;
    } else if (event.kind === 'agent.blocked') {
      agent.phase = 'waiting';
      agent.status = 'blocked';
    } else if (event.kind === 'agent.resumed') {
      agent.phase = 'tooling';
      agent.status = 'working';
    } else if (event.kind === 'agent.completed') {
      agent.phase = 'completed';
      agent.status = 'completed';
      agent.activeTool = undefined;
      agent.activeToolCallId = undefined;
      agent.capability = undefined;
      agent.engagedResourceId = undefined;
      agent.resourceQueued = false;
    } else if (event.kind === 'agent.failed') {
      agent.phase = 'failed';
      agent.status = 'failed';
      agent.activeTool = undefined;
      agent.activeToolCallId = undefined;
      agent.capability = undefined;
      agent.engagedResourceId = undefined;
      agent.resourceQueued = false;
    } else if (event.kind === 'agent.stopped') {
      agent.phase = 'canceled';
      agent.status = 'canceled';
      agent.activeTool = undefined;
      agent.activeToolCallId = undefined;
      agent.capability = undefined;
      agent.engagedResourceId = undefined;
      agent.resourceQueued = false;
    }
  }
  return projected;
}

function effectiveLocation(agent, now = Date.now()) {
  if (agent.navigation && now < Date.parse(agent.navigation.arrivesAt)) {
    return agent.navigation.fromLocationId;
  }
  return agent.locationId;
}

function activeNavigation(agent, now = Date.now()) {
  if (!agent.navigation || now >= Date.parse(agent.navigation.arrivesAt)) {
    return undefined;
  }
  return agent.navigation;
}

function assertLocalBoardAccess(agentId) {
  const self = projectAgentStates().get(agentId);
  if (!self) throw httpError(403, 'Identity is not present in this run');
  if (activeNavigation(self)) {
    throw httpError(409, 'The comms board cannot be used while moving');
  }
  if (effectiveLocation(self) !== 'comms-board') {
    throw httpError(
      409,
      'The comms board is outside reach; navigate to comms-board first',
    );
  }
}

function assertLocalPrivateJournalAccess(agentId) {
  const self = projectAgentStates().get(agentId);
  if (!self) throw httpError(403, 'Identity is not present in this run');
  if (activeNavigation(self)) {
    throw httpError(409, 'The journal cannot be used while moving');
  }
  if (
    effectiveLocation(self) !== PRIVATE_JOURNAL_RESOURCE_ID ||
    self.engagedResourceId !== PRIVATE_JOURNAL_RESOURCE_ID
  ) {
    throw httpError(
      409,
      'The private journal is outside reach; move to context-kiosk and use the writing desk first',
    );
  }
}

function privateJournalRequestMatches(entry, normalized) {
  return (
    entry.title === normalized.title &&
    entry.text === normalized.text &&
    entry.clientNoteId === normalized.clientNoteId
  );
}

function writePrivateJournalNote(agentId, body) {
  assertActiveAgent(agentId);
  assertLocalPrivateJournalAccess(agentId);
  if (!isRecord(body)) throw httpError(400, 'Request body must be an object');
  if (!hasText(body, 'observationId')) {
    throw httpError(400, 'observationId is required');
  }
  assertFreshObservation(agentId, body.observationId.trim());

  const normalized = {
    clientNoteId: assertChatIdentifier(body.clientNoteId, 'clientNoteId'),
    title: body.title
      ? assertSafeBoardText(body.title, 'title', MAX_PRIVATE_NOTE_TITLE_LENGTH)
      : undefined,
    text: assertSafeBoardText(body.text, 'text', MAX_PRIVATE_NOTE_TEXT_LENGTH),
  };
  const ownEntries = privateJournalForAgent(agentId);
  const prior = ownEntries.find(
    (entry) => entry.clientNoteId === normalized.clientNoteId,
  );
  if (prior) {
    if (!privateJournalRequestMatches(prior, normalized)) {
      throw httpError(
        409,
        'clientNoteId was already used for a different private note',
      );
    }
    return {
      note: prior,
      created: false,
      privacyNotice: PRIVATE_JOURNAL_NOTICE,
      observation: compileObservation(agentId, 0),
    };
  }

  const sequence =
    ownEntries.reduce(
      (latest, entry) => Math.max(latest, Number(entry.sequence) || 0),
      0,
    ) + 1;
  const entry = {
    schemaVersion: 1,
    noteId: `note_${randomUUID()}`,
    clientNoteId: normalized.clientNoteId,
    runId: state.runId,
    agentId,
    sequence,
    createdAt: new Date().toISOString(),
    ...(normalized.title ? { title: normalized.title } : {}),
    text: normalized.text,
  };
  privateJournalEntries.push(entry);
  appendFileSync(privateJournalPath, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    note: entry,
    created: true,
    privacyNotice: PRIVATE_JOURNAL_NOTICE,
    observation: compileObservation(agentId, 0),
  };
}

function readPrivateJournal(agentId, url) {
  assertActiveAgent(agentId);
  assertLocalPrivateJournalAccess(agentId);
  const after = parseAfter(url);
  if (after === undefined) {
    throw httpError(400, 'after must be a non-negative integer');
  }
  const ownEntries = privateJournalForAgent(agentId);
  return {
    schemaVersion: 1,
    privacyNotice: PRIVATE_JOURNAL_NOTICE,
    notes: ownEntries.filter((entry) => entry.sequence > after),
    latestSequence: ownEntries.at(-1)?.sequence ?? 0,
  };
}

function plantCondition(hydration) {
  if (hydration <= 0) return 'dead';
  if (hydration < 25) return 'wilted';
  if (hydration < 55) return 'thirsty';
  return 'healthy';
}

function runStartedAt() {
  return (
    currentRunEvents().find((event) => event.kind === 'run.started')
      ?.occurredAt ?? new Date().toISOString()
  );
}

function effectiveEntityState(entity, stateValue, now = Date.now()) {
  if (entity.dynamics?.kind !== 'plant') return { ...stateValue };
  const baseHydration = Number(
    stateValue._hydrationBase ?? entity.initialState._hydrationBase ?? 0,
  );
  const rawBaseAt =
    stateValue._hydrationBaseAt ??
    entity.initialState._hydrationBaseAt ??
    'run-start';
  const baseAt = rawBaseAt === 'run-start' ? runStartedAt() : rawBaseAt;
  const elapsedMinutes = Math.max(0, (now - Date.parse(baseAt)) / 60_000);
  const hydration = Math.max(
    0,
    Math.round(
      (baseHydration - elapsedMinutes * entity.dynamics.decayPerMinute) * 10,
    ) / 10,
  );
  return {
    ...stateValue,
    hydration,
    condition: plantCondition(hydration),
    minutesToDry: Math.max(
      0,
      Math.ceil(hydration / entity.dynamics.decayPerMinute),
    ),
  };
}

function publicEntityState(stateValue) {
  return Object.fromEntries(
    Object.entries(stateValue).filter(([key]) => !key.startsWith('_')),
  );
}

function projectWorldEntityStates(now = Date.now()) {
  const projected = new Map(
    FACILITY_PROPS.map((entity) => [
      entity.id,
      {
        id: entity.id,
        state: effectiveEntityState(entity, entity.initialState, now),
        stateVersion: 0,
        lastChangedBy: undefined,
        lastChangedAt: undefined,
      },
    ]),
  );
  for (const event of currentRunEvents()) {
    if (event.kind !== 'world.interaction') continue;
    const entity = projected.get(event.payload.entityId);
    if (!entity) continue;
    const definition = FACILITY_PROPS.find(
      (candidate) => candidate.id === event.payload.entityId,
    );
    entity.state = definition
      ? effectiveEntityState(definition, event.payload.state, now)
      : { ...event.payload.state };
    entity.stateVersion = event.payload.stateVersion;
    entity.lastChangedBy = event.agentId;
    entity.lastChangedAt = event.occurredAt;
  }
  return projected;
}

function researchTopicState(topicId) {
  const selection = researchSelection(topicId);
  if (!selection) return undefined;
  const update = [...currentResearchEvents()]
    .reverse()
    .find(
      (event) =>
        event.kind === 'research.topic.updated' &&
        event.payload.topicId === topicId,
    );
  return {
    topicId,
    ownerAgentId: selection.agentId,
    parentTopicId: selection.payload.parentTopicId,
    title: selection.payload.title,
    question: selection.payload.question,
    status: update?.payload.status ?? 'active',
    summary: update?.payload.summary,
  };
}

const PURPOSE_PRIORITY = Object.freeze({
  urgent: 5,
  continue: 4,
  contribute: 3,
  explore: 2,
  reflect: 1,
});

function purposeForResident(
  self,
  { localNeeds, visibleUnread, entities, people, privateNoteCount },
) {
  const profile = residentPurposeProfile(self.role);
  const topicStates = currentResearchEvents()
    .filter((event) => event.kind === 'research.topic.selected')
    .map((event) => researchTopicState(event.payload.topicId))
    .filter(Boolean);
  const ownTopic = self.currentTopicId
    ? researchTopicState(self.currentTopicId)
    : undefined;
  const artifacts = currentArtifacts();
  const opportunities = [];

  if (self.activeTool) {
    opportunities.push({
      id: `finish-tool:${self.activeToolCallId}`,
      kind: 'follow-through',
      priority: 'continue',
      title: `Finish the active ${self.activeTool} call truthfully`,
      reason:
        'A real utility call is in progress and its result has not been recorded.',
      suggestedAction:
        'Complete the actual call, record any durable artifact, then emit tool-finish with the factual outcome.',
      resourceId: self.engagedResourceId,
      capability: self.capability,
    });
  }

  if (visibleUnread.length > 0) {
    opportunities.push({
      id: 'coordination:unread-board',
      kind: 'coordination',
      priority: 'urgent',
      title: `Read ${visibleUnread.length} unanswered board message${visibleUnread.length === 1 ? '' : 's'}`,
      reason: 'Another resident deliberately left information or a question.',
      suggestedAction:
        'Visit comms-board, retrieve the messages, and acknowledge only what you actually read.',
      resourceId: 'comms-board',
      locationId: 'comms-board',
      capability: 'communicate',
    });
  }

  for (const need of localNeeds) {
    const [entityId, state] = need.split(':');
    opportunities.push({
      id: `care:${entityId}:${state}`,
      kind: 'care',
      priority: state === 'off' ? 'explore' : 'urgent',
      title:
        state === 'off'
          ? `Decide whether ${entityId} should remain off`
          : `Care for ${entityId} (${state})`,
      reason:
        state === 'off'
          ? 'The room is dim; changing it is optional and should serve a real activity.'
          : 'A living fixture has a visible unmet need.',
      suggestedAction:
        state === 'off'
          ? 'Approach the physical switch only if better light serves a chosen purpose.'
          : `Approach ${entityId}, inspect it, act on the observed condition, and verify the new state.`,
      locationId: entityId,
    });
  }

  if (ownTopic && !new Set(['complete', 'dropped']).has(ownTopic.status)) {
    const topicArtifacts = artifacts.filter(
      (event) => event.payload.topicId === ownTopic.topicId,
    );
    const sourceNotes = topicArtifacts.filter(
      (event) => event.payload.kind === 'source-note',
    );
    const validation = topicArtifacts.filter(
      (event) => event.payload.kind === 'test-result',
    );
    const decisions = topicArtifacts.filter(
      (event) => event.payload.kind === 'decision',
    );
    if (sourceNotes.length === 0) {
      opportunities.push({
        id: `evidence:${ownTopic.topicId}`,
        kind: 'research',
        priority: 'continue',
        title: `Find evidence for “${ownTopic.title}”`,
        reason: 'Your active inquiry has no recorded source evidence yet.',
        suggestedAction:
          'Use the connected research computer for live web search or browsing, prefer primary sources, and record URL-backed source notes.',
        locationId: 'research-computer-b',
        resourceId: 'research-computer-b',
        capability: 'search',
        topicId: ownTopic.topicId,
      });
    } else if (validation.length === 0) {
      opportunities.push({
        id: `validate:${ownTopic.topicId}`,
        kind: 'validation',
        priority: 'continue',
        title: `Challenge the evidence for “${ownTopic.title}”`,
        reason: `${sourceNotes.length} source note${sourceNotes.length === 1 ? '' : 's'} exist, but no validation result tests the conclusion.`,
        suggestedAction:
          'Use the diagnostic rig for a real test, audit, or adversarial review and record a test-result artifact.',
        locationId: 'verify-rig-b',
        resourceId: 'verify-rig-b',
        capability: 'test',
        topicId: ownTopic.topicId,
      });
    } else if (decisions.length === 0) {
      opportunities.push({
        id: `synthesize:${ownTopic.topicId}`,
        kind: 'synthesis',
        priority: 'continue',
        title: `Resolve “${ownTopic.title}”`,
        reason:
          'Evidence and validation exist, but no decision closes the loop.',
        suggestedAction:
          'Use the decision console to reconcile the artifacts, record a decision, and update the topic status factually.',
        locationId: 'publish-console',
        resourceId: 'publish-console',
        capability: 'publish',
        topicId: ownTopic.topicId,
      });
    }
  }

  for (const topic of topicStates
    .filter(
      (candidate) =>
        candidate.ownerAgentId !== self.id &&
        !new Set(['complete', 'dropped']).has(candidate.status),
    )
    .slice(0, 2)) {
    const topicArtifacts = artifacts.filter(
      (event) => event.payload.topicId === topic.topicId,
    );
    const hasSources = topicArtifacts.some(
      (event) => event.payload.kind === 'source-note',
    );
    const hasValidation = topicArtifacts.some(
      (event) => event.payload.kind === 'test-result',
    );
    opportunities.push({
      id: `${hasSources && !hasValidation ? 'review' : 'support'}:${topic.topicId}`,
      kind: hasSources && !hasValidation ? 'validation' : 'collaboration',
      priority: 'contribute',
      title:
        hasSources && !hasValidation
          ? `Independently test “${topic.title}”`
          : `Offer evidence on “${topic.title}”`,
      reason:
        hasSources && !hasValidation
          ? `Another resident owns this inquiry and has evidence, but no independent validation is recorded.`
          : `Another resident owns this active inquiry and it still needs source evidence.`,
      suggestedAction:
        hasSources && !hasValidation
          ? 'Use the diagnostic rig for a real independent check, record a linked test result, then send the owner a concise evidence handoff.'
          : 'Use the connected research computer for real source gathering, record a linked source note, then send the owner a concise evidence handoff.',
      locationId:
        hasSources && !hasValidation ? 'verify-rig-b' : 'research-computer-b',
      resourceId:
        hasSources && !hasValidation ? 'verify-rig-b' : 'research-computer-b',
      capability: hasSources && !hasValidation ? 'test' : 'search',
      topicId: topic.topicId,
      ownerAgentId: topic.ownerAgentId,
    });
  }

  const claimedTracks = new Set(
    topicStates
      .filter((topic) => !new Set(['complete', 'dropped']).has(topic.status))
      .map((topic) => topic.parentTopicId)
      .filter(Boolean),
  );
  const profileOrder = new Map(
    profile.preferredTracks.map((trackId, index) => [trackId, index]),
  );
  const openTracks = RESEARCH_TRACKS.filter(
    (track) => !claimedTracks.has(track.id),
  ).sort(
    (left, right) =>
      (profileOrder.get(left.id) ?? 999) - (profileOrder.get(right.id) ?? 999),
  );
  if (!ownTopic || new Set(['complete', 'dropped']).has(ownTopic.status)) {
    for (const track of openTracks.slice(0, 3)) {
      opportunities.push({
        id: `inquiry:${track.id}`,
        kind: 'open-inquiry',
        priority: 'contribute',
        title: `Open inquiry: ${track.title}`,
        reason: track.purpose,
        suggestedAction:
          'If this matters to you, claim a narrow question with research-select, then gather real evidence through the appropriate archive or connected research computer.',
        locationId: 'research-computer-b',
        resourceId: 'research-computer-b',
        capability: 'search',
        parentTopicId: track.id,
      });
    }
  }

  const unknownResources = entities.filter(
    (entity) =>
      !entity.known &&
      FACILITY_RESOURCES.some((resource) => resource.id === entity.id),
  );
  for (const entity of unknownResources.slice(0, 2)) {
    opportunities.push({
      id: `discover:${entity.id}`,
      kind: 'discovery',
      priority: 'explore',
      title: `Learn what ${entity.id} can actually do`,
      reason: 'This local fixture has not been inspected by you.',
      suggestedAction: `Approach and inspect ${entity.id}; use it only if its real capabilities serve a chosen purpose.`,
      locationId: entity.id,
      resourceId: entity.id,
    });
  }

  const stationaryPeople = people.filter((person) => !person.moving);
  if (stationaryPeople.length > 0) {
    const person = stationaryPeople[0];
    opportunities.push({
      id: `social:${person.id}`,
      kind: 'social',
      priority: 'explore',
      title: `Consider ${person.name} as a collaborator`,
      reason: `${person.name} is sharing this room; conversation is optional but may reveal compatible work.`,
      suggestedAction:
        'Approach only when a concrete question, offer, or shared interest justifies a short conversation.',
      locationId: person.locationId,
      agentId: person.id,
    });
  }

  if (privateNoteCount === 0) {
    opportunities.push({
      id: 'reflect:first-private-note',
      kind: 'reflection',
      priority: 'reflect',
      title: 'Begin a private thread of intention',
      reason:
        'Your private journal is empty; a durable preference or open question can guide later self-directed choices.',
      suggestedAction:
        'Use the context-kiosk and write a private note about what you care to investigate, make, verify, or maintain.',
      locationId: 'context-kiosk',
      resourceId: 'context-kiosk',
      capability: 'context',
    });
  }

  opportunities.sort(
    (left, right) =>
      PURPOSE_PRIORITY[right.priority] - PURPOSE_PRIORITY[left.priority] ||
      left.id.localeCompare(right.id),
  );

  return {
    profile: {
      id: profile.id,
      label: profile.label,
      drives: [...profile.drives],
    },
    commitment: ownTopic
      ? {
          kind: 'research-topic',
          id: ownTopic.topicId,
          title: ownTopic.title,
          status: ownTopic.status,
        }
      : self.assignmentMode === 'directed'
        ? {
            kind: 'assignment',
            id: self.taskId,
            title: self.objective,
            status: self.status,
          }
        : undefined,
    opportunities: opportunities.slice(0, 8),
    completionStandard:
      'Complete a meaningful arc with evidence, a verified change, a resolved handoff, a verified care outcome, or a factual blocker; one movement or inspection is not enough.',
  };
}

function roomIdForLocation(locationId) {
  return worldLocationById(locationId)?.roomId ?? 'context';
}

function metricDistance(left, right) {
  const dx = ((right.x - left.x) / 100) * 768;
  const dy = ((right.y - left.y) / 100) * 448;
  return Math.hypot(dx, dy);
}

function bearingLabel(left, right) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return 'HERE';
  const horizontal = Math.abs(dx) > 0.5 ? (dx > 0 ? 'E' : 'W') : '';
  const vertical = Math.abs(dy) > 0.5 ? (dy > 0 ? 'S' : 'N') : '';
  return `${vertical}${horizontal}` || 'HERE';
}

function rangeLabel(distancePixels) {
  if (distancePixels < 18) return 'reach';
  if (distancePixels < SOCIAL_RANGE_PX) return 'near';
  return 'room';
}

function activeResidents(agents) {
  return [...agents.values()].filter(
    (candidate) =>
      !new Set(['completed', 'failed', 'canceled']).has(candidate.status),
  );
}

function locationClaims(agents, targetId, exceptAgentId, now = Date.now()) {
  const present = [];
  const reserved = [];
  for (const candidate of activeResidents(agents)) {
    if (candidate.id === exceptAgentId) continue;
    const navigation = activeNavigation(candidate, now);
    if (effectiveLocation(candidate, now) === targetId) present.push(candidate);
    if (navigation?.toLocationId === targetId) reserved.push(candidate);
  }
  return { present, reserved };
}

function laneUsers(
  agents,
  fromLocationId,
  toLocationId,
  exceptAgentId,
  now = Date.now(),
) {
  return activeResidents(agents).filter((candidate) => {
    if (candidate.id === exceptAgentId) return false;
    const navigation = activeNavigation(candidate, now);
    if (!navigation) return false;
    return (
      (navigation.fromLocationId === fromLocationId &&
        navigation.toLocationId === toLocationId) ||
      (navigation.fromLocationId === toLocationId &&
        navigation.toLocationId === fromLocationId)
    );
  });
}

function movementAwareness(
  agents,
  agentId,
  fromLocationId,
  toLocationId,
  now = Date.now(),
) {
  const target = worldLocationById(toLocationId);
  if (!target) return undefined;
  const claims = locationClaims(agents, toLocationId, agentId, now);
  const traffic = laneUsers(agents, fromLocationId, toLocationId, agentId, now);
  const claimedBy = new Map(
    [...claims.present, ...claims.reserved].map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  const remainingCapacity = Math.max(0, target.capacity - claimedBy.size);
  let status = 'open';
  if (traffic.length > 0) status = 'yield';
  else if (claims.present.length >= target.capacity) status = 'occupied';
  else if (claimedBy.size >= target.capacity) status = 'reserved';
  else if (claimedBy.size > 0) status = 'shared';
  return {
    status,
    available: new Set(['open', 'shared']).has(status),
    capacity: target.capacity,
    remainingCapacity,
    present: claims.present,
    reserved: claims.reserved,
    traffic,
  };
}

function movementRelation(navigation, observerRoomId) {
  if (!navigation) return 'stationary';
  const fromRoomId = roomIdForLocation(navigation.fromLocationId);
  const toRoomId = roomIdForLocation(navigation.toLocationId);
  if (fromRoomId !== observerRoomId && toRoomId === observerRoomId)
    return 'entering-room';
  if (fromRoomId === observerRoomId && toRoomId !== observerRoomId)
    return 'leaving-room';
  if (fromRoomId === observerRoomId && toRoomId === observerRoomId)
    return 'moving-within-room';
  return 'passing-nearby';
}

function speechPreview(text, maximum = 96) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const firstSentence = segmenter.segment(normalized)[Symbol.iterator]().next()
    .value?.segment;
  let preview = (firstSentence ?? normalized).trim();
  let shortened = preview.length < normalized.length;
  const codePoints = [...preview];
  if (codePoints.length > maximum) {
    const clipped = codePoints.slice(0, maximum).join('');
    const boundary = clipped.lastIndexOf(' ');
    preview = (boundary > maximum * 0.62 ? clipped.slice(0, boundary) : clipped)
      .trim()
      .replace(/[.!?]+$/u, '');
    shortened = true;
  }
  if (shortened) return `${preview.replace(/[.!?]+$/u, '')}…`;
  return preview;
}

function priorProximityAction(agentId, actionId) {
  return currentProximitySpeech().find(
    (event) => event.agentId === agentId && event.payload.actionId === actionId,
  );
}

function proximityActionMatches(prior, body) {
  if (
    !hasText(body, 'observationId') ||
    !hasText(body, 'speechAct') ||
    !hasText(body, 'text')
  ) {
    return false;
  }
  const speechAct = body.speechAct.trim();
  if (
    prior.payload.observationId !== body.observationId.trim() ||
    prior.payload.speechAct !== speechAct ||
    prior.payload.text !== normalizedText(body.text)
  ) {
    return false;
  }
  if (speechAct === 'say') {
    return (
      hasText(body, 'targetAgentId') &&
      prior.payload.targetAgentId === body.targetAgentId.trim() &&
      (prior.payload.replyToSpeechId ?? undefined) ===
        (hasText(body, 'replyToSpeechId')
          ? body.replyToSpeechId.trim()
          : undefined)
    );
  }
  if (speechAct === 'invite') {
    return (
      hasText(body, 'targetAgentId') &&
      prior.payload.targetAgentId === body.targetAgentId.trim() &&
      prior.payload.invitationMode === body.invitationMode &&
      prior.payload.objective === normalizedText(body.objective) &&
      (hasText(body, 'invitationId')
        ? prior.payload.invitationId === body.invitationId.trim()
        : true)
    );
  }
  return (
    hasText(body, 'invitationId') &&
    prior.payload.invitationId === body.invitationId.trim()
  );
}

function assertSpeechReach(agentId, targetAgentId, observationId) {
  const observation = assertFreshObservation(agentId, observationId);
  if (targetAgentId === agentId) {
    throw httpError(409, 'Nearby speech requires another person');
  }
  const agents = projectAgentStates();
  const speaker = agents.get(agentId);
  const target = agents.get(targetAgentId);
  if (!target) throw httpError(404, 'That person is not present');
  if (new Set(['completed', 'failed', 'canceled']).has(target.status)) {
    throw httpError(409, 'That person is no longer present');
  }
  if (activeNavigation(speaker) || activeNavigation(target)) {
    throw httpError(409, 'Both people must be stationary to speak');
  }
  const speakerLocationId = effectiveLocation(speaker);
  const targetLocationId = effectiveLocation(target);
  const speakerLocation = worldLocationById(speakerLocationId);
  const targetLocation = worldLocationById(targetLocationId);
  if (!speakerLocation || !targetLocation) {
    throw httpError(409, 'The local positions are not grounded');
  }
  if (
    roomIdForLocation(speakerLocationId) !== roomIdForLocation(targetLocationId)
  ) {
    throw httpError(409, 'A wall separates the two people');
  }
  const distancePx = metricDistance(
    speakerLocation.position,
    targetLocation.position,
  );
  const perceivedTarget = observation.people.find(
    (person) => person.id === targetAgentId,
  );
  if (
    distancePx >= SOCIAL_RANGE_PX ||
    !perceivedTarget ||
    !new Set(['reach', 'near']).has(perceivedTarget.range)
  ) {
    throw httpError(
      409,
      `${target.name} is outside speaking range; move closer first`,
    );
  }
  const heardByAgentIds = [...agents.values()]
    .filter(
      (candidate) =>
        candidate.id !== agentId &&
        !new Set(['completed', 'failed', 'canceled']).has(candidate.status) &&
        !activeNavigation(candidate) &&
        roomIdForLocation(effectiveLocation(candidate)) ===
          roomIdForLocation(speakerLocationId),
    )
    .filter((candidate) => {
      const candidateLocation = worldLocationById(effectiveLocation(candidate));
      return (
        candidateLocation &&
        metricDistance(speakerLocation.position, candidateLocation.position) <
          SOCIAL_RANGE_PX
      );
    })
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
  if (!heardByAgentIds.includes(targetAgentId)) {
    throw httpError(409, 'The intended listener cannot hear from here');
  }
  return {
    target,
    speakerLocationId,
    targetLocationId,
    distancePx: Math.round(distancePx * 10) / 10,
    heardByAgentIds,
  };
}

function postProximitySpeech(agentId, body) {
  if (!isRecord(body) || !hasText(body, 'actionId')) {
    throw httpError(400, 'actionId is required');
  }
  const actionId = assertChatIdentifier(body.actionId, 'actionId');
  const prior = priorProximityAction(agentId, actionId);
  if (prior) {
    if (!proximityActionMatches(prior, body)) {
      throw httpError(409, 'actionId was already used for different speech');
    }
    return {
      event: prior,
      created: false,
      observation: compileObservation(agentId, prior.sequence - 1),
    };
  }
  if (!hasText(body, 'observationId')) {
    throw httpError(400, 'observationId is required');
  }
  if (
    !hasText(body, 'speechAct') ||
    !PROXIMITY_SPEECH_ACTS.has(body.speechAct)
  ) {
    throw httpError(400, 'speechAct must be say, invite, accept, or decline');
  }
  const speechAct = body.speechAct.trim();
  const text = assertSafeBoardText(
    body.text,
    'text',
    MAX_PROXIMITY_TEXT_LENGTH,
  );
  let targetAgentId;
  let invitationId;
  let invitationMode;
  let objective;
  let replyToSpeechId;
  let invitation;

  if (speechAct === 'say') {
    if (!hasText(body, 'targetAgentId')) {
      throw httpError(400, 'say requires targetAgentId');
    }
    targetAgentId = assertChatIdentifier(body.targetAgentId, 'targetAgentId');
    if (hasText(body, 'replyToSpeechId')) {
      replyToSpeechId = assertChatIdentifier(
        body.replyToSpeechId,
        'replyToSpeechId',
      );
      const replyTarget = speechById(replyToSpeechId);
      if (
        !replyTarget ||
        replyTarget.agentId === agentId ||
        !replyTarget.payload.heardByAgentIds.includes(agentId)
      ) {
        throw httpError(409, 'replyToSpeechId was not heard by this identity');
      }
      if (replyTarget.agentId !== targetAgentId) {
        throw httpError(409, 'A reply must address the original speaker');
      }
    }
  } else if (speechAct === 'invite') {
    if (!hasText(body, 'targetAgentId')) {
      throw httpError(400, 'invite requires targetAgentId');
    }
    targetAgentId = assertChatIdentifier(body.targetAgentId, 'targetAgentId');
    if (!COLLABORATION_MODES.has(body.invitationMode)) {
      throw httpError(400, 'invitationMode must be collaborate or recruit');
    }
    invitationMode = body.invitationMode;
    objective = assertSafeBoardText(
      body.objective,
      'objective',
      MAX_COLLABORATION_OBJECTIVE_LENGTH,
    );
    invitationId = hasText(body, 'invitationId')
      ? assertChatIdentifier(body.invitationId, 'invitationId')
      : `invite_${randomUUID()}`;
    if (invitationById(invitationId)) {
      throw httpError(409, 'invitationId already exists in this run');
    }
  } else {
    if (!hasText(body, 'invitationId')) {
      throw httpError(400, `${speechAct} requires invitationId`);
    }
    invitationId = assertChatIdentifier(body.invitationId, 'invitationId');
    invitation = invitationById(invitationId);
    if (!invitation) throw httpError(404, 'That invitation is not in this run');
    if (invitation.payload.targetAgentId !== agentId) {
      throw httpError(403, 'Only the invited person may respond');
    }
    if (invitationResponse(invitationId)) {
      throw httpError(409, 'That invitation already has a response');
    }
    targetAgentId = invitation.agentId;
    invitationMode = invitation.payload.invitationMode;
    objective = invitation.payload.objective;
  }

  const reach = assertSpeechReach(
    agentId,
    targetAgentId,
    body.observationId.trim(),
  );
  const speechId = `speech_${randomUUID()}`;
  const event = appendEvent({
    kind: 'proximity.spoken',
    agentId,
    ...(invitationId ? { correlationId: invitationId } : {}),
    payload: {
      actionId,
      observationId: body.observationId.trim(),
      speechId,
      speechAct,
      speakerLocationId: reach.speakerLocationId,
      targetLocationId: reach.targetLocationId,
      targetAgentId,
      heardByAgentIds: reach.heardByAgentIds,
      distancePx: reach.distancePx,
      text,
      preview: speechPreview(text),
      ...(replyToSpeechId ? { replyToSpeechId } : {}),
      ...(invitationId ? { invitationId } : {}),
      ...(invitationMode ? { invitationMode } : {}),
      ...(objective ? { objective } : {}),
    },
  });
  return {
    event,
    created: true,
    observation: compileObservation(agentId, event.sequence - 1),
  };
}

function sceneObservationId(materialObservation) {
  const digest = createHash('sha256')
    .update(JSON.stringify(materialObservation))
    .digest('hex')
    .slice(0, 16);
  return `obs_${digest}`;
}

function materialEntityObservation(entity, projected) {
  const stableState =
    entity.kind === 'plant'
      ? { condition: entity.state?.condition }
      : entity.state;
  return {
    ...entity,
    ...(stableState ? { state: stableState } : {}),
    stateVersion: projected?.stateVersion ?? 0,
  };
}

function compileObservation(agentId, after = 0) {
  const now = Date.now();
  const agents = projectAgentStates();
  const self = agents.get(agentId);
  if (!self) throw httpError(403, 'Identity is not present in this run');
  const worldStates = projectWorldEntityStates();
  const locationId = effectiveLocation(self, now);
  const location = worldLocationById(locationId);
  const roomId = location?.roomId ?? 'context';
  const room = roomForLocation(locationId);
  const navigation = activeNavigation(self, now);
  const position = location?.position ?? { x: 50, y: 80 };
  const privateJournalEntriesForSelf = privateJournalForAgent(agentId);
  const privateJournalAccessible =
    !navigation &&
    locationId === PRIVATE_JOURNAL_RESOURCE_ID &&
    self.engagedResourceId === PRIVATE_JOURNAL_RESOURCE_ID;
  const active = activeResidents(agents);
  const people = active
    .filter((candidate) => {
      if (candidate.id === agentId) return false;
      const peerNavigation = activeNavigation(candidate, now);
      const currentRoomId = roomIdForLocation(
        effectiveLocation(candidate, now),
      );
      const destinationRoomId = peerNavigation
        ? roomIdForLocation(peerNavigation.toLocationId)
        : undefined;
      return currentRoomId === roomId || destinationRoomId === roomId;
    })
    .map((candidate) => {
      const peerLocationId = effectiveLocation(candidate, now);
      const peerLocation = worldLocationById(peerLocationId);
      const peerDistance = peerLocation
        ? metricDistance(position, peerLocation.position)
        : Number.POSITIVE_INFINITY;
      const peerNavigation = activeNavigation(candidate, now);
      const presence =
        roomIdForLocation(peerLocationId) === roomId ? 'present' : 'incoming';
      const relation = movementRelation(peerNavigation, roomId);
      const proximity =
        peerLocationId === locationId
          ? 'shared-place'
          : peerDistance < RESIDENT_BODY_CLEARANCE_PX
            ? 'body-close'
            : peerDistance < SOCIAL_RANGE_PX
              ? 'conversation'
              : 'room';
      return {
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        activity: candidate.phase,
        locationId: peerLocationId,
        bearing: peerLocation
          ? bearingLabel(position, peerLocation.position)
          : 'unknown',
        range: peerLocation ? rangeLabel(peerDistance) : 'unknown',
        distancePx: Number.isFinite(peerDistance)
          ? Math.round(peerDistance * 10) / 10
          : undefined,
        presence,
        proximity,
        movement: relation,
        moving: Boolean(peerNavigation),
        canSpeak:
          presence === 'present' &&
          !navigation &&
          !peerNavigation &&
          peerDistance < SOCIAL_RANGE_PX,
        ...(peerNavigation
          ? {
              destinationId: peerNavigation.toLocationId,
              arrivesAt: peerNavigation.arrivesAt,
              ...(peerNavigation.reason
                ? { movementReason: peerNavigation.reason }
                : {}),
            }
          : {}),
      };
    });
  const presentPeople = people.filter(
    (person) => person.presence === 'present',
  );
  const talk = people
    .filter((person) => person.canSpeak)
    .map((person) => ({
      id: person.id,
      name: person.name,
      locationId: person.locationId,
      bearing: person.bearing,
      range: person.range,
      distancePx: person.distancePx,
    }));
  const incomingPeople = people.filter(
    (person) => person.movement === 'entering-room',
  );
  const leavingPeople = people.filter(
    (person) => person.movement === 'leaving-room',
  );
  const space = {
    bodyClearancePx: RESIDENT_BODY_CLEARANCE_PX,
    conversationRangePx: SOCIAL_RANGE_PX,
    residentsPresent: presentPeople.length + 1,
    presentAgentIds: presentPeople
      .map((person) => person.id)
      .sort((left, right) => left.localeCompare(right)),
    conversationalAgentIds: talk
      .map((person) => person.id)
      .sort((left, right) => left.localeCompare(right)),
    incoming: incomingPeople.map((person) => ({
      agentId: person.id,
      from: person.locationId,
      to: person.destinationId,
      arrivesAt: person.arrivesAt,
    })),
    leaving: leavingPeople.map((person) => ({
      agentId: person.id,
      from: person.locationId,
      to: person.destinationId,
      arrivesAt: person.arrivesAt,
    })),
    socialApproach:
      'Allowed through an open or shared destination; physical overlap remains blocked.',
  };
  const socialEvents = currentProximitySpeech().filter((event) =>
    proximitySpeechVisibleTo(event, agentId),
  );
  const audibleAfter = socialEvents.filter(
    (event) =>
      event.sequence > after &&
      event.agentId !== agentId &&
      event.payload.heardByAgentIds.includes(agentId),
  );
  const heardPage = audibleAfter.slice(0, 8);
  const heardThroughSequence = heardPage.at(-1)?.sequence ?? after;
  const heardHasMore = audibleAfter.length > heardPage.length;
  const heard = heardPage.map((event) => ({
    sequence: event.sequence,
    speechId: event.payload.speechId,
    speechAct: event.payload.speechAct,
    fromAgentId: event.agentId,
    fromName: agents.get(event.agentId)?.name ?? event.agentId,
    targetAgentId: event.payload.targetAgentId,
    targetName:
      agents.get(event.payload.targetAgentId)?.name ??
      event.payload.targetAgentId,
    text: event.payload.text,
    ...(event.payload.replyToSpeechId
      ? { replyToSpeechId: event.payload.replyToSpeechId }
      : {}),
    ...(event.payload.invitationId
      ? { invitationId: event.payload.invitationId }
      : {}),
    ...(event.payload.invitationMode
      ? { invitationMode: event.payload.invitationMode }
      : {}),
    ...(event.payload.objective ? { objective: event.payload.objective } : {}),
  }));
  const invitations = socialEvents
    .filter(
      (event) =>
        event.payload.speechAct === 'invite' &&
        (event.agentId === agentId || event.payload.targetAgentId === agentId),
    )
    .map((event) => {
      const response = invitationResponse(event.payload.invitationId);
      return {
        invitationId: event.payload.invitationId,
        mode: event.payload.invitationMode,
        objective: event.payload.objective,
        fromAgentId: event.agentId,
        fromName: agents.get(event.agentId)?.name ?? event.agentId,
        toAgentId: event.payload.targetAgentId,
        toName:
          agents.get(event.payload.targetAgentId)?.name ??
          event.payload.targetAgentId,
        status: response ? response.payload.speechAct : 'pending',
        ...(response ? { responseSpeechId: response.payload.speechId } : {}),
      };
    });
  const collaborations = invitations.filter(
    (invitation) => invitation.status === 'accept',
  );
  const propsInRoom = FACILITY_PROPS.filter(
    (entity) => entity.roomId === roomId,
  );
  const resourcesInRoom = FACILITY_RESOURCES.filter(
    (entity) => entity.roomId === roomId,
  );
  const entities = [...resourcesInRoom, ...propsInRoom].map((entity) => {
    const distance = metricDistance(position, entity.position);
    const projected = worldStates.get(entity.id);
    const inspected = self.inspectedEntityIds.has(entity.id);
    const occupants = active
      .filter(
        (candidate) =>
          candidate.id !== agentId &&
          effectiveLocation(candidate, now) === entity.id,
      )
      .map((candidate) => candidate.name);
    return {
      id: entity.id,
      label: entity.label,
      kind: entity.kind,
      bearing: bearingLabel(position, entity.position),
      range: rangeLabel(distance),
      ...(projected ? { state: publicEntityState(projected.state) } : {}),
      ...(occupants.length > 0 ? { occupiedBy: occupants } : {}),
      ...(inspected
        ? {
            known: {
              description:
                entity.description ??
                `${entity.label} supports ${entity.capabilities.join(', ') || 'local use'}.`,
              ...(entity.capabilities.length > 0
                ? { capabilities: entity.capabilities }
                : {}),
              ...(entity.interactions
                ? {
                    affordances: entity.interactions.map(
                      (interaction) => interaction.verb,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };
  });
  const exits = navigation
    ? []
    : neighborsForLocation(locationId).map((neighborId) => {
        const neighbor = worldLocationById(neighborId);
        const awareness = movementAwareness(
          agents,
          agentId,
          locationId,
          neighborId,
          now,
        );
        return {
          to: neighborId,
          label: neighbor?.label ?? neighborId,
          bearing: neighbor
            ? bearingLabel(position, neighbor.position)
            : 'unknown',
          range: neighbor
            ? rangeLabel(metricDistance(position, neighbor.position))
            : 'unknown',
          status: awareness?.status ?? 'open',
          available: awareness?.available ?? true,
          capacity: awareness?.capacity ?? neighbor?.capacity ?? 1,
          remainingCapacity: awareness?.remainingCapacity ?? 0,
          ...(awareness?.present.length
            ? {
                occupiedBy: awareness.present.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                })),
              }
            : {}),
          ...(awareness?.reserved.length
            ? {
                reservedBy: awareness.reserved.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                })),
              }
            : {}),
          ...(awareness?.traffic.length
            ? {
                trafficBy: awareness.traffic.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                })),
              }
            : {}),
        };
      });
  const worldChanges = currentRunEvents()
    .filter(
      (event) =>
        event.sequence > after &&
        (event.kind === 'world.navigation' ||
          event.kind === 'world.interaction'),
    )
    .filter((event) =>
      event.kind === 'world.navigation'
        ? Boolean(
            worldLocationById(event.payload.fromLocationId) &&
            worldLocationById(event.payload.toLocationId),
          )
        : Boolean(worldEntityById(event.payload.entityId)),
    )
    .filter((event) => {
      if (event.agentId === agentId) return true;
      if (event.kind === 'world.navigation') {
        return (
          roomIdForLocation(event.payload.fromLocationId) === roomId ||
          roomIdForLocation(event.payload.toLocationId) === roomId
        );
      }
      return roomIdForLocation(event.payload.locationId) === roomId;
    })
    .slice(-8)
    .map((event) => {
      const residentName = agents.get(event.agentId)?.name ?? event.agentId;
      return event.kind === 'world.navigation'
        ? `${residentName} moved ${event.payload.fromLocationId} -> ${event.payload.toLocationId}`
        : `${residentName} ${event.payload.verb} ${event.payload.entityId}: ${event.payload.result}`;
    });
  const visibleUnread = currentBoardMessages().filter(
    (message) =>
      message.agentId !== agentId &&
      messageVisibleTo(message, agentId) &&
      !latestAcknowledgement(message.payload.messageId, agentId),
  );
  const lamp = worldStates.get('archive-lamp');
  const roomLight = worldStates.get(`room-light-${roomId}`);
  const light =
    roomLight?.state.power === 'on'
      ? 'warm'
      : roomId === 'research' && lamp?.state.power === 'on'
        ? 'task-lit'
        : 'low';
  const localNeeds = entities.flatMap((entity) => {
    if (entity.kind === 'plant') {
      const condition = entity.state?.condition;
      if (condition === 'dead')
        return [`${entity.id}:dead/replacement-possible`];
      if (condition === 'wilted') return [`${entity.id}:wilted`];
      if (condition === 'thirsty') return [`${entity.id}:thirsty`];
    }
    if (entity.kind === 'room-light' && entity.state?.power === 'off') {
      return [`${entity.id}:off`];
    }
    return [];
  });
  const purpose = purposeForResident(self, {
    localNeeds,
    visibleUnread,
    entities,
    people,
    privateNoteCount: privateJournalEntriesForSelf.length,
  });
  const observationId = sceneObservationId({
    self: {
      name: self.name,
      role: self.role,
      objective: self.objective,
      assignmentMode: self.assignmentMode,
      taskId: self.taskId,
      phase: self.phase,
      status: self.status,
      currentTopicId: self.currentTopicId,
      activeTool: self.activeTool,
      capability: self.capability,
      engagement: self.engagedResourceId,
      inspectedEntityIds: [...self.inspectedEntityIds].sort((left, right) =>
        left.localeCompare(right),
      ),
    },
    locationId,
    roomId,
    light,
    localNeeds,
    navigation,
    space,
    people: people
      .map((person) => ({ ...person }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    exits,
    // Plant hydration is a continuously projected clock value. It remains
    // visible to residents, but must not invalidate an otherwise actionable
    // observation every time the displayed decimal ticks. Explicit
    // interactions still invalidate through stateVersion, and natural decay
    // still invalidates when it crosses a meaningful condition boundary.
    entities: entities.map((entity) =>
      materialEntityObservation(entity, worldStates.get(entity.id)),
    ),
    privateJournal: {
      noteCount: privateJournalEntriesForSelf.length,
      accessible: privateJournalAccessible,
    },
    purpose: {
      profileId: purpose.profile.id,
      commitmentId: purpose.commitment?.id,
      commitmentStatus: purpose.commitment?.status,
      opportunityIds: purpose.opportunities.map(
        (opportunity) => opportunity.id,
      ),
    },
    unreadBoardMessageIds: visibleUnread
      .map((message) => message.payload.messageId)
      .sort((left, right) => left.localeCompare(right)),
    visibleSpeech: socialEvents.slice(-24).map((event) => ({
      sequence: event.sequence,
      speechId: event.payload.speechId,
      speechAct: event.payload.speechAct,
      invitationId: event.payload.invitationId,
    })),
    invitations: invitations.map((invitation) => ({
      invitationId: invitation.invitationId,
      status: invitation.status,
    })),
  });
  const lines = [
    `OBS HIVE/3 ${observationId} SEQ ${state.sequence}`,
    `YOU ${self.name} | ${self.role} | ${self.assignmentMode === 'self-directed' ? 'self-directed; no imposed objective' : `assignment: ${self.objective}`}`,
    `HERE ${locationId} / ${room?.name ?? 'Central corridor'} | light:${light} | ${
      navigation
        ? `moving ${navigation.fromLocationId}->${navigation.toLocationId} until ${navigation.arrivesAt}`
        : `still${self.engagedResourceId ? ` | using:${self.engagedResourceId}` : ''}`
    }`,
    `WITH ${presentPeople.length > 0 ? presentPeople.map((person) => `${person.name}(${person.id})@${person.locationId}/${person.bearing}/${person.range}:${person.activity}${person.moving ? `:${person.movement}->${person.destinationId}` : ':stationary'}`).join(' ; ') : 'no one else in this room'}`,
    `TALK ${talk.length > 0 ? talk.map((person) => `${person.name}(${person.id})@${person.locationId}/${person.bearing}/${person.range}`).join(' ; ') : navigation ? 'unavailable while moving' : 'no one within speaking range'}`,
    `SPACE residents:${space.residentsPresent} | conversation:${talk.length > 0 ? talk.map((person) => `${person.name}(${person.id})`).join(',') : 'none'} | incoming:${incomingPeople.length > 0 ? incomingPeople.map((person) => `${person.name}(${person.id}) ${person.locationId}->${person.destinationId}`).join(',') : 'none'} | leaving:${leavingPeople.length > 0 ? leavingPeople.map((person) => `${person.name}(${person.id}) ${person.locationId}->${person.destinationId}`).join(',') : 'none'} | body-clearance:${RESIDENT_BODY_CLEARANCE_PX}px; speaking-range:${SOCIAL_RANGE_PX}px; approach allowed via open/shared places`,
    `HEARD ${heard.length > 0 ? heard.map((speech) => `#${speech.sequence} ${speech.speechId} ${speech.fromName}(${speech.fromAgentId})->${speech.targetName}(${speech.targetAgentId}) [${speech.speechAct}] ${JSON.stringify(speech.text)}`).join(' ; ') : 'nothing new within earshot since cursor'}`,
    `HEARD_PAGE through:${heardThroughSequence} ${heardHasMore ? `more:${audibleAfter.length - heardPage.length}; observe --after ${heardThroughSequence}` : 'complete'}`,
    `INVITES ${invitations.length > 0 ? invitations.map((invitation) => `${invitation.invitationId} ${invitation.fromName}(${invitation.fromAgentId})->${invitation.toName}(${invitation.toAgentId}) ${invitation.mode}:${invitation.status} objective=${JSON.stringify(invitation.objective)}`).join(' ; ') : 'none'}`,
    `COLLAB ${collaborations.length > 0 ? collaborations.map((invitation) => `${invitation.invitationId} ${invitation.fromName}(${invitation.fromAgentId})+${invitation.toName}(${invitation.toAgentId}) ${invitation.mode} consent-recorded; shared work awaits an assignment`).join(' ; ') : 'none accepted'}`,
    `EXITS ${
      exits.length > 0
        ? exits
            .map((exit) => {
              const involved = [
                ...(exit.trafficBy ?? []),
                ...(exit.reservedBy ?? []),
                ...(exit.occupiedBy ?? []),
              ];
              const names = [
                ...new Map(
                  involved.map((person) => [person.id, person.name]),
                ).values(),
              ];
              return `${exit.to}@${exit.bearing}/${exit.range}/${exit.status}${names.length > 0 ? `:${names.join(',')}` : ''}`;
            })
            .join(' ; ')
        : navigation
          ? 'none while moving'
          : 'none'
    }`,
    `NEEDS ${localNeeds.length > 0 ? localNeeds.join(' ; ') : 'no obvious local urgency'}`,
    `DRIVES ${purpose.profile.label} | ${purpose.profile.drives.join(' ; ')}`,
    `OPPORTUNITIES ${purpose.opportunities.length > 0 ? purpose.opportunities.map((opportunity) => `${opportunity.id}[${opportunity.priority}] ${opportunity.title} -> ${opportunity.suggestedAction}`).join(' ; ') : 'none visible; explore, reflect, or deliberately rest'}`,
    `SEE ${
      entities.length > 0
        ? entities
            .map(
              (entity) =>
                `${entity.id}[${entity.kind}]@${entity.bearing}/${entity.range}${
                  entity.state && Object.keys(entity.state).length > 0
                    ? ` ${Object.entries(entity.state)
                        .map(([key, value]) => `${key}:${value}`)
                        .join(',')}`
                    : ''
                }${entity.occupiedBy ? ` occupied:${entity.occupiedBy.join(',')}` : ''}${entity.known ? ` known:${entity.known.description}` : ''}`,
            )
            .join(' ; ')
        : 'no fixtures in view'
    }`,
    `CHANGED ${worldChanges.length > 0 ? worldChanges.join(' ; ') : 'nothing locally since cursor'}`,
    `BOARD ${locationId === 'comms-board' ? `unread:${visibleUnread.length} accessible here` : visibleUnread.length > 0 ? `chime:${visibleUnread.length} unread; contents are at comms-board` : 'quiet'}`,
    `JOURNAL private-to-you | notes:${privateJournalEntriesForSelf.length} | ${privateJournalAccessible ? 'open at this writing desk' : 'bound volume at context-kiosk; use the desk to open it'}`,
    `MEM ${
      self.inspectedEntityIds.has('facility-plan')
        ? 'facility plan memorized'
        : `visited:${[
            'spawn-lift',
            ...currentRunEvents()
              .filter(
                (event) =>
                  event.agentId === agentId &&
                  event.kind === 'world.navigation',
              )
              .flatMap((event) => [
                event.payload.fromLocationId,
                event.payload.toLocationId,
              ]),
          ]
            .filter((value) => worldLocationById(value))
            .filter((value, index, values) => values.indexOf(value) === index)
            .join(',')}`
    }`,
  ];

  return {
    schemaVersion: 3,
    observationId,
    sequence: state.sequence,
    after,
    text: lines.join('\n'),
    you: {
      name: self.name,
      role: self.role,
      assignment: self.objective,
      assignmentMode: self.assignmentMode,
      locationId,
      engagedResourceId: self.engagedResourceId,
      navigation,
    },
    place: {
      id: roomId,
      name: room?.name ?? 'Central corridor',
      light,
      needs: localNeeds,
      occupancy: {
        residentsPresent: space.residentsPresent,
        incoming: space.incoming.length,
        leaving: space.leaving.length,
      },
    },
    space,
    people,
    talk,
    heard,
    hearing: {
      requestedAfter: after,
      throughSequence: heardThroughSequence,
      hasMore: heardHasMore,
      remaining: Math.max(0, audibleAfter.length - heardPage.length),
    },
    invitations,
    collaborations,
    exits,
    entities,
    changes: worldChanges,
    board: {
      unreadCount: visibleUnread.length,
      accessible: locationId === 'comms-board',
    },
    journal: {
      privacy: 'owner-only',
      noteCount: privateJournalEntriesForSelf.length,
      accessible: privateJournalAccessible,
    },
    purpose,
  };
}

function agentContext(agentId, after = 0) {
  const agents = projectAgentStates();
  const self = agents.get(agentId);
  if (!self) throw httpError(403, 'Agent is not projected in this run');
  const active = activeResidents(agents).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const locationId = effectiveLocation(self);
  const room = roomForLocation(locationId) ?? {
    id: 'corridor',
    name: 'Central corridor',
    purpose: 'Connect the six facility rooms through visible doorways.',
    input: 'A chosen adjacent doorway or corridor segment',
    output: 'Arrival at the next local landmark',
  };
  const sameRoom = active.filter(
    (agent) =>
      agent.id !== agentId &&
      roomIdForLocation(effectiveLocation(agent)) ===
        roomIdForLocation(locationId),
  );
  const visibleUnread = currentBoardMessages()
    .filter(
      (message) =>
        message.agentId !== agentId &&
        messageVisibleTo(message, agentId) &&
        !latestAcknowledgement(message.payload.messageId, agentId),
    )
    .slice(-6)
    .map((message) => ({
      messageId: message.payload.messageId,
      threadId: message.payload.threadId,
      topic: message.payload.topic,
      from: message.agentId,
      sequence: message.sequence,
    }));
  const roomCounts = Object.fromEntries(
    FACILITY_ROOMS.map((candidateRoom) => [
      candidateRoom.id,
      active.filter(
        (agent) =>
          roomIdForLocation(effectiveLocation(agent)) === candidateRoom.id,
      ).length,
    ]).filter(([, count]) => count > 0),
  );
  const changedAgentIds = active
    .filter((agent) => agent.lastSequence > after)
    .map((agent) => agent.id);
  const topic = self.currentTopicId
    ? researchTopicState(self.currentTopicId)
    : undefined;
  const withLabel =
    sameRoom.length > 0
      ? sameRoom.map((agent) => `${agent.id}(${agent.phase})`).join(',')
      : 'none';
  const elsewhere = Object.entries(roomCounts)
    .filter(([roomId]) => roomId !== room.id)
    .map(([roomId, count]) => `${roomId}:${count}`)
    .join(',');
  const observation = compileObservation(agentId, after);
  const purposeProfile = residentPurposeProfile(self.role);

  return {
    schemaVersion: 1,
    runId: state.runId,
    sequence: state.sequence,
    after,
    directive:
      self.assignmentMode === 'self-directed'
        ? SELF_DIRECTED_DIRECTIVE
        : AUTONOMY_DIRECTIVE,
    brief: `MODE ${self.assignmentMode === 'self-directed' ? 'SELF-DIRECTED' : 'DIRECTED'} | AREA ${room.id} / ${room.name} | WITH ${withLabel} | SPACE present:${observation.space.residentsPresent},talk:${observation.space.conversationalAgentIds.join(',') || 'none'},incoming:${observation.space.incoming.length},leaving:${observation.space.leaving.length} | ELSEWHERE ${elsewhere || 'none'} | BOARD unread:${visibleUnread.length} | SEQ ${state.sequence}`,
    observation,
    self: {
      id: self.id,
      name: self.name,
      role: self.role,
      taskId: self.taskId,
      assignmentMode: self.assignmentMode,
      objective: self.objective,
      phase: self.phase,
      status: self.status,
      roomId: room.id,
      locationId,
      resourceId: self.engagedResourceId,
      activeTool: self.activeTool,
      capability: self.capability,
      resourceQueued: self.resourceQueued,
      topic,
    },
    room: {
      id: room.id,
      name: room.name,
      purpose: room.purpose,
      input: room.input,
      output: room.output,
      resources: FACILITY_RESOURCES.filter(
        (resource) => resource.roomId === room.id,
      ).map((resource) => ({
        id: resource.id,
        label: resource.label,
        capacity: resource.capacity,
        capabilities: resource.capabilities,
      })),
    },
    activeRoster: active.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      phase: agent.phase,
      status: agent.status,
      roomId: roomIdForLocation(effectiveLocation(agent)),
    })),
    sameRoomAgentIds: sameRoom.map((agent) => agent.id),
    changedAgentIds,
    roomCounts,
    unreadBoard: visibleUnread,
    researchTracks: RESEARCH_TRACKS.map((track) => ({
      id: track.id,
      title: track.title,
      subtopics: track.subtopics,
    })),
    purpose: {
      charterPath: purposeProfile.charterPath,
      coreCharterPath: '.codex/residents/CORE.md',
      ...observation.purpose,
    },
  };
}

function priorWorldAction(agentId, actionId) {
  return currentRunEvents().find(
    (event) =>
      event.agentId === agentId &&
      WORLD_EVENT_KINDS.has(event.kind) &&
      event.payload.actionId === actionId,
  );
}

function worldActionMatches(prior, body) {
  if (!hasText(body, 'observationId') || !hasText(body, 'action')) return false;
  if (prior.payload.observationId !== body.observationId.trim()) return false;
  if (prior.kind === 'world.navigation') {
    return (
      body.action === 'move' &&
      hasText(body, 'targetId') &&
      prior.payload.toLocationId === body.targetId.trim() &&
      (prior.payload.reason ?? undefined) ===
        (hasText(body, 'reason') ? body.reason.trim() : undefined)
    );
  }
  return (
    body.action === 'interact' &&
    hasText(body, 'targetId') &&
    hasText(body, 'verb') &&
    prior.payload.entityId === body.targetId.trim() &&
    prior.payload.verb === body.verb.trim()
  );
}

function assertFreshObservation(agentId, observationId) {
  const current = compileObservation(agentId, 0);
  if (current.observationId !== observationId) {
    throw httpError(
      409,
      `The local scene changed; observe again (${current.observationId})`,
    );
  }
  return current;
}

function performWorldAction(agentId, body) {
  if (!isRecord(body) || !hasText(body, 'actionId')) {
    throw httpError(400, 'actionId is required');
  }
  const actionId = assertChatIdentifier(body.actionId, 'actionId');
  const prior = priorWorldAction(agentId, actionId);
  if (prior) {
    if (!worldActionMatches(prior, body)) {
      throw httpError(409, 'actionId was already used for a different action');
    }
    return {
      event: prior,
      created: false,
      observation: compileObservation(agentId, prior.sequence - 1),
    };
  }
  if (!hasText(body, 'observationId')) {
    throw httpError(400, 'observationId is required');
  }
  assertFreshObservation(agentId, body.observationId);
  const agents = projectAgentStates();
  const self = agents.get(agentId);
  const navigation = activeNavigation(self);
  if (navigation) {
    throw httpError(
      409,
      `Movement is still in progress toward ${navigation.toLocationId} until ${navigation.arrivesAt}`,
    );
  }
  const locationId = effectiveLocation(self);

  if (body.action === 'move') {
    if (!hasText(body, 'targetId')) {
      throw httpError(400, 'move requires targetId');
    }
    if (self.activeTool) {
      throw httpError(409, 'Finish the active utility session before moving');
    }
    const target = worldLocationById(body.targetId);
    if (!target) throw httpError(404, 'That place is not known');
    if (!neighborsForLocation(locationId).includes(target.id)) {
      throw httpError(
        409,
        `${target.id} is not adjacent to ${locationId}; choose a visible exit`,
      );
    }
    const awareness = movementAwareness(agents, agentId, locationId, target.id);
    if (!awareness?.available) {
      const involved =
        awareness.status === 'yield'
          ? awareness.traffic
          : awareness.status === 'reserved'
            ? awareness.reserved
            : awareness.present;
      const names = involved.map((candidate) => candidate.name).join(', ');
      const message =
        awareness.status === 'yield'
          ? `${target.label} path is in use by ${names}; yield, then observe again`
          : awareness.status === 'reserved'
            ? `${target.label} is reserved for ${names}; observe or choose another local step`
            : `${target.label} is occupied by ${names}; observe or choose another local step`;
      throw httpError(409, message);
    }
    const from = worldLocationById(locationId);
    const distance = from ? metricDistance(from.position, target.position) : 48;
    const durationMs = Math.max(
      MIN_TRAVEL_MS,
      Math.min(4_000, (distance / TRAVEL_SPEED_PX_PER_SECOND) * 1_000),
    );
    const startedAt = new Date();
    const arrivesAt = new Date(startedAt.getTime() + durationMs);
    const event = appendEvent({
      kind: 'world.navigation',
      agentId,
      payload: {
        actionId,
        observationId: body.observationId,
        fromLocationId: locationId,
        toLocationId: target.id,
        startedAt: startedAt.toISOString(),
        arrivesAt: arrivesAt.toISOString(),
        ...(hasText(body, 'reason') ? { reason: body.reason.trim() } : {}),
      },
    });
    return {
      event,
      created: true,
      observation: compileObservation(agentId, event.sequence - 1),
    };
  }

  if (body.action === 'interact') {
    if (!hasText(body, 'targetId') || !hasText(body, 'verb')) {
      throw httpError(400, 'interact requires targetId and verb');
    }
    if (body.targetId !== locationId) {
      throw httpError(
        409,
        `${body.targetId} is outside reach; move there before interacting`,
      );
    }
    const entity = worldEntityById(body.targetId);
    if (!entity) throw httpError(404, 'There is no interactable fixture there');
    const verb = body.verb.trim();
    if (
      entity.kind === 'room-light' &&
      new Set(['switch_on', 'switch_off']).has(verb)
    ) {
      const actorPosition = worldLocationById(locationId)?.position;
      const controlPosition = entity.controlPosition;
      const controlDistance =
        actorPosition && controlPosition
          ? metricDistance(actorPosition, controlPosition)
          : Number.POSITIVE_INFINITY;
      if (controlDistance > LIGHT_SWITCH_REACH_PX) {
        throw httpError(
          409,
          `${entity.label} switch is outside physical reach; move beside the wall control`,
        );
      }
    }
    const resource = resourceById(entity.id);
    const worldState = projectWorldEntityStates().get(entity.id);
    const currentState = {
      ...(worldState?.state ?? entity.initialState),
    };
    let nextState = currentState;
    let stateVersion = worldState?.stateVersion ?? 0;
    let result;

    if (resource) {
      if (!new Set(['inspect', 'use']).has(verb)) {
        throw httpError(409, `${verb} is not a grounded interaction here`);
      }
      if (verb === 'use') {
        if (resource.capabilities.length === 0) {
          throw httpError(409, `${resource.label} has no utility interface`);
        }
        const occupants = [...agents.values()].filter(
          (candidate) =>
            candidate.id !== agentId &&
            !new Set(['completed', 'failed', 'canceled']).has(
              candidate.status,
            ) &&
            candidate.engagedResourceId === resource.id &&
            effectiveLocation(candidate) === resource.id,
        );
        if (occupants.length >= resource.capacity) {
          throw httpError(
            409,
            `${resource.label} is at capacity (${occupants.map((candidate) => candidate.name).join(', ')})`,
          );
        }
        result = `${resource.label} is physically engaged and ready for ${resource.capabilities.join(', ')}.`;
      } else {
        result = `${resource.label} supports ${resource.capabilities.join(', ') || 'local occupancy'}.`;
      }
    } else {
      const interaction = entity.interactions.find(
        (candidate) => candidate.verb === verb,
      );
      if (!interaction) {
        throw httpError(409, `${verb} is not a grounded interaction here`);
      }
      const failedRequirement = Object.entries(interaction.requires ?? {}).find(
        ([key, value]) => currentState[key] !== value,
      );
      if (failedRequirement) {
        throw httpError(
          409,
          `${entity.label} cannot ${verb}: ${failedRequirement[0]} is ${currentState[failedRequirement[0]]}`,
        );
      }
      if (interaction.effect === 'water_plant') {
        if (currentState.condition === 'dead') {
          throw httpError(
            409,
            `${entity.label} is dead; replace it before watering`,
          );
        }
        const changedAt = new Date().toISOString();
        nextState = {
          ...currentState,
          _hydrationBase: 100,
          _hydrationBaseAt: changedAt,
          hydration: 100,
          condition: 'healthy',
          minutesToDry: Math.ceil(
            100 / Math.max(0.01, entity.dynamics?.decayPerMinute ?? 1),
          ),
          lastWateredAt: changedAt,
        };
        stateVersion += 1;
      } else if (interaction.effect === 'replace_plant') {
        if (currentState.condition !== 'dead') {
          throw httpError(
            409,
            `${entity.label} is still living; replacement is not grounded`,
          );
        }
        const changedAt = new Date().toISOString();
        nextState = {
          ...currentState,
          _hydrationBase: 46,
          _hydrationBaseAt: changedAt,
          hydration: 46,
          condition: 'thirsty',
          minutesToDry: Math.ceil(
            46 / Math.max(0.01, entity.dynamics?.decayPerMinute ?? 1),
          ),
          lastWateredAt: changedAt,
        };
        stateVersion += 1;
      } else if (interaction.set) {
        nextState = { ...currentState, ...interaction.set };
        stateVersion += 1;
      }
      result =
        entity.kind === 'plant' && verb === 'inspect'
          ? `${interaction.result} It is ${currentState.condition} at ${currentState.hydration}% hydration; projected dry-out is ${currentState.minutesToDry} minutes.`
          : interaction.result;
    }

    const event = appendEvent({
      kind: 'world.interaction',
      agentId,
      payload: {
        actionId,
        observationId: body.observationId,
        locationId,
        entityId: entity.id,
        verb,
        result,
        stateVersion,
        state: nextState,
      },
    });
    return {
      event,
      created: true,
      observation: compileObservation(agentId, event.sequence - 1),
    };
  }

  throw httpError(400, 'action must be move or interact');
}

function appendEvent(body, source = 'codex') {
  const kind = body.kind;
  if (!EVENT_KINDS.has(kind))
    throw new Error(`Unsupported event kind: ${kind}`);

  if (
    kind === 'tool.started' &&
    isRecord(body.payload) &&
    body.payload.capability === undefined
  ) {
    body = {
      ...body,
      payload: {
        ...body.payload,
        capability: inferToolCapability(body.payload.tool),
      },
    };
  }

  if (kind === 'tool.started' && isRecord(body.payload)) {
    const projected = projectAgentStates().get(body.agentId?.trim());
    if (projected) {
      if (activeNavigation(projected)) {
        throw new Error('A utility cannot start while movement is in progress');
      }
      if (projected.activeTool) {
        throw new Error('This identity already has an active utility call');
      }
      const capability =
        body.payload.capability ?? inferToolCapability(body.payload.tool);
      const resource = resourceById(projected.engagedResourceId);
      if (
        !resource ||
        effectiveLocation(projected) !== resource.id ||
        !resource.capabilities.includes(capability)
      ) {
        throw new Error(
          `Use a local facility resource with the ${capability} capability before starting this utility`,
        );
      }
      body = {
        ...body,
        payload: { ...body.payload, resourceId: resource.id },
      };
    }
  }

  const payloadError = assertPayload(kind, body.payload);
  if (payloadError) throw new Error(payloadError);

  if (kind === 'run.started') {
    if (body.reset !== true) {
      throw new Error('run.started requires reset: true');
    }
    resetRun();
  } else if (!state.runId) {
    throw new Error('No active run. Emit run.started with reset: true first.');
  }

  if (AGENT_EVENT_KINDS.has(kind) && !hasText(body, 'agentId')) {
    throw new Error(`${kind} requires agentId`);
  }

  if (!kind.startsWith('run.') && currentRunIsClosed()) {
    throw new Error('The current run is closed');
  }

  if (kind === 'agent.spawned' && spawnedAgentIds().has(body.agentId.trim())) {
    throw new Error(
      `Agent ${body.agentId.trim()} is already spawned in this run`,
    );
  }
  if (
    AGENT_EVENT_KINDS.has(kind) &&
    kind !== 'agent.spawned' &&
    !BOARD_EVENT_KINDS.has(kind) &&
    !spawnedAgentIds().has(body.agentId.trim())
  ) {
    throw new Error(`Agent ${body.agentId.trim()} is not spawned in this run`);
  }
  if (
    AGENT_EVENT_KINDS.has(kind) &&
    kind !== 'agent.spawned' &&
    kind !== 'task.assigned' &&
    !BOARD_EVENT_KINDS.has(kind) &&
    agentIsTerminal(body.agentId.trim())
  ) {
    throw new Error(`Agent ${body.agentId.trim()} is no longer active`);
  }

  if (kind === 'research.topic.selected') {
    const topicId = assertChatIdentifier(body.payload.topicId, 'topicId');
    if (researchSelection(topicId)) {
      throw new Error(`Research topic ${topicId} already exists`);
    }
    if (
      body.payload.parentTopicId &&
      !researchSelection(body.payload.parentTopicId) &&
      !RESEARCH_TRACKS.some((track) => track.id === body.payload.parentTopicId)
    ) {
      throw new Error('parentTopicId is not available in this run or catalog');
    }
  }
  if (kind === 'research.topic.updated') {
    const selection = researchSelection(body.payload.topicId);
    if (!selection) throw new Error('topicId is not selected in this run');
    if (selection.agentId !== body.agentId.trim()) {
      throw new Error('Only the topic owner may update it');
    }
  }
  if (kind === 'artifact.recorded') {
    const artifactId = assertChatIdentifier(
      body.payload.artifactId,
      'artifactId',
    );
    if (artifactEvent(artifactId)) {
      throw new Error(`Artifact ${artifactId} already exists`);
    }
    if (body.payload.topicId && !researchSelection(body.payload.topicId)) {
      throw new Error('artifact topicId is not selected in this run');
    }
  }
  if (
    kind === 'tool.started' &&
    body.payload.topicId &&
    !researchSelection(body.payload.topicId)
  ) {
    throw new Error('tool topicId is not selected in this run');
  }
  if (kind === 'tool.finished') {
    const projected = projectAgentStates().get(body.agentId.trim());
    if (
      !projected?.activeToolCallId ||
      projected.activeToolCallId !== body.payload.toolCallId
    ) {
      throw new Error('toolCallId does not match an active utility call');
    }
    const unknownArtifact = body.payload.artifactIds?.find(
      (artifactId) => !artifactEvent(artifactId),
    );
    if (unknownArtifact) {
      throw new Error(`Unknown artifact: ${unknownArtifact}`);
    }
    if (
      body.payload.outcome === 'succeeded' &&
      !hasText(body.payload, 'summary')
    ) {
      throw new Error('A successful utility call requires a factual summary');
    }
    if (
      body.payload.outcome === 'succeeded' &&
      new Set(['search', 'browse']).has(projected.capability)
    ) {
      if (!body.payload.artifactIds?.length) {
        throw new Error(
          'Successful web research requires a linked URL-backed source-note',
        );
      }
      const invalidEvidence = body.payload.artifactIds
        .map((artifactId) => artifactEvent(artifactId))
        .find(
          (artifact) =>
            artifact?.payload.kind !== 'source-note' ||
            !/^https?:\/\//u.test(artifact?.payload.uri ?? ''),
        );
      if (invalidEvidence) {
        throw new Error(
          'Successful web research artifacts must be source notes with HTTP(S) source URLs',
        );
      }
    }
  }

  const nextSequence = state.sequence + 1;
  const event = {
    schemaVersion: 1,
    eventId: `evt_${randomUUID()}`,
    sequence: nextSequence,
    occurredAt: new Date().toISOString(),
    source,
    runId: state.runId,
    ...(hasText(body, 'agentId') ? { agentId: body.agentId.trim() } : {}),
    ...(hasText(body, 'parentAgentId')
      ? { parentAgentId: body.parentAgentId.trim() }
      : {}),
    ...(hasText(body, 'taskId') ? { taskId: body.taskId.trim() } : {}),
    ...(hasText(body, 'correlationId')
      ? { correlationId: body.correlationId.trim() }
      : {}),
    kind,
    payload: body.payload,
  };

  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  state.sequence = nextSequence;
  events.push(event);
  persistState();
  return event;
}

function appendIntent(body) {
  const intent = isRecord(body.intent) ? body.intent : body;
  const intentId = hasText(body, 'intentId')
    ? body.intentId.trim()
    : `intent_${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const error = validateIntent(intent);

  if (error) {
    return {
      receipt: { intentId, accepted: false, receivedAt, reason: error },
      envelope: undefined,
    };
  }

  const nextIntentSequence = state.intentSequence + 1;
  const envelope = {
    schemaVersion: 1,
    intentId,
    sequence: nextIntentSequence,
    occurredAt: receivedAt,
    source: 'operator',
    runId: state.runId ?? 'unbound',
    sentAt: hasText(body, 'sentAt') ? body.sentAt : undefined,
    intent,
  };
  if (envelope.sentAt === undefined) delete envelope.sentAt;

  appendFileSync(intentsPath, `${JSON.stringify(envelope)}\n`, 'utf8');
  state.intentSequence = nextIntentSequence;
  intents.push(envelope);
  persistState();
  return {
    receipt: { intentId, accepted: true, receivedAt },
    envelope,
  };
}

syncChatIngressJournal();
persistState();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${options.port}`);

  if (request.method === 'OPTIONS') {
    writeJson(request, response, 204, {});
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      syncChatIngressJournal();
      const runEvents = currentRunEvents();
      writeJson(request, response, 200, {
        ok: true,
        schemaVersion: 1,
        source: 'codex',
        runId: state.runId,
        latestSequence: state.sequence,
        latestIntentSequence: state.intentSequence,
        eventCount: runEvents.length,
        intentCount: currentRunIntents().length,
        journalEventCount: events.length,
        journalIntentCount: intents.length,
        boardMessageCount: runEvents.filter(
          (event) => event.kind === 'board.message',
        ).length,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      syncChatIngressJournal();
      const after = parseAfter(url);
      if (after === undefined) {
        writeJson(request, response, 400, {
          error: 'after must be a non-negative integer',
        });
        return;
      }
      writeJson(request, response, 200, {
        events: currentRunEvents().filter((event) => event.sequence > after),
        latestSequence: state.sequence,
        runId: state.runId,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/chat/ingress') {
      if (!hasChatAuthority(request)) {
        writeJson(request, response, 401, {
          error: 'Chat-hook authentication required',
        });
        return;
      }
      const body = await readJsonBody(request);
      const { event, created } = appendChatIngress(body);
      writeJson(request, response, created ? 201 : 200, { event, created });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/chat/relay') {
      if (!hasEmitterAuthority(request)) {
        writeJson(request, response, 401, {
          error: 'Emitter authentication required',
        });
        return;
      }
      syncChatIngressJournal();
      const body = await readJsonBody(request);
      const { event, created } = appendChatRelay(body);
      writeJson(request, response, created ? 201 : 200, { event, created });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/chat/status') {
      if (!hasChatAuthority(request) && !hasEmitterAuthority(request)) {
        writeJson(request, response, 401, {
          error: 'Chat-hook or emitter authentication required',
        });
        return;
      }
      syncChatIngressJournal();
      const ingressId = normalizedText(url.searchParams.get('ingress'));
      if (!ingressId) {
        writeJson(request, response, 400, { error: 'ingress is required' });
        return;
      }
      const status = chatStatus(ingressId);
      if (!status) {
        writeJson(request, response, 404, {
          error: 'ingressId is not journaled',
        });
        return;
      }
      writeJson(request, response, 200, status);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/intents') {
      const after = parseAfter(url);
      if (after === undefined) {
        writeJson(request, response, 400, {
          error: 'after must be a non-negative integer',
        });
        return;
      }
      writeJson(request, response, 200, {
        intents: currentRunIntents().filter(
          (intent) => intent.sequence > after,
        ),
        latestSequence: state.intentSequence,
        runId: state.runId,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/agent/context') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Agent authentication required',
        });
        return;
      }
      assertActiveAgent(agentId);
      const after = parseAfter(url);
      if (after === undefined) {
        writeJson(request, response, 400, {
          error: 'after must be a non-negative integer',
        });
        return;
      }
      writeJson(request, response, 200, agentContext(agentId, after));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/agent/observation') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Identity authentication required',
        });
        return;
      }
      assertActiveAgent(agentId);
      const after = parseAfter(url);
      if (after === undefined) {
        writeJson(request, response, 400, {
          error: 'after must be a non-negative integer',
        });
        return;
      }
      writeJson(request, response, 200, compileObservation(agentId, after));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/journal') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Identity authentication required',
        });
        return;
      }
      writeJson(request, response, 200, readPrivateJournal(agentId, url));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/journal/note') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Identity authentication required',
        });
        return;
      }
      const body = await readJsonBody(request);
      try {
        const result = writePrivateJournalNote(agentId, body);
        writeJson(request, response, result.created ? 201 : 200, result);
      } catch (error) {
        let observation;
        try {
          observation = compileObservation(agentId, 0);
        } catch {
          observation = undefined;
        }
        writeJson(request, response, error.status ?? 400, {
          error: error.message,
          ...(observation ? { observation } : {}),
        });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/world/action') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Identity authentication required',
        });
        return;
      }
      assertActiveAgent(agentId);
      const body = await readJsonBody(request);
      try {
        const result = performWorldAction(agentId, body);
        writeJson(request, response, result.created ? 201 : 200, result);
      } catch (error) {
        let observation;
        try {
          observation = compileObservation(agentId, 0);
        } catch {
          observation = undefined;
        }
        writeJson(request, response, error.status ?? 400, {
          error: error.message,
          ...(observation ? { observation } : {}),
        });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/proximity/speech') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Identity authentication required',
        });
        return;
      }
      assertActiveAgent(agentId);
      const body = await readJsonBody(request);
      try {
        const result = postProximitySpeech(agentId, body);
        writeJson(request, response, result.created ? 201 : 200, result);
      } catch (error) {
        let observation;
        try {
          observation = compileObservation(agentId, 0);
        } catch {
          observation = undefined;
        }
        writeJson(request, response, error.status ?? 400, {
          error: error.message,
          ...(observation ? { observation } : {}),
        });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/event') {
      if (!hasEmitterAuthority(request)) {
        writeJson(request, response, 401, {
          error: 'Emitter authentication required',
        });
        return;
      }
      const body = await readJsonBody(request);
      try {
        if (BOARD_EVENT_KINDS.has(body.kind)) {
          throw httpError(
            400,
            'Board events must use the authenticated board endpoints',
          );
        }
        if (CHAT_EVENT_KINDS.has(body.kind)) {
          throw httpError(
            400,
            'Chat access-loop events must use the authenticated chat endpoints',
          );
        }
        if (WORLD_EVENT_KINDS.has(body.kind)) {
          throw httpError(
            400,
            'World events must use the authenticated action endpoint',
          );
        }
        if (SOCIAL_EVENT_KINDS.has(body.kind)) {
          throw httpError(
            400,
            'Proximity speech must use the authenticated speech endpoint',
          );
        }
        const event = appendEvent(body);
        const agentToken =
          event.kind === 'agent.spawned'
            ? issueAgentCredential(event.agentId)
            : undefined;
        writeJson(request, response, 201, {
          event,
          ...(agentToken ? { agentToken } : {}),
        });
      } catch (error) {
        const status =
          error.status ??
          (error.message.startsWith('No active run') ? 409 : 400);
        writeJson(request, response, status, { error: error.message });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/board/message') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Agent authentication required',
        });
        return;
      }
      const body = await readJsonBody(request);
      const { event, created } = postBoardMessage(agentId, body);
      writeJson(request, response, created ? 201 : 200, { event, created });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/board') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Agent authentication required',
        });
        return;
      }
      writeJson(request, response, 200, readBoard(agentId, url));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/board/ack') {
      const agentId = agentAuthority(request);
      if (!agentId) {
        writeJson(request, response, 401, {
          error: 'Agent authentication required',
        });
        return;
      }
      const body = await readJsonBody(request);
      const { event, created } = acknowledgeBoardMessage(agentId, body);
      writeJson(request, response, created ? 201 : 200, { event, created });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/intent') {
      const body = await readJsonBody(request);
      const { receipt } = appendIntent(body);
      writeJson(request, response, 200, { receipt });
      return;
    }

    writeJson(request, response, 404, { error: 'Not found' });
  } catch (error) {
    if (!response.headersSent) {
      writeJson(request, response, error.status ?? 400, {
        error: error.message || 'Request failed',
      });
    }
  }
});

server.on('error', (error) => {
  process.stderr.write(`[arena-bridge] ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(options.port, HOST, () => {
  process.stdout.write(
    `[arena-bridge] http://${HOST}:${options.port} · ${options.dataDir}\n`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
