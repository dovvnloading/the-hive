import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { neighborsForLocation } from '../lib/arena/facility-protocol.mjs';
import {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_WIDTH,
  capsulesOverlap,
  worldCollisionIds,
} from '../lib/arena/agentic-spatial.ts';
import { validateRejectionReceipt } from './arena-eval.mjs';

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

async function interactAt(
  origin,
  agentToken,
  observation,
  target,
  verb,
  actionId = `test_interact_${randomId()}`,
) {
  const response = await boardRequest(origin, '/world/action', agentToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId,
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

function navigationPathDistancePx(payload) {
  const points = [payload.fromPosition, ...payload.path];
  return points
    .slice(1)
    .reduce(
      (distance, point, index) =>
        distance +
        Math.hypot(
          ((point.x - points[index].x) / 100) * ARENA_WORLD_WIDTH,
          ((point.y - points[index].y) / 100) * ARENA_WORLD_HEIGHT,
        ),
      0,
    );
}

function assertNavigationPathIsSweptLegal(payload) {
  assert.deepEqual(payload.path.at(-1), payload.toPosition);
  const points = [payload.fromPosition, ...payload.path];
  for (let segment = 1; segment < points.length; segment += 1) {
    const from = points[segment - 1];
    const to = points[segment];
    const distance = Math.hypot(
      ((to.x - from.x) / 100) * ARENA_WORLD_WIDTH,
      ((to.y - from.y) / 100) * ARENA_WORLD_HEIGHT,
    );
    const samples = Math.max(1, Math.ceil(distance / 0.5));
    for (let sample = 0; sample <= samples; sample += 1) {
      const progress = sample / samples;
      const point = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      };
      assert.deepEqual(
        worldCollisionIds(point),
        [],
        `navigation segment ${segment} intersects static geometry at ${JSON.stringify(point)}`,
      );
    }
  }
}

function assertNavigationPathClearsPositions(payload, positions) {
  const points = [payload.fromPosition, ...payload.path];
  for (let segment = 1; segment < points.length; segment += 1) {
    const from = points[segment - 1];
    const to = points[segment];
    const distance = Math.hypot(
      ((to.x - from.x) / 100) * ARENA_WORLD_WIDTH,
      ((to.y - from.y) / 100) * ARENA_WORLD_HEIGHT,
    );
    const samples = Math.max(1, Math.ceil(distance / 0.5));
    for (let sample = 0; sample <= samples; sample += 1) {
      const progress = sample / samples;
      const point = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      };
      assert.equal(
        positions.some((position) => capsulesOverlap(point, position)),
        false,
        `navigation segment ${segment} crosses a stationary resident at ${JSON.stringify(point)}`,
      );
    }
  }
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
  const unauthorizedIntentPoll = await fetch(`${origin}/intents?after=0`);
  assert.equal(unauthorizedIntentPoll.status, 401);
  assert.deepEqual(
    (
      await json(
        await fetch(`${origin}/intents?after=0`, {
          headers: { 'X-Arena-Emitter-Token': emitterToken },
        }),
      )
    ).intents,
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

void test('operator mailbox persists safe drafts and requires embodied addressed reads', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-mailbox-'));
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

  const hostileDraft = await fetch(`${origin}/mailbox/draft`, {
    headers: { Origin: hostileOrigin },
  });
  assert.equal(hostileDraft.status, 403);

  const emptyDraft = await json(await fetch(`${origin}/mailbox/draft`));
  assert.equal(emptyDraft.content, '');
  assert.equal(typeof emptyDraft.updatedAt, 'string');

  const draftText =
    'Please inspect the Commons route.\nReport only what you observe.';
  const savedDraftResponse = await fetch(`${origin}/mailbox/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({ content: draftText }),
  });
  assert.equal(savedDraftResponse.status, 200);
  assert.equal((await json(savedDraftResponse)).content, draftText);
  assert.equal(
    await readFile(resolve(dataDir, 'operator-mailbox.md'), 'utf8'),
    draftText,
  );

  for (const content of [
    `unsafe\u0000draft`,
    `direction\u202Econtrol`,
    'x'.repeat(2_001),
  ]) {
    const rejected = await fetch(`${origin}/mailbox/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
      body: JSON.stringify({ content }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      await readFile(resolve(dataDir, 'operator-mailbox.md'), 'utf8'),
      draftText,
    );
  }

  const started = await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'exercise operator dispatch' },
  });
  assert.equal(started.status, 201);

  const asterSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'aster',
    payload: { name: 'Aster', role: 'Steward' },
  });
  const asterToken = (await json(asterSpawn)).agentToken;
  const birchSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'birch',
    payload: { name: 'Birch', role: 'Explorer' },
  });
  const birchToken = (await json(birchSpawn)).agentToken;
  assert.equal(typeof asterToken, 'string');
  assert.equal(typeof birchToken, 'string');

  // Keep the second recipient physically clear of the Commons pickup lane;
  // their unread state must remain independent even from another room.
  await walkTo(origin, birchToken, 'hall-center');

  const mailboxBody = 'Inspect the east corridor and leave a factual note.';
  const intentBody = {
    intentId: 'intent-mailbox-1',
    sentAt: new Date().toISOString(),
    intent: {
      type: 'SendMailboxMessage',
      recipientAgentIds: ['aster', 'birch'],
      content: mailboxBody,
    },
  };
  const queued = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify(intentBody),
  });
  assert.equal(queued.status, 200);
  assert.equal((await json(queued)).receipt.accepted, true);
  assert.equal(
    (await json(await fetch(`${origin}/events?after=0`)))
      .mailboxUnreadDeliveryCount,
    2,
  );

  const exactRetry = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify(intentBody),
  });
  assert.equal((await json(exactRetry)).receipt.accepted, true);

  const conflictingRetry = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      ...intentBody,
      intent: { ...intentBody.intent, content: 'Different content' },
    }),
  });
  assert.equal((await json(conflictingRetry)).receipt.accepted, false);

  const normalizedDuplicateRecipient = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      intentId: 'intent-mailbox-duplicate-recipient',
      intent: {
        type: 'SendMailboxMessage',
        recipientAgentIds: ['aster', ' aster '],
        content: 'This must not be queued.',
      },
    }),
  });
  assert.equal(
    (await json(normalizedDuplicateRecipient)).receipt.accepted,
    false,
  );

  const inactiveRecipient = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      intentId: 'intent-mailbox-unknown',
      intent: {
        type: 'SendMailboxMessage',
        recipientAgentIds: ['unknown'],
        content: 'This must not be queued.',
      },
    }),
  });
  assert.equal((await json(inactiveRecipient)).receipt.accepted, false);

  const intentLines = (
    await readFile(resolve(dataDir, 'intents.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/);
  assert.equal(intentLines.length, 1);

  const unauthorizedIntentPoll = await fetch(`${origin}/intents?after=0`);
  assert.equal(unauthorizedIntentPoll.status, 401);
  const authorizedIntentPoll = await json(
    await fetch(`${origin}/intents?after=0`, {
      headers: { 'X-Arena-Emitter-Token': emitterToken },
    }),
  );
  assert.equal(authorizedIntentPoll.intents.length, 1);
  assert.equal(authorizedIntentPoll.intents[0].intent.content, mailboxBody);

  let asterObservation = await observe(origin, asterToken);
  const birchObservation = await observe(origin, birchToken);
  assert.equal(asterObservation.mailbox.unreadCount, 1);
  assert.equal(birchObservation.mailbox.unreadCount, 1);
  assert.match(asterObservation.text, /MAILBOX flag:1 unread/u);
  assert.equal(asterObservation.text.includes(mailboxBody), false);

  asterObservation = await walkTo(origin, asterToken, 'operator-mailbox');
  const readActionId = `test_interact_${randomId()}`;
  const readObservationId = asterObservation.observationId;
  const opened = await interactAt(
    origin,
    asterToken,
    asterObservation,
    'operator-mailbox',
    'read',
    readActionId,
  );
  assert.deepEqual(opened.mail, {
    intentId: 'intent-mailbox-1',
    occurredAt: opened.mail.occurredAt,
    content: mailboxBody,
  });
  assert.equal(opened.observation.mailbox.unreadCount, 0);
  assert.equal(opened.event.payload.result.includes(mailboxBody), false);
  assert.equal(opened.event.payload.state._mailboxIntentId, 'intent-mailbox-1');
  assert.equal((await observe(origin, birchToken)).mailbox.unreadCount, 1);

  const replayedRead = await boardRequest(origin, '/world/action', asterToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: readActionId,
      observationId: readObservationId,
      action: 'interact',
      targetId: 'operator-mailbox',
      verb: 'read',
    }),
  });
  assert.equal(replayedRead.status, 200);
  const replayedReadBody = await json(replayedRead);
  assert.equal(replayedReadBody.created, false);
  assert.deepEqual(replayedReadBody.mail, opened.mail);

  const unreadCompletion = await postEvent(origin, {
    kind: 'agent.completed',
    agentId: 'birch',
    payload: { summary: 'Must collect addressed mail first' },
  });
  assert.equal(unreadCompletion.status, 409);
  assert.match(
    await unreadCompletion.text(),
    /Read operator mailbox dispatches before completing/u,
  );

  const unreadRunCompletion = await postEvent(origin, {
    kind: 'run.completed',
    payload: { summary: 'Must not strand an unread dispatch' },
  });
  assert.equal(unreadRunCompletion.status, 409);
  assert.match(
    await unreadRunCompletion.text(),
    /Collect operator mailbox dispatches before completing the run/u,
  );

  const publicEvents = await json(await fetch(`${origin}/events?after=0`));
  assert.equal(publicEvents.mailboxUnreadDeliveryCount, 1);
  assert.equal(JSON.stringify(publicEvents).includes(mailboxBody), false);

  const reread = await boardRequest(origin, '/world/action', asterToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: `test_interact_${randomId()}`,
      observationId: opened.observation.observationId,
      action: 'interact',
      targetId: 'operator-mailbox',
      verb: 'read',
    }),
  });
  assert.equal(reread.status, 409);

  const canceled = await postEvent(origin, {
    kind: 'run.canceled',
    payload: { reason: 'verify closed-run mailbox rejection' },
  });
  assert.equal(canceled.status, 201);
  const closedRunIntent = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      intentId: 'intent-mailbox-closed-run',
      intent: {
        type: 'SendMailboxMessage',
        recipientAgentIds: ['birch'],
        content: 'This cannot be collected after closure.',
      },
    }),
  });
  const closedRunReceipt = (await json(closedRunIntent)).receipt;
  assert.equal(closedRunReceipt.accepted, false);
  assert.match(closedRunReceipt.reason, /open facility run/u);

  const nextRun = await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'verify run-scoped mailbox retries' },
  });
  assert.equal(nextRun.status, 201);
  const nextBirchSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'birch',
    payload: { name: 'Birch', role: 'Explorer' },
  });
  assert.equal(nextBirchSpawn.status, 201);

  const historicalRetry = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      intentId: 'intent-mailbox-1',
      intent: {
        type: 'SendMailboxMessage',
        recipientAgentIds: ['birch'],
        content: mailboxBody,
      },
    }),
  });
  const historicalRetryReceipt = (await json(historicalRetry)).receipt;
  assert.equal(historicalRetryReceipt.accepted, false);
  assert.match(historicalRetryReceipt.reason, /earlier facility run/u);

  const unsafeIntentId = await fetch(`${origin}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({
      intentId: 'unsafe\nmailbox-id',
      intent: {
        type: 'SendMailboxMessage',
        recipientAgentIds: ['birch'],
        content: 'The unsafe identifier must be rejected.',
      },
    }),
  });
  assert.equal(unsafeIntentId.status, 400);
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
        messageType: 'update',
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

void test('direct-message lifecycle blocks unresolved completion and inactive recipients', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-board-lifecycle-'));
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
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'run.started',
        reset: true,
        payload: { objective: 'Exercise direct-message lifecycle invariants' },
      })
    ).status,
    201,
  );

  const tokens = {};
  for (const agentId of ['atlas', 'sage', 'nova']) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name: agentId.toUpperCase(), role: 'Test resident' },
    });
    assert.equal(spawned.status, 201);
    tokens[agentId] = (await json(spawned)).agentToken;
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'task.assigned',
          agentId,
          taskId: `task-${agentId}-one`,
          payload: { objective: 'Complete one accountable coordination arc' },
        })
      ).status,
      201,
    );
    if (agentId !== 'nova') {
      await walkTo(origin, tokens[agentId], 'comms-board');
    }
  }

  for (const [agentId, topicId, artifactId] of [
    ['atlas', 'topic-lifecycle', 'artifact-lifecycle-root'],
    ['sage', 'topic-other', 'artifact-other-topic'],
  ]) {
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'research.topic.selected',
          agentId,
          payload: {
            topicId,
            title: topicId,
            question: `What should ${topicId} establish?`,
          },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'artifact.recorded',
          agentId,
          payload: {
            artifactId,
            kind: 'decision',
            title: artifactId,
            summary: `Decision for ${topicId}`,
            topicId,
          },
        })
      ).status,
      201,
    );
  }
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'artifact.recorded',
        agentId: 'sage',
        payload: {
          artifactId: 'artifact-sage-result',
          kind: 'test-result',
          title: 'Sage lifecycle result',
          summary: 'Independent result for the lifecycle topic',
          topicId: 'topic-lifecycle',
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'artifact.recorded',
        agentId: 'sage',
        payload: {
          artifactId: 'artifact-unscoped-decision',
          kind: 'decision',
          title: 'Unscoped lifecycle decision',
          summary: 'A valid decision that is intentionally not topic-bound',
        },
      })
    ).status,
    201,
  );

  const unscopedArtifactMessage = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'sage-unscoped-artifact-update',
        text: 'This non-handoff update carries an unscoped decision.',
        topic: 'Unscoped coordination',
        messageType: 'decision',
        audience: 'broadcast',
        recipientAgentIds: [],
        artifactIds: ['artifact-unscoped-decision'],
      }),
    },
  );
  assert.equal(unscopedArtifactMessage.status, 201);
  assert.equal(
    (await json(unscopedArtifactMessage)).event.payload.topicId,
    undefined,
  );

  const topicBoundArtifactOnUnscopedMessage = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'sage-topic-artifact-unscoped-message',
        text: 'A topic-bound artifact cannot be attached without its topic.',
        topic: 'Unscoped coordination',
        messageType: 'decision',
        audience: 'broadcast',
        recipientAgentIds: [],
        artifactIds: ['artifact-sage-result'],
      }),
    },
  );
  assert.equal(topicBoundArtifactOnUnscopedMessage.status, 409);
  assert.match(
    await topicBoundArtifactOnUnscopedMessage.text(),
    /is not linked to the unscoped message/u,
  );

  const originalRequest = {
    clientMessageId: 'atlas-to-sage-lifecycle',
    text: 'Please verify the coordination outcome before completing.',
    topic: 'Lifecycle invariant',
    messageType: 'question',
    audience: 'direct',
    recipientAgentIds: ['sage'],
    topicId: 'topic-lifecycle',
  };
  const directResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    { method: 'POST', body: JSON.stringify(originalRequest) },
  );
  assert.equal(directResponse.status, 201);
  const direct = (await json(directResponse)).event;

  const crossTopicReply = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'sage-cross-topic-reply',
        threadId: direct.payload.threadId,
        text: 'This attachment belongs to the wrong topic.',
        messageType: 'update',
        artifactIds: ['artifact-other-topic'],
      }),
    },
  );
  assert.equal(crossTopicReply.status, 409);
  assert.match(
    await crossTopicReply.text(),
    /is not linked to topic topic-lifecycle/u,
  );

  const linkedReplyRequest = {
    clientMessageId: 'sage-linked-result-reply',
    threadId: direct.payload.threadId,
    text: 'The linked result resolves the requested verification.',
    messageType: 'decision',
    artifactIds: ['artifact-sage-result'],
  };
  const linkedReply = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify(linkedReplyRequest),
    },
  );
  assert.equal(linkedReply.status, 201);
  const linkedReplyEvent = (await json(linkedReply)).event;
  assert.deepEqual(linkedReplyEvent.payload.artifactIds, [
    'artifact-sage-result',
  ]);

  const exactLinkedReplyReplay = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    { method: 'POST', body: JSON.stringify(linkedReplyRequest) },
  );
  assert.equal(exactLinkedReplyReplay.status, 200);
  assert.equal(
    (await json(exactLinkedReplyReplay)).event.eventId,
    linkedReplyEvent.eventId,
  );

  const omittedAttachmentReplay = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        ...linkedReplyRequest,
        artifactIds: undefined,
      }),
    },
  );
  assert.equal(omittedAttachmentReplay.status, 409);

  const conflictingAttachmentReplay = await boardRequest(
    origin,
    '/board/message',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        ...linkedReplyRequest,
        artifactIds: ['artifact-lifecycle-root'],
      }),
    },
  );
  assert.equal(conflictingAttachmentReplay.status, 409);

  const groupResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'atlas-group-lifecycle',
        text: 'Coordinate this lifecycle result together.',
        topic: 'Group lifecycle',
        messageType: 'update',
        audience: 'direct',
        recipientAgentIds: ['sage', 'nova'],
        topicId: 'topic-lifecycle',
      }),
    },
  );
  assert.equal(groupResponse.status, 201);
  const groupMessage = (await json(groupResponse)).event;

  for (const state of ['read', 'acknowledged']) {
    assert.equal(
      (
        await boardRequest(origin, '/board/ack', tokens.sage, {
          method: 'POST',
          body: JSON.stringify({
            messageId: direct.payload.messageId,
            state,
          }),
        })
      ).status,
      201,
    );
  }

  const unresolvedCompletion = await postEvent(origin, {
    kind: 'agent.completed',
    agentId: 'sage',
    payload: {
      summary: 'This must remain active until the thread is resolved',
    },
  });
  assert.equal(unresolvedCompletion.status, 409);
  const unresolvedCompletionText = await unresolvedCompletion.text();
  assert.match(unresolvedCompletionText, /Resolve direct board messages/u);
  assert.match(
    unresolvedCompletionText,
    new RegExp(direct.payload.messageId, 'u'),
  );

  assert.equal(
    (
      await boardRequest(origin, '/board/ack', tokens.sage, {
        method: 'POST',
        body: JSON.stringify({
          messageId: direct.payload.messageId,
          state: 'resolved',
        }),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await boardRequest(origin, '/board/ack', tokens.sage, {
        method: 'POST',
        body: JSON.stringify({
          messageId: groupMessage.payload.messageId,
          state: 'resolved',
        }),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'agent.completed',
        agentId: 'sage',
        payload: { summary: 'Resolved the direct coordination thread' },
      })
    ).status,
    201,
  );

  const exactReplay = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    { method: 'POST', body: JSON.stringify(originalRequest) },
  );
  assert.equal(exactReplay.status, 200);
  assert.equal((await json(exactReplay)).event.eventId, direct.eventId);

  await walkTo(origin, tokens.nova, 'comms-board');
  const activeGroupReply = await boardRequest(
    origin,
    '/board/message',
    tokens.nova,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'nova-group-reply-after-sage-completed',
        threadId: groupMessage.payload.threadId,
        text: 'Atlas remains active, so the group thread can continue without Sage.',
        messageType: 'update',
      }),
    },
  );
  assert.equal(activeGroupReply.status, 201);
  const activeGroupReplyEvent = (await json(activeGroupReply)).event;
  assert.deepEqual(activeGroupReplyEvent.payload.recipientAgentIds, ['atlas']);

  const replyToInactive = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'atlas-reply-to-inactive-sage',
        threadId: direct.payload.threadId,
        text: 'This reply must wait until Sage is active again.',
        messageType: 'update',
      }),
    },
  );
  assert.equal(replyToInactive.status, 409);
  assert.match(await replyToInactive.text(), /no active recipient/u);

  const newDirectToInactive = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'atlas-new-to-inactive-sage',
        text: 'This new direct message must not be created.',
        topic: 'Inactive target',
        messageType: 'update',
        audience: 'direct',
        recipientAgentIds: ['sage'],
      }),
    },
  );
  assert.equal(newDirectToInactive.status, 409);
  assert.match(await newDirectToInactive.text(), /inactive resident sage/u);

  await walkTo(origin, tokens.nova, 'command-hub');
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'task.assigned',
        agentId: 'sage',
        taskId: 'task-sage-two',
        payload: { objective: 'Rejoin active coordination' },
      })
    ).status,
    201,
  );

  const reactivatedHistory = await json(
    await boardRequest(origin, '/board?after=0', tokens.sage),
  );
  const historicalReply = reactivatedHistory.messages.find(
    (message) =>
      message.payload.messageId === activeGroupReplyEvent.payload.messageId,
  );
  assert.ok(
    historicalReply,
    'a reactivated thread member retains historical thread visibility',
  );
  assert.equal(
    historicalReply.unread,
    false,
    'a reply sent while the resident was inactive is not delivered retroactively',
  );

  const reactivatedUnread = await json(
    await boardRequest(origin, '/board?after=0&unread=true', tokens.sage),
  );
  assert.equal(
    reactivatedUnread.messages.some(
      (message) =>
        message.payload.messageId === activeGroupReplyEvent.payload.messageId,
    ),
    false,
  );

  const excludedReplyAck = await boardRequest(
    origin,
    '/board/ack',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        messageId: activeGroupReplyEvent.payload.messageId,
        state: 'read',
      }),
    },
  );
  assert.equal(excludedReplyAck.status, 403);
  assert.match(await excludedReplyAck.text(), /not addressed/u);

  const reactivatedContext = await json(
    await boardRequest(origin, '/agent/context?after=0', tokens.sage),
  );
  assert.equal(
    reactivatedContext.purpose.opportunities.some(
      (opportunity) => opportunity.id === 'coordination:unread-board',
    ),
    false,
  );

  const directAfterReactivation = await boardRequest(
    origin,
    '/board/message',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'atlas-to-reactivated-sage',
        text: 'Sage is active again and can receive direct work.',
        topic: 'Reactivated target',
        messageType: 'update',
        audience: 'direct',
        recipientAgentIds: ['sage'],
      }),
    },
  );
  assert.equal(directAfterReactivation.status, 201);
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
  assert.equal(firstScene.people[0].distancePx, 64);
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

  async function waitForStationaryLocation(agentToken, expectedLocationId) {
    const deadline = Date.now() + 3_000;
    let observation;
    do {
      observation = await observe(origin, agentToken);
      if (
        observation.you.locationId === expectedLocationId &&
        !observation.you.navigation
      ) {
        return observation;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    } while (Date.now() < deadline);
    assert.equal(observation?.you.locationId, expectedLocationId);
    assert.equal(observation?.you.navigation, undefined);
    return observation;
  }

  const atlasAtLift = await observe(origin, tokens.atlas);
  const atlasMove = await boardRequest(origin, '/world/action', tokens.atlas, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'atlas-takes-east-lift-lane',
      observationId: atlasAtLift.observationId,
      action: 'move',
      targetId: 'context-hub',
      reason: 'Use the nearest same-side landing.',
    }),
  });
  const atlasMoveBody = await json(atlasMove);
  assert.equal(atlasMove.status, 201, atlasMoveBody.error);

  const sageWhileAtlasMoves = await observe(origin, tokens.sage);
  const atlasPerceived = sageWhileAtlasMoves.people.find(
    (person) => person.id === 'atlas',
  );
  assert.equal(atlasPerceived.movement, 'moving-within-room');
  assert.equal(atlasPerceived.destinationId, 'context-hub');
  const reservedExit = sageWhileAtlasMoves.exits.find(
    (exit) => exit.to === 'context-hub',
  );
  assert.ok(
    ['reserved', 'yield'].includes(reservedExit.status),
    `expected Atlas's exact trajectory to reserve or yield the shared junction, received ${reservedExit.status}`,
  );
  assert.equal(reservedExit.available, false);
  const blockingPeople =
    reservedExit.status === 'reserved'
      ? reservedExit.reservedBy
      : reservedExit.trafficBy;
  assert.deepEqual(
    blockingPeople.map((person) => person.id),
    ['atlas'],
  );
  assert.match(
    sageWhileAtlasMoves.text,
    /EXITS context-hub@[^\n]+\/(?:reserved|yield):Atlas/u,
  );

  const conflictingMove = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-yields-shared-lift-junction',
        observationId: sageWhileAtlasMoves.observationId,
        action: 'move',
        targetId: 'context-hub',
      }),
    },
  );
  assert.equal(conflictingMove.status, 409);
  assert.match(
    (await json(conflictingMove)).error,
    /(path is in use by Atlas|route conflicts with Atlas|occupied or reserved by Atlas)/u,
  );

  let atlasScene = await waitForStationaryLocation(tokens.atlas, 'context-hub');
  const sageAtLift = await waitForStationaryLocation(tokens.sage, 'spawn-lift');
  const sageMove = await boardRequest(origin, '/world/action', tokens.sage, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'sage-uses-opposite-landing-after-junction-clears',
      observationId: sageAtLift.observationId,
      action: 'move',
      targetId: 'context-hub',
      reason: 'Use the open same-side landing while Atlas remains opposite.',
    }),
  });
  const sageMoveBody = await json(sageMove);
  assert.equal(sageMove.status, 201, sageMoveBody.error);
  assertNavigationPathClearsPositions(sageMoveBody.event.payload, [
    atlasMoveBody.event.payload.toPosition,
  ]);
  await waitForStationaryLocation(tokens.sage, 'context-hub');
  atlasScene = await waitForStationaryLocation(tokens.atlas, 'context-hub');
  const atlasToCommons = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-enters-shared-commons',
        observationId: atlasScene.observationId,
        action: 'move',
        targetId: 'commons',
        reason: 'Choose a shared place where conversation remains possible.',
      }),
    },
  );
  const atlasToCommonsBody = await json(atlasToCommons);
  assert.equal(atlasToCommons.status, 201, atlasToCommonsBody.error);
  await waitForStationaryLocation(tokens.atlas, 'commons');

  const sageScene = await walkTo(origin, tokens.sage, 'context-hub');
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
  const socialApproachBody = await json(socialApproach);
  assert.equal(socialApproach.status, 201, socialApproachBody.error);
  const sharedCommons = await waitForStationaryLocation(tokens.sage, 'commons');
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

  const sageWhileThresholdMoves = await observe(origin, tokens.sage);
  const thresholdExit = sageWhileThresholdMoves.exits.find(
    (exit) => exit.to === 'door-context',
  );
  assert.ok(
    ['occupied', 'reserved', 'yield'].includes(thresholdExit.status),
    `expected Atlas's live threshold traversal to block the exit, received ${thresholdExit.status}`,
  );
  assert.equal(thresholdExit.available, false);
  const thresholdBlockingPeople =
    thresholdExit.status === 'occupied'
      ? thresholdExit.occupiedBy
      : thresholdExit.status === 'reserved'
        ? thresholdExit.reservedBy
        : thresholdExit.trafficBy;
  assert.deepEqual(
    thresholdBlockingPeople.map((person) => person.id),
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
    /(path is in use by Atlas|route conflicts with Atlas|occupied or reserved by Atlas)/u,
  );

  const atlasInHall = await waitForStationaryLocation(
    tokens.atlas,
    'hall-center',
  );
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
  await waitForStationaryLocation(tokens.atlas, 'door-context');

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
  await walkTo(origin, tokens.atlas, 'hall-east');
  await walkTo(origin, tokens.sage, 'hall-center');

  const sageCrossesWest = await boardRequest(
    origin,
    '/world/action',
    tokens.sage,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sage-crosses-west-from-junction',
        observationId: (await observe(origin, tokens.sage)).observationId,
        action: 'move',
        targetId: 'hall-west',
      }),
    },
  );
  assert.equal(sageCrossesWest.status, 201);
  const sageCrossesWestBody = await json(sageCrossesWest);
  const atlasEntersVacatedJunction = await boardRequest(
    origin,
    '/world/action',
    tokens.atlas,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'atlas-enters-vacated-corridor-junction',
        observationId: (await observe(origin, tokens.atlas)).observationId,
        action: 'move',
        targetId: 'hall-center',
      }),
    },
  );
  assert.equal(atlasEntersVacatedJunction.status, 201);
  const atlasEntersVacatedJunctionBody = await json(atlasEntersVacatedJunction);
  assert.ok(
    Date.parse(atlasEntersVacatedJunctionBody.event.payload.startedAt) <
      Date.parse(sageCrossesWestBody.event.payload.arrivesAt),
    'disjoint trajectories may use opposite sides of the corridor concurrently',
  );
  await Promise.all([
    waitForStationaryLocation(tokens.sage, 'hall-west'),
    waitForStationaryLocation(tokens.atlas, 'hall-center'),
  ]);
});

