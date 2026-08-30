import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { neighborsForLocation } from '../lib/arena/facility-protocol.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const bridgeScript = resolve(import.meta.dirname, 'arena-bridge.mjs');
const driverScript = resolve(import.meta.dirname, 'arena-driver.mjs');
const ingressHookScript = resolve(
  projectRoot,
  '.codex',
  'hooks',
  'arena-chat-ingress.mjs',
);
const stopHookScript = resolve(
  projectRoot,
  '.codex',
  'hooks',
  'arena-chat-stop.mjs',
);
const trustedOrigin = 'http://localhost:3000';
const hostileOrigin = 'https://untrusted.example';
const emitterToken = 'test-emitter-token-with-at-least-thirty-two-characters';
const chatToken = 'test-chat-hook-token-with-at-least-thirty-two-characters';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  const port =
    typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolveClose) => probe.close(resolveClose));
  if (!port) throw new Error('Unable to reserve a test port');
  return port;
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Bridge exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // Bridge has not started listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  }
  throw new Error('Timed out waiting for the bridge');
}

async function json(response) {
  return response.json();
}

function postEvent(origin, body, token = emitterToken, requestOrigin) {
  return fetch(`${origin}/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Arena-Emitter-Token': token } : {}),
      ...(requestOrigin ? { Origin: requestOrigin } : {}),
    },
    body: JSON.stringify(body),
  });
}

function boardRequest(origin, path, agentToken, init = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(agentToken ? { 'X-Arena-Agent-Token': agentToken } : {}),
      ...init.headers,
    },
  });
}

function speechRequest(origin, agentToken, body) {
  return boardRequest(origin, '/proximity/speech', agentToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function observe(origin, agentToken, after = 0) {
  const response = await boardRequest(
    origin,
    `/agent/observation?after=${after}`,
    agentToken,
  );
  assert.equal(response.status, 200);
  return json(response);
}

function routeBetween(from, target) {
  const queue = [[from]];
  const visited = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path.at(-1);
    if (current === target) return path;
    for (const neighbor of neighborsForLocation(current)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push([...path, neighbor]);
    }
  }
  throw new Error(`No facility route from ${from} to ${target}`);
}

async function walkTo(origin, agentToken, target) {
  let observation = await observe(origin, agentToken);
  let transitions = 0;
  while (observation.you.locationId !== target) {
    transitions += 1;
    if (transitions > 64) {
      throw new Error(`Facility route to ${target} exceeded 64 transitions`);
    }
    const path = routeBetween(observation.you.locationId, target);
    const step = path[1];
    let response;
    let rejection;
    let lightingHandled = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      response = await boardRequest(origin, '/world/action', agentToken, {
        method: 'POST',
        body: JSON.stringify({
          actionId: `test_move_${randomId()}`,
          observationId: observation.observationId,
          action: 'move',
          targetId: step,
        }),
      });
      if (response.status !== 409) break;
      const retry = await json(response);
      rejection = retry.error ?? retry.message ?? JSON.stringify(retry);
      observation = retry.observation ?? (await observe(origin, agentToken));
      if (/too dark to resolve/u.test(rejection)) {
        const lightId = observation.place.perception.roomLightId;
        observation = await setRoomLight(
          origin,
          agentToken,
          observation,
          lightId,
          'on',
        );
        lightingHandled = true;
        break;
      }
      if (/last resident leaving/u.test(rejection)) {
        const lightId = observation.place.perception.roomLightId;
        observation = await setRoomLight(
          origin,
          agentToken,
          observation,
          lightId,
          'off',
        );
        lightingHandled = true;
        break;
      }
      if (/(path is in use|reserved|occupied)/u.test(rejection)) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 125));
        continue;
      }
      if (!retry.observation) break;
    }
    if (lightingHandled) continue;
    if (response.status !== 201) {
      throw new Error(
        `World move failed (${response.status}): ${rejection ?? (await response.text())}`,
      );
    }
    const payload = await json(response);
    const arrivesAt = Date.parse(payload.event.payload.arrivesAt);
    const arrivalDeadline = arrivesAt + 1_000;
    do {
      const waitMs = Math.max(5, arrivesAt - Date.now() + 5);
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, Math.min(waitMs, 100)),
      );
      observation = await observe(
        origin,
        agentToken,
        payload.event.sequence - 1,
      );
    } while (
      observation.you.locationId !== step &&
      Date.now() < arrivalDeadline
    );
  }
  assert.equal(observation.you.locationId, target);
  return observation;
}

async function setRoomLight(origin, agentToken, observation, lightId, power) {
  assert.ok(lightId, 'dark-room response names its physical wall light');
  if (observation.you.locationId !== lightId) {
    observation = await walkTo(origin, agentToken, lightId);
  }
  const light = observation.entities.find((entity) => entity.id === lightId);
  if (light?.state?.power === power) return observation;
  const payload = await interactAt(
    origin,
    agentToken,
    observation,
    lightId,
    power === 'on' ? 'switch_on' : 'switch_off',
  );
  return payload.observation;
}

async function interactAt(origin, agentToken, observation, target, verb) {
  const response = await boardRequest(origin, '/world/action', agentToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: `test_interact_${randomId()}`,
      observationId: observation.observationId,
      action: 'interact',
      targetId: target,
      verb,
    }),
  });
  if (response.status !== 201) {
    throw new Error(
      `World interaction failed (${response.status}): ${await response.text()}`,
    );
  }
  return json(response);
}

function randomId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function chatRequest(origin, path, token, init = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'X-Arena-Chat-Token': token } : {}),
      ...init.headers,
    },
  });
}

async function runHook(script, input, env) {
  const child = spawn(process.execPath, [script], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(input));
  const exitCode = await new Promise((resolveExit) =>
    child.once('exit', resolveExit),
  );
  assert.equal(exitCode, 0, stderr);
  return JSON.parse(stdout);
}

async function runDriver(args) {
  const child = spawn(process.execPath, [driverScript, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ARENA_EMITTER_TOKEN: emitterToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolveExit) =>
    child.once('exit', resolveExit),
  );
  return { exitCode, stdout, stderr };
}

void test('arena driver rejects invalid activity enums before contacting the bridge', async () => {
  const invalidPhase = await runDriver([
    'activity',
    '--agent',
    'kernel',
    '--phase',
    'invented',
    '--summary',
    'invalid phase',
    '--url',
    'http://127.0.0.1:1',
  ]);
  assert.equal(invalidPhase.exitCode, 1);
  assert.equal(invalidPhase.stdout, '');
  assert.match(invalidPhase.stderr, /--phase must be one of:/u);
  assert.doesNotMatch(invalidPhase.stderr, /Bridge unavailable/u);

  const invalidStatus = await runDriver([
    'activity',
    '--agent',
    'kernel',
    '--phase',
    'planning',
    '--summary',
    'invalid status',
    '--status',
    'paused',
    '--url',
    'http://127.0.0.1:1',
  ]);
  assert.equal(invalidStatus.exitCode, 1);
  assert.equal(invalidStatus.stdout, '');
  assert.match(invalidStatus.stderr, /--status must be one of:/u);
  assert.doesNotMatch(invalidStatus.stderr, /Bridge unavailable/u);
});

void test('arena driver rejects invalid event enums before contacting the bridge', async () => {
  const cases = [
    {
      args: [
        'tool-finish',
        '--agent',
        'kernel',
        '--call-id',
        'tool-kernel',
        '--outcome',
        'invented',
      ],
      expected: /--outcome must be one of: succeeded, failed/u,
    },
    {
      args: [
        'research-update',
        '--agent',
        'kernel',
        '--topic-id',
        'topic-kernel',
        '--state',
        'invented',
      ],
      expected: /--state must be one of: active, blocked, complete, dropped/u,
    },
    {
      args: [
        'artifact-record',
        '--agent',
        'kernel',
        '--artifact-id',
        'artifact-kernel',
        '--kind',
        'invented',
        '--title',
        'invalid artifact',
        '--summary',
        'invalid kind',
      ],
      expected:
        /--kind must be one of: source-note, change, test-result, decision/u,
    },
  ];

  for (const item of cases) {
    const result = await runDriver([
      ...item.args,
      '--url',
      'http://127.0.0.1:1',
    ]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, item.expected);
    assert.doesNotMatch(result.stderr, /Bridge unavailable/u);
  }
});

void test('project hooks capture offline, replay once, inject context, and guard stop', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-chat-hook-'));
  const origin = `http://127.0.0.1:${port}`;
  const hookEnv = {
    ARENA_DATA_DIR: dataDir,
    ARENA_BRIDGE_URL: origin,
    ARENA_CHAT_TOKEN: chatToken,
  };
  const hookInput = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-hook-test',
    turn_id: 'turn-hook-test',
    prompt: 'Unicode Ω and <script> remain inert data.\nSecond line.',
  };

  const offlineOutput = await runHook(ingressHookScript, hookInput, hookEnv);
  assert.equal(offlineOutput.continue, true);
  assert.equal(
    offlineOutput.hookSpecificOutput.hookEventName,
    'UserPromptSubmit',
  );
  assert.match(
    offlineOutput.hookSpecificOutput.additionalContext,
    /durably captured in the local outbox/u,
  );
  assert.equal(
    offlineOutput.hookSpecificOutput.additionalContext.includes(
      hookInput.prompt,
    ),
    false,
  );
  const rawLines = (
    await readFile(resolve(dataDir, 'chat-ingress.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/u);
  assert.equal(rawLines.length, 1);
  assert.equal(JSON.parse(rawLines[0]).prompt, hookInput.prompt);

  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '1',
        ARENA_CHAT_TOKEN: chatToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
    await rm(dataDir, { recursive: true, force: true });
  });
  await waitForHealth(origin, child);

  const events = await json(await fetch(`${origin}/events?after=0`));
  assert.deepEqual(
    events.events.map((event) => event.kind),
    ['run.started', 'chat.ingress'],
  );
  const ingressId = events.events[1].payload.ingressId;

  const onlineRetry = await runHook(ingressHookScript, hookInput, hookEnv);
  assert.match(
    onlineRetry.hookSpecificOutput.additionalContext,
    /already journaled by the arena bridge/u,
  );
  const replayedEvents = await json(await fetch(`${origin}/events?after=0`));
  assert.equal(
    replayedEvents.events.filter((event) => event.kind === 'chat.ingress')
      .length,
    1,
  );

  const blockedStop = await runHook(
    stopHookScript,
    { ...hookInput, hook_event_name: 'Stop', stop_hook_active: false },
    hookEnv,
  );
  assert.equal(blockedStop.decision, 'block');
  assert.match(blockedStop.reason, new RegExp(ingressId, 'u'));

  const failedRelay = await fetch(`${origin}/chat/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Arena-Emitter-Token': emitterToken,
    },
    body: JSON.stringify({
      ingressId,
      state: 'failed',
      summary: 'Explicitly failed in the hook contract test',
      targetAgentIds: [],
    }),
  });
  assert.equal(failedRelay.status, 201);
  const allowedStop = await runHook(
    stopHookScript,
    { ...hookInput, hook_event_name: 'Stop', stop_hook_active: false },
    hookEnv,
  );
  assert.deepEqual(allowedStop, { continue: true });
});

void test('Codex chat ingress is authenticated, idempotent, correlated, and terminalized', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-chat-loop-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '1',
        ARENA_CHAT_TOKEN: chatToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(origin, child);
  const ingress = {
    ingressId: 'chat_access_loop_test',
    sessionId: 'session-test',
    turnId: 'turn-test',
    prompt:
      'Relay this Codex chat turn into the real arena.\n<script>inert</script>',
    capturedAt: '2026-08-29T12:00:00.000Z',
  };

  const unauthorized = await chatRequest(origin, '/chat/ingress', null, {
    method: 'POST',
    body: JSON.stringify(ingress),
  });
  assert.equal(unauthorized.status, 401);

  const created = await chatRequest(origin, '/chat/ingress', chatToken, {
    method: 'POST',
    body: JSON.stringify(ingress),
  });
  assert.equal(created.status, 201);
  const createdBody = await json(created);
  assert.equal(createdBody.event.kind, 'chat.ingress');
  assert.equal(createdBody.event.source, 'operator');
  assert.equal(createdBody.event.correlationId, ingress.ingressId);

  const retry = await chatRequest(origin, '/chat/ingress', chatToken, {
    method: 'POST',
    body: JSON.stringify(ingress),
  });
  assert.equal(retry.status, 200);
  assert.equal((await json(retry)).event.eventId, createdBody.event.eventId);

  const conflict = await chatRequest(origin, '/chat/ingress', chatToken, {
    method: 'POST',
    body: JSON.stringify({ ...ingress, prompt: 'conflicting retry' }),
  });
  assert.equal(conflict.status, 409);

  const bypass = await postEvent(origin, {
    kind: 'chat.relay',
    payload: {
      ingressId: ingress.ingressId,
      state: 'claimed',
      targetAgentIds: [],
      summary: 'generic bypass',
    },
  });
  assert.equal(bypass.status, 400);

  const claim = await fetch(`${origin}/chat/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Arena-Emitter-Token': emitterToken,
    },
    body: JSON.stringify({
      ingressId: ingress.ingressId,
      state: 'claimed',
      summary: 'Root claimed the actual Codex chat turn',
      targetAgentIds: [],
    }),
  });
  assert.equal(claim.status, 201);

  const unknownDispatch = await fetch(`${origin}/chat/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Arena-Emitter-Token': emitterToken,
    },
    body: JSON.stringify({
      ingressId: ingress.ingressId,
      state: 'dispatched',
      summary: 'not actually dispatched',
      targetAgentIds: ['sage'],
    }),
  });
  assert.equal(unknownDispatch.status, 409);

  const spawned = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'sage',
    payload: { name: 'Sage', role: 'Protocol verifier' },
  });
  const sageToken = (await json(spawned)).agentToken;
  await postEvent(origin, {
    kind: 'task.assigned',
    agentId: 'sage',
    correlationId: ingress.ingressId,
    payload: { objective: 'Verify the correlated access-loop turn' },
  });

  const dispatch = await fetch(`${origin}/chat/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Arena-Emitter-Token': emitterToken,
    },
    body: JSON.stringify({
      ingressId: ingress.ingressId,
      state: 'dispatched',
      summary: 'Collaboration dispatch succeeded',
      targetAgentIds: ['sage'],
    }),
  });
  assert.equal(dispatch.status, 201);

  await walkTo(origin, sageToken, 'comms-board');
  const board = await boardRequest(origin, '/board/message', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      clientMessageId: 'access-loop-result',
      correlationId: ingress.ingressId,
      text: 'Verified the correlated work.',
      topic: 'Access loop',
      messageType: 'decision',
      audience: 'broadcast',
      recipientAgentIds: [],
    }),
  });
  assert.equal(board.status, 201);
  assert.equal((await json(board)).event.correlationId, ingress.ingressId);

  const completed = await fetch(`${origin}/chat/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Arena-Emitter-Token': emitterToken,
    },
    body: JSON.stringify({
      ingressId: ingress.ingressId,
      state: 'completed',
      summary: 'Root received and synthesized the real subagent result',
    }),
  });
  assert.equal(completed.status, 201);

  const status = await chatRequest(
    origin,
    `/chat/status?ingress=${ingress.ingressId}`,
    chatToken,
  );
  const statusBody = await json(status);
  assert.equal(statusBody.state, 'completed');
  assert.equal(statusBody.terminal, true);
  assert.deepEqual(statusBody.targetAgentIds, ['sage']);

  const regression = await fetch(`${origin}/chat/relay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Arena-Emitter-Token': emitterToken,
    },
    body: JSON.stringify({
      ingressId: ingress.ingressId,
      state: 'claimed',
      summary: 'illegal regression',
    }),
  });
  assert.equal(regression.status, 409);
});

