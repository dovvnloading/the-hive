import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ArenaEvalInputError,
  evaluateArenaRun,
  parseJsonLines,
  validateEventRecord,
  validateRejectionReceipt,
} from './arena-eval.mjs';

const RUN_ID = 'run_qualification_golden';
const BASE_TIME = Date.parse('2026-08-30T12:00:00.000Z');
const evaluatorPath = resolve(import.meta.dirname, 'arena-eval.mjs');
const TERMINAL_KINDS_FOR_TEST = new Set([
  'agent.completed',
  'agent.failed',
  'agent.stopped',
]);

const roster = Object.freeze({
  schemaVersion: 1,
  runId: RUN_ID,
  residents: [
    {
      processId: '/root/explorer',
      agentId: 'explorer',
      taskId: 'task-explorer',
      profile: 'Explorer',
      charterPath: '.codex/residents/EXPLORER.md',
    },
    {
      processId: '/root/maker',
      agentId: 'maker',
      taskId: 'task-maker',
      profile: 'Maker',
      charterPath: '.codex/residents/MAKER.md',
    },
    {
      processId: '/root/critic',
      agentId: 'critic',
      taskId: 'task-critic',
      profile: 'Critic',
      charterPath: '.codex/residents/CRITIC.md',
    },
    {
      processId: '/root',
      agentId: 'steward',
      taskId: 'task-steward',
      profile: 'Steward',
      charterPath: '.codex/residents/STEWARD.md',
    },
  ],
});

function clone(value) {
  return structuredClone(value);
}

function eventFactory(events) {
  return (kind, payload, envelope = {}) => {
    const sequence = events.length + 1;
    const event = {
      schemaVersion: 1,
      eventId: `evt-${sequence}`,
      sequence,
      occurredAt: new Date(BASE_TIME + sequence * 1_000).toISOString(),
      source: 'codex',
      runId: RUN_ID,
      ...envelope,
      kind,
      payload,
    };
    events.push(event);
    return event;
  };
}

function observation(seed) {
  return `obs_${seed.toString(16).padStart(16, '0')}`;
}

function makeGolden() {
  const events = [];
  const add = eventFactory(events);
  add('run.started', {
    objective:
      'Produce one evidence-backed, implemented, independently verified improvement to the Hive while maintaining facility continuity.',
  });
  for (const [agentId, profile] of [
    ['explorer', 'Explorer'],
    ['maker', 'Maker'],
    ['critic', 'Critic'],
    ['steward', 'Steward'],
  ]) {
    add('agent.spawned', { name: profile, role: profile }, { agentId });
  }
  for (const agentId of ['explorer', 'maker', 'critic', 'steward']) {
    add(
      'task.assigned',
      {
        objective:
          'Establish a life and pursue useful work from your resident charter.',
        mode: 'self-directed',
      },
      { agentId, taskId: `task-${agentId}` },
    );
  }
  add(
    'research.topic.selected',
    {
      topicId: 'topic-hive',
      title: 'Hive improvement evidence',
      question: 'What verified improvement should the Hive receive?',
    },
    { agentId: 'explorer' },
  );
  add(
    'world.interaction',
    {
      actionId: 'use-research-computer',
      observationId: observation(1),
      locationId: 'research-computer-b',
      entityId: 'research-computer-b',
      verb: 'use',
      result: 'Research computer engaged.',
      stateVersion: 0,
      state: {},
    },
    { agentId: 'explorer' },
  );
  add(
    'tool.started',
    {
      toolCallId: 'search-1',
      tool: 'web.search',
      summary: 'Search an authoritative source',
      capability: 'search',
      activityId: 'research.search-primary-sources',
      topicId: 'topic-hive',
      resourceId: 'research-computer-b',
    },
    { agentId: 'explorer' },
  );
  add(
    'artifact.recorded',
    {
      artifactId: 'source-1',
      kind: 'source-note',
      title: 'Primary evidence',
      summary: 'One factual source note',
      uri: 'https://example.com/primary',
      topicId: 'topic-hive',
    },
    { agentId: 'explorer' },
  );
  add(
    'tool.finished',
    {
      toolCallId: 'search-1',
      outcome: 'succeeded',
      summary: 'Source captured',
      artifactIds: ['source-1'],
    },
    { agentId: 'explorer' },
  );
  add(
    'research.topic.updated',
    { topicId: 'topic-hive', status: 'complete', summary: 'Evidence found' },
    { agentId: 'explorer' },
  );
  add(
    'board.message',
    {
      messageId: 'message-evidence',
      clientMessageId: 'client-evidence',
      threadId: 'thread-hive',
      topic: 'Evidence handoff',
      messageType: 'handoff',
      audience: 'direct',
      recipientAgentIds: ['maker'],
      topicId: 'topic-hive',
      artifactIds: ['source-1'],
      text: 'The linked evidence is ready.',
    },
    { agentId: 'explorer' },
  );
  add(
    'board.acknowledged',
    { messageId: 'message-evidence', state: 'resolved' },
    { agentId: 'maker' },
  );
  add(
    'world.interaction',
    {
      actionId: 'use-build-bench',
      observationId: observation(2),
      locationId: 'build-bench-a',
      entityId: 'build-bench-a',
      verb: 'use',
      result: 'Build bench engaged.',
      stateVersion: 0,
      state: {},
    },
    { agentId: 'maker' },
  );
  add(
    'tool.started',
    {
      toolCallId: 'edit-1',
      tool: 'filesystem.edit',
      summary: 'Implement the evidence-backed change',
      capability: 'edit',
      activityId: 'build.implement-linked-change',
      topicId: 'topic-hive',
      resourceId: 'build-bench-a',
    },
    { agentId: 'maker' },
  );
  add(
    'artifact.recorded',
    {
      artifactId: 'change-1',
      kind: 'change',
      title: 'Hive change',
      summary: 'Implemented change',
      uri: 'file:///disposable-worktree/change',
      topicId: 'topic-hive',
    },
    { agentId: 'maker' },
  );
  add(
    'tool.finished',
    {
      toolCallId: 'edit-1',
      outcome: 'succeeded',
      summary: 'Change implemented',
      artifactIds: ['change-1'],
    },
    { agentId: 'maker' },
  );
  add(
    'world.interaction',
    {
      actionId: 'use-maker-verify-rig',
      observationId: observation(3),
      locationId: 'verify-rig-b',
      entityId: 'verify-rig-b',
      verb: 'use',
      result: 'Verification rig engaged.',
      stateVersion: 0,
      state: {},
    },
    { agentId: 'maker' },
  );
  add(
    'tool.started',
    {
      toolCallId: 'maker-test-1',
      tool: 'npm.test',
      summary: 'Run the Maker test',
      capability: 'test',
      activityId: 'verify.run-scoped-validation',
      topicId: 'topic-hive',
      resourceId: 'verify-rig-b',
    },
    { agentId: 'maker' },
  );
  add(
    'artifact.recorded',
    {
      artifactId: 'maker-test-result-1',
      kind: 'test-result',
      title: 'Maker test',
      summary: 'Maker test passed',
      topicId: 'topic-hive',
    },
    { agentId: 'maker' },
  );
  add(
    'tool.finished',
    {
      toolCallId: 'maker-test-1',
      outcome: 'succeeded',
      summary: 'Maker test passed',
      artifactIds: ['maker-test-result-1'],
    },
    { agentId: 'maker' },
  );
  add(
    'board.message',
    {
      messageId: 'message-change',
      clientMessageId: 'client-change',
      threadId: 'thread-hive',
      topic: 'Change handoff',
      messageType: 'handoff',
      audience: 'direct',
      recipientAgentIds: ['critic'],
      topicId: 'topic-hive',
      artifactIds: ['change-1', 'maker-test-result-1'],
      text: 'The linked change is ready for independent validation.',
    },
    { agentId: 'maker' },
  );
  add(
    'board.acknowledged',
    { messageId: 'message-change', state: 'resolved' },
    { agentId: 'critic' },
  );
  add(
    'world.interaction',
    {
      actionId: 'use-critic-verify-rig',
      observationId: observation(4),
      locationId: 'verify-rig-b',
      entityId: 'verify-rig-b',
      verb: 'use',
      result: 'Verification rig engaged.',
      stateVersion: 0,
      state: {},
    },
    { agentId: 'critic' },
  );
  add(
    'tool.started',
    {
      toolCallId: 'critic-test-1',
      tool: 'npm.test',
      summary: 'Independently validate the Maker topic',
      capability: 'review',
      activityId: 'verify.independent-review',
      topicId: 'topic-hive',
      resourceId: 'verify-rig-b',
    },
    { agentId: 'critic' },
  );
  add(
    'artifact.recorded',
    {
      artifactId: 'critic-test-result-1',
      kind: 'test-result',
      title: 'Independent validation',
      summary: 'Independent validation passed',
      topicId: 'topic-hive',
    },
    { agentId: 'critic' },
  );
  add(
    'tool.finished',
    {
      toolCallId: 'critic-test-1',
      outcome: 'succeeded',
      summary: 'Independent validation passed',
      artifactIds: ['critic-test-result-1'],
    },
    { agentId: 'critic' },
  );
  add(
    'board.message',
    {
      messageId: 'message-validation-result',
      clientMessageId: 'client-validation-result',
      threadId: 'thread-validation-result',
      topic: 'Independent validation result',
      messageType: 'decision',
      audience: 'broadcast',
      recipientAgentIds: [],
      topicId: 'topic-hive',
      artifactIds: ['critic-test-result-1'],
      text: 'The linked independent validation is complete.',
    },
    { agentId: 'critic' },
  );
  add(
    'world.interaction',
    {
      actionId: 'inspect-plant-before',
      observationId: 'obs-steward-before',
      locationId: 'plant-context',
      entityId: 'plant-context',
      verb: 'inspect',
      result: 'The plant needs water.',
      stateVersion: 0,
      state: { hydration: 44, condition: 'thirsty' },
    },
    { agentId: 'steward' },
  );
  add(
    'world.interaction',
    {
      actionId: 'water-plant',
      observationId: 'obs-steward-water',
      locationId: 'plant-context',
      entityId: 'plant-context',
      verb: 'water',
      result: 'The plant is watered.',
      stateVersion: 1,
      state: { hydration: 100, condition: 'healthy' },
    },
    { agentId: 'steward' },
  );
  add(
    'world.interaction',
    {
      actionId: 'inspect-plant-after',
      observationId: 'obs-steward-after',
      locationId: 'plant-context',
      entityId: 'plant-context',
      verb: 'inspect',
      result: 'The plant is healthy.',
      stateVersion: 1,
      state: { hydration: 100, condition: 'healthy' },
    },
    { agentId: 'steward' },
  );
  for (const room of ['command', 'synthesis', 'context', 'build']) {
    add(
      'world.interaction',
      {
        actionId: `light-${room}-off`,
        observationId: `obs-light-${room}`,
        locationId: `room-light-${room}`,
        entityId: `room-light-${room}`,
        verb: 'switch_off',
        result: 'The room light is off.',
        stateVersion: 1,
        state: { power: 'off' },
      },
      { agentId: 'steward' },
    );
  }
  const rejectionSequence = events.length;
  add(
    'world.navigation',
    {
      actionId: 'fresh-move',
      observationId: observation(12),
      fromLocationId: 'context-hub',
      toLocationId: 'command-hub',
      startedAt: new Date(
        BASE_TIME + (events.length + 1) * 1_000,
      ).toISOString(),
      arrivesAt: new Date(
        BASE_TIME + (events.length + 1) * 1_000 + 100,
      ).toISOString(),
    },
    { agentId: 'steward' },
  );
  for (const agentId of ['explorer', 'maker', 'critic', 'steward']) {
    add(
      'agent.completed',
      { summary: `${agentId} completed factual work` },
      { agentId },
    );
  }
  add('run.completed', { summary: 'Qualification work completed' });

  const receipt = {
    schemaVersion: 1,
    receiptId: 'reject_00000000-0000-4000-8000-000000000001',
    occurredAt: new Date(
      BASE_TIME + rejectionSequence * 1_000 + 500,
    ).toISOString(),
    runId: RUN_ID,
    agentId: 'steward',
    actionId: 'stale-move',
    action: 'move',
    targetId: 'comms-board',
    submittedObservationId: observation(10),
    returnedObservationId: observation(11),
    currentEventSequence: rejectionSequence,
    httpStatus: 409,
    reasonCode: 'stale_observation',
  };
  return { runId: RUN_ID, events, receipts: [receipt], roster: clone(roster) };
}