void test('bridge-authored paths have exact timing, reserve conflicts, and keep the four-resident Commons route clear', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-navigation-contract-'));
  const origin = `http://127.0.0.1:${port}`;
  const speedPxPerSecond = 96;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: String(speedPxPerSecond),
        ARENA_MIN_TRAVEL_MS: '1',
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

  await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'Verify the authoritative navigation contract' },
  });
  const alphaSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'alpha-path',
    payload: { name: 'Alpha', role: 'Path verifier' },
  });
  assert.equal(alphaSpawn.status, 201);
  const alphaToken = (await json(alphaSpawn)).agentToken;
  const alphaObservation = await observe(origin, alphaToken);
  const alphaMove = await boardRequest(origin, '/world/action', alphaToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'alpha-authored-path',
      observationId: alphaObservation.observationId,
      action: 'move',
      targetId: 'context-hub',
    }),
  });
  assert.equal(alphaMove.status, 201);
  const alphaMoveBody = await json(alphaMove);
  const alphaNavigation = alphaMoveBody.event.payload;
  assert.ok(alphaNavigation.fromPosition);
  assert.ok(alphaNavigation.toPosition);
  assert.ok(Array.isArray(alphaNavigation.path));
  assert.ok(alphaNavigation.path.length > 0);
  assert.ok(alphaNavigation.speedPxPerSecond > 0);
  assert.ok(alphaNavigation.speedPxPerSecond <= speedPxPerSecond);
  assertNavigationPathIsSweptLegal(alphaNavigation);
  const authoredDuration =
    Date.parse(alphaNavigation.arrivesAt) -
    Date.parse(alphaNavigation.startedAt);
  const exactDuration =
    (navigationPathDistancePx(alphaNavigation) /
      alphaNavigation.speedPxPerSecond) *
    1_000;
  assert.ok(
    Math.abs(authoredDuration - exactDuration) <= 1.1,
    `duration ${authoredDuration}ms does not match ${exactDuration}ms polyline`,
  );

  const betaSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'beta-path',
    payload: { name: 'Beta', role: 'Conflict verifier' },
  });
  assert.equal(betaSpawn.status, 201);
  const betaSpawnBody = await json(betaSpawn);
  const betaToken = betaSpawnBody.agentToken;
  const betaConflict = await boardRequest(origin, '/world/action', betaToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'beta-conflicting-path',
      observationId: (await observe(origin, betaToken)).observationId,
      action: 'move',
      targetId: 'context-hub',
    }),
  });
  assert.equal(betaConflict.status, 409);
  assert.match(
    (await json(betaConflict)).error,
    /(path|trajectory|standing slot|route).*(use|conflict|reserved|occupied|yield)/iu,
  );
  const conflictReceipts = (
    await readFile(resolve(dataDir, 'action-rejections.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(
    conflictReceipts.find(
      (receipt) => receipt.actionId === 'beta-conflicting-path',
    )?.reasonCode,
    'path_reserved',
  );

  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(0, Date.parse(alphaNavigation.arrivesAt) - Date.now() + 5),
    ),
  );
  const betaRecovers = await boardRequest(origin, '/world/action', betaToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'beta-uses-opposite-landing',
      observationId: (await observe(origin, betaToken)).observationId,
      action: 'move',
      targetId: 'context-hub',
    }),
  });
  const betaRecoversBody = await json(betaRecovers);
  assert.equal(betaRecovers.status, 201, betaRecoversBody.error);
  const betaNavigation = betaRecoversBody.event.payload;
  assert.ok(
    Math.abs(
      betaNavigation.toPosition.x - betaSpawnBody.event.payload.position.x,
    ) < 0.001,
    'the recovered arrival must retain its same-side landing',
  );
  assertNavigationPathClearsPositions(betaNavigation, [
    alphaNavigation.toPosition,
  ]);
  assert.equal(
    betaNavigation.path.some(
      (point) =>
        Math.round((point.x / 100) * ARENA_WORLD_WIDTH) === 384 &&
        Math.round((point.y / 100) * ARENA_WORLD_HEIGHT) === 352,
    ),
    true,
  );
  await new Promise((resolveWait) =>
    setTimeout(
      resolveWait,
      Math.max(0, Date.parse(betaNavigation.arrivesAt) - Date.now() + 5),
    ),
  );

  await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: {
      objective: 'Replay the canceled four-resident Commons arrangement safely',
    },
  });
  const residents = new Map();
  for (const [agentId, name, role] of [
    ['steward-live', 'Mara', 'Steward'],
    ['explorer-live', 'Lumen', 'Explorer'],
    ['maker-live', 'Forge', 'Maker'],
    ['critic-live', 'Vale', 'Critic'],
  ]) {
    const response = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role },
    });
    assert.equal(response.status, 201);
    const body = await json(response);
    assert.ok(body.event.payload.position, `${agentId} spawn lacks a position`);
    residents.set(agentId, {
      token: body.agentToken,
      position: body.event.payload.position,
    });
  }
  assert.deepEqual(
    [...residents.values()]
      .map(({ position }) => [
        Math.round((position.x / 100) * ARENA_WORLD_WIDTH),
        Math.round((position.y / 100) * ARENA_WORLD_HEIGHT),
      ])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]),
    [
      [320, 404],
      [352, 378],
      [416, 378],
      [448, 404],
    ],
  );

  const moveResident = async (agentId, targetId, actionId) => {
    const resident = residents.get(agentId);
    const response = await boardRequest(
      origin,
      '/world/action',
      resident.token,
      {
        method: 'POST',
        body: JSON.stringify({
          actionId,
          observationId: (await observe(origin, resident.token)).observationId,
          action: 'move',
          targetId,
        }),
      },
    );
    const body = await json(response);
    return { response, body };
  };
  const settle = async (navigation) => {
    await new Promise((resolveWait) =>
      setTimeout(
        resolveWait,
        Math.max(0, Date.parse(navigation.arrivesAt) - Date.now() + 5),
      ),
    );
  };
  const acceptedMove = async (agentId, targetId, actionId) => {
    const result = await moveResident(agentId, targetId, actionId);
    assert.equal(result.response.status, 201, result.body.error);
    assertNavigationPathIsSweptLegal(result.body.event.payload);
    return result.body.event.payload;
  };

  const explorerToWestLanding = await acceptedMove(
    'explorer-live',
    'context-hub',
    'explorer-enters-west-landing',
  );
  assert.equal(
    Math.round((explorerToWestLanding.toPosition.x / 100) * ARENA_WORLD_WIDTH),
    352,
  );
  await settle(explorerToWestLanding);

  const stewardToEastLanding = await acceptedMove(
    'steward-live',
    'context-hub',
    'steward-enters-east-landing',
  );
  assert.equal(
    Math.round((stewardToEastLanding.toPosition.x / 100) * ARENA_WORLD_WIDTH),
    416,
  );
  assertNavigationPathClearsPositions(stewardToEastLanding, [
    explorerToWestLanding.toPosition,
  ]);
  await settle(stewardToEastLanding);

  const explorerToDoor = await acceptedMove(
    'explorer-live',
    'door-context',
    'explorer-reserves-single-door',
  );
  const stewardDoorConflict = await moveResident(
    'steward-live',
    'door-context',
    'steward-yields-single-door',
  );
  assert.equal(stewardDoorConflict.response.status, 409);
  assert.match(
    stewardDoorConflict.body.error,
    /(route conflicts|yield|reserved|standing slot|occupied)/iu,
  );
  await settle(explorerToDoor);
  const explorerToHall = await acceptedMove(
    'explorer-live',
    'hall-center',
    'explorer-clears-single-door',
  );
  await settle(explorerToHall);
  const explorerClearsDoorMouth = await acceptedMove(
    'explorer-live',
    'hall-west',
    'explorer-clears-context-door-mouth',
  );
  await settle(explorerClearsDoorMouth);

  const stewardToDoor = await acceptedMove(
    'steward-live',
    'door-context',
    'steward-enters-serialized-door',
  );
  await settle(stewardToDoor);
  const stewardToHall = await acceptedMove(
    'steward-live',
    'hall-center',
    'steward-clears-serialized-door',
  );
  await settle(stewardToHall);
  const stewardClearsDoorMouth = await acceptedMove(
    'steward-live',
    'hall-east',
    'steward-clears-context-door-mouth',
  );
  await settle(stewardClearsDoorMouth);

  const makerToEastLanding = await acceptedMove(
    'maker-live',
    'context-hub',
    'maker-drains-east-overflow',
  );
  await settle(makerToEastLanding);
  const criticToWestLanding = await acceptedMove(
    'critic-live',
    'context-hub',
    'critic-drains-west-overflow',
  );
  assertNavigationPathClearsPositions(criticToWestLanding, [
    makerToEastLanding.toPosition,
  ]);
  await settle(criticToWestLanding);

  const makerToDoor = await acceptedMove(
    'maker-live',
    'door-context',
    'maker-reserves-single-door',
  );
  const criticDoorConflict = await moveResident(
    'critic-live',
    'door-context',
    'critic-yields-single-door',
  );
  assert.equal(criticDoorConflict.response.status, 409);
  await settle(makerToDoor);
  const makerToHall = await acceptedMove(
    'maker-live',
    'hall-center',
    'maker-clears-single-door',
  );
  await settle(makerToHall);
  const makerClearsDoorMouth = await acceptedMove(
    'maker-live',
    'hall-east',
    'maker-clears-context-door-mouth',
  );
  await settle(makerClearsDoorMouth);

  const criticToLight = await acceptedMove(
    'critic-live',
    'room-light-context',
    'critic-visits-commons-switch',
  );
  await settle(criticToLight);
  const criticLightScene = await observe(
    origin,
    residents.get('critic-live').token,
  );
  await interactAt(
    origin,
    residents.get('critic-live').token,
    criticLightScene,
    'room-light-context',
    'switch_off',
    'critic-switches-off-commons',
  );
  const criticReturnsToLanding = await acceptedMove(
    'critic-live',
    'context-hub',
    'critic-returns-from-commons-switch',
  );
  await settle(criticReturnsToLanding);

  const criticToDoor = await acceptedMove(
    'critic-live',
    'door-context',
    'critic-enters-serialized-door',
  );
  await settle(criticToDoor);
  const criticToHall = await acceptedMove(
    'critic-live',
    'hall-center',
    'critic-clears-serialized-door',
  );
  await settle(criticToHall);

  assert.equal(
    (await observe(origin, residents.get('explorer-live').token)).you
      .locationId,
    'hall-west',
  );
  assert.equal(
    (await observe(origin, residents.get('steward-live').token)).you.locationId,
    'hall-east',
  );
  assert.equal(
    (await observe(origin, residents.get('maker-live').token)).you.locationId,
    'hall-east',
  );
  assert.equal(
    (await observe(origin, residents.get('critic-live').token)).you.locationId,
    'hall-center',
  );
});

