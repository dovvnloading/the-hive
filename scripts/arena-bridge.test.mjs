import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const bridgeScript = resolve(import.meta.dirname, 'arena-bridge.mjs');
const trustedOrigin = 'http://localhost:3000';
const hostileOrigin = 'https://untrusted.example';
const emitterToken = 'test-emitter-token-with-at-least-thirty-two-characters';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolveClose) => probe.close(resolveClose));
  if (!port) throw new Error('Unable to reserve a test port');
  return port;
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Bridge exited with ${child.exitCode}`);
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

test('bridge authenticates emitters, restricts CORS, and preserves monotonic runs', async (t) => {
  const port = await availablePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'hive-bridge-'));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [bridgeScript, '--port', String(port), '--data-dir', dataDir], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ARENA_EMITTER_TOKEN: emitterToken,
      ARENA_ALLOWED_ORIGINS: trustedOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

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
    { kind: 'run.started', reset: true, payload: { objective: 'unauthorized' } },
    null,
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await json(await fetch(`${origin}/health`))).latestSequence, 0);

  const hostile = await fetch(`${origin}/health`, { headers: { Origin: hostileOrigin } });
  assert.equal(hostile.headers.get('access-control-allow-origin'), null);
  const trusted = await fetch(`${origin}/health`, { headers: { Origin: trustedOrigin } });
  assert.equal(trusted.headers.get('access-control-allow-origin'), trustedOrigin);

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
  assert.deepEqual(current.events.map((event) => event.sequence), [3]);
  assert.equal(current.events[0].kind, 'run.started');
});