function assertionById(report, id) {
  const result = report.assertions.find((entry) => entry.id === id);
  assert.ok(result, `missing assertion ${id}`);
  return result;
}

function evaluate(fixture = makeGolden()) {
  return evaluateArenaRun(fixture);
}

function resequence(fixture) {
  for (const [index, event] of fixture.events.entries()) {
    event.sequence = index + 1;
    event.occurredAt = new Date(BASE_TIME + (index + 1) * 1_000).toISOString();
  }
  const accepted = fixture.events.find(
    (event) =>
      event.kind === 'world.navigation' &&
      event.payload.actionId === 'fresh-move',
  );
  for (const receipt of fixture.receipts) {
    receipt.currentEventSequence = accepted.sequence - 1;
    receipt.occurredAt = new Date(
      BASE_TIME + receipt.currentEventSequence * 1_000 + 500,
    ).toISOString();
  }
}

function moveEventAfter(fixture, eventPredicate, predecessorPredicate) {
  const eventIndex = fixture.events.findIndex(eventPredicate);
  const [event] = fixture.events.splice(eventIndex, 1);
  const predecessorIndex = fixture.events.findIndex(predecessorPredicate);
  fixture.events.splice(predecessorIndex + 1, 0, event);
  resequence(fixture);
}

function addReactivation(
  fixture,
  { agentId = 'explorer', includeTerminal = true } = {},
) {
  const taskId = `task-${agentId}-reactivated`;
  const initialAssignment = fixture.events.find(
    (event) => event.kind === 'task.assigned' && event.agentId === agentId,
  );
  const initialTerminal = fixture.events.find(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === agentId,
  );
  const assignment = {
    ...clone(initialAssignment),
    eventId: `evt-${agentId}-reactivated-assignment`,
    taskId,
  };
  const terminal = {
    ...clone(initialTerminal),
    eventId: `evt-${agentId}-reactivated-terminal`,
    taskId,
    payload: { summary: `${agentId} completed reactivated work` },
  };
  const runCompleteIndex = fixture.events.findIndex(
    (event) => event.kind === 'run.completed',
  );
  fixture.events.splice(
    runCompleteIndex,
    0,
    assignment,
    ...(includeTerminal ? [terminal] : []),
  );
  resequence(fixture);
  return { assignment, terminal };
}