void test('an occupied doorway can drain past a stationary adjacent corridor resident', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-doorway-drain-'));
  const origin = `http://127.0.0.1:${port}`;
  const runId = 'run-doorway-drain';
  const occurredAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - 2_000).toISOString();
  const arrivesAt = new Date(Date.now() - 1_000).toISOString();
  const events = [
    {
      schemaVersion: 1,
      eventId: 'doorway-drain-run',
      runId,
      sequence: 1,
      occurredAt,
      source: 'codex',
      kind: 'run.started',
      payload: { objective: 'Keep doorway egress live' },
    },
    ...[
      ['steward-01', 'Aster', 'Steward'],
      ['explorer-01', 'Sagan', 'Explorer'],
    ].map(([agentId, name, role], index) => ({
      schemaVersion: 1,
      eventId: `doorway-drain-spawn-${agentId}`,
      runId,
      sequence: index + 2,
      occurredAt,
      source: 'codex',
      kind: 'agent.spawned',
      agentId,
      payload: { name, role },
    })),
    ...[
      ['steward-01', 'spawn-lift', 'hall-center'],
      ['explorer-01', 'spawn-lift', 'door-command'],
    ].map(([agentId, fromLocationId, toLocationId], index) => ({
      schemaVersion: 1,
      eventId: `doorway-drain-navigation-${agentId}`,
      runId,
      sequence: index + 4,
      occurredAt,
      source: 'codex',
      kind: 'world.navigation',
      agentId,
      payload: {
        actionId: `legacy-position-${agentId}`,
        observationId: `legacy-observation-${agentId}`,
        fromLocationId,
        toLocationId,
        startedAt,
        arrivesAt,
      },
    })),
  ];
  const tokens = {
    'steward-01':
      'doorway-drain-steward-token-0123456789abcdef0123456789abcdef',
    'explorer-01':
      'doorway-drain-explorer-token-0123456789abcdef0123456789abcdef',
  };
  const credentials = Object.fromEntries(
    Object.entries(tokens).map(([agentId, token]) => [
      agentId,
      {
        hash: createHash('sha256').update(token).digest('hex'),
        runId,
        issuedAt: occurredAt,
      },
    ]),
  );
  await writeFile(
    resolve(dataDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      sequence: events.length,
      intentSequence: 0,
      startedAt: occurredAt,
      updatedAt: occurredAt,
    })}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'agent-credentials.json'),
    `${JSON.stringify(credentials)}\n`,
    'utf8',
  );

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

  const asterScene = await observe(origin, tokens['steward-01']);
  assert.equal(asterScene.you.locationId, 'hall-center');
  const occupiedDoor = asterScene.exits.find(
    (exit) => exit.to === 'door-command',
  );
  assert.equal(occupiedDoor.status, 'occupied');
  assert.equal(occupiedDoor.available, false);
  assert.deepEqual(
    occupiedDoor.occupiedBy.map((resident) => resident.id),
    ['explorer-01'],
  );

  const saganScene = await observe(origin, tokens['explorer-01']);
  assert.equal(saganScene.you.locationId, 'door-command');
  assert.equal(saganScene.you.navigation, undefined);
  const roomEgress = saganScene.exits.find((exit) => exit.to === 'command-hub');
  assert.ok(roomEgress);
  assert.equal(roomEgress.available, true);
  assert.ok(['open', 'shared'].includes(roomEgress.status));

  const egress = await boardRequest(
    origin,
    '/world/action',
    tokens['explorer-01'],
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'sagan-drains-command-doorway',
        observationId: saganScene.observationId,
        action: 'move',
        targetId: 'command-hub',
      }),
    },
  );
  const egressBody = await json(egress);
  assert.equal(egress.status, 201, egressBody.error);
  assert.deepEqual(egressBody.event.payload.fromPosition, {
    x: 45.833,
    y: 50,
  });
  assertNavigationPathClearsPositions(egressBody.event.payload, [
    { x: 52.25, y: 50 },
  ]);
});