void test('bridge authenticates emitters, restricts CORS, and preserves monotonic runs', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-bridge-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '1',
        ARENA_ALLOWED_ORIGINS: trustedOrigin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(origin, child);

  const unauthorized = await postEvent(
    origin,
    {
      kind: 'run.started',
      reset: true,
      payload: { objective: 'unauthorized' },
    },
    null,
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await json(await fetch(`${origin}/health`))).latestSequence, 0);

  const hostile = await fetch(`${origin}/health`, {
    headers: { Origin: hostileOrigin },
  });
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.get('access-control-allow-origin'), null);
  const trusted = await fetch(`${origin}/health`, {
    headers: { Origin: trustedOrigin },
  });
  assert.equal(
    trusted.headers.get('access-control-allow-origin'),
    trustedOrigin,
  );

  const hostileIntent = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: hostileOrigin },
    body: JSON.stringify({
      intentId: 'intent-hostile-origin',
      sentAt: new Date().toISOString(),
      intent: { type: 'SendFollowUp', agentId: 'kernel', content: 'forge' },
    }),
  });
  assert.equal(hostileIntent.status, 403);
  assert.deepEqual(
    (await json(await fetch(`${origin}/intents?after=0`))).intents,
    [],
  );

  const firstRun = await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'first authenticated run' },
  });
  assert.equal(firstRun.status, 201);
  assert.equal((await json(firstRun)).event.sequence, 1);

  const invalid = await postEvent(origin, {
    kind: 'agent.activity',
    agentId: 'kernel',
    payload: { phase: 'invented', status: 'working', summary: 'invalid' },
  });
  assert.equal(invalid.status, 400);
  assert.equal((await json(await fetch(`${origin}/health`))).latestSequence, 1);

  const intent = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      intentId: 'intent-test-1',
      sentAt: new Date().toISOString(),
      intent: { type: 'SendFollowUp', agentId: 'kernel', content: 'verify' },
    }),
  });
  assert.equal(intent.status, 200);
  assert.equal((await json(intent)).receipt.accepted, true);

  const spawnEvent = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'kernel',
    parentAgentId: 'atlas',
    payload: { name: 'Kernel', role: 'Verification agent' },
  });
  assert.equal((await json(spawnEvent)).event.sequence, 2);

  const secondRun = await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'second authenticated run' },
  });
  assert.equal((await json(secondRun)).event.sequence, 3);

  const current = await json(await fetch(`${origin}/events?after=0`));
  assert.deepEqual(
    current.events.map((event) => event.sequence),
    [3],
  );
  assert.equal(current.events[0].kind, 'run.started');

  const journalLines = (
    await readFile(resolve(dataDir, 'events.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/);
  assert.equal(journalLines.length, 3);
});

void test('board authenticates agents and preserves threads, receipts, and visibility', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-board-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '1',
        ARENA_ALLOWED_ORIGINS: trustedOrigin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(origin, child);
  await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'exercise the real agent board' },
  });

  const tokens = {};
  for (const agentId of ['atlas', 'sage', 'nova']) {
    const response = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name: agentId.toUpperCase(), role: 'Test agent' },
    });
    assert.equal(response.status, 201);
    const body = await json(response);
    assert.equal(typeof body.agentToken, 'string');
    tokens[agentId] = body.agentToken;
  }

  const unauthorized = await boardRequest(origin, '/board/message', null, {
    method: 'POST',
    body: JSON.stringify({
      clientMessageId: 'unauthorized-1',
      text: 'should not be written',
      messageType: 'update',
      audience: 'broadcast',
      recipientAgentIds: [],
    }),
  });
  assert.equal(unauthorized.status, 401);

  const bypass = await postEvent(origin, {
    kind: 'board.message',
    agentId: 'atlas',
    payload: {
      messageId: 'fake',
      clientMessageId: 'fake',
      threadId: 'fake',
      topic: 'Fake',
      messageType: 'update',
      audience: 'broadcast',
      recipientAgentIds: [],
      text: 'generic event bypass',
    },
  });
  assert.equal(bypass.status, 400);

  await walkTo(origin, tokens.atlas, 'comms-board');
  await walkTo(origin, tokens.sage, 'comms-board');

  const directRequest = {
    clientMessageId: 'atlas-to-sage-1',
    agentId: 'nova',
    text: 'Can you validate the bridge invariants?',
    topic: 'Bridge invariants',
    messageType: 'question',
    audience: 'direct',
    recipientAgentIds: ['sage'],
  };
  const directResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    { method: 'POST', body: JSON.stringify(directRequest) },
  );
  assert.equal(directResponse.status, 201);
  const direct = (await json(directResponse)).event;
  assert.equal(direct.agentId, 'atlas');
  assert.equal(direct.payload.audience, 'direct');

  const exactRetry = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    { method: 'POST', body: JSON.stringify(directRequest) },
  );
  assert.equal(exactRetry.status, 200);
  assert.equal((await json(exactRetry)).event.eventId, direct.eventId);

  const conflictingRetry = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({ ...directRequest, text: 'different retry body' }),
    },
  );
  assert.equal(conflictingRetry.status, 409);

  const atlasBoard = await json(
    await boardRequest(origin, '/board?after=0', tokens.atlas),
  );
  const sageBoard = await json(
    await boardRequest(origin, '/board?after=0&unread=true', tokens.sage),
  );
  await walkTo(origin, tokens.atlas, 'command-hub');
  await walkTo(origin, tokens.nova, 'comms-board');
  const novaBoard = await json(
    await boardRequest(origin, '/board?after=0', tokens.nova),
  );
  assert.deepEqual(
    atlasBoard.messages.map((message) => message.payload.messageId),
    [direct.payload.messageId],
  );
  assert.equal(sageBoard.messages[0].unread, true);
  assert.equal(novaBoard.messages.length, 0);

  const forbiddenAck = await boardRequest(origin, '/board/ack', tokens.nova, {
    method: 'POST',
    body: JSON.stringify({
      messageId: direct.payload.messageId,
      state: 'read',
    }),
  });
  assert.equal(forbiddenAck.status, 403);

  const readAck = await boardRequest(origin, '/board/ack', tokens.sage, {
    method: 'POST',
    body: JSON.stringify({
      messageId: direct.payload.messageId,
      state: 'read',
    }),
  });
  assert.equal(readAck.status, 201);
  const readEvent = (await json(readAck)).event;
  const repeatedAck = await boardRequest(origin, '/board/ack', tokens.sage, {
    method: 'POST',
    body: JSON.stringify({
      messageId: direct.payload.messageId,
      state: 'read',
    }),
  });
  assert.equal(repeatedAck.status, 200);
  assert.equal((await json(repeatedAck)).event.eventId, readEvent.eventId);

  const acknowledged = await boardRequest(origin, '/board/ack', tokens.sage, {
    method: 'POST',
    body: JSON.stringify({
      messageId: direct.payload.messageId,
      state: 'acknowledged',
    }),
  });
  assert.equal(acknowledged.status, 201);
  const regression = await boardRequest(origin, '/board/ack', tokens.sage, {
    method: 'POST',
    body: JSON.stringify({
      messageId: direct.payload.messageId,
      state: 'read',
    }),
  });
  assert.equal(regression.status, 409);

  const replyResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'sage-reply-1',
        threadId: direct.payload.threadId,
        text: 'Validated. The write and receipt paths are scoped.',
        messageType: 'decision',
      }),
    },
  );
  assert.equal(replyResponse.status, 201);
  const reply = (await json(replyResponse)).event;
  assert.equal(reply.payload.threadId, direct.payload.threadId);
  assert.equal(reply.payload.replyToMessageId, direct.payload.messageId);
  assert.deepEqual(reply.payload.recipientAgentIds, ['atlas']);

  const broadcastResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.nova,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'nova-broadcast-1',
        text: '<script>alert(1)</script> is inert board text',
        topic: 'Implementation handoff',
        messageType: 'handoff',
        audience: 'broadcast',
        recipientAgentIds: [],
      }),
    },
  );
  assert.equal(broadcastResponse.status, 201);
  const broadcast = (await json(broadcastResponse)).event;
  const sageAfter = await json(
    await boardRequest(origin, '/board?after=0', tokens.sage),
  );
  assert.equal(
    sageAfter.messages.some(
      (message) => message.payload.messageId === broadcast.payload.messageId,
    ),
    true,
  );
  assert.equal(
    sageAfter.acknowledgements.some(
      (event) =>
        event.agentId === 'sage' &&
        event.payload.messageId === direct.payload.messageId,
    ),
    true,
  );

  const linesBeforeReset = (
    await readFile(resolve(dataDir, 'events.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/).length;
  const nextRun = await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'new run keeps the prior journal' },
  });
  assert.equal(nextRun.status, 201);
  const currentRunEvents = await json(await fetch(`${origin}/events?after=0`));
  assert.deepEqual(
    currentRunEvents.events.map((event) => event.kind),
    ['run.started'],
  );
  const linesAfterReset = (
    await readFile(resolve(dataDir, 'events.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/).length;
  assert.equal(linesAfterReset, linesBeforeReset + 1);
});

void test('proximity speech is voluntary, audible, replay-safe, and cannot fabricate collaboration', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-proximity-speech-'));
  const origin = `http://127.0.0.1:${port}`;
  const startProximityBridge = () =>
    spawn(
      process.execPath,
      [bridgeScript, '--port', String(port), '--data-dir', dataDir],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ARENA_EMITTER_TOKEN: emitterToken,
          ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
          ARENA_MIN_TRAVEL_MS: '1',
          ARENA_SOCIAL_RANGE_PX: '70',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
  let child = startProximityBridge();

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(origin, child);
  await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'Exercise situated social choices' },
  });
  const tokens = {};
  for (const [agentId, name] of [
    ['atlas', 'Atlas'],
    ['sage', 'Sage'],
  ]) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role: 'Resident verifier' },
    });
    tokens[agentId] = (await json(spawned)).agentToken;
  }

  const firstScene = await observe(origin, tokens.atlas);
  assert.equal(firstScene.schemaVersion, 3);
  assert.equal(firstScene.place.occupancy.residentsPresent, 2);
  assert.equal(firstScene.space.residentsPresent, 2);
  assert.equal(firstScene.space.bodyClearancePx, 32);
  assert.equal(firstScene.space.conversationRangePx, 70);
  assert.equal(firstScene.people[0].proximity, 'shared-place');
  assert.equal(firstScene.people[0].distancePx, 32);
  assert.deepEqual(
    firstScene.talk.map((person) => person.id),
    ['sage'],
  );
  assert.match(firstScene.text, /TALK Sage\(sage\)/u);
  assert.match(firstScene.text, /SPACE residents:2/u);

  const sayBody = {
    actionId: 'speech-say-one',
    observationId: firstScene.observationId,
    speechAct: 'say',
    targetAgentId: 'sage',
    text: 'I found the invariant. The full evidence remains in the journal.',
  };
  const unauthorized = await speechRequest(origin, null, sayBody);
  assert.equal(unauthorized.status, 401);

  const forged = await postEvent(origin, {
    kind: 'proximity.spoken',
    agentId: 'atlas',
    payload: {},
  });
  assert.equal(forged.status, 400);

  const spokenResponse = await speechRequest(origin, tokens.atlas, sayBody);
  assert.equal(spokenResponse.status, 201);
  const spoken = await json(spokenResponse);
  assert.equal(spoken.event.payload.preview, 'I found the invariant…');
  assert.equal(spoken.event.payload.text, sayBody.text);
  assert.deepEqual(spoken.event.payload.heardByAgentIds, ['sage']);

  const exactRetry = await speechRequest(origin, tokens.atlas, sayBody);
  assert.equal(exactRetry.status, 200);
  assert.equal((await json(exactRetry)).event.eventId, spoken.event.eventId);
  const conflictingRetry = await speechRequest(origin, tokens.atlas, {
    ...sayBody,
    text: 'A conflicting use of the same action id.',
  });
  assert.equal(conflictingRetry.status, 409);

  const sageHeard = await observe(origin, tokens.sage);
  assert.equal(sageHeard.heard.length, 1);
  assert.equal(sageHeard.heard[0].speechId, spoken.event.payload.speechId);
  assert.equal(sageHeard.heard[0].text, sayBody.text);
  assert.match(sageHeard.text, /HEARD .*I found the invariant/u);

  const novaSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'nova',
    payload: { name: 'Nova', role: 'Late arrival' },
  });
  tokens.nova = (await json(novaSpawn)).agentToken;
  const novaScene = await observe(origin, tokens.nova);
  assert.ok(
    novaScene.people.every(
      (person) => person.distancePx >= novaScene.space.bodyClearancePx,
    ),
  );
  assert.deepEqual(novaScene.heard, []);
  assert.equal(novaScene.text.includes(spoken.event.payload.speechId), false);

  const invitationScene = await observe(origin, tokens.atlas);
  const invitationBody = {
    actionId: 'speech-invite-one',
    observationId: invitationScene.observationId,
    speechAct: 'invite',
    targetAgentId: 'sage',
    invitationId: 'invite-replay-check',
    invitationMode: 'collaborate',
    objective: 'Verify the replay invariant together',
    text: 'Would you verify the replay invariant with me?',
  };
  const invitationResponse = await speechRequest(
    origin,
    tokens.atlas,
    invitationBody,
  );
  assert.equal(invitationResponse.status, 201);
  const invitation = (await json(invitationResponse)).event;

  const pendingScene = await observe(origin, tokens.sage);
  assert.deepEqual(
    pendingScene.invitations.map((item) => [item.invitationId, item.status]),
    [['invite-replay-check', 'pending']],
  );
  const sageLocationBefore = pendingScene.you.locationId;
  const acceptanceBody = {
    actionId: 'speech-accept-one',
    observationId: pendingScene.observationId,
    speechAct: 'accept',
    invitationId: invitation.payload.invitationId,
    text: 'Yes. I will take the replay check.',
  };
  const acceptanceResponse = await speechRequest(
    origin,
    tokens.sage,
    acceptanceBody,
  );
  assert.equal(acceptanceResponse.status, 201);
  const acceptance = (await json(acceptanceResponse)).event;
  assert.equal(acceptance.payload.targetAgentId, 'atlas');
  assert.equal(acceptance.payload.invitationMode, 'collaborate');

  const acceptedScene = await observe(origin, tokens.sage);
  assert.equal(acceptedScene.you.locationId, sageLocationBefore);
  assert.deepEqual(
    acceptedScene.collaborations.map((item) => [
      item.invitationId,
      item.status,
    ]),
    [['invite-replay-check', 'accept']],
  );
  assert.match(acceptedScene.text, /shared work awaits an assignment/u);

  const burst = [];
  for (let index = 0; index < 9; index += 1) {
    const atlasScene = await observe(origin, tokens.atlas);
    const response = await speechRequest(origin, tokens.atlas, {
      actionId: `speech-burst-${index}`,
      observationId: atlasScene.observationId,
      speechAct: 'say',
      targetAgentId: 'sage',
      text: `Audible burst line ${index + 1}.`,
    });
    assert.equal(response.status, 201);
    burst.push((await json(response)).event);
  }

  const firstHeardPage = await observe(
    origin,
    tokens.sage,
    acceptance.sequence,
  );
  assert.equal(firstHeardPage.heard.length, 8);
  assert.equal(firstHeardPage.hearing.hasMore, true);
  assert.equal(firstHeardPage.hearing.remaining, 1);
  assert.equal(firstHeardPage.hearing.throughSequence, burst[7].sequence);
  const secondHeardPage = await observe(
    origin,
    tokens.sage,
    firstHeardPage.hearing.throughSequence,
  );
  assert.deepEqual(
    secondHeardPage.heard.map((speech) => speech.speechId),
    [burst[8].payload.speechId],
  );
  assert.equal(secondHeardPage.hearing.hasMore, false);

  child.kill('SIGTERM');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  child = startProximityBridge();
  await waitForHealth(origin, child);

  const replayedScene = await observe(origin, tokens.sage);
  assert.deepEqual(
    replayedScene.collaborations.map((item) => [
      item.invitationId,
      item.status,
    ]),
    [['invite-replay-check', 'accept']],
  );

  const journal = await json(await fetch(`${origin}/events?after=0`));
  assert.equal(
    journal.events.filter((event) => event.kind === 'proximity.spoken').length,
    12,
  );
  const replayedOpening = journal.events.find(
    (event) => event.eventId === spoken.event.eventId,
  );
  assert.deepEqual(replayedOpening.payload.heardByAgentIds, ['sage']);
  assert.equal(
    journal.events.some((event) => event.kind === 'task.assigned'),
    false,
  );

  await walkTo(origin, tokens.sage, 'hall-east');
  const distantScene = await observe(origin, tokens.atlas);
  assert.equal(
    distantScene.talk.some((person) => person.id === 'sage'),
    false,
  );
  const distantSpeech = await speechRequest(origin, tokens.atlas, {
    actionId: 'speech-too-far',
    observationId: distantScene.observationId,
    speechAct: 'say',
    targetAgentId: 'sage',
    text: 'This should not cross the room at a distance.',
  });
  assert.equal(distantSpeech.status, 409);
  assert.match(
    (await json(distantSpeech)).error,
    /(outside speaking range|wall separates the two people)/u,
  );
});