function addEarlierUnreviewedMakerProof(fixture) {
  const template = (predicate) => clone(fixture.events.find(predicate));
  const topic = template(
    (event) =>
      event.kind === 'research.topic.selected' &&
      event.payload.topicId === 'topic-hive',
  );
  topic.eventId = 'evt-early-maker-topic';
  topic.agentId = 'maker';
  topic.payload = {
    topicId: 'topic-early-maker',
    title: 'Earlier unreviewed Maker work',
    question: 'Can the Maker complete an unrelated local improvement?',
  };

  const buildUse = template(
    (event) => event.payload?.actionId === 'use-build-bench',
  );
  buildUse.eventId = 'evt-early-maker-build-use';
  buildUse.payload.actionId = 'use-build-bench-early';
  const editStart = template(
    (event) =>
      event.payload?.toolCallId === 'edit-1' && event.kind === 'tool.started',
  );
  editStart.eventId = 'evt-early-maker-edit-start';
  editStart.payload.toolCallId = 'edit-early';
  editStart.payload.topicId = 'topic-early-maker';
  const change = template((event) => event.payload?.artifactId === 'change-1');
  change.eventId = 'evt-early-maker-change';
  change.payload.artifactId = 'change-early';
  change.payload.topicId = 'topic-early-maker';
  const editFinish = template(
    (event) =>
      event.payload?.toolCallId === 'edit-1' && event.kind === 'tool.finished',
  );
  editFinish.eventId = 'evt-early-maker-edit-finish';
  editFinish.payload.toolCallId = 'edit-early';
  editFinish.payload.artifactIds = ['change-early'];

  const verifyUse = template(
    (event) => event.payload?.actionId === 'use-maker-verify-rig',
  );
  verifyUse.eventId = 'evt-early-maker-verify-use';
  verifyUse.payload.actionId = 'use-maker-verify-rig-early';
  const testStart = template(
    (event) =>
      event.payload?.toolCallId === 'maker-test-1' &&
      event.kind === 'tool.started',
  );
  testStart.eventId = 'evt-early-maker-test-start';
  testStart.payload.toolCallId = 'maker-test-early';
  testStart.payload.topicId = 'topic-early-maker';
  const testResult = template(
    (event) => event.payload?.artifactId === 'maker-test-result-1',
  );
  testResult.eventId = 'evt-early-maker-test-result';
  testResult.payload.artifactId = 'maker-test-result-early';
  testResult.payload.topicId = 'topic-early-maker';
  const testFinish = template(
    (event) =>
      event.payload?.toolCallId === 'maker-test-1' &&
      event.kind === 'tool.finished',
  );
  testFinish.eventId = 'evt-early-maker-test-finish';
  testFinish.payload.toolCallId = 'maker-test-early';
  testFinish.payload.artifactIds = ['maker-test-result-early'];
  const close = template(
    (event) =>
      event.kind === 'research.topic.updated' &&
      event.payload.topicId === 'topic-hive',
  );
  close.eventId = 'evt-early-maker-topic-close';
  close.agentId = 'maker';
  close.payload.topicId = 'topic-early-maker';
  close.payload.summary = 'Earlier Maker work completed without Critic review';

  const insertionIndex = fixture.events.findIndex(
    (event) =>
      event.kind === 'research.topic.selected' &&
      event.payload.topicId === 'topic-hive',
  );
  fixture.events.splice(
    insertionIndex,
    0,
    topic,
    buildUse,
    editStart,
    change,
    editFinish,
    verifyUse,
    testStart,
    testResult,
    testFinish,
    close,
  );
  resequence(fixture);
}

function addStewardCoordinationResolution(fixture, { resolver = 'peer' } = {}) {
  fixture.events = fixture.events.filter(
    (event) =>
      !(
        event.kind === 'world.interaction' &&
        event.payload.entityId === 'plant-context'
      ),
  );
  const messageTemplate = fixture.events.find(
    (event) =>
      event.kind === 'board.message' &&
      event.payload.messageId === 'message-change',
  );
  const acknowledgementTemplate = fixture.events.find(
    (event) =>
      event.kind === 'board.acknowledged' &&
      event.payload.messageId === 'message-change',
  );
  const parent = {
    ...clone(messageTemplate),
    eventId: 'evt-steward-coordination-parent',
    agentId: 'critic',
    payload: {
      ...clone(messageTemplate.payload),
      messageId: 'message-steward-coordination-parent',
      clientMessageId: 'client-steward-coordination-parent',
      threadId: 'thread-steward-coordination',
      topic: 'Coordination resolution',
      messageType: 'decision',
      audience: 'broadcast',
      recipientAgentIds: [],
      artifactIds: ['critic-test-result-1'],
      text: 'The linked validation needs a coordinated resolution.',
    },
  };
  const update = {
    ...clone(parent),
    eventId: 'evt-steward-coordination-update',
    agentId: 'steward',
    payload: {
      ...clone(parent.payload),
      messageId: 'message-steward-coordination-update',
      clientMessageId: 'client-steward-coordination-update',
      messageType: 'update',
      replyToMessageId: parent.payload.messageId,
      text: 'The linked validation supports resolving this coordination thread.',
    },
  };
  const peerMessage =
    resolver === 'steward'
      ? {
          ...clone(update),
          eventId: 'evt-steward-coordination-peer-decision',
          agentId: 'maker',
          payload: {
            ...clone(update.payload),
            messageId: 'message-steward-coordination-peer-decision',
            clientMessageId: 'client-steward-coordination-peer-decision',
            messageType: 'decision',
            replyToMessageId: update.payload.messageId,
            text: 'The linked evidence supports this final decision.',
          },
        }
      : undefined;
  const resolvedMessage = peerMessage ?? update;
  const resolved = {
    ...clone(acknowledgementTemplate),
    eventId: 'evt-steward-coordination-resolved',
    agentId: resolver === 'steward' ? 'steward' : 'critic',
    payload: {
      messageId: resolvedMessage.payload.messageId,
      state: 'resolved',
    },
  };
  const firstTerminalIndex = fixture.events.findIndex((event) =>
    TERMINAL_KINDS_FOR_TEST.has(event.kind),
  );
  fixture.events.splice(
    firstTerminalIndex,
    0,
    parent,
    update,
    ...(peerMessage ? [peerMessage] : []),
    resolved,
  );
  resequence(fixture);
  return { parent, update, peerMessage, resolved };
}

async function invokeEvaluatorCli(
  t,
  fixture,
  { eventPrefix = [], receiptPrefix = [], run = RUN_ID } = {},
) {
  const directory = await mkdtemp(resolve(tmpdir(), 'arena-eval-input-'));
  const dataDir = resolve(directory, '.arena');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    resolve(dataDir, 'events.jsonl'),
    `${[
      ...eventPrefix.map((entry) =>
        typeof entry === 'string' ? entry : JSON.stringify(entry),
      ),
      ...fixture.events.map((event) => JSON.stringify(event)),
    ].join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'action-rejections.jsonl'),
    `${[
      ...receiptPrefix.map((entry) =>
        typeof entry === 'string' ? entry : JSON.stringify(entry),
      ),
      ...fixture.receipts.map((receipt) => JSON.stringify(receipt)),
    ].join('\n')}\n`,
    'utf8',
  );
  const rosterPath = resolve(directory, 'roster.json');
  await writeFile(rosterPath, JSON.stringify(fixture.roster), 'utf8');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    [
      evaluatorPath,
      '--run',
      run,
      '--roster',
      rosterPath,
      '--data-dir',
      dataDir,
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  return { child, directory };
}

void test('valid four-role golden trace passes every required assertion', () => {
  const report = evaluate();
  assert.equal(report.status, 'pass');
  assert.equal(report.counts.failed, 0);
  assert.equal(report.counts.inconclusive, 0);
  assert.ok(report.assertions.every((entry) => entry.status === 'pass'));
});

void test('CLI resolves current, writes the versioned report, and exits zero', async (t) => {
  const fixture = makeGolden();
  const directory = await mkdtemp(resolve(tmpdir(), 'arena-eval-'));
  const dataDir = resolve(directory, '.arena');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    resolve(dataDir, 'events.jsonl'),
    `${fixture.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'action-rejections.jsonl'),
    `${fixture.receipts.map((receipt) => JSON.stringify(receipt)).join('\n')}\n`,
    'utf8',
  );
  const rosterPath = resolve(directory, 'roster.json');
  await writeFile(rosterPath, JSON.stringify(fixture.roster), 'utf8');
  t.after(() => rm(directory, { recursive: true, force: true }));

  const child = spawnSync(
    process.execPath,
    [
      evaluatorPath,
      '--run',
      'current',
      '--roster',
      rosterPath,
      '--data-dir',
      dataDir,
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /Arena qualification PASS/u);
  const report = JSON.parse(
    await readFile(
      resolve(directory, 'outputs', 'evaluations', `${RUN_ID}.json`),
      'utf8',
    ),
  );
  assert.equal(report.status, 'pass');
  assert.equal(report.qualificationVersion, 1);
  assert.deepEqual(report.provenance.roster, fixture.roster);
  assert.match(report.provenance.rosterSha256, /^[0-9a-f]{64}$/u);
});