void test('door-context movement retries a later hall-center slot when its preferred bay is occupied', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-door-slot-retry-'));
  const origin = `http://127.0.0.1:${port}`;
  const runId = 'run-door-slot-retry';
  const occurredAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - 2_000).toISOString();
  const arrivesAt = new Date(Date.now() - 1_000).toISOString();
  const events = [
    {
      schemaVersion: 1,
      eventId: 'door-slot-retry-run',
      runId,
      sequence: 1,
      occurredAt,
      source: 'codex',
      kind: 'run.started',
      payload: { objective: 'Retry every authored target slot safely' },
    },
    ...[
      ['aster-safe', 'Aster', 'Steward'],
      ['mover-smoke', 'Mover', 'Movement verifier'],
    ].map(([agentId, name, role], index) => ({
      schemaVersion: 1,
      eventId: `door-slot-retry-spawn-${agentId}`,
      runId,
      sequence: index + 2,
      occurredAt,
      source: 'codex',
      kind: 'agent.spawned',
      agentId,
      payload: { name, role },
    })),
    ...[
      ['aster-safe', 'spawn-lift', 'hall-center'],
      ['mover-smoke', 'spawn-lift', 'door-context'],
    ].map(([agentId, fromLocationId, toLocationId], index) => ({
      schemaVersion: 1,
      eventId: `door-slot-retry-navigation-${agentId}`,
      runId,
      sequence: index + 4,
      occurredAt,
      source: 'codex',
      kind: 'world.navigation',
      agentId,
      payload: {
        actionId: `legacy-position-${agentId}`,
        observationId: `legacy-observation-${agentId}`,
        fromLocationId,
        toLocationId,
        startedAt,
        arrivesAt,
      },
    })),
  ];
  const tokens = {
    'aster-safe':
      'door-slot-retry-steward-token-0123456789abcdef0123456789abcdef',
    'mover-smoke':
      'door-slot-retry-mover-token-0123456789abcdef0123456789abcdef',
  };
  const credentials = Object.fromEntries(
    Object.entries(tokens).map(([agentId, token]) => [
      agentId,
      {
        hash: createHash('sha256').update(token).digest('hex'),
        runId,
        issuedAt: occurredAt,
      },
    ]),
  );
  await writeFile(
    resolve(dataDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      sequence: events.length,
      intentSequence: 0,
      startedAt: occurredAt,
      updatedAt: occurredAt,
    })}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'agent-credentials.json'),
    `${JSON.stringify(credentials)}\n`,
    'utf8',
  );

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

  const moverScene = await observe(origin, tokens['mover-smoke']);
  assert.equal(moverScene.you.locationId, 'door-context');
  const hallExit = moverScene.exits.find((exit) => exit.to === 'hall-center');
  assert.ok(hallExit);
  assert.equal(hallExit.capacity, 4);
  assert.equal(hallExit.remainingCapacity, 3);
  assert.equal(hallExit.status, 'shared');
  assert.equal(hallExit.available, true);
  assert.deepEqual(
    hallExit.occupiedBy.map((resident) => resident.id),
    ['aster-safe'],
  );
  assert.equal(hallExit.trafficBy, undefined);

  const move = await boardRequest(
    origin,
    '/world/action',
    tokens['mover-smoke'],
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'mover-smoke-retries-hall-slot',
        observationId: moverScene.observationId,
        action: 'move',
        targetId: 'hall-center',
      }),
    },
  );
  const moveBody = await json(move);
  assert.equal(move.status, 201, moveBody.error);
  assert.deepEqual(moveBody.event.payload.fromPosition, {
    x: 50,
    y: 50,
  });
  assert.deepEqual(moveBody.event.payload.toPosition, { x: 43.25, y: 50 });
  assertNavigationPathIsSweptLegal(moveBody.event.payload);
  assertNavigationPathClearsPositions(moveBody.event.payload, [
    { x: 56.75, y: 50 },
  ]);
});