void test('shared social space stays approachable while in-use paths require yielding', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-spatial-awareness-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '800',
        ARENA_SOCIAL_RANGE_PX: '80',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(origin, child);
  await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'Exercise layered spatial awareness' },
  });
  const tokens = {};
  for (const [agentId, name] of [
    ['atlas', 'Atlas'],
    ['sage', 'Sage'],
  ]) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role: 'Resident verifier' },
    });
    tokens[agentId] = (await json(spawned)).agentToken;
  }

  const atlasAtLift = await observe(origin, tokens.atlas);
  const atlasMove = await boardRequest(origin, '/world/action', tokens.atlas, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'atlas-takes-commons-lane',
      observationId: atlasAtLift.observationId,
      action: 'move',
      targetId: 'context-hub',
      reason: 'Make room while keeping Sage within social reach.',
    }),
  });
  assert.equal(atlasMove.status, 201);
  const atlasMoveBody = await json(atlasMove);

  const sageWhileAtlasMoves = await observe(origin, tokens.sage);
  const atlasPerceived = sageWhileAtlasMoves.people.find(
    (person) => person.id === 'atlas',
  );
  assert.equal(atlasPerceived.movement, 'moving-within-room');
  assert.equal(atlasPerceived.destinationId, 'context-hub');
  const reservedExit = sageWhileAtlasMoves.exits.find(
    (exit) => exit.to === 'context-hub',
  );
  assert.equal(reservedExit.status, 'yield');
  assert.equal(reservedExit.available, false);
  assert.deepEqual(
    reservedExit.trafficBy.map((person) => person.id),
    ['atlas'],
  );
  assert.match(
    sageWhileAtlasMoves.text,
    /EXITS context-hub@[^\n]+\/yield:Atlas/u,
  );

  const conflictingMove = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-does-not-run-into-atlas',
        observationId: sageWhileAtlasMoves.observationId,
        action: 'move',
        targetId: 'context-hub',
      }),
    },
  );
  assert.equal(conflictingMove.status, 409);
  assert.match((await json(conflictingMove)).error, /path is in use by Atlas/u);

  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(atlasMoveBody.event.payload.arrivesAt) - Date.now() + 5,
      ),
    ),
  );
  const atlasAtHub = await observe(origin, tokens.atlas);
  const atlasToCommons = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-enters-shared-commons',
        observationId: atlasAtHub.observationId,
        action: 'move',
        targetId: 'commons',
        reason: 'Choose a shared place where conversation remains possible.',
      }),
    },
  );
  assert.equal(atlasToCommons.status, 201);
  const atlasToCommonsBody = await json(atlasToCommons);
  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(atlasToCommonsBody.event.payload.arrivesAt) - Date.now() + 5,
      ),
    ),
  );

  let sageScene = await observe(origin, tokens.sage);
  const sageToHub = await boardRequest(origin, '/world/action', tokens.sage, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'sage-follows-after-clearance',
      observationId: sageScene.observationId,
      action: 'move',
      targetId: 'context-hub',
    }),
  });
  assert.equal(sageToHub.status, 201);
  const sageToHubBody = await json(sageToHub);
  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(sageToHubBody.event.payload.arrivesAt) - Date.now() + 5,
      ),
    ),
  );

  const sageArrivalDeadline =
    Date.parse(sageToHubBody.event.payload.arrivesAt) + 1_000;
  do {
    sageScene = await observe(origin, tokens.sage);
    if (sageScene.you.locationId !== 'context-hub') {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  } while (
    sageScene.you.locationId !== 'context-hub' &&
    Date.now() < sageArrivalDeadline
  );
  assert.equal(sageScene.you.locationId, 'context-hub');
  const sharedExit = sageScene.exits.find((exit) => exit.to === 'commons');
  assert.equal(sharedExit.status, 'shared');
  assert.equal(sharedExit.available, true);
  assert.deepEqual(
    sharedExit.occupiedBy.map((person) => person.id),
    ['atlas'],
  );
  const socialApproach = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-approaches-atlas-socially',
        observationId: sageScene.observationId,
        action: 'move',
        targetId: 'commons',
        reason: 'Approach Atlas into conversational range.',
      }),
    },
  );
  assert.equal(socialApproach.status, 201);
  const socialApproachBody = await json(socialApproach);
  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(socialApproachBody.event.payload.arrivesAt) - Date.now() + 5,
      ),
    ),
  );
  const sharedCommons = await observe(origin, tokens.sage);
  assert.equal(sharedCommons.space.residentsPresent, 2);
  assert.deepEqual(
    sharedCommons.talk.map((person) => person.id),
    ['atlas'],
  );
  assert.equal(
    sharedCommons.people.find((person) => person.id === 'atlas').proximity,
    'shared-place',
  );

  const atlasAtPortal = await walkTo(origin, tokens.atlas, 'door-context');
  await walkTo(origin, tokens.sage, 'context-hub');
  const sageAtContextLight = await walkTo(
    origin,
    tokens.sage,
    'room-light-context',
  );
  await interactAt(
    origin,
    tokens.sage,
    sageAtContextLight,
    'room-light-context',
    'switch_off',
  );
  const sageAtLanding = await walkTo(origin, tokens.sage, 'context-hub');
  assert.equal(atlasAtPortal.you.locationId, 'door-context');
  assert.equal(sageAtLanding.you.locationId, 'context-hub');
  const atlasReadyToClear = await observe(origin, tokens.atlas);
  const atlasClearsPortal = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-clears-context-threshold',
        observationId: atlasReadyToClear.observationId,
        action: 'move',
        targetId: 'hall-center',
      }),
    },
  );
  assert.equal(atlasClearsPortal.status, 201);
  const atlasClearsPortalBody = await json(atlasClearsPortal);

  const sageWhileThresholdMoves = await observe(origin, tokens.sage);
  const thresholdExit = sageWhileThresholdMoves.exits.find(
    (exit) => exit.to === 'door-context',
  );
  assert.equal(thresholdExit.status, 'yield');
  assert.equal(thresholdExit.available, false);
  assert.deepEqual(
    thresholdExit.trafficBy.map((person) => person.id),
    ['atlas'],
  );
  const thresholdConflict = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-yields-adjacent-portal-edge',
        observationId: sageWhileThresholdMoves.observationId,
        action: 'move',
        targetId: 'door-context',
      }),
    },
  );
  assert.equal(thresholdConflict.status, 409);
  assert.match(
    (await json(thresholdConflict)).error,
    /path is in use by Atlas/u,
  );

  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(atlasClearsPortalBody.event.payload.arrivesAt) -
          Date.now() +
          5,
      ),
    ),
  );
  const atlasInHall = await observe(origin, tokens.atlas);
  const atlasStagesInbound = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-stages-inbound-at-context',
        observationId: atlasInHall.observationId,
        action: 'move',
        targetId: 'door-context',
        reason: 'Stage beside the doorway before entering Commons.',
      }),
    },
  );
  assert.equal(atlasStagesInbound.status, 201);
  const atlasStagesInboundBody = await json(atlasStagesInbound);
  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(atlasStagesInboundBody.event.payload.arrivesAt) -
          Date.now() +
          5,
      ),
    ),
  );

  const sageAtContextSwitch = await walkTo(
    origin,
    tokens.sage,
    'room-light-context',
  );
  const contextLightOn = await interactAt(
    origin,
    tokens.sage,
    sageAtContextSwitch,
    'room-light-context',
    'switch_on',
  );
  const prematureDarkening = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-does-not-darken-room-before-handoff',
        observationId: contextLightOn.observation.observationId,
        action: 'interact',
        targetId: 'room-light-context',
        verb: 'switch_off',
      }),
    },
  );
  assert.equal(prematureDarkening.status, 409);
  assert.match(
    (await json(prematureDarkening)).error,
    /Atlas remains in or is entering context; leave room-light-context on/u,
  );

  const atlasEntersHall = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-enters-central-hall',
        observationId: (await observe(origin, tokens.atlas)).observationId,
        action: 'move',
        targetId: 'hall-center',
      }),
    },
  );
  assert.equal(atlasEntersHall.status, 201);
  const atlasEntersHallBody = await json(atlasEntersHall);
  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(atlasEntersHallBody.event.payload.arrivesAt) -
          Date.now() +
          5,
      ),
    ),
  );
  const contextLightOff = await interactAt(
    origin,
    tokens.sage,
    await observe(origin, tokens.sage),
    'room-light-context',
    'switch_off',
  );
  assert.equal(contextLightOff.observation.place.perception.vision, 'dark');
  await walkTo(origin, tokens.sage, 'door-context');

  const atlasCrossesWest = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-crosses-west-from-junction',
        observationId: (await observe(origin, tokens.atlas)).observationId,
        action: 'move',
        targetId: 'hall-west',
      }),
    },
  );
  assert.equal(atlasCrossesWest.status, 201);
  const atlasCrossesWestBody = await json(atlasCrossesWest);
  const sageDoesNotEnterMovingJunction = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-yields-central-corridor-junction',
        observationId: (await observe(origin, tokens.sage)).observationId,
        action: 'move',
        targetId: 'hall-center',
      }),
    },
  );
  assert.equal(sageDoesNotEnterMovingJunction.status, 409);
  assert.match(
    (await json(sageDoesNotEnterMovingJunction)).error,
    /path is in use by Atlas/u,
  );

  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(
        0,
        Date.parse(atlasCrossesWestBody.event.payload.arrivesAt) -
          Date.now() +
          5,
      ),
    ),
  );
  const sageWaitsForVisibleClearance = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-waits-for-corridor-body-clearance',
        observationId: (await observe(origin, tokens.sage)).observationId,
        action: 'move',
        targetId: 'hall-center',
      }),
    },
  );
  assert.equal(sageWaitsForVisibleClearance.status, 409);
  assert.match(
    (await json(sageWaitsForVisibleClearance)).error,
    /path is in use by Atlas/u,
  );
});