void test('report roster provenance is canonical, deterministic, and attributable', () => {
  const fixture = makeGolden();
  const baseline = evaluate(fixture).provenance;
  assert.deepEqual(baseline.roster, fixture.roster);
  assert.match(baseline.rosterSha256, /^[0-9a-f]{64}$/u);

  const reordered = makeGolden();
  reordered.roster.residents.reverse();
  assert.deepEqual(evaluate(reordered).provenance, baseline);

  const changed = makeGolden();
  changed.roster.residents[0].taskId = 'task-explorer-replacement';
  assert.notEqual(
    evaluate(changed).provenance.rosterSha256,
    baseline.rosterSha256,
  );
});

void test('duplicate process and identity mappings fail roster qualification', () => {
  for (const field of ['processId', 'agentId']) {
    const fixture = makeGolden();
    fixture.roster.residents[1][field] = fixture.roster.residents[0][field];
    const report = evaluate(fixture);
    assert.equal(assertionById(report, 'roster.mapping').status, 'fail');
  }
});

void test('malformed and noncanonical process IDs fail cleanly without throwing', () => {
  for (const processId of [
    undefined,
    42,
    '/root/../forged',
    '/root//forged',
    '/root/forged/',
    '/root/Forged',
    '/root/forged-agent',
    'root/forged',
  ]) {
    const fixture = makeGolden();
    fixture.roster.residents[0].processId = processId;
    let report;
    assert.doesNotThrow(() => {
      report = evaluate(fixture);
    });
    assert.equal(assertionById(report, 'roster.mapping').status, 'fail');
  }
});

void test('direct evaluator rejects malformed records with controlled input errors', () => {
  const cases = [
    (fixture) => {
      fixture.events.find(
        (event) => event.kind === 'artifact.recorded',
      ).payload = null;
    },
    (fixture) => {
      fixture.events[0].kind = 42;
    },
    (fixture) => {
      delete fixture.events.find((event) => event.kind === 'board.message')
        .payload.recipientAgentIds;
    },
    (fixture) => {
      fixture.events.find(
        (event) => event.kind === 'agent.spawned',
      ).payload.role = 42;
    },
    (fixture) => {
      fixture.receipts[0].reasonCode = 'unstable_raw_reason';
    },
  ];
  for (const mutate of cases) {
    const fixture = makeGolden();
    mutate(fixture);
    assert.throws(
      () => evaluate(fixture),
      (error) =>
        error instanceof ArenaEvalInputError &&
        !/TypeError|Cannot read properties/u.test(error.message),
    );
  }
});

void test('CLI rejects malformed event and receipt records as input errors', async (t) => {
  const cases = [
    (fixture) => {
      fixture.events.find(
        (event) => event.kind === 'artifact.recorded',
      ).payload = null;
    },
    (fixture) => {
      fixture.events[0].kind = 42;
    },
    (fixture) => {
      delete fixture.events.find((event) => event.kind === 'board.message')
        .payload.recipientAgentIds;
    },
    (fixture) => {
      fixture.events.find(
        (event) => event.kind === 'agent.spawned',
      ).payload.role = 42;
    },
    (fixture) => {
      fixture.receipts[0].reasonCode = 'unstable_raw_reason';
    },
  ];
  for (const mutate of cases) {
    const fixture = makeGolden();
    mutate(fixture);
    const { child } = await invokeEvaluatorCli(t, fixture);
    assert.equal(child.status, 2, child.stderr || child.stdout);
    assert.match(child.stderr, /^Input error:/u);
    assert.doesNotMatch(
      `${child.stderr}\n${child.stdout}`,
      /TypeError|Cannot read properties|\.startsWith is not a function|\.trim is not a function/u,
    );
  }
});