void test('authenticated semantic world-action failures write redacted recovery receipts', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-action-rejections-'));
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
  await postEvent(origin, {
    kind: 'run.started',
    reset: true,
    payload: { objective: 'Prove recoverable semantic rejection receipts' },
  });
  const unsafeIdentity = 'unsafe/resident\nCLASSIFIED_IDENTITY';
  const unsafeSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: unsafeIdentity,
    payload: { name: 'Unsafe', role: 'Resident verifier' },
  });
  assert.equal(unsafeSpawn.status, 400);
  assert.doesNotMatch(await unsafeSpawn.text(), /CLASSIFIED_IDENTITY/u);
  const tokens = {};
  for (const [agentId, name] of [
    ['alpha', 'CLASSIFIED_DISPLAY_NAME'],
    ['beta', 'Beta'],
  ]) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role: 'Resident verifier' },
    });
    assert.equal(spawned.status, 201);
    tokens[agentId] = (await json(spawned)).agentToken;
  }

  const staleScene = await observe(origin, tokens.alpha);
  const activityResponse = await postEvent(origin, {
    kind: 'agent.activity',
    agentId: 'alpha',
    payload: {
      phase: 'planning',
      status: 'working',
      summary: 'Refresh the local action context',
    },
  });
  assert.equal(activityResponse.status, 201);
  const activity = (await json(activityResponse)).event;
  const staleResponse = await boardRequest(
    origin,
    '/world/action',
    tokens.alpha,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'alpha-stale-move',
        observationId: staleScene.observationId,
        action: 'move',
        targetId: 'context-hub',
      }),
    },
  );
  assert.equal(staleResponse.status, 409);
  const staleBody = await json(staleResponse);
  assert.notEqual(
    staleBody.observation.observationId,
    staleScene.observationId,
  );

  const recoveredResponse = await boardRequest(
    origin,
    '/world/action',
    tokens.alpha,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'alpha-recovered-move',
        observationId: staleBody.observation.observationId,
        action: 'move',
        targetId: 'context-hub',
      }),
    },
  );
  assert.equal(recoveredResponse.status, 201);
  const recovered = await json(recoveredResponse);
  assert.equal(
    recovered.event.payload.observationId,
    staleBody.observation.observationId,
  );

  const betaDuringContention = await observe(origin, tokens.beta);
  const contentionResponse = await boardRequest(
    origin,
    '/world/action',
    tokens.beta,
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'beta-yields-path',
        observationId: betaDuringContention.observationId,
        action: 'move',
        targetId: 'context-hub',
      }),
    },
  );
  assert.equal(contentionResponse.status, 409);
  assert.match(
    (await json(contentionResponse)).error,
    /(path is in use|route conflicts|occupied or reserved|yield)/u,
  );

  const rejectionPath = resolve(dataDir, 'action-rejections.jsonl');
  const rawReceipts = await readFile(rejectionPath, 'utf8');
  const receipts = rawReceipts
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(receipts.length, 2);
  const expectedKeys = [
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
  ].sort();
  for (const receipt of receipts) {
    assert.deepEqual(Object.keys(receipt).sort(), expectedKeys);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.httpStatus, 409);
    assert.match(receipt.receiptId, /^reject_[0-9a-f-]+$/u);
    assert.ok(!Number.isNaN(Date.parse(receipt.occurredAt)));
    assert.deepEqual(
      validateRejectionReceipt(receipt),
      [],
      'every bridge receipt must satisfy the offline evaluator schema',
    );
  }
  const staleReceipt = receipts.find(
    (receipt) => receipt.actionId === 'alpha-stale-move',
  );
  assert.equal(staleReceipt.reasonCode, 'stale_observation');
  assert.equal(staleReceipt.agentId, 'alpha');
  assert.equal(staleReceipt.action, 'move');
  assert.equal(staleReceipt.targetId, 'context-hub');
  assert.equal(staleReceipt.submittedObservationId, staleScene.observationId);
  assert.equal(
    staleReceipt.returnedObservationId,
    staleBody.observation.observationId,
  );
  assert.equal(staleReceipt.currentEventSequence, activity.sequence);
  assert.equal(
    receipts.find((receipt) => receipt.actionId === 'beta-yields-path')
      .reasonCode,
    'path_reserved',
  );
  assert.doesNotMatch(rawReceipts, /CLASSIFIED_DISPLAY_NAME/u);
  assert.doesNotMatch(rawReceipts, /path is in use|local scene changed/u);
  assert.doesNotMatch(rawReceipts, new RegExp(tokens.alpha, 'u'));

  const beforeUnauthorized = receipts.length;
  const unauthorized = await boardRequest(origin, '/world/action', undefined, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'unauthorized-action',
      observationId: staleScene.observationId,
      action: 'move',
      targetId: 'context-hub',
    }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(
    (await readFile(rejectionPath, 'utf8')).trim().split(/\r?\n/u).length,
    beforeUnauthorized,
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
  assert.ok(
    commandContext.purpose.opportunities.some(
      (opportunity) =>
        opportunity.kind === 'open-inquiry' &&
        opportunity.capability === 'search' &&
        /real evidence/u.test(opportunity.suggestedAction),
    ),
  );
  assert.ok(
    commandContext.purpose.opportunities.some(
      (opportunity) => opportunity.id === 'purpose:form-commitment',
    ) === false,
    'a directed Explorer gets evidence opportunities without a self-directed commitment prompt',
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
  assert.equal(
    selfDirectedContext.purpose.opportunities.some(
      (opportunity) => opportunity.kind === 'open-inquiry',
    ),
    false,
  );
  assert.equal(
    selfDirectedContext.purpose.opportunities.some(
      (opportunity) => opportunity.id === 'purpose:form-commitment',
    ),
    false,
  );

  const firstActivityResponse = await postEvent(origin, {
    kind: 'agent.activity',
    agentId: 'atlas',
    payload: {
      phase: 'planning',
      status: 'working',
      summary: 'Maintain coordination continuity for the shared run',
    },
  });
  assert.equal(firstActivityResponse.status, 201);
  const firstActivity = (await json(firstActivityResponse)).event;
  const activityContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.deepEqual(activityContext.purpose.commitment, {
    kind: 'activity',
    id: firstActivity.eventId,
    title: 'Maintain coordination continuity for the shared run',
    status: 'working',
    phase: 'planning',
    sequence: firstActivity.sequence,
  });
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'agent.activity',
        agentId: 'atlas',
        payload: {
          phase: 'waiting',
          status: 'idle',
          summary: 'Context refresh after the commitment was declared',
        },
      })
    ).status,
    201,
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
  assert.equal(
    collaboratorContext.purpose.opportunities.some(
      (opportunity) => opportunity.topicId === 'topic-tools',
    ),
    false,
    'another resident selecting a topic must not create cross-resident work without a board question or handoff',
  );
  assert.equal(
    collaboratorContext.purpose.commitment.id,
    firstActivity.eventId,
    'idle and unrelated journal refreshes preserve the latest working activity commitment',
  );
  const replacementActivityResponse = await postEvent(origin, {
    kind: 'agent.activity',
    agentId: 'atlas',
    payload: {
      phase: 'delegating',
      status: 'working',
      summary: 'Coordinate the next explicit evidence handoff',
    },
  });
  assert.equal(replacementActivityResponse.status, 201);
  const replacementActivity = (await json(replacementActivityResponse)).event;
  const replacementContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.equal(
    replacementContext.purpose.commitment.id,
    replacementActivity.eventId,
  );
  assert.equal(
    replacementContext.purpose.commitment.title,
    'Coordinate the next explicit evidence handoff',
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
  const contributionStart = await postEvent(origin, {
    kind: 'tool.started',
    agentId: 'atlas',
    payload: {
      toolCallId: 'tool-context-contribution',
      tool: 'private-journal.review',
      summary: "Reviewing context in support of Sage's active inquiry",
      capability: 'context',
      topicId: 'topic-tools',
    },
  });
  assert.equal(contributionStart.status, 201);
  const contributionContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.equal(
    contributionContext.self.topic,
    undefined,
    "using a utility on another resident's topic must not project topic ownership",
  );
  assert.equal(
    contributionContext.purpose.commitment.id,
    replacementActivity.eventId,
    "a contributed tool call must not replace the resident's latest working activity",
  );
  assert.deepEqual(contributionContext.purpose.activeContribution, {
    kind: 'research-topic-contribution',
    id: 'topic-tools',
    title: 'Tool orchestration',
    status: 'active',
    ownerAgentId: 'sage',
    toolCallId: 'tool-context-contribution',
  });
  assert.ok(
    contributionContext.purpose.opportunities.some(
      (opportunity) =>
        opportunity.id === 'finish-tool:tool-context-contribution' &&
        opportunity.topicId === 'topic-tools' &&
        opportunity.topicRelation === 'contributed' &&
        opportunity.ownerAgentId === 'sage',
    ),
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.finished',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-context-contribution',
          outcome: 'succeeded',
          summary: 'Reviewed the supporting context without claiming ownership',
        },
      })
    ).status,
    201,
  );
  const afterContribution = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.equal(afterContribution.purpose.activeContribution, undefined);
  assert.equal(
    afterContribution.purpose.commitment.id,
    replacementActivity.eventId,
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
  assert.equal(
    observation.entities.find((entity) => entity.id === 'research-computer-b')
      .known,
    undefined,
  );
  const inspectedComputer = await interactAt(
    origin,
    sageToken,
    observation,
    'research-computer-b',
    'inspect',
  );
  const knownComputer = inspectedComputer.observation.entities.find(
    (entity) => entity.id === 'research-computer-b',
  ).known;
  assert.deepEqual(knownComputer.affordances, ['inspect', 'use']);
  assert.deepEqual(
    knownComputer.activities.map((activity) => activity.id),
    ['research.search-primary-sources', 'research.browse-authoritative-source'],
  );
  const engaged = await interactAt(
    origin,
    sageToken,
    inspectedComputer.observation,
    'research-computer-b',
    'use',
  );
  observation = engaged.observation;
  assert.equal(observation.you.engagedResourceId, 'research-computer-b');
  assert.deepEqual(
    observation.activities.map((activity) => activity.id),
    ['research.search-primary-sources', 'research.browse-authoritative-source'],
  );
  assert.match(observation.text, /^ACTIVITIES .*search-primary-sources/mu);

  const staleArtifact = await postEvent(origin, {
    kind: 'artifact.recorded',
    agentId: 'sage',
    payload: {
      artifactId: 'artifact-source-before-tool',
      kind: 'source-note',
      title: 'Evidence recorded too early for this call',
      summary: 'Useful evidence, but it predates this utility lifecycle.',
      uri: 'https://example.com/before-tool',
      topicId: 'topic-tools',
    },
  });
  assert.equal(staleArtifact.status, 201);

  const wrongResourceActivity = await postEvent(origin, {
    kind: 'tool.started',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-wrong-resource-activity',
      tool: 'web.search',
      summary: 'Attempt an activity from a different workstation',
      capability: 'search',
      activityId: 'shell.run-scoped-command',
      topicId: 'topic-tools',
    },
  });
  assert.equal(wrongResourceActivity.status, 400);
  assert.match(
    await wrongResourceActivity.text(),
    /does not belong to research-computer-b/u,
  );

  const wrongActivityCapability = await postEvent(origin, {
    kind: 'tool.started',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-wrong-activity-capability',
      tool: 'web.search',
      summary: 'Attempt an exact activity with the wrong capability',
      capability: 'search',
      activityId: 'research.browse-authoritative-source',
      topicId: 'topic-tools',
    },
  });
  assert.equal(wrongActivityCapability.status, 400);
  assert.match(
    await wrongActivityCapability.text(),
    /requires browse, not search/u,
  );

  const searchStart = await postEvent(origin, {
    kind: 'tool.started',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-search-1',
      tool: 'web.search',
      summary: 'Searching official agent orchestration documentation',
      capability: 'search',
      activityId: 'research.search-primary-sources',
      topicId: 'topic-tools',
    },
  });
  assert.equal(searchStart.status, 201);
  const searchStartEvent = (await json(searchStart)).event;
  assert.equal(
    searchStartEvent.payload.activityId,
    'research.search-primary-sources',
  );
  assert.equal(searchStartEvent.payload.resourceId, 'research-computer-b');

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

  const staleEvidenceFinish = await postEvent(origin, {
    kind: 'tool.finished',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-search-1',
      outcome: 'succeeded',
      summary: 'Attempted to reuse evidence recorded before the utility call',
      artifactIds: ['artifact-source-before-tool'],
    },
  });
  assert.equal(staleEvidenceFinish.status, 400);
  assert.match(await staleEvidenceFinish.text(), /after the tool start/u);

  const foreignArtifact = await postEvent(origin, {
    kind: 'artifact.recorded',
    agentId: 'atlas',
    payload: {
      artifactId: 'artifact-source-other-resident',
      kind: 'source-note',
      title: 'Another resident source',
      summary: 'This cannot prove Sage performed the active search.',
      uri: 'https://example.com/other-resident',
      topicId: 'topic-tools',
    },
  });
  assert.equal(foreignArtifact.status, 201);
  const foreignEvidenceFinish = await postEvent(origin, {
    kind: 'tool.finished',
    agentId: 'sage',
    payload: {
      toolCallId: 'tool-search-1',
      outcome: 'succeeded',
      summary: "Attempted to claim another resident's evidence",
      artifactIds: ['artifact-source-other-resident'],
    },
  });
  assert.equal(foreignEvidenceFinish.status, 400);
  assert.match(
    await foreignEvidenceFinish.text(),
    /authored by this resident/u,
  );

  const researchContext = await json(
    await boardRequest(origin, '/agent/context?after=0', sageToken),
  );
  assert.equal(researchContext.self.roomId, 'research');
  assert.equal(researchContext.self.resourceId, 'research-computer-b');
  assert.equal(researchContext.self.capability, 'search');
  assert.equal(
    researchContext.self.activeActivityId,
    'research.search-primary-sources',
  );
  assert.equal(researchContext.self.topic.topicId, 'topic-tools');
  assert.equal(researchContext.purpose.commitment.id, 'topic-tools');
  assert.ok(
    researchContext.purpose.opportunities.some(
      (opportunity) =>
        opportunity.id === 'finish-tool:tool-search-1' &&
        opportunity.activityId === 'research.search-primary-sources',
    ),
  );
  assert.ok(
    researchContext.researchTracks.some(
      (track) => track.id === 'technical-sources',
    ),
  );
  assert.deepEqual(
    researchContext.room.resources
      .find((resource) => resource.id === 'research-computer-b')
      .activities.map((activity) => activity.id),
    ['research.search-primary-sources', 'research.browse-authoritative-source'],
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
  const coordinatedContext = await json(
    await boardRequest(origin, '/agent/context?after=0', atlasToken),
  );
  assert.ok(
    coordinatedContext.purpose.opportunities.some(
      (opportunity) =>
        opportunity.id === `handoff:coordinate:${linkedPayload.messageId}` &&
        opportunity.topicId === 'topic-tools' &&
        opportunity.artifactIds.includes('artifact-source-1'),
    ),
  );

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

  const atlasAtBuildBench = await walkTo(origin, atlasToken, 'build-bench-a');
  const atlasInspectedBuildBench = await interactAt(
    origin,
    atlasToken,
    atlasAtBuildBench,
    'build-bench-a',
    'inspect',
  );
  assert.deepEqual(
    atlasInspectedBuildBench.observation.entities
      .find((entity) => entity.id === 'build-bench-a')
      .known.activities.map((activity) => activity.id),
    ['build.implement-linked-change', 'build.compile-project'],
  );
  await interactAt(
    origin,
    atlasToken,
    atlasInspectedBuildBench.observation,
    'build-bench-a',
    'use',
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.started',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-edit-proof-1',
          tool: 'apply_patch',
          summary: 'Implementing one topic-linked change',
          capability: 'edit',
          topicId: 'topic-tools',
        },
      })
    ).status,
    201,
  );
  const unprovenEdit = await postEvent(origin, {
    kind: 'tool.finished',
    agentId: 'atlas',
    payload: {
      toolCallId: 'tool-edit-proof-1',
      outcome: 'succeeded',
      summary: 'Claimed an edit without preserving its change',
    },
  });
  assert.equal(unprovenEdit.status, 400);
  assert.match(await unprovenEdit.text(), /requires a linked change artifact/u);
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'artifact.recorded',
        agentId: 'atlas',
        payload: {
          artifactId: 'artifact-change-after-edit',
          kind: 'change',
          title: 'Topic-linked implementation change',
          summary: 'A concrete edit created during the active utility call.',
          uri: 'local://worktree/change',
          topicId: 'topic-tools',
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.finished',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-edit-proof-1',
          outcome: 'succeeded',
          summary: 'Preserved the topic-linked implementation change',
          artifactIds: ['artifact-change-after-edit'],
        },
      })
    ).status,
    201,
  );

  const atlasAtShell = await walkTo(origin, atlasToken, 'shell-console-a');
  const atlasInspectedShell = await interactAt(
    origin,
    atlasToken,
    atlasAtShell,
    'shell-console-a',
    'inspect',
  );
  await interactAt(
    origin,
    atlasToken,
    atlasInspectedShell.observation,
    'shell-console-a',
    'use',
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.started',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-shell-proof-1',
          tool: 'npm test -- --runInBand',
          summary: 'Run one bounded project validation command',
          capability: 'shell',
          activityId: 'shell.run-scoped-command',
          topicId: 'topic-tools',
        },
      })
    ).status,
    201,
  );
  const unprovenShell = await postEvent(origin, {
    kind: 'tool.finished',
    agentId: 'atlas',
    payload: {
      toolCallId: 'tool-shell-proof-1',
      outcome: 'succeeded',
      summary: 'Claimed command success without a preserved result',
    },
  });
  assert.equal(unprovenShell.status, 400);
  assert.match(
    await unprovenShell.text(),
    /requires a linked test-result artifact/u,
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'artifact.recorded',
        agentId: 'atlas',
        payload: {
          artifactId: 'artifact-shell-result',
          kind: 'test-result',
          title: 'Scoped command result',
          summary: 'The bounded command exited successfully.',
          topicId: 'topic-tools',
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.finished',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-shell-proof-1',
          outcome: 'succeeded',
          summary: 'The bounded command completed successfully',
          artifactIds: ['artifact-shell-result'],
        },
      })
    ).status,
    201,
  );

  const atlasAtConnector = await walkTo(
    origin,
    atlasToken,
    'connector-console-b',
  );
  const atlasInspectedConnector = await interactAt(
    origin,
    atlasToken,
    atlasAtConnector,
    'connector-console-b',
    'inspect',
  );
  await interactAt(
    origin,
    atlasToken,
    atlasInspectedConnector.observation,
    'connector-console-b',
    'use',
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.started',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-connector-failure-1',
          tool: 'connector.query',
          summary: 'Query one configured service if it exists',
          capability: 'connector',
          activityId: 'connector.query-configured-service',
          topicId: 'topic-tools',
        },
      })
    ).status,
    201,
  );
  const unprovenConnector = await postEvent(origin, {
    kind: 'tool.finished',
    agentId: 'atlas',
    payload: {
      toolCallId: 'tool-connector-failure-1',
      outcome: 'succeeded',
      summary: 'Claimed connector success without durable evidence',
    },
  });
  assert.equal(unprovenConnector.status, 400);
  assert.match(
    await unprovenConnector.text(),
    /requires a linked source-note or change or decision artifact/u,
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'tool.finished',
        agentId: 'atlas',
        payload: {
          toolCallId: 'tool-connector-failure-1',
          outcome: 'failed',
          summary:
            'No configured service was available; no success was claimed',
        },
      })
    ).status,
    201,
  );

  await walkTo(origin, atlasToken, 'comms-board');
  assert.equal(
    (
      await boardRequest(origin, '/board/ack', atlasToken, {
        method: 'POST',
        body: JSON.stringify({
          messageId: linkedPayload.messageId,
          state: 'resolved',
        }),
      })
    ).status,
    201,
  );
  await walkTo(origin, atlasToken, 'commons');

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

