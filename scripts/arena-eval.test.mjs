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
      artifactIds: ['change-1'],
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
      capability: 'test',
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
      delete fixture.events.find(
        (event) => event.kind === 'board.message',
      ).payload.recipientAgentIds;
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
      delete fixture.events.find(
        (event) => event.kind === 'board.message',
      ).payload.recipientAgentIds;
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
  delete malformedEvent.events.find(
    (event) => event.kind === 'tool.started',
  ).payload.resourceId;
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
  delete malformedEvent.events.find(
    (event) => event.kind === 'tool.started',
  ).payload.resourceId;
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