void test('explicit run ignores schema-invalid records owned by unrelated legacy runs', async (t) => {
  const fixture = makeGolden();
  const unrelatedEvent = {
    ...clone(fixture.events.find((event) => event.kind === 'tool.started')),
    eventId: 'evt-unrelated-legacy-tool',
    runId: 'run_unrelated_legacy',
    payload: {
      toolCallId: 'legacy-tool',
      tool: 'rg',
      summary: 'Legacy tool record predating resource attribution',
    },
  };
  const unrelatedReceipt = {
    ...clone(fixture.receipts[0]),
    receiptId: 'reject_unrelated_legacy',
    runId: 'run_unrelated_legacy',
    prompt: 'legacy field that is forbidden by the current receipt schema',
  };
  const { child, directory } = await invokeEvaluatorCli(t, fixture, {
    eventPrefix: [unrelatedEvent],
    receiptPrefix: [unrelatedReceipt],
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(
    await readFile(
      resolve(directory, 'outputs', 'evaluations', `${RUN_ID}.json`),
      'utf8',
    ),
  );
  assert.equal(report.counts.events, fixture.events.length);
  assert.equal(report.counts.rejectionReceipts, fixture.receipts.length);
  assert.equal(report.status, 'pass');
});

void test('current run ignores schema-invalid records owned by unrelated legacy runs', async (t) => {
  const fixture = makeGolden();
  const unrelatedEvent = {
    ...clone(fixture.events.find((event) => event.kind === 'tool.started')),
    eventId: 'evt-unrelated-current-legacy-tool',
    runId: 'run_unrelated_current_legacy',
    payload: {
      toolCallId: 'legacy-current-tool',
      tool: 'rg',
      summary: 'Legacy tool record predating resource attribution',
    },
  };
  const unrelatedReceipt = {
    ...clone(fixture.receipts[0]),
    receiptId: 'reject_unrelated_current_legacy',
    runId: 'run_unrelated_current_legacy',
    prompt: 'legacy field that is forbidden by the current receipt schema',
  };
  const { child, directory } = await invokeEvaluatorCli(t, fixture, {
    eventPrefix: [unrelatedEvent],
    receiptPrefix: [unrelatedReceipt],
    run: 'current',
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(
    await readFile(
      resolve(directory, 'outputs', 'evaluations', `${RUN_ID}.json`),
      'utf8',
    ),
  );
  assert.equal(report.counts.events, fixture.events.length);
  assert.equal(report.counts.rejectionReceipts, fixture.receipts.length);
  assert.equal(report.status, 'pass');
});

void test('explicit run keeps corrupt JSON and malformed selected-run records fatal', async (t) => {
  const corrupt = await invokeEvaluatorCli(t, makeGolden(), {
    eventPrefix: ['{not-json}'],
  });
  assert.equal(corrupt.child.status, 2, corrupt.child.stderr);
  assert.match(corrupt.child.stderr, /is not valid JSON/u);

  const malformedEvent = makeGolden();
  delete malformedEvent.events.find((event) => event.kind === 'tool.started')
    .payload.resourceId;
  const eventResult = await invokeEvaluatorCli(t, malformedEvent);
  assert.equal(eventResult.child.status, 2, eventResult.child.stderr);
  assert.match(eventResult.child.stderr, /payload\.resourceId is required/u);

  const malformedReceipt = makeGolden();
  malformedReceipt.receipts[0].prompt = 'selected-run secret';
  const receiptResult = await invokeEvaluatorCli(t, malformedReceipt);
  assert.equal(receiptResult.child.status, 2, receiptResult.child.stderr);
  assert.match(
    receiptResult.child.stderr,
    /unexpected receipt fields: prompt/u,
  );
});

void test('current run keeps malformed selected-run records fatal', async (t) => {
  const malformedEvent = makeGolden();
  delete malformedEvent.events.find((event) => event.kind === 'tool.started')
    .payload.resourceId;
  const eventResult = await invokeEvaluatorCli(t, malformedEvent, {
    run: 'current',
  });
  assert.equal(eventResult.child.status, 2, eventResult.child.stderr);
  assert.match(eventResult.child.stderr, /payload\.resourceId is required/u);

  const malformedReceipt = makeGolden();
  malformedReceipt.receipts[0].prompt = 'selected-current secret';
  const receiptResult = await invokeEvaluatorCli(t, malformedReceipt, {
    run: 'current',
  });
  assert.equal(receiptResult.child.status, 2, receiptResult.child.stderr);
  assert.match(
    receiptResult.child.stderr,
    /unexpected receipt fields: prompt/u,
  );
});

void test('explicit run preserves duplicate and out-of-order journal failures', async (t) => {
  const fixtures = [];
  const duplicate = makeGolden();
  duplicate.events.splice(1, 0, clone(duplicate.events[0]));
  fixtures.push(duplicate);

  const reordered = makeGolden();
  [reordered.events[10], reordered.events[11]] = [
    reordered.events[11],
    reordered.events[10],
  ];
  fixtures.push(reordered);

  for (const fixture of fixtures) {
    const { child, directory } = await invokeEvaluatorCli(t, fixture);
    assert.equal(child.status, 1, child.stderr || child.stdout);
    const report = JSON.parse(
      await readFile(
        resolve(directory, 'outputs', 'evaluations', `${RUN_ID}.json`),
        'utf8',
      ),
    );
    assert.equal(assertionById(report, 'journal.integrity').status, 'fail');
  }
});

void test('root provenance, exact objective, and exact charter paths are enforced', () => {
  const wrongRoot = makeGolden();
  wrongRoot.roster.residents.find(
    (resident) => resident.profile === 'Steward',
  ).processId = '/root/steward';
  assert.equal(
    assertionById(evaluate(wrongRoot), 'roster.mapping').status,
    'fail',
  );

  const wrongObjective = makeGolden();
  wrongObjective.events[0].payload.objective =
    'A similar but non-qualification objective';
  assert.equal(
    assertionById(evaluate(wrongObjective), 'run.lifecycle').status,
    'fail',
  );

  const wrongCharter = makeGolden();
  wrongCharter.roster.residents[0].charterPath =
    'C:/workspace/.codex/residents/EXPLORER.md';
  assert.equal(
    assertionById(evaluate(wrongCharter), 'roster.mapping').status,
    'fail',
  );
});

void test('selected-run integrity accepts a contiguous global sequence that starts above one', () => {
  const fixture = makeGolden();
  for (const event of fixture.events) event.sequence += 50;
  for (const receipt of fixture.receipts) receipt.currentEventSequence += 50;
  const report = evaluate(fixture);
  assert.equal(assertionById(report, 'journal.integrity').status, 'pass');
  assert.equal(assertionById(report, 'run.lifecycle').status, 'pass');
  assert.equal(report.status, 'pass');
});

void test('missing and directed assignments fail the assignment gate', () => {
  const directed = makeGolden();
  directed.events.find(
    (event) => event.kind === 'task.assigned' && event.agentId === 'maker',
  ).payload.mode = 'directed';
  assert.equal(
    assertionById(evaluate(directed), 'resident.assignments').status,
    'fail',
  );

  const missing = makeGolden();
  missing.events = missing.events.filter(
    (event) => !(event.kind === 'task.assigned' && event.agentId === 'critic'),
  );
  resequence(missing);
  assert.equal(
    assertionById(evaluate(missing), 'resident.assignments').status,
    'fail',
  );
});

void test('a resident must spawn before its canonical assignment', () => {
  const fixture = makeGolden();
  moveEventAfter(
    fixture,
    (event) => event.kind === 'task.assigned' && event.agentId === 'explorer',
    (event) => event.kind === 'run.started',
  );

  const report = evaluate(fixture);
  assert.equal(assertionById(report, 'resident.assignments').status, 'fail');
  assert.match(
    assertionById(report, 'resident.assignments').details.join(' '),
    /before its spawn/u,
  );
});

void test('qualification v1 rejects reactivation even when the general lifecycle is factual', () => {
  const fixture = makeGolden();
  addReactivation(fixture);
  const report = evaluate(fixture);

  assert.equal(assertionById(report, 'resident.assignments').status, 'fail');
  assert.match(
    assertionById(report, 'resident.assignments').details.join(' '),
    /exactly one qualification assignment/u,
  );
  assert.equal(assertionById(report, 'resident.terminals').status, 'pass');
  assert.equal(assertionById(report, 'liveness.thirty_minutes').status, 'pass');
});

void test('reactivations cannot overlap or reuse an assignment taskId', () => {
  const overlap = makeGolden();
  const initialAssignment = overlap.events.find(
    (event) => event.kind === 'task.assigned' && event.agentId === 'explorer',
  );
  const initialTerminalIndex = overlap.events.findIndex(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'explorer',
  );
  overlap.events[initialTerminalIndex].taskId = initialAssignment.taskId;
  const overlappingAssignment = {
    ...clone(initialAssignment),
    eventId: 'evt-explorer-overlapping-assignment',
    taskId: 'task-explorer-overlapping',
  };
  const overlappingTerminal = {
    ...clone(overlap.events[initialTerminalIndex]),
    eventId: 'evt-explorer-overlapping-terminal',
    taskId: overlappingAssignment.taskId,
    payload: { summary: 'Explorer completed overlapping work' },
  };
  overlap.events.splice(initialTerminalIndex, 0, overlappingAssignment);
  overlap.events.splice(initialTerminalIndex + 2, 0, overlappingTerminal);
  resequence(overlap);
  const overlapReport = evaluate(overlap);
  assert.equal(
    assertionById(overlapReport, 'resident.assignments').status,
    'fail',
  );
  assert.equal(
    assertionById(overlapReport, 'resident.terminals').status,
    'pass',
  );

  const reused = makeGolden();
  const reactivation = addReactivation(reused);
  reactivation.assignment.taskId = 'task-explorer';
  reactivation.terminal.taskId = 'task-explorer';
  assert.equal(
    assertionById(evaluate(reused), 'resident.assignments').status,
    'fail',
  );
});

void test('every reactivation requires exactly one factual terminal', () => {
  const missing = makeGolden();
  addReactivation(missing, { includeTerminal: false });
  const missingReport = evaluate(missing);
  assert.equal(
    assertionById(missingReport, 'resident.assignments').status,
    'fail',
  );
  assert.equal(
    assertionById(missingReport, 'resident.terminals').status,
    'fail',
  );

  const duplicate = makeGolden();
  const terminal = duplicate.events.find(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'explorer',
  );
  const runCompleteIndex = duplicate.events.findIndex(
    (event) => event.kind === 'run.completed',
  );
  duplicate.events.splice(runCompleteIndex, 0, {
    ...clone(terminal),
    eventId: 'evt-explorer-duplicate-terminal',
    payload: { summary: 'Explorer emitted a duplicate terminal' },
  });
  resequence(duplicate);
  const duplicateReport = evaluate(duplicate);
  assert.equal(
    assertionById(duplicateReport, 'resident.assignments').status,
    'pass',
  );
  assert.equal(
    assertionById(duplicateReport, 'resident.terminals').status,
    'fail',
  );
});

void test('liveness is measured from the single qualification assignment', () => {
  const slow = makeGolden();
  const slowAssignment = slow.events.find(
    (event) => event.kind === 'task.assigned' && event.agentId === 'explorer',
  );
  const slowTerminalIndex = slow.events.findIndex(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'explorer',
  );
  const slowTerminalTime =
    Date.parse(slowAssignment.occurredAt) + 30 * 60 * 1_000 + 1_000;
  for (let index = slowTerminalIndex; index < slow.events.length; index += 1) {
    slow.events[index].occurredAt = new Date(
      slowTerminalTime + (index - slowTerminalIndex) * 1_000,
    ).toISOString();
  }
  const slowReport = evaluate(slow);
  assert.equal(assertionById(slowReport, 'journal.integrity').status, 'pass');
  assert.equal(
    assertionById(slowReport, 'resident.assignments').status,
    'pass',
  );
  assert.equal(assertionById(slowReport, 'resident.terminals').status, 'pass');
  assert.equal(
    assertionById(slowReport, 'liveness.thirty_minutes').status,
    'fail',
  );
  assert.match(
    assertionById(slowReport, 'liveness.thirty_minutes').details.join(' '),
    /task-explorer/u,
  );

  const boundary = makeGolden();
  const boundaryAssignment = boundary.events.find(
    (event) => event.kind === 'task.assigned' && event.agentId === 'explorer',
  );
  const boundaryTerminalIndex = boundary.events.findIndex(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'explorer',
  );
  const boundaryTerminalTime =
    Date.parse(boundaryAssignment.occurredAt) + 30 * 60 * 1_000;
  for (
    let index = boundaryTerminalIndex;
    index < boundary.events.length;
    index += 1
  ) {
    boundary.events[index].occurredAt = new Date(
      boundaryTerminalTime + (index - boundaryTerminalIndex) * 1_000,
    ).toISOString();
  }
  assert.equal(
    assertionById(evaluate(boundary), 'liveness.thirty_minutes').status,
    'pass',
  );

  const blocked = makeGolden();
  const blockedAssignment = blocked.events.find(
    (event) => event.kind === 'task.assigned' && event.agentId === 'explorer',
  );
  const explorerTerminalIndex = blocked.events.findIndex(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'explorer',
  );
  const [explorerTerminal] = blocked.events.splice(explorerTerminalIndex, 1);
  const runCompleteIndex = blocked.events.findIndex(
    (event) => event.kind === 'run.completed',
  );
  blocked.events.splice(
    runCompleteIndex,
    0,
    {
      schemaVersion: 1,
      eventId: 'evt-explorer-reactivated-blocked',
      sequence: 1,
      occurredAt: new Date(BASE_TIME).toISOString(),
      source: 'codex',
      runId: RUN_ID,
      agentId: 'explorer',
      taskId: blockedAssignment.taskId,
      kind: 'agent.blocked',
      payload: {
        promptId: 'prompt-explorer-qualification',
        reason: 'question',
        request: 'A factual answer is required to continue.',
      },
    },
    explorerTerminal,
  );
  resequence(blocked);
  const blockedEvent = blocked.events.find(
    (event) => event.eventId === 'evt-explorer-reactivated-blocked',
  );
  blockedEvent.occurredAt = new Date(
    Date.parse(blockedAssignment.occurredAt) + 60_000,
  ).toISOString();
  const blockedTerminalIndex = blocked.events.findIndex(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'explorer',
  );
  const blockedTerminalTime =
    Date.parse(blockedAssignment.occurredAt) + 30 * 60 * 1_000 + 1_000;
  blocked.events[blockedTerminalIndex].occurredAt = new Date(
    blockedTerminalTime,
  ).toISOString();
  blocked.events.at(-1).occurredAt = new Date(
    blockedTerminalTime + 1_000,
  ).toISOString();
  const blockedReport = evaluate(blocked);
  assert.equal(
    assertionById(blockedReport, 'journal.integrity').status,
    'pass',
  );
  assert.equal(
    assertionById(blockedReport, 'liveness.thirty_minutes').status,
    'pass',
  );
});

void test('broken artifact lineage fails the Critic and team chain gates', () => {
  const fixture = makeGolden();
  fixture.events.find(
    (event) =>
      event.kind === 'board.message' &&
      event.payload.messageId === 'message-change',
  ).payload.artifactIds = ['unknown-change'];
  const report = evaluate(fixture);
  assert.equal(assertionById(report, 'role.critic').status, 'fail');
  assert.equal(
    assertionById(report, 'team.evidence_change_validation_chain').status,
    'fail',
  );
});

void test('tool lifecycles require a real compatible and actively used facility resource', () => {
  const unknown = makeGolden();
  unknown.events.find(
    (event) =>
      event.kind === 'tool.started' && event.payload.toolCallId === 'edit-1',
  ).payload.resourceId = 'invented-build-station';
  assert.equal(
    assertionById(evaluate(unknown), 'journal.integrity').status,
    'fail',
  );

  const unsupported = makeGolden();
  unsupported.events.find(
    (event) =>
      event.kind === 'tool.started' && event.payload.toolCallId === 'edit-1',
  ).payload.resourceId = 'research-computer-b';
  assert.equal(
    assertionById(evaluate(unsupported), 'journal.integrity').status,
    'fail',
  );

  const notUsed = makeGolden();
  notUsed.events.find(
    (event) => event.payload?.actionId === 'use-build-bench',
  ).payload.verb = 'inspect';
  assert.equal(
    assertionById(evaluate(notUsed), 'journal.integrity').status,
    'fail',
  );

  const unknownActivity = makeGolden();
  unknownActivity.events.find(
    (event) =>
      event.kind === 'tool.started' && event.payload.toolCallId === 'edit-1',
  ).payload.activityId = 'build.activity-does-not-exist';
  assert.equal(
    assertionById(evaluate(unknownActivity), 'journal.integrity').status,
    'fail',
  );

  const mismatchedActivity = makeGolden();
  mismatchedActivity.events.find(
    (event) =>
      event.kind === 'tool.started' && event.payload.toolCallId === 'edit-1',
  ).payload.activityId = 'build.compile-project';
  assert.equal(
    assertionById(evaluate(mismatchedActivity), 'journal.integrity').status,
    'fail',
  );
});

void test('artifact lineage must occur inside its owning tool lifecycle', () => {
  const fixture = makeGolden();
  const source = fixture.events.find(
    (event) =>
      event.kind === 'artifact.recorded' &&
      event.payload.artifactId === 'source-1',
  );
  const search = fixture.events.find(
    (event) =>
      event.kind === 'tool.started' && event.payload.toolCallId === 'search-1',
  );
  [source.sequence, search.sequence] = [search.sequence, source.sequence];
  [source.occurredAt, search.occurredAt] = [
    search.occurredAt,
    source.occurredAt,
  ];
  fixture.events.sort((left, right) => left.sequence - right.sequence);
  assert.equal(
    assertionById(evaluate(fixture), 'role.explorer').status,
    'fail',
  );
});

void test('broadcast artifact handoffs qualify when the receiving resident acknowledges', () => {
  const fixture = makeGolden();
  for (const message of fixture.events.filter(
    (event) => event.kind === 'board.message',
  )) {
    message.payload.audience = 'broadcast';
    message.payload.recipientAgentIds = [];
  }
  const report = evaluate(fixture);
  assert.equal(assertionById(report, 'role.critic').status, 'pass');
  assert.equal(
    assertionById(report, 'team.evidence_change_validation_chain').status,
    'pass',
  );
});

void test('handoffs must precede recipient acknowledgement and work', () => {
  const earlyEvidence = makeGolden();
  moveEventAfter(
    earlyEvidence,
    (event) => event.payload?.messageId === 'message-evidence',
    (event) =>
      event.kind === 'artifact.recorded' &&
      event.payload.artifactId === 'source-1',
  );
  assert.equal(
    assertionById(
      evaluate(earlyEvidence),
      'team.evidence_change_validation_chain',
    ).status,
    'fail',
  );

  const lateMakerAck = makeGolden();
  moveEventAfter(
    lateMakerAck,
    (event) =>
      event.kind === 'board.acknowledged' &&
      event.payload.messageId === 'message-evidence',
    (event) =>
      event.kind === 'tool.started' && event.payload.toolCallId === 'edit-1',
  );
  assert.equal(
    assertionById(
      evaluate(lateMakerAck),
      'team.evidence_change_validation_chain',
    ).status,
    'fail',
  );

  const lateCriticAck = makeGolden();
  moveEventAfter(
    lateCriticAck,
    (event) =>
      event.kind === 'board.acknowledged' &&
      event.payload.messageId === 'message-change',
    (event) =>
      event.kind === 'tool.started' &&
      event.payload.toolCallId === 'critic-test-1',
  );
  assert.equal(
    assertionById(evaluate(lateCriticAck), 'role.critic').status,
    'fail',
  );
});

void test('a later complete chain qualifies despite earlier unreviewed Maker work', () => {
  const fixture = makeGolden();
  addEarlierUnreviewedMakerProof(fixture);
  const report = evaluate(fixture);

  assert.equal(assertionById(report, 'role.maker').status, 'pass');
  assert.equal(assertionById(report, 'role.critic').status, 'pass');
  const chain = assertionById(report, 'team.evidence_change_validation_chain');
  assert.equal(chain.status, 'pass');
  assert.ok(chain.evidence.artifactIds.includes('change-1'));
  assert.ok(chain.evidence.artifactIds.includes('maker-test-result-1'));
  assert.ok(chain.evidence.artifactIds.includes('critic-test-result-1'));
});

void test('orphaned tools, unfinished topics, unresolved handoffs, and lights are rejected', () => {
  const orphan = makeGolden();
  orphan.events = orphan.events.filter(
    (event) =>
      !(
        event.kind === 'tool.finished' &&
        event.payload.toolCallId === 'critic-test-1'
      ),
  );
  resequence(orphan);
  assert.equal(
    assertionById(evaluate(orphan), 'resident.tools_closed').status,
    'fail',
  );

  const topic = makeGolden();
  topic.events.find(
    (event) => event.kind === 'research.topic.updated',
  ).payload.status = 'active';
  assert.equal(
    assertionById(evaluate(topic), 'resident.topics_closed').status,
    'fail',
  );

  const handoff = makeGolden();
  handoff.events.find(
    (event) =>
      event.kind === 'board.acknowledged' &&
      event.payload.messageId === 'message-change',
  ).payload.state = 'read';
  const handoffReport = evaluate(handoff);
  assert.equal(assertionById(handoffReport, 'role.critic').status, 'fail');
  assert.equal(
    assertionById(handoffReport, 'team.direct_messages_resolved').status,
    'fail',
  );

  const lights = makeGolden();
  lights.events.find(
    (event) =>
      event.kind === 'world.interaction' &&
      event.payload.entityId === 'room-light-build',
  ).payload.state.power = 'on';
  assert.equal(
    assertionById(evaluate(lights), 'team.lights_off').status,
    'fail',
  );
});

void test('missing Maker change and non-independent Critic validation fail their role gates', () => {
  const missingChange = makeGolden();
  missingChange.events.find(
    (event) =>
      event.kind === 'artifact.recorded' &&
      event.payload.artifactId === 'change-1',
  ).payload.kind = 'decision';
  assert.equal(
    assertionById(evaluate(missingChange), 'role.maker').status,
    'fail',
  );

  const dependent = makeGolden();
  for (const event of dependent.events) {
    if (
      (event.kind === 'tool.started' &&
        event.payload.toolCallId === 'critic-test-1') ||
      (event.kind === 'tool.finished' &&
        event.payload.toolCallId === 'critic-test-1') ||
      (event.kind === 'artifact.recorded' &&
        event.payload.artifactId === 'critic-test-result-1')
    ) {
      event.agentId = 'maker';
    }
  }
  assert.equal(
    assertionById(evaluate(dependent), 'role.critic').status,
    'fail',
  );

  const unreported = makeGolden();
  unreported.events.find(
    (event) => event.payload?.messageId === 'message-validation-result',
  ).payload.artifactIds = ['maker-test-result-1'];
  assert.equal(
    assertionById(evaluate(unreported), 'role.critic').status,
    'fail',
    'the Critic result message must link its own independent test artifact',
  );
});

void test('Steward coordination accepts both strict resolution orientations', () => {
  const peerResolved = makeGolden();
  const { update } = addStewardCoordinationResolution(peerResolved);
  const proof = assertionById(evaluate(peerResolved), 'role.steward');

  assert.equal(proof.status, 'pass');
  assert.ok(proof.evidence.messageIds.includes(update.payload.messageId));
  assert.ok(proof.evidence.artifactIds.includes('critic-test-result-1'));

  const stewardResolved = makeGolden();
  const stewardResolution = addStewardCoordinationResolution(stewardResolved, {
    resolver: 'steward',
  });
  const stewardProof = assertionById(evaluate(stewardResolved), 'role.steward');
  assert.equal(stewardProof.status, 'pass');
  assert.ok(
    stewardProof.evidence.messageIds.includes(
      stewardResolution.peerMessage.payload.messageId,
    ),
  );
});

void test('post-terminal Steward coordination is outside the activation lifecycle', () => {
  const fixture = makeGolden();
  const coordination = addStewardCoordinationResolution(fixture);
  fixture.events = fixture.events.filter(
    (event) => event !== coordination.update && event !== coordination.resolved,
  );
  const stewardTerminalIndex = fixture.events.findIndex(
    (event) =>
      TERMINAL_KINDS_FOR_TEST.has(event.kind) && event.agentId === 'steward',
  );
  fixture.events.splice(
    stewardTerminalIndex + 1,
    0,
    coordination.update,
    coordination.resolved,
  );
  resequence(fixture);

  const report = evaluate(fixture);
  assert.equal(report.status, 'fail');
  assert.equal(assertionById(report, 'resident.terminals').status, 'fail');
  assert.match(
    assertionById(report, 'resident.terminals').details.join(' '),
    /board\.message.*outside an active assignment/u,
  );
});

void test('Steward coordination requires valid prior artifacts and peer resolution', () => {
  const unresolved = makeGolden();
  const unresolvedProof = addStewardCoordinationResolution(unresolved);
  unresolvedProof.resolved.payload.state = 'acknowledged';
  assert.equal(
    assertionById(evaluate(unresolved), 'role.steward').status,
    'fail',
  );

  const wrongArtifact = makeGolden();
  const wrongArtifactProof = addStewardCoordinationResolution(wrongArtifact);
  wrongArtifactProof.update.payload.artifactIds = ['unknown-artifact'];
  assert.equal(
    assertionById(evaluate(wrongArtifact), 'role.steward').status,
    'fail',
  );

  const futureArtifact = makeGolden();
  const futureArtifactProof = addStewardCoordinationResolution(futureArtifact);
  const artifactIndex = futureArtifact.events.findIndex(
    (event) =>
      event.kind === 'artifact.recorded' &&
      event.payload.artifactId === 'critic-test-result-1',
  );
  const [artifact] = futureArtifact.events.splice(artifactIndex, 1);
  const updateIndex = futureArtifact.events.indexOf(futureArtifactProof.update);
  futureArtifact.events.splice(updateIndex + 1, 0, artifact);
  resequence(futureArtifact);
  assert.equal(
    assertionById(evaluate(futureArtifact), 'role.steward').status,
    'fail',
  );

  const unrelated = makeGolden();
  const unrelatedProof = addStewardCoordinationResolution(unrelated, {
    resolver: 'steward',
  });
  unrelatedProof.peerMessage.payload.threadId = 'thread-unrelated-decision';
  delete unrelatedProof.peerMessage.payload.replyToMessageId;
  assert.equal(
    assertionById(evaluate(unrelated), 'role.steward').status,
    'fail',
  );
});

void test('Steward resolution must follow the latest causal message', () => {
  const unresolvedTail = makeGolden();
  const unresolvedTailProof = addStewardCoordinationResolution(unresolvedTail);
  const tailReply = {
    ...clone(unresolvedTailProof.update),
    eventId: 'evt-steward-coordination-later-reply',
    agentId: 'maker',
    payload: {
      ...clone(unresolvedTailProof.update.payload),
      messageId: 'message-steward-coordination-later-reply',
      clientMessageId: 'client-steward-coordination-later-reply',
      messageType: 'decision',
      replyToMessageId: unresolvedTailProof.update.payload.messageId,
      text: 'This later connected decision still needs resolution.',
    },
  };
  const resolvedIndex = unresolvedTail.events.indexOf(
    unresolvedTailProof.resolved,
  );
  unresolvedTail.events.splice(resolvedIndex + 1, 0, tailReply);
  resequence(unresolvedTail);
  assert.equal(
    assertionById(evaluate(unresolvedTail), 'role.steward').status,
    'fail',
  );

  const lateAuthor = makeGolden();
  const lateAuthorProof = addStewardCoordinationResolution(lateAuthor);
  lateAuthorProof.resolved.agentId = 'maker';
  const lateAuthorMessage = {
    ...clone(lateAuthorProof.update),
    eventId: 'evt-steward-coordination-late-author',
    agentId: 'maker',
    payload: {
      ...clone(lateAuthorProof.update.payload),
      messageId: 'message-steward-coordination-late-author',
      clientMessageId: 'client-steward-coordination-late-author',
      messageType: 'update',
      replyToMessageId: lateAuthorProof.update.payload.messageId,
      text: 'The resolver joined only after acknowledging the earlier message.',
    },
  };
  const lateResolutionIndex = lateAuthor.events.indexOf(
    lateAuthorProof.resolved,
  );
  lateAuthor.events.splice(lateResolutionIndex + 1, 0, lateAuthorMessage);
  resequence(lateAuthor);
  assert.equal(
    assertionById(evaluate(lateAuthor), 'role.steward').status,
    'fail',
  );
});

void test('unverified Steward care does not qualify as environmental recovery', () => {
  const fixture = makeGolden();
  fixture.events = fixture.events.filter(
    (event) => event.payload?.actionId !== 'inspect-plant-after',
  );
  resequence(fixture);
  assert.equal(assertionById(evaluate(fixture), 'role.steward').status, 'fail');
});

void test('partial Steward improvement that remains needy is not verified recovery', () => {
  const fixture = makeGolden();
  for (const event of fixture.events.filter(
    (candidate) =>
      candidate.kind === 'world.interaction' &&
      candidate.payload.entityId === 'plant-context' &&
      candidate.sequence >
        fixture.events.find(
          (prior) => prior.payload?.actionId === 'inspect-plant-before',
        ).sequence,
  )) {
    event.payload.state = { hydration: 50, condition: 'thirsty' };
  }
  assert.equal(assertionById(evaluate(fixture), 'role.steward').status, 'fail');
});

void test('fabricated plant-like entities cannot satisfy Steward care', () => {
  const fixture = makeGolden();
  for (const event of fixture.events.filter(
    (candidate) =>
      candidate.kind === 'world.interaction' &&
      candidate.payload.entityId === 'plant-context',
  )) {
    event.payload.entityId = 'fake-plant';
    event.payload.locationId = 'fake-plant';
  }
  const report = evaluate(fixture);
  assert.equal(assertionById(report, 'journal.integrity').status, 'fail');
  assert.equal(assertionById(report, 'role.steward').status, 'fail');
});

void test('rejection receipt schema is redacted and accepts only stable reason codes', () => {
  const receipt = makeGolden().receipts[0];
  for (const reasonCode of [
    'stale_observation',
    'path_yield',
    'path_reserved',
    'destination_occupied',
    'resource_capacity',
    'vision_limited',
    'light_stewardship',
  ]) {
    assert.deepEqual(validateRejectionReceipt({ ...receipt, reasonCode }), []);
  }
  assert.match(
    validateRejectionReceipt({ ...receipt, error: 'raw error text' }).join(' '),
    /unexpected receipt fields: error/u,
  );
  assert.match(
    validateRejectionReceipt({ ...receipt, reasonCode: 'unknown' }).join(' '),
    /stable recoverable code/u,
  );
  assert.match(
    validateRejectionReceipt({
      ...receipt,
      actionId: 'raw prompt and error text',
    }).join(' '),
    /actionId must be a bounded safe identifier/u,
  );
});

void test('recovery passes, unrecovered contention fails, and no contention is inconclusive', () => {
  assert.equal(assertionById(evaluate(), 'recovery.contention').status, 'pass');

  const unrecovered = makeGolden();
  unrecovered.events.find(
    (event) =>
      event.kind === 'world.navigation' &&
      event.payload.actionId === 'fresh-move',
  ).payload.observationId = observation(10);
  assert.equal(
    assertionById(evaluate(unrecovered), 'recovery.contention').status,
    'fail',
  );

  const noContention = makeGolden();
  noContention.receipts = [];
  const report = evaluate(noContention);
  assert.equal(
    assertionById(report, 'recovery.contention').status,
    'inconclusive',
  );
  assert.equal(report.status, 'inconclusive');
});

void test('strict JSONL rejects corrupt records and redaction violations', () => {
  assert.throws(
    () => parseJsonLines('{not-json}\n', { label: 'events' }),
    ArenaEvalInputError,
  );
  const event = makeGolden().events[0];
  assert.throws(
    () =>
      parseJsonLines(`${JSON.stringify({ ...event, sequence: 'one' })}\n`, {
        label: 'events',
        validate: validateEventRecord,
      }),
    /sequence must be a positive safe integer/u,
  );
  const receipt = { ...makeGolden().receipts[0], prompt: 'secret prompt' };
  assert.throws(
    () =>
      parseJsonLines(`${JSON.stringify(receipt)}\n`, {
        label: 'receipts',
        validate: validateRejectionReceipt,
      }),
    /unexpected receipt fields: prompt/u,
  );
});

void test('duplicate and out-of-order journal records fail integrity', () => {
  const duplicate = makeGolden();
  duplicate.events.splice(1, 0, clone(duplicate.events[0]));
  assert.equal(
    assertionById(evaluate(duplicate), 'journal.integrity').status,
    'fail',
  );

  const reordered = makeGolden();
  [reordered.events[10], reordered.events[11]] = [
    reordered.events[11],
    reordered.events[10],
  ];
  assert.equal(
    assertionById(evaluate(reordered), 'journal.integrity').status,
    'fail',
  );
});

void test('duplicate semantic ids and unknown artifact references fail integrity', () => {
  for (const mutate of [
    (fixture) => {
      const artifacts = fixture.events.filter(
        (event) => event.kind === 'artifact.recorded',
      );
      artifacts[1].payload.artifactId = artifacts[0].payload.artifactId;
    },
    (fixture) => {
      const messages = fixture.events.filter(
        (event) => event.kind === 'board.message',
      );
      messages[1].payload.messageId = messages[0].payload.messageId;
    },
    (fixture) => {
      fixture.events.find(
        (event) =>
          event.kind === 'tool.finished' &&
          event.payload.toolCallId === 'maker-test-1',
      ).payload.artifactIds = ['artifact-does-not-exist'];
    },
  ]) {
    const fixture = makeGolden();
    mutate(fixture);
    assert.equal(
      assertionById(evaluate(fixture), 'journal.integrity').status,
      'fail',
    );
  }

  const duplicateTopic = makeGolden();
  const selection = clone(
    duplicateTopic.events.find(
      (event) => event.kind === 'research.topic.selected',
    ),
  );
  duplicateTopic.events.splice(selection.sequence, 0, selection);
  resequence(duplicateTopic);
  assert.equal(
    assertionById(evaluate(duplicateTopic), 'journal.integrity').status,
    'fail',
  );
});