void test('purpose exposes only explicit role-aware board work with valid artifact lineage', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-role-handoffs-'));
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
        payload: { objective: 'Exercise explicit role handoffs' },
      })
    ).status,
    201,
  );
  const tokens = {};
  for (const [agentId, name, role] of [
    ['explorer', 'Explorer', 'Explorer'],
    ['maker', 'Maker', 'Maker'],
    ['critic', 'Critic', 'Critic'],
    ['steward', 'Steward', 'Steward'],
  ]) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role },
    });
    assert.equal(spawned.status, 201);
    tokens[agentId] = (await json(spawned)).agentToken;
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'task.assigned',
          agentId,
          taskId: `task-${agentId}`,
          payload: {
            objective:
              'Establish a life and pursue useful work from your resident charter.',
            mode: 'self-directed',
          },
        })
      ).status,
      201,
    );
  }

  const initialExplorerPurpose = await purpose('explorer');
  assert.ok(
    initialExplorerPurpose.opportunities.some(
      (opportunity) => opportunity.id === 'purpose:form-commitment',
    ),
  );
  assert.ok(
    initialExplorerPurpose.opportunities.some(
      (opportunity) => opportunity.kind === 'open-inquiry',
    ),
  );
  for (const agentId of ['maker', 'critic', 'steward']) {
    const initialPurpose = await purpose(agentId);
    assert.equal(
      initialPurpose.opportunities.some(
        (opportunity) => opportunity.id === 'purpose:form-commitment',
      ),
      false,
    );
    assert.equal(
      initialPurpose.opportunities.some(
        (opportunity) => opportunity.kind === 'open-inquiry',
      ),
      false,
    );
  }

  for (const [agentId, topicId, title] of [
    ['maker', 'topic-gap', 'Unanswered evidence gap'],
    ['explorer', 'topic-make', 'Evidence ready to implement'],
    ['maker', 'topic-critic', 'Change awaiting independent validation'],
    ['explorer', 'topic-coordinate', 'Coordination continuity'],
    ['explorer', 'topic-random', 'Unhanded source note'],
  ]) {
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'research.topic.selected',
          agentId,
          payload: {
            topicId,
            parentTopicId: 'project-context',
            title,
            question: `${title}?`,
          },
        })
      ).status,
      201,
    );
  }

  for (const [agentId, artifactId, kind, topicId, sourceUri] of [
    ['maker', 'artifact-gap-decision', 'decision', 'topic-gap'],
    ['maker', 'artifact-gap-no-uri', 'source-note', 'topic-gap'],
    [
      'explorer',
      'artifact-maker-source',
      'source-note',
      'topic-make',
      'https://example.test/artifact-maker-source',
    ],
    ['maker', 'artifact-maker-change', 'change', 'topic-critic'],
    [
      'explorer',
      'artifact-coordination-decision',
      'decision',
      'topic-coordinate',
    ],
    ['explorer', 'artifact-random-source', 'source-note', 'topic-random'],
  ]) {
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'artifact.recorded',
          agentId,
          payload: {
            artifactId,
            kind,
            title: artifactId,
            summary: `Recorded ${kind} for ${topicId}`,
            topicId,
            ...(sourceUri ? { uri: sourceUri } : {}),
          },
        })
      ).status,
      201,
    );
  }

  await walkTo(origin, tokens.maker, 'comms-board');
  await walkTo(origin, tokens.explorer, 'comms-board');
  const stewardClearsMakerLane = await walkTo(
    origin,
    tokens.steward,
    'commons',
  );
  assert.equal(stewardClearsMakerLane.you.locationId, 'commons');
  const gapQuestionResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.maker,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'question-gap',
        text: 'Which primary source resolves this gap?',
        topic: 'Evidence gap',
        messageType: 'question',
        audience: 'direct',
        recipientAgentIds: ['explorer'],
        topicId: 'topic-gap',
      }),
    },
  );
  assert.equal(gapQuestionResponse.status, 201);
  const gapQuestion = (await json(gapQuestionResponse)).event;
  const criticHandoffResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.maker,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-critic',
        text: 'Please independently validate this change.',
        topic: 'Critic handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['critic'],
        topicId: 'topic-critic',
        artifactIds: ['artifact-maker-change'],
      }),
    },
  );
  assert.equal(criticHandoffResponse.status, 201);
  const criticHandoff = (await json(criticHandoffResponse)).event;

  await walkTo(origin, tokens.explorer, 'comms-board');
  const incompleteHandoff = await boardRequest(
    origin,
    '/board/message',
    tokens.explorer,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-missing-lineage',
        text: 'This cannot become work without lineage.',
        topic: 'Incomplete handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['maker'],
      }),
    },
  );
  assert.equal(incompleteHandoff.status, 400);
  assert.match(
    await incompleteHandoff.text(),
    /topicId and at least one linked artifact/u,
  );
  const mismatchedHandoff = await boardRequest(
    origin,
    '/board/message',
    tokens.explorer,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-mismatched-lineage',
        text: 'This artifact belongs to another topic.',
        topic: 'Mismatched handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['maker'],
        topicId: 'topic-gap',
        artifactIds: ['artifact-maker-source'],
      }),
    },
  );
  assert.equal(mismatchedHandoff.status, 409);
  assert.match(
    await mismatchedHandoff.text(),
    /is not linked to topic topic-gap/u,
  );

  const makerHandoffResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.explorer,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-maker',
        text: 'The linked source is ready for a grounded change.',
        topic: 'Maker handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['maker'],
        topicId: 'topic-make',
        artifactIds: ['artifact-maker-source'],
      }),
    },
  );
  assert.equal(makerHandoffResponse.status, 201);
  const makerHandoff = (await json(makerHandoffResponse)).event;
  const noUriHandoffResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.explorer,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-maker-no-uri',
        text: 'This source-note has no external source URL.',
        topic: 'No-URI Maker handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['maker'],
        topicId: 'topic-random',
        artifactIds: ['artifact-random-source'],
      }),
    },
  );
  assert.equal(noUriHandoffResponse.status, 201);
  const noUriHandoff = (await json(noUriHandoffResponse)).event;
  const decisionMakerHandoffResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.explorer,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-maker-decision',
        text: 'This explicit decision is ready for implementation.',
        topic: 'Decision Maker handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['maker'],
        topicId: 'topic-coordinate',
        artifactIds: ['artifact-coordination-decision'],
      }),
    },
  );
  assert.equal(decisionMakerHandoffResponse.status, 201);
  const decisionMakerHandoff = (await json(decisionMakerHandoffResponse)).event;
  const stewardHandoffResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.explorer,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-steward',
        text: 'This coordination thread needs an accountable next step.',
        topic: 'Steward handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['steward'],
        topicId: 'topic-coordinate',
        artifactIds: ['artifact-coordination-decision'],
      }),
    },
  );
  assert.equal(stewardHandoffResponse.status, 201);
  const stewardHandoff = (await json(stewardHandoffResponse)).event;

  await walkTo(origin, tokens.explorer, 'research-hub');
  for (const message of [makerHandoff, noUriHandoff, decisionMakerHandoff]) {
    assert.equal(
      (
        await boardRequest(origin, '/board/ack', tokens.maker, {
          method: 'POST',
          body: JSON.stringify({
            messageId: message.payload.messageId,
            state: 'acknowledged',
          }),
        })
      ).status,
      201,
    );
  }
  await walkTo(origin, tokens.maker, 'command-hub');
  await walkTo(origin, tokens.steward, 'comms-board');
  assert.equal(
    (
      await boardRequest(origin, '/board/ack', tokens.steward, {
        method: 'POST',
        body: JSON.stringify({
          messageId: stewardHandoff.payload.messageId,
          state: 'acknowledged',
        }),
      })
    ).status,
    201,
  );
  await walkTo(origin, tokens.steward, 'commons');
  await walkTo(origin, tokens.critic, 'comms-board');
  assert.equal(
    (
      await boardRequest(origin, '/board/ack', tokens.critic, {
        method: 'POST',
        body: JSON.stringify({
          messageId: criticHandoff.payload.messageId,
          state: 'acknowledged',
        }),
      })
    ).status,
    201,
  );
  await walkTo(origin, tokens.critic, 'command-table');

  async function purpose(agentId) {
    return (
      await json(
        await boardRequest(origin, '/agent/context?after=0', tokens[agentId]),
      )
    ).purpose;
  }

  assert.ok(
    (await purpose('explorer')).opportunities.some(
      (opportunity) =>
        opportunity.id === `handoff:explore:${gapQuestion.payload.messageId}` &&
        opportunity.topicId === 'topic-gap' &&
        opportunity.capability === 'search',
    ),
    'a source-note without an HTTP(S) URI does not close the Explorer evidence gap',
  );
  assert.ok(
    (await purpose('maker')).opportunities.some(
      (opportunity) =>
        opportunity.id === `handoff:make:${makerHandoff.payload.messageId}` &&
        opportunity.artifactIds.includes('artifact-maker-source') &&
        opportunity.capability === 'edit',
    ),
  );
  assert.equal(
    (await purpose('maker')).opportunities.some(
      (opportunity) =>
        opportunity.id === `handoff:make:${noUriHandoff.payload.messageId}`,
    ),
    false,
    'a handed-off source-note without an HTTP(S) URI must not create implementation work',
  );
  assert.ok(
    (await purpose('maker')).opportunities.some(
      (opportunity) =>
        opportunity.id ===
          `handoff:make:${decisionMakerHandoff.payload.messageId}` &&
        opportunity.artifactIds.includes('artifact-coordination-decision'),
    ),
    'an explicit decision handoff remains valid Maker work',
  );
  assert.equal(
    (await purpose('critic')).opportunities.some(
      (opportunity) =>
        opportunity.id ===
        `handoff:critique:${criticHandoff.payload.messageId}`,
    ),
    false,
    'a Critic handoff without the Maker self-test is not actionable validation work',
  );
  assert.ok(
    (await purpose('steward')).opportunities.some(
      (opportunity) =>
        opportunity.id ===
          `handoff:coordinate:${stewardHandoff.payload.messageId}` &&
        opportunity.capability === 'communicate',
    ),
  );

  assert.equal(
    (
      await postEvent(origin, {
        kind: 'artifact.recorded',
        agentId: 'maker',
        payload: {
          artifactId: 'artifact-self-test',
          kind: 'test-result',
          title: 'Maker self-test',
          summary: 'The change author tested their own change.',
          topicId: 'topic-critic',
        },
      })
    ).status,
    201,
  );
  await walkTo(origin, tokens.maker, 'comms-board');
  const completeCriticHandoffResponse = await boardRequest(
    origin,
    '/board/message',
    tokens.maker,
    {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: 'handoff-critic-complete',
        text: 'Please independently validate the linked change and Maker test.',
        topic: 'Complete Critic handoff',
        messageType: 'handoff',
        audience: 'direct',
        recipientAgentIds: ['critic'],
        topicId: 'topic-critic',
        artifactIds: ['artifact-maker-change', 'artifact-self-test'],
      }),
    },
  );
  assert.equal(completeCriticHandoffResponse.status, 201);
  const completeCriticHandoff = (await json(completeCriticHandoffResponse))
    .event;
  await walkTo(origin, tokens.critic, 'comms-board');
  assert.equal(
    (
      await boardRequest(origin, '/board/ack', tokens.critic, {
        method: 'POST',
        body: JSON.stringify({
          messageId: completeCriticHandoff.payload.messageId,
          state: 'acknowledged',
        }),
      })
    ).status,
    201,
  );
  assert.ok(
    (await purpose('critic')).opportunities.some(
      (opportunity) =>
        opportunity.id ===
          `handoff:critique:${completeCriticHandoff.payload.messageId}` &&
        opportunity.changeArtifactId === 'artifact-maker-change' &&
        opportunity.makerTestArtifactId === 'artifact-self-test',
    ),
    'the linked Maker change and self-test create actionable independent validation work',
  );
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'artifact.recorded',
        agentId: 'critic',
        payload: {
          artifactId: 'artifact-independent-test',
          kind: 'test-result',
          title: 'Independent validation',
          summary: 'A different resident independently validated the change.',
          topicId: 'topic-critic',
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (await purpose('critic')).opportunities.some(
      (opportunity) =>
        opportunity.id ===
        `handoff:critique:${completeCriticHandoff.payload.messageId}`,
    ),
    false,
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

void test('legacy bridge projection keeps five positionless residents physically distinct', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-legacy-overflow-'));
  const origin = `http://127.0.0.1:${port}`;
  const runId = 'run-legacy-five-positionless';
  const occurredAt = new Date().toISOString();
  const agentIds = [
    'legacy-steward',
    'legacy-explorer',
    'legacy-maker',
    'legacy-critic',
    'legacy-archivist',
  ];
  const events = [
    {
      schemaVersion: 1,
      eventId: 'legacy-run-started',
      runId,
      sequence: 1,
      occurredAt,
      source: 'codex',
      kind: 'run.started',
      payload: { objective: 'Hydrate five old resident bodies safely' },
    },
    ...agentIds.map((agentId, index) => ({
      schemaVersion: 1,
      eventId: `legacy-spawn-${agentId}`,
      runId,
      sequence: index + 2,
      occurredAt,
      source: 'codex',
      kind: 'agent.spawned',
      agentId,
      payload: { name: agentId, role: 'Legacy resident' },
    })),
  ];
  const tokens = Object.fromEntries(
    agentIds.map((agentId) => [
      agentId,
      `legacy-token-${agentId}-0123456789abcdef0123456789abcdef`,
    ]),
  );
  const credentials = Object.fromEntries(
    agentIds.map((agentId) => [
      agentId,
      {
        hash: createHash('sha256').update(tokens[agentId]).digest('hex'),
        runId,
        issuedAt: occurredAt,
      },
    ]),
  );
  await writeFile(
    resolve(dataDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      sequence: events.length,
      intentSequence: 0,
      startedAt: occurredAt,
      updatedAt: occurredAt,
    })}\n`,
    'utf8',
  );
  await writeFile(
    resolve(dataDir, 'agent-credentials.json'),
    `${JSON.stringify(credentials)}\n`,
    'utf8',
  );

  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
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

  for (const agentId of agentIds) {
    const scene = await observe(origin, tokens[agentId]);
    assert.equal(scene.you.locationId, 'spawn-lift');
    assert.equal(scene.space.residentsPresent, 5);
    assert.equal(scene.people.length, 4);
    assert.equal(scene.exits.length > 0, true);
    assert.equal(
      scene.people.some((person) => person.bearing === 'HERE'),
      false,
      `${agentId} shares an exact projected coordinate with a peer`,
    );
  }

  const reactivatedPositions = [];
  for (const agentId of agentIds) {
    assert.equal(
      (
        await postEvent(origin, {
          kind: 'agent.completed',
          agentId,
          payload: { summary: 'Refresh the old projected body coordinate' },
        })
      ).status,
      201,
    );
    const reactivated = await postEvent(origin, {
      kind: 'task.assigned',
      agentId,
      taskId: `legacy-reactivation-${agentId}`,
      payload: { objective: 'Resume from a collision-safe legacy position' },
    });
    const reactivatedBody = await json(reactivated);
    assert.equal(reactivated.status, 201, reactivatedBody.error);
    assert.ok(reactivatedBody.event.payload.position);
    reactivatedPositions.push(reactivatedBody.event.payload.position);
  }
  assert.equal(new Set(reactivatedPositions.map(JSON.stringify)).size, 5);
  for (let left = 0; left < reactivatedPositions.length; left += 1) {
    assert.deepEqual(worldCollisionIds(reactivatedPositions[left]), []);
    for (
      let right = left + 1;
      right < reactivatedPositions.length;
      right += 1
    ) {
      assert.equal(
        capsulesOverlap(
          reactivatedPositions[left],
          reactivatedPositions[right],
        ),
        false,
      );
    }
  }
});

void test('terminal residents free arrival capacity and cannot reactivate before an authored move arrives', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-terminal-motion-'));
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

  await t.test(
    'a fifth resident can enter after four terminal residents leave the lift',
    async () => {
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'run.started',
            reset: true,
            payload: { objective: 'Release completed arrival slots' },
          })
        ).status,
        201,
      );
      const priorPositions = [];
      const priorTokens = {};
      for (let index = 0; index < 4; index += 1) {
        const agentId = `arrival-${index + 1}`;
        const spawned = await postEvent(origin, {
          kind: 'agent.spawned',
          agentId,
          payload: { name: `Arrival ${index + 1}`, role: 'Resident' },
        });
        const spawnBody = await json(spawned);
        assert.equal(spawned.status, 201, spawnBody.error);
        priorPositions.push(spawnBody.event.payload.position);
        priorTokens[agentId] = spawnBody.agentToken;
      }
      assert.equal(new Set(priorPositions.map(JSON.stringify)).size, 4);

      const fullLift = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'arrival-five',
        payload: { name: 'Arrival Five', role: 'Resident' },
      });
      assert.equal(fullLift.status, 400);
      assert.match(await fullLift.text(), /no collision-safe spawn slot/iu);

      for (let index = 0; index < 4; index += 1) {
        const agentId = `arrival-${index + 1}`;
        assert.equal(
          (
            await postEvent(origin, {
              kind: 'agent.completed',
              agentId,
              payload: { summary: 'Arrival slot released' },
            })
          ).status,
          201,
        );
      }

      const fifth = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'arrival-five',
        payload: { name: 'Arrival Five', role: 'Resident' },
      });
      const fifthBody = await json(fifth);
      assert.equal(fifth.status, 201, fifthBody.error);
      assert.ok(fifthBody.event.payload.position);
      const reusedIndex = priorPositions.findIndex(
        (position) =>
          JSON.stringify(position) ===
          JSON.stringify(fifthBody.event.payload.position),
      );
      assert.ok(
        reusedIndex >= 0,
        'the released lift position should be reused authoritatively',
      );

      const reactivatedAgentId = `arrival-${reusedIndex + 1}`;
      const forgedReactivation = await postEvent(origin, {
        kind: 'task.assigned',
        agentId: reactivatedAgentId,
        taskId: 'task-forged-reactivation-position',
        payload: {
          objective: 'A caller must not choose its own reactivation body',
          position: priorPositions[(reusedIndex + 1) % priorPositions.length],
        },
      });
      assert.equal(forgedReactivation.status, 400);
      assert.match(await forgedReactivation.text(), /position.*bridge/iu);

      const reactivated = await postEvent(origin, {
        kind: 'task.assigned',
        agentId: reactivatedAgentId,
        taskId: 'task-reactivated-away-from-reused-spawn',
        payload: { objective: 'Resume without overlapping the new arrival' },
      });
      const reactivatedBody = await json(reactivated);
      assert.equal(reactivated.status, 201, reactivatedBody.error);
      assert.ok(reactivatedBody.event.payload.position);
      assert.deepEqual(
        worldCollisionIds(reactivatedBody.event.payload.position),
        [],
      );
      assert.equal(
        capsulesOverlap(
          reactivatedBody.event.payload.position,
          fifthBody.event.payload.position,
        ),
        false,
      );
      assert.notDeepEqual(
        reactivatedBody.event.payload.position,
        fifthBody.event.payload.position,
      );

      const fifthScene = await observe(origin, fifthBody.agentToken);
      const reactivatedScene = await observe(
        origin,
        priorTokens[reactivatedAgentId],
      );
      assert.notEqual(fifthScene.observationId, reactivatedScene.observationId);
      assert.equal(fifthScene.space.residentsPresent, 2);
      assert.equal(reactivatedScene.space.residentsPresent, 2);
      assert.equal(
        fifthScene.people.some((person) => person.id === reactivatedAgentId),
        true,
      );
      assert.equal(
        reactivatedScene.people.some((person) => person.id === 'arrival-five'),
        true,
      );
    },
  );

  await t.test(
    'terminal movement owns the endpoint until its deadline',
    async () => {
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'run.started',
            reset: true,
            payload: { objective: 'Preserve a terminal body trajectory' },
          })
        ).status,
        201,
      );
      const spawned = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'moving-terminal',
        payload: { name: 'Moving Terminal', role: 'Resident' },
      });
      assert.equal(spawned.status, 201);
      const token = (await json(spawned)).agentToken;
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'task.assigned',
            agentId: 'moving-terminal',
            taskId: 'task-before-terminal-move',
            payload: { objective: 'Move once, then complete' },
          })
        ).status,
        201,
      );
      const scene = await observe(origin, token);
      const move = await boardRequest(origin, '/world/action', token, {
        method: 'POST',
        body: JSON.stringify({
          actionId: 'terminal-move-to-context',
          observationId: scene.observationId,
          action: 'move',
          targetId: 'context-hub',
        }),
      });
      const moveBody = await json(move);
      assert.equal(move.status, 201, moveBody.error);
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'agent.completed',
            agentId: 'moving-terminal',
            payload: { summary: 'The authored move is still settling' },
          })
        ).status,
        201,
      );

      const earlyAssignment = await postEvent(origin, {
        kind: 'task.assigned',
        agentId: 'moving-terminal',
        taskId: 'task-too-early',
        payload: { objective: 'Do not snap back into the moving body' },
      });
      assert.equal(earlyAssignment.status, 409);
      assert.match(await earlyAssignment.text(), /prior movement.*arrive/iu);

      await new Promise((resolveWait) =>
        setTimeout(
          resolveWait,
          Math.max(
            0,
            Date.parse(moveBody.event.payload.arrivesAt) - Date.now() + 10,
          ),
        ),
      );
      const resumed = await postEvent(origin, {
        kind: 'task.assigned',
        agentId: 'moving-terminal',
        taskId: 'task-after-arrival',
        payload: { objective: 'Resume from the authoritative endpoint' },
      });
      assert.equal(resumed.status, 201);
      const resumedScene = await observe(origin, token);
      assert.equal(resumedScene.you.locationId, 'context-hub');
      assert.equal(resumedScene.you.navigation, undefined);
    },
  );

  await t.test(
    'registration avoids every point remaining on an active trajectory',
    async () => {
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'run.started',
            reset: true,
            payload: { objective: 'Keep new arrivals out of active motion' },
          })
        ).status,
        201,
      );
      const moverSpawn = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'spawn-sweep-mover',
        payload: { name: 'Spawn Sweep Mover', role: 'Resident' },
      });
      assert.equal(moverSpawn.status, 201);
      const moverToken = (await json(moverSpawn)).agentToken;
      const atContext = await walkTo(origin, moverToken, 'context-hub');
      const movingAcrossLift = await boardRequest(
        origin,
        '/world/action',
        moverToken,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId: 'move-across-lift-spawn-slot',
            observationId: atContext.observationId,
            action: 'move',
            targetId: 'plant-context',
          }),
        },
      );
      const movingAcrossLiftBody = await json(movingAcrossLift);
      assert.equal(movingAcrossLift.status, 201, movingAcrossLiftBody.error);

      const arrival = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'arrival-during-spawn-sweep',
        payload: { name: 'Safe Arrival', role: 'Resident' },
      });
      const arrivalBody = await json(arrival);
      assert.equal(arrival.status, 201, arrivalBody.error);
      assertNavigationPathClearsPositions(movingAcrossLiftBody.event.payload, [
        arrivalBody.event.payload.position,
      ]);
    },
  );

  await t.test(
    'terminal reactivation avoids every point remaining on an active trajectory',
    async () => {
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'run.started',
            reset: true,
            payload: {
              objective: 'Keep reactivated residents out of active motion',
            },
          })
        ).status,
        201,
      );
      const dormantSpawn = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'dormant-spawn-resident',
        payload: { name: 'Dormant Resident', role: 'Resident' },
      });
      assert.equal(dormantSpawn.status, 201);
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'agent.completed',
            agentId: 'dormant-spawn-resident',
            payload: { summary: 'Wait for a safe reactivation location' },
          })
        ).status,
        201,
      );

      const moverSpawn = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'reactivation-sweep-mover',
        payload: { name: 'Reactivation Sweep Mover', role: 'Resident' },
      });
      assert.equal(moverSpawn.status, 201);
      const moverToken = (await json(moverSpawn)).agentToken;
      const atContext = await walkTo(origin, moverToken, 'context-hub');
      const movingAcrossLift = await boardRequest(
        origin,
        '/world/action',
        moverToken,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId: 'move-across-reactivation-slot',
            observationId: atContext.observationId,
            action: 'move',
            targetId: 'plant-context',
          }),
        },
      );
      const movingAcrossLiftBody = await json(movingAcrossLift);
      assert.equal(movingAcrossLift.status, 201, movingAcrossLiftBody.error);

      const reactivated = await postEvent(origin, {
        kind: 'task.assigned',
        agentId: 'dormant-spawn-resident',
        taskId: 'task-reactivated-during-spawn-sweep',
        payload: { objective: 'Resume in a trajectory-safe standing bay' },
      });
      const reactivatedBody = await json(reactivated);
      assert.equal(reactivated.status, 201, reactivatedBody.error);
      assertNavigationPathClearsPositions(movingAcrossLiftBody.event.payload, [
        reactivatedBody.event.payload.position,
      ]);
    },
  );

  await t.test(
    'reactivated movement starts from its bridge-authored override instead of its old endpoint',
    async () => {
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'run.started',
            reset: true,
            payload: {
              objective: 'Route from the current reactivation body position',
            },
          })
        ).status,
        201,
      );
      const residentSpawn = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'endpoint-mask-r',
        payload: { name: 'Endpoint Mask Resident', role: 'Resident' },
      });
      assert.equal(residentSpawn.status, 201);
      const residentToken = (await json(residentSpawn)).agentToken;
      const residentAtContext = await walkTo(
        origin,
        residentToken,
        'context-hub',
      );
      const residentToCommons = await boardRequest(
        origin,
        '/world/action',
        residentToken,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId: 'resident-terminal-route-to-commons',
            observationId: residentAtContext.observationId,
            action: 'move',
            targetId: 'commons',
          }),
        },
      );
      const residentToCommonsBody = await json(residentToCommons);
      assert.equal(residentToCommons.status, 201, residentToCommonsBody.error);
      const oldEndpoint = residentToCommonsBody.event.payload.toPosition;
      assert.equal(
        (
          await postEvent(origin, {
            kind: 'agent.completed',
            agentId: 'endpoint-mask-r',
            payload: { summary: 'Hold the completed Commons endpoint' },
          })
        ).status,
        201,
      );
      await new Promise((resolveWait) =>
        setTimeout(
          resolveWait,
          Math.max(
            0,
            Date.parse(residentToCommonsBody.event.payload.arrivesAt) -
              Date.now() +
              10,
          ),
        ),
      );

      const blockerSpawn = await postEvent(origin, {
        kind: 'agent.spawned',
        agentId: 'endpoint-mask-blocker',
        payload: { name: 'Endpoint Blocker', role: 'Resident' },
      });
      assert.equal(blockerSpawn.status, 201);
      const blockerToken = (await json(blockerSpawn)).agentToken;
      const blockerAtContext = await walkTo(
        origin,
        blockerToken,
        'context-hub',
      );
      const blockerToCommons = await boardRequest(
        origin,
        '/world/action',
        blockerToken,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId: 'blocker-claims-old-terminal-endpoint',
            observationId: blockerAtContext.observationId,
            action: 'move',
            targetId: 'commons',
          }),
        },
      );
      const blockerToCommonsBody = await json(blockerToCommons);
      assert.equal(blockerToCommons.status, 201, blockerToCommonsBody.error);
      assert.deepEqual(
        blockerToCommonsBody.event.payload.toPosition,
        oldEndpoint,
      );
      await new Promise((resolveWait) =>
        setTimeout(
          resolveWait,
          Math.max(
            0,
            Date.parse(blockerToCommonsBody.event.payload.arrivesAt) -
              Date.now() +
              10,
          ),
        ),
      );

      const reactivated = await postEvent(origin, {
        kind: 'task.assigned',
        agentId: 'endpoint-mask-r',
        taskId: 'task-route-from-reactivated-override',
        payload: { objective: 'Leave Commons from the available body slot' },
      });
      const reactivatedBody = await json(reactivated);
      assert.equal(reactivated.status, 201, reactivatedBody.error);
      assert.notDeepEqual(reactivatedBody.event.payload.position, oldEndpoint);
      assert.equal(
        capsulesOverlap(
          reactivatedBody.event.payload.position,
          blockerToCommonsBody.event.payload.toPosition,
        ),
        false,
      );

      const reactivatedScene = await observe(origin, residentToken);
      const leavesCommons = await boardRequest(
        origin,
        '/world/action',
        residentToken,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId: 'reactivated-route-uses-position-override',
            observationId: reactivatedScene.observationId,
            action: 'move',
            targetId: 'context-hub',
          }),
        },
      );
      const leavesCommonsBody = await json(leavesCommons);
      assert.equal(leavesCommons.status, 201, leavesCommonsBody.error);
      assert.deepEqual(
        leavesCommonsBody.event.payload.fromPosition,
        reactivatedBody.event.payload.position,
      );
      assertNavigationPathClearsPositions(leavesCommonsBody.event.payload, [
        blockerToCommonsBody.event.payload.toPosition,
      ]);
    },
  );
});

void test('continuous peer motion preserves fresh disjoint actions while exact conflicts yield', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-live-trajectory-'));
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
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'run.started',
        reset: true,
        payload: {
          objective: 'Match exit claims to exact trajectory admission',
        },
      })
    ).status,
    201,
  );

  const tokens = {};
  for (const [agentId, name, destination] of [
    ['west-motion', 'West Motion', 'hall-west'],
    ['east-mover-3', 'East Mover', 'hall-east'],
    ['east-witness-0', 'East Witness', 'hall-east'],
  ]) {
    const spawned = await postEvent(origin, {
      kind: 'agent.spawned',
      agentId,
      payload: { name, role: 'Trajectory verifier' },
    });
    assert.equal(spawned.status, 201);
    tokens[agentId] = (await json(spawned)).agentToken;
    await walkTo(origin, tokens[agentId], destination);
  }

  const westStartScene = await observe(origin, tokens['west-motion']);
  const westMove = await boardRequest(
    origin,
    '/world/action',
    tokens['west-motion'],
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'west-disjoint-trajectory',
        observationId: westStartScene.observationId,
        action: 'move',
        targetId: 'door-research',
      }),
    },
  );
  const westMoveBody = await json(westMove);
  assert.equal(westMove.status, 201, westMoveBody.error);

  const eastSceneDuringWestMotion = await observe(
    origin,
    tokens['east-mover-3'],
  );
  const advertisedOpenExit = eastSceneDuringWestMotion.exits.find(
    (exit) => exit.to === 'door-build',
  );
  assert.ok(advertisedOpenExit);
  assert.equal(advertisedOpenExit.available, true);
  assert.ok(['open', 'shared'].includes(advertisedOpenExit.status));
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.ok(
    Date.now() < Date.parse(westMoveBody.event.payload.arrivesAt),
    'the peer trajectory must still be continuously in flight',
  );
  assert.equal(
    (await observe(origin, tokens['east-mover-3'])).observationId,
    eastSceneDuringWestMotion.observationId,
    'continuous interpolation alone must not stale the observation',
  );

  const eastMove = await boardRequest(
    origin,
    '/world/action',
    tokens['east-mover-3'],
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'east-disjoint-trajectory',
        observationId: eastSceneDuringWestMotion.observationId,
        action: 'move',
        targetId: 'door-build',
      }),
    },
  );
  const eastMoveBody = await json(eastMove);
  assert.equal(eastMove.status, 201, eastMoveBody.error);
  assertNavigationPathIsSweptLegal(eastMoveBody.event.payload);

  const witnessScene = await observe(origin, tokens['east-witness-0']);
  const advertisedYield = witnessScene.exits.find(
    (exit) => exit.to === 'door-build',
  );
  assert.ok(advertisedYield);
  assert.ok(['yield', 'reserved'].includes(advertisedYield.status));
  assert.equal(advertisedYield.available, false);
  assert.deepEqual(
    [
      ...(advertisedYield.trafficBy ?? []),
      ...(advertisedYield.reservedBy ?? []),
    ].map((person) => person.id),
    ['east-mover-3'],
  );
  const conflictingMove = await boardRequest(
    origin,
    '/world/action',
    tokens['east-witness-0'],
    {
      method: 'POST',
      body: JSON.stringify({
        actionId: 'east-witness-yields-exact-path',
        observationId: witnessScene.observationId,
        action: 'move',
        targetId: 'door-build',
      }),
    },
  );
  assert.equal(conflictingMove.status, 409);
  assert.match(
    (await json(conflictingMove)).error,
    /(path is in use|route conflicts|occupied or reserved|yield)/iu,
  );
});

void test('trajectory admission reserves a new parked endpoint through a longer peer route', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-future-endpoint-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [bridgeScript, '--port', String(port), '--data-dir', dataDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ARENA_EMITTER_TOKEN: emitterToken,
        ARENA_TRAVEL_SPEED_PX_PER_SECOND: '500',
        ARENA_MIN_TRAVEL_MS: '1',
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
  assert.equal(
    (
      await postEvent(origin, {
        kind: 'run.started',
        reset: true,
        payload: { objective: 'Reserve endpoints across unequal route times' },
      })
    ).status,
    201,
  );

  const betaSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'horizon-c',
    payload: { name: 'Horizon B', role: 'Trajectory verifier' },
  });
  assert.equal(betaSpawn.status, 201);
  const betaToken = (await json(betaSpawn)).agentToken;
  await walkTo(origin, betaToken, 'hall-west');

  const alphaSpawn = await postEvent(origin, {
    kind: 'agent.spawned',
    agentId: 'horizon-a',
    payload: { name: 'Horizon A', role: 'Endpoint verifier' },
  });
  assert.equal(alphaSpawn.status, 201);
  const alphaToken = (await json(alphaSpawn)).agentToken;
  await walkTo(origin, alphaToken, 'context-hub');

  const betaScene = await observe(origin, betaToken);
  const betaMove = await boardRequest(origin, '/world/action', betaToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'long-hall-route-past-context-door',
      observationId: betaScene.observationId,
      action: 'move',
      targetId: 'hall-center',
    }),
  });
  const betaMoveBody = await json(betaMove);
  assert.equal(betaMove.status, 201, betaMoveBody.error);
  assert.deepEqual(betaMoveBody.event.payload.fromPosition, {
    x: 20.667,
    y: 50,
  });
  assert.deepEqual(betaMoveBody.event.payload.toPosition, {
    x: 47.75,
    y: 50,
  });

  const alphaScene = await observe(origin, alphaToken);
  const contextDoorExit = alphaScene.exits.find(
    (exit) => exit.to === 'door-context',
  );
  assert.ok(contextDoorExit);
  assert.equal(contextDoorExit.status, 'yield');
  assert.equal(contextDoorExit.available, false);
  assert.deepEqual(
    contextDoorExit.trafficBy.map((person) => person.id),
    ['horizon-c'],
  );
  const alphaMove = await boardRequest(origin, '/world/action', alphaToken, {
    method: 'POST',
    body: JSON.stringify({
      actionId: 'short-route-would-park-in-future-traffic',
      observationId: alphaScene.observationId,
      action: 'move',
      targetId: 'door-context',
    }),
  });
  assert.equal(alphaMove.status, 409);
  assert.match(
    (await json(alphaMove)).error,
    /(path is in use|route conflicts|occupied or reserved|yield)/iu,
  );
  assert.ok(
    Date.now() < Date.parse(betaMoveBody.event.payload.arrivesAt),
    'the accepted longer route must still be in flight when admission rejects the shorter route',
  );
});