void test('research computers, artifacts, and authenticated context remain agent-authored', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-research-context-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '1',
        ARENA_CHAT_TOKEN: chatToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await rm(dataDir, { recursive: true, force: true });
  });
  await waitForHealth(origin, child);

  assert.equal(
    (
      await postEvent(origin, {
        kind: 'run.started',
        reset: true,
        payload: { objective: 'Research and verify an implementation path' },
      })
    ).status,
    201,
  );

  async function spawnAgent(agentId, name, role) {
    const response = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role },
    });
    assert.equal(response.status, 201);
    return (await json(response)).agentToken;
  }

  const sageToken = await spawnAgent('sage', 'Sage', 'Research lead');
  const atlasToken = await spawnAgent('atlas', 'Atlas', 'Orchestrator');

  for (const [agentId, objective, mode] of [
    ['sage', 'Research authoritative tool orchestration patterns', 'directed'],
    ['atlas', 'No imposed objective', 'self-directed'],
  ]) {
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'task.assigned',
          agentId,
          taskId: `task-${agentId}`,
          payload: { objective, mode },
        })
      ).status,
      201,
    );
  }

  const commandContext = await json(
    await boardRequest(origin, '/agent/context?after=0', sageToken),
  );
  assert.equal(commandContext.self.roomId, 'context');
  assert.equal(commandContext.self.locationId, 'spawn-lift');
  assert.deepEqual(commandContext.sameRoomAgentIds, ['atlas']);
  assert.match(commandContext.brief, /AREA context/u);
  assert.ok(commandContext.brief.length < 240);
  assert.equal(
    commandContext.purpose.charterPath,
    '.codex/residents/EXPLORER.md',
  );

  const selfDirectedContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.equal(selfDirectedContext.self.assignmentMode, 'self-directed');
  assert.match(selfDirectedContext.brief, /MODE SELF-DIRECTED/u);
  assert.match(selfDirectedContext.directive, /No task has been imposed/u);
  assert.equal(
    selfDirectedContext.purpose.charterPath,
    '.codex/residents/STEWARD.md',
  );
  assert.equal(
    selfDirectedContext.purpose.coreCharterPath,
    '.codex/residents/CORE.md',
  );
  assert.ok(selfDirectedContext.purpose.opportunities.length >= 3);
  assert.ok(
    selfDirectedContext.purpose.opportunities.some(
      (opportunity) =>
        opportunity.kind === 'open-inquiry' &&
        opportunity.capability === 'search' &&
        /real evidence/u.test(opportunity.suggestedAction),
    ),
  );

  const beforeResearchSelection = await observe(origin, sageToken);
  assert.match(beforeResearchSelection.text, /^DRIVES /mu);
  assert.match(beforeResearchSelection.text, /^OPPORTUNITIES /mu);
  const selected = await postEvent(origin, {
    kind: 'research.topic.selected',
    agentId: 'sage',
    payload: {
      topicId: 'topic-tools',
      parentTopicId: 'technical-sources',
      title: 'Tool orchestration',
      question: 'Which authenticated tool boundary preserves real agent work?',
      reason: 'The runtime needs a truthful utility model',
    },
  });
  assert.equal(selected.status, 201);

  const collaboratorContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.ok(
    collaboratorContext.purpose.opportunities.some(
      (opportunity) =>
        opportunity.id === 'support:topic-tools' &&
        opportunity.ownerAgentId === 'sage' &&
        opportunity.capability === 'search',
    ),
  );

  const staleAssignmentScene = await boardRequest(
    origin,
    '/world/action',
    sageToken,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'stale-after-research-selection',
        observationId: beforeResearchSelection.observationId,
        action: 'move',
        targetId: neighborsForLocation(
          beforeResearchSelection.you.locationId,
        )[0],
      }),
    },
  );
  assert.equal(staleAssignmentScene.status, 409);

  const prematureTool = await postEvent(origin, {
    kind: 'tool.started',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-too-early',
      tool: 'web.search',
      summary: 'Attempting remote use without approaching a computer',
      capability: 'search',
      topicId: 'topic-tools',
    },
  });
  assert.equal(prematureTool.status, 400);

  const afterResearchSelection = await observe(origin, sageToken);
  assert.equal(afterResearchSelection.you.locationId, 'spawn-lift');

  const sageAtKiosk = await walkTo(origin, sageToken, 'context-kiosk');
  const sageUsingKiosk = await interactAt(
    origin,
    sageToken,
    sageAtKiosk,
    'context-kiosk',
    'use',
  );
  assert.equal(
    sageUsingKiosk.observation.you.engagedResourceId,
    'context-kiosk',
  );
  const atlasAtKiosk = await walkTo(origin, atlasToken, 'context-kiosk');
  const atlasUsingKiosk = await interactAt(
    origin,
    atlasToken,
    atlasAtKiosk,
    'context-kiosk',
    'use',
  );
  assert.equal(
    atlasUsingKiosk.observation.you.engagedResourceId,
    'context-kiosk',
  );

  const atLamp = await walkTo(origin, sageToken, 'archive-lamp');
  const inspectedLamp = await interactAt(
    origin,
    sageToken,
    atLamp,
    'archive-lamp',
    'inspect',
  );
  const staleInspectionScene = await boardRequest(
    origin,
    '/world/action',
    sageToken,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'stale-after-lamp-inspection',
        observationId: atLamp.observationId,
        action: 'interact',
        targetId: 'archive-lamp',
        verb: 'switch_on',
      }),
    },
  );
  assert.equal(staleInspectionScene.status, 409);
  const lit = await interactAt(
    origin,
    sageToken,
    inspectedLamp.observation,
    'archive-lamp',
    'switch_on',
  );
  assert.equal(
    lit.observation.entities.find((entity) => entity.id === 'archive-lamp')
      .state.power,
    'on',
  );
  assert.equal(lit.observation.place.light, 'warm');
  assert.equal(lit.observation.place.perception.vision, 'clear');

  const staleSwitch = await boardRequest(origin, '/world/action', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'stale-lamp-switch',
      observationId: inspectedLamp.observation.observationId,
      action: 'interact',
      targetId: 'archive-lamp',
      verb: 'switch_off',
    }),
  });
  assert.equal(staleSwitch.status, 409);

  const conflictingRetry = await boardRequest(
    origin,
    '/world/action',
    sageToken,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: lit.event.payload.actionId,
        observationId: lit.event.payload.observationId,
        action: 'interact',
        targetId: 'archive-lamp',
        verb: 'switch_off',
      }),
    },
  );
  assert.equal(conflictingRetry.status, 409);
  assert.match(await conflictingRetry.text(), /different action/u);

  const atRoomLight = await walkTo(origin, sageToken, 'room-light-research');
  const inspectedRoomLight = await interactAt(
    origin,
    sageToken,
    atRoomLight,
    'room-light-research',
    'inspect',
  );
  assert.deepEqual(
    inspectedRoomLight.observation.entities.find(
      (entity) => entity.id === 'room-light-research',
    ).known.affordances,
    ['inspect', 'switch_on', 'switch_off'],
  );
  const ceilingDark = await interactAt(
    origin,
    sageToken,
    inspectedRoomLight.observation,
    'room-light-research',
    'switch_off',
  );
  assert.equal(ceilingDark.observation.place.light, 'task-lit');
  assert.equal(ceilingDark.observation.place.perception.vision, 'focused');
  assert.ok(
    ceilingDark.observation.entities.every((entity) =>
      new Set(['room-light-research', 'archive-lamp', 'archive-desk']).has(
        entity.id,
      ),
    ),
  );
  const ceilingLit = await interactAt(
    origin,
    sageToken,
    ceilingDark.observation,
    'room-light-research',
    'switch_on',
  );
  assert.equal(
    ceilingLit.observation.entities.find(
      (entity) => entity.id === 'room-light-research',
    ).state.power,
    'on',
  );
  assert.equal(ceilingLit.observation.place.light, 'warm');

  const backAtLamp = await walkTo(origin, sageToken, 'archive-lamp');
  const lampOff = await interactAt(
    origin,
    sageToken,
    backAtLamp,
    'archive-lamp',
    'switch_off',
  );
  assert.equal(lampOff.observation.place.light, 'warm');
  const backAtRoomLight = await walkTo(
    origin,
    sageToken,
    'room-light-research',
  );
  const fullyDark = await interactAt(
    origin,
    sageToken,
    backAtRoomLight,
    'room-light-research',
    'switch_off',
  );
  assert.equal(fullyDark.observation.place.light, 'dark');
  assert.equal(fullyDark.observation.place.perception.vision, 'dark');
  const darkHub = await walkTo(origin, sageToken, 'research-hub');
  assert.match(darkHub.text, /^VISION dark /mu);
  assert.deepEqual(
    darkHub.entities.map((entity) => entity.id),
    ['room-light-research'],
  );
  const darkContext = await json(
    await boardRequest(origin, '/agent/context?after=0', sageToken),
  );
  assert.equal(darkContext.room.perception.vision, 'dark');
  assert.equal(darkContext.room.resources.length, 0);
  assert.ok(darkContext.room.obscuredResourceCount > 0);
  const blindPlantMove = await boardRequest(
    origin,
    '/world/action',
    sageToken,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'dark-room-hides-plant-route',
        observationId: darkHub.observationId,
        action: 'move',
        targetId: 'plant-research',
      }),
    },
  );
  assert.equal(blindPlantMove.status, 409);
  assert.match((await json(blindPlantMove)).error, /too dark to resolve/u);

  const atPlant = await walkTo(origin, sageToken, 'plant-research');
  const inspectedPlant = await interactAt(
    origin,
    sageToken,
    atPlant,
    'plant-research',
    'inspect',
  );
  assert.deepEqual(
    inspectedPlant.observation.entities.find(
      (entity) => entity.id === 'plant-research',
    ).known.affordances,
    ['inspect', 'water', 'replace'],
  );
  const wateredPlant = await interactAt(
    origin,
    sageToken,
    inspectedPlant.observation,
    'plant-research',
    'water',
  );
  const plantState = wateredPlant.observation.entities.find(
    (entity) => entity.id === 'plant-research',
  ).state;
  assert.ok(plantState.hydration > 99.9);
  assert.equal(plantState.condition, 'healthy');
  assert.notEqual(plantState.lastWateredAt, 'never');
  assert.notEqual(
    wateredPlant.observation.observationId,
    inspectedPlant.observation.observationId,
  );

  let driftedPlantScene = wateredPlant.observation;
  const hydrationAtWatering = plantState.hydration;
  const driftDeadline = Date.now() + 12_000;
  while (
    driftedPlantScene.entities.find((entity) => entity.id === 'plant-research')
      .state.hydration === hydrationAtWatering &&
    Date.now() < driftDeadline
  ) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    driftedPlantScene = await observe(origin, sageToken);
  }
  assert.notEqual(
    driftedPlantScene.entities.find((entity) => entity.id === 'plant-research')
      .state.hydration,
    hydrationAtWatering,
  );
  assert.equal(
    driftedPlantScene.observationId,
    wateredPlant.observation.observationId,
    'continuous plant hydration drift must not stale an otherwise actionable scene',
  );

  let observation = await walkTo(origin, sageToken, 'research-computer-b');
  const engaged = await interactAt(
    origin,
    sageToken,
    observation,
    'research-computer-b',
    'use',
  );
  observation = engaged.observation;
  assert.equal(observation.you.engagedResourceId, 'research-computer-b');

  const searchStart = await postEvent(origin, {
    kind: 'tool.started',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-search-1',
      tool: 'web.search',
      summary: 'Searching official agent orchestration documentation',
      capability: 'search',
      topicId: 'topic-tools',
    },
  });
  assert.equal(searchStart.status, 201);

  const evidenceFreeFinish = await postEvent(origin, {
    kind: 'tool.finished',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-search-1',
      outcome: 'succeeded',
      summary: 'Claimed success without preserving any source evidence',
    },
  });
  assert.equal(evidenceFreeFinish.status, 400);
  assert.match(await evidenceFreeFinish.text(), /URL-backed source-note/u);

  const researchContext = await json(
    await boardRequest(origin, '/agent/context?after=0', sageToken),
  );
  assert.equal(researchContext.self.roomId, 'research');
  assert.equal(researchContext.self.resourceId, 'research-computer-b');
  assert.equal(researchContext.self.capability, 'search');
  assert.equal(researchContext.self.topic.topicId, 'topic-tools');
  assert.equal(researchContext.purpose.commitment.id, 'topic-tools');
  assert.ok(
    researchContext.purpose.opportunities.some(
      (opportunity) => opportunity.id === 'evidence:topic-tools',
    ),
  );
  assert.ok(
    researchContext.researchTracks.some(
      (track) => track.id === 'technical-sources',
    ),
  );

  const artifact = await postEvent(origin, {
    kind: 'artifact.recorded',
    agentId: 'sage',
    payload: {
      artifactId: 'artifact-source-1',
      kind: 'source-note',
      title: 'Authenticated agent context',
      summary:
        'Context stays read-only while tool events remain agent-authored.',
      uri: 'https://developers.openai.com/',
      topicId: 'topic-tools',
    },
  });
  assert.equal(artifact.status, 201);

  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.finished',
        agentId: 'sage',
        payload: {
          toolCallId: 'tool-search-1',
          outcome: 'succeeded',
          summary: 'Captured one authoritative source note',
          artifactIds: ['artifact-source-1'],
        },
      })
    ).status,
    201,
  );

  const readyToLeaveResearch = await walkTo(origin, sageToken, 'research-hub');
  const litDeparture = await boardRequest(origin, '/world/action', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'last-resident-cannot-abandon-light',
      observationId: readyToLeaveResearch.observationId,
      action: 'move',
      targetId: 'door-research',
    }),
  });
  assert.equal(litDeparture.status, 409);
  assert.match(
    (await json(litDeparture)).error,
    /last resident leaving research; switch off room-light-research/u,
  );
  await walkTo(origin, sageToken, 'comms-board');
  const lightLifecycle = await json(await fetch(`${origin}/events?after=0`));
  const lastResearchLightEvent = lightLifecycle.events
    .filter(
      (event) =>
        event.kind === 'world.interaction' &&
        event.payload.entityId === 'room-light-research',
    )
    .at(-1);
  assert.equal(lastResearchLightEvent.payload.verb, 'switch_off');

  const linkedBoard = await boardRequest(origin, '/board/message', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      clientMessageId: 'research-handoff-1',
      text: 'Source note ready for synthesis.',
      topic: 'Research handoff',
      messageType: 'handoff',
      audience: 'direct',
      recipientAgentIds: ['atlas'],
      topicId: 'topic-tools',
      artifactIds: ['artifact-source-1'],
    }),
  });
  assert.equal(linkedBoard.status, 201);
  const linkedPayload = (await json(linkedBoard)).event.payload;
  assert.equal(linkedPayload.topicId, 'topic-tools');
  assert.deepEqual(linkedPayload.artifactIds, ['artifact-source-1']);

  const forgedUpdate = await postEvent(origin, {
    kind: 'research.topic.updated',
    agentId: 'atlas',
    payload: {
      topicId: 'topic-tools',
      status: 'complete',
      summary: 'This update is not owned by Atlas',
    },
  });
  assert.equal(forgedUpdate.status, 400);

  assert.equal(
    (
      await postEvent(origin, {
        kind: 'research.topic.updated',
        agentId: 'sage',
        payload: {
          topicId: 'topic-tools',
          status: 'complete',
          summary: 'Authoritative source note delivered',
        },
      })
    ).status,
    201,
  );

  const terminalAtComputer = await walkTo(
    origin,
    sageToken,
    'research-computer-b',
  );
  await interactAt(
    origin,
    sageToken,
    terminalAtComputer,
    'research-computer-b',
    'use',
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'agent.completed',
        agentId: 'sage',
        payload: { summary: 'Research handoff complete' },
      })
    ).status,
    201,
  );
  const atlasAtReleasedComputer = await walkTo(
    origin,
    atlasToken,
    'research-computer-b',
  );
  const atlasEngagedReleasedComputer = await interactAt(
    origin,
    atlasToken,
    atlasAtReleasedComputer,
    'research-computer-b',
    'use',
  );
  assert.equal(
    atlasEngagedReleasedComputer.observation.you.engagedResourceId,
    'research-computer-b',
  );

  const finalContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.ok(finalContext.activeRoster.every((agent) => agent.id !== 'sage'));
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'agent.completed',
        agentId: 'atlas',
        payload: { summary: 'Coordination complete' },
      })
    ).status,
    201,
  );
});

