import assert from 'node:assert/strict';
import test from 'node:test';
import {
  constrainCamera,
  FIT_CAMERA,
  focusCamera,
  zoomCamera,
} from '../lib/arena/camera.ts';

await test('camera stays inside world bounds at every zoom level', () => {
  for (const zoom of [-2, 1, 1.25, 2, 3, 8]) {
    for (const x of [-1000, -40, 0, 40, 1000]) {
      const camera = constrainCamera({ zoom, x, y: -x });
      assert.ok(camera.zoom >= 1 && camera.zoom <= 3);
      assert.ok(Math.abs(camera.x) <= (camera.zoom - 1) * 50);
      assert.ok(Math.abs(camera.y) <= (camera.zoom - 1) * 50);
    }
  }
});

await test('zoom keeps the point under the cursor fixed when bounds allow it', () => {
  const camera = { zoom: 1.5, x: 5, y: -8 };
  const anchor = { x: 15, y: -5 };
  const result = zoomCamera(camera, 2.5, anchor);
  assert.ok(
    Math.abs(
      (anchor.x - camera.x) / camera.zoom - (anchor.x - result.x) / result.zoom,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      (anchor.y - camera.y) / camera.zoom - (anchor.y - result.y) / result.zoom,
    ) < 1e-10,
  );
});

await test('zooming back to Fit always resets pan', () => {
  assert.deepEqual(zoomCamera({ zoom: 3, x: 90, y: -70 }, 1), FIT_CAMERA);
});

await test('focus centers a resident and subsequent zoom preserves that center', () => {
  const camera = focusCamera({ x: 40, y: 60 }, 1.8);
  assert.deepEqual(camera, { zoom: 1.8, x: 18, y: -18 });
  const result = zoomCamera(camera, 2.05);
  assert.equal(result.zoom, 2.05);
  assert.ok(Math.abs((40 - 50) * result.zoom + result.x) < 1e-10);
  assert.ok(Math.abs((60 - 50) * result.zoom + result.y) < 1e-10);
});

await test('focusing an edge never exposes space beyond the floor', () => {
  assert.deepEqual(focusCamera({ x: 0, y: 100 }, 2), {
    zoom: 2,
    x: 50,
    y: -50,
  });
});

await test('idle projection preserves references while factual arrivals and departures refresh proximity', async () => {
  const { createServer } = await import('vite');
  const path = await import('node:path');
  const vite = await createServer({
    root: path.resolve(import.meta.dirname, '..'),
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    const { agentArenaReducer, createAgentArenaState } =
      await vite.ssrLoadModule('/lib/arena/agentic-reducer.ts');
    let state = createAgentArenaState();
    let sequence = 0;
    const apply = (kind, payload, agentId) => {
      sequence += 1;
      state = agentArenaReducer(state, {
        type: 'runtime.event',
        event: {
          schemaVersion: 1,
          eventId: `unit-camera-${sequence}`,
          runId: 'unit-camera-projection',
          sequence,
          occurredAt: new Date().toISOString(),
          source: 'codex',
          kind,
          payload,
          agentId,
        },
      });
    };
    apply('run.started', { objective: 'Pure reducer regression fixture' });
    apply(
      'agent.spawned',
      { name: 'First fixture', role: 'review', position: { x: 50, y: 80 } },
      'fixture-a',
    );
    apply(
      'agent.spawned',
      { name: 'Second fixture', role: 'review', position: { x: 52, y: 80 } },
      'fixture-b',
    );
    assert.deepEqual(
      state.avatars.find((avatar) => avatar.agentId === 'fixture-a')
        .nearbyAgentIds,
      ['fixture-b'],
    );
    const before = state;
    for (let tick = 0; tick < 100; tick += 1) {
      state = agentArenaReducer(state, {
        type: 'projection.tick',
        now: Date.now() + tick * 34,
      });
      assert.strictEqual(state, before);
    }
    apply('agent.completed', { summary: 'Fixture removal only' }, 'fixture-b');
    assert.equal(state.avatars.length, 1);
    assert.deepEqual(state.avatars[0].nearbyAgentIds, []);
    const after = state;
    assert.strictEqual(
      agentArenaReducer(state, { type: 'projection.tick', now: Date.now() }),
      after,
    );
  } finally {
    await vite.close();
  }
});