void test('resident journals are situated, append-only, and private to each authenticated identity', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-private-journal-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '100000',
        ARENA_MIN_TRAVEL_MS: '1',
        ARENA_CHAT_TOKEN: chatToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await rm(dataDir, { recursive: true, force: true });
  });
  await waitForHealth(origin, child);

  assert.equal(
    (
      await postEvent(origin, {
        kind: 'run.started',
        reset: true,
        payload: { objective: 'Keep private situated notes' },
      })
    ).status,
    201,
  );

  async function spawnAssigned(agentId, name) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role: 'Resident' },
    });
    assert.equal(spawned.status, 201);
    const token = (await json(spawned)).agentToken;
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'task.assigned',
          agentId,
          taskId: `task-${agentId}`,
          payload: { objective: 'Choose and pursue a private line of thought' },
        })
      ).status,
      201,
    );
    return token;
  }

  const sageToken = await spawnAssigned('sage', 'Sage');
  const atlasToken = await spawnAssigned('atlas', 'Atlas');

  assert.equal(
    (await boardRequest(origin, '/journal?after=0', null)).status,
    401,
  );
  assert.equal(
    (await boardRequest(origin, '/journal?after=0', sageToken)).status,
    409,
  );

  const sageAtDesk = await walkTo(origin, sageToken, 'context-kiosk');
  const sageUsingDesk = await interactAt(
    origin,
    sageToken,
    sageAtDesk,
    'context-kiosk',
    'use',
  );
  assert.equal(sageUsingDesk.observation.journal.accessible, true);
  assert.equal(sageUsingDesk.observation.journal.noteCount, 0);
  assert.match(
    sageUsingDesk.observation.text,
    /JOURNAL private-to-you \| notes:0 \| open at this writing desk/u,
  );

  const privateText =
    'SENTINEL_SAGE_PRIVATE_7f4c I want to revisit the west archive quietly.';
  const beforeWriteObservationId = sageUsingDesk.observation.observationId;
  const writeResponse = await boardRequest(origin, '/journal/note', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      clientNoteId: 'sage-note-01',
      observationId: beforeWriteObservationId,
      title: 'Unresolved thought',
      text: privateText,
    }),
  });
  assert.equal(writeResponse.status, 201);
  const written = await json(writeResponse);
  assert.equal(written.created, true);
  assert.equal(written.note.text, privateText);
  assert.match(written.privacyNotice, /Other residents cannot read/u);
  assert.equal(written.observation.journal.noteCount, 1);
  assert.doesNotMatch(written.observation.text, /SENTINEL_SAGE_PRIVATE/u);

  const staleWrite = await boardRequest(origin, '/journal/note', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      clientNoteId: 'sage-note-stale',
      observationId: beforeWriteObservationId,
      text: 'This must be rejected because the private scene changed.',
    }),
  });
  assert.equal(staleWrite.status, 409);

  const exactRetry = await boardRequest(origin, '/journal/note', sageToken, {
    method: 'POST',
    body: JSON.stringify({
      clientNoteId: 'sage-note-01',
      observationId: written.observation.observationId,
      title: 'Unresolved thought',
      text: privateText,
    }),
  });
  assert.equal(exactRetry.status, 200);
  assert.equal((await json(exactRetry)).created, false);

  const sageJournal = await json(
    await boardRequest(origin, '/journal?after=0', sageToken),
  );
  assert.equal(sageJournal.notes.length, 1);
  assert.equal(sageJournal.notes[0].text, privateText);

  const atlasAtDesk = await walkTo(origin, atlasToken, 'context-kiosk');
  const atlasUsingDesk = await interactAt(
    origin,
    atlasToken,
    atlasAtDesk,
    'context-kiosk',
    'use',
  );
  assert.equal(atlasUsingDesk.observation.journal.accessible, true);
  assert.equal(atlasUsingDesk.observation.journal.noteCount, 0);
  assert.doesNotMatch(
    atlasUsingDesk.observation.text,
    /SENTINEL_SAGE_PRIVATE/u,
  );

  const atlasJournal = await json(
    await boardRequest(origin, '/journal?after=0', atlasToken),
  );
  assert.deepEqual(atlasJournal.notes, []);

  const atlasContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  const publicEvents = await json(await fetch(`${origin}/events?after=0`));
  const publicHealth = await json(await fetch(`${origin}/health`));
  assert.doesNotMatch(JSON.stringify(atlasContext), /SENTINEL_SAGE_PRIVATE/u);
  assert.doesNotMatch(JSON.stringify(publicEvents), /SENTINEL_SAGE_PRIVATE/u);
  assert.doesNotMatch(JSON.stringify(publicHealth), /SENTINEL_SAGE_PRIVATE/u);

  const privateFile = await readFile(
    resolve(dataDir, 'private-journals.jsonl'),
    'utf8',
  );
  assert.match(privateFile, /SENTINEL_SAGE_PRIVATE/u);
  assert.equal(privateFile.trim().split('\n').length, 1);
});
