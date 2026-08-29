import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createServer as createViteServer } from 'vite';

import {
  STATIONS,
  WORLD_EDGES,
  buildArenaPath,
  slotForAgent,
  stationById,
} from '../lib/arena/agentic-catalog.ts';
import {
  capsuleIsWorldLegal,
  capsulesOverlap,
  resolveAvatarCollisions,
  worldCollisionIds,
} from '../lib/arena/agentic-spatial.ts';

function avatar(agentId, position, routeOrder = 0) {
  return {
    agentId,
    position,
    path: [],
    direction: 'south',
    isMoving: false,
    routeOrder,
    stationId: 'commons',
    lastStationId: 'commons',
  };
}

void test('station reservations never return an already reserved working slot', () => {
  const reserved = [];
  const assigned = ['ohm', 'dalton', 'sage', 'nova', 'kernel'].map(
    (agentId) => {
      const slot = slotForAgent('command-table', agentId, reserved);
      reserved.push(slot);
      return slot;
    },
  );
  assert.equal(
    new Set(assigned.map((slot) => `${slot.x}:${slot.y}`)).size,
    assigned.length,
  );
});

void test('lift arrivals stage in visually separated capsule slots', () => {
  const reserved = [];
  for (const agentId of ['atlas', 'ohm', 'dalton', 'sage', 'nova', 'kernel']) {
    const slot = slotForAgent('spawn-lift', agentId, reserved);
    for (const occupied of reserved) {
      assert.equal(capsulesOverlap(slot, occupied), false);
    }
    reserved.push(slot);
  }
});

void test('historical over-capacity hub replay keeps full character bodies apart', () => {
  const reserved = [];
  for (const agentId of ['lyra', 'morrow']) {
    const slot = slotForAgent('context-hub', agentId, reserved);
    assert.equal(
      capsuleIsWorldLegal(slot),
      true,
      `${agentId} replay slot collides with ${worldCollisionIds(slot).join(', ')}`,
    );
    for (const occupied of reserved) {
      assert.equal(capsulesOverlap(slot, occupied), false);
    }
    reserved.push(slot);
  }
});

void test('collective capsule resolution separates conflicting proposals', () => {
  const previous = [
    avatar('atlas', { x: 45, y: 50 }, 0),
    avatar('sage', { x: 49, y: 50 }, 1),
    avatar('nova', { x: 53, y: 50 }, 2),
  ];
  const proposals = previous.map((item) => ({
    ...item,
    position: { x: 50, y: 50 },
    isMoving: true,
  }));
  const resolved = resolveAvatarCollisions(previous, proposals, 32);
  assert.deepEqual(resolved[0].position, proposals[0].position);
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      assert.equal(
        capsulesOverlap(resolved[left].position, resolved[right].position),
        false,
      );
    }
  }
  assert.ok(resolved.some((item) => item.isYielding));
});

void test('all station slots and semantic edge routes clear static world geometry', () => {
  for (const station of STATIONS) {
    for (const slot of station.slots) {
      assert.equal(
        capsuleIsWorldLegal(slot),
        true,
        `${station.id} slot collides with ${worldCollisionIds(slot).join(', ')}`,
      );
    }
  }

  for (const edge of WORLD_EDGES) {
    for (const [fromId, toId] of [edge, [edge[1], edge[0]]]) {
      const fromStation = stationById(fromId);
      const toStation = stationById(toId);
      const isLiftPortal =
        new Set([fromId, toId]).has('spawn-lift') &&
        new Set([fromId, toId]).has('context-hub');
      if (isLiftPortal) {
        assert.equal(capsuleIsWorldLegal(fromStation.slots[0]), true);
        assert.equal(capsuleIsWorldLegal(toStation.slots[0]), true);
        continue;
      }
      let previous = fromStation.slots[0];
      const path = buildArenaPath(
        previous,
        toStation.slots[0],
        fromId,
        toId,
      );
      for (const target of path) {
        const dx = ((target.x - previous.x) / 100) * 768;
        const dy = ((target.y - previous.y) / 100) * 448;
        const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
        for (let sample = 0; sample <= samples; sample += 1) {
          const progress = sample / samples;
          const point = {
            x: previous.x + (target.x - previous.x) * progress,
            y: previous.y + (target.y - previous.y) * progress,
          };
          assert.equal(
            capsuleIsWorldLegal(point),
            true,
            `${fromId}->${toId} collides with ${worldCollisionIds(point).join(', ')}`,
          );
        }
        previous = target;
      }
    }
  }

  const lift = stationById('spawn-lift');
  for (const slot of lift.slots) {
    const pixelY = (slot.y / 100) * 448;
    assert.equal(capsuleIsWorldLegal(slot), true);
    assert.ok(pixelY >= 432 && pixelY <= 434);
  }
});

void test('visible commons walls and closed lift are not walkable floor', () => {
  const noWalkPoints = [
    { id: 'west wall face', position: { x: 45, y: 64 } },
    { id: 'east wall face', position: { x: 55, y: 64 } },
    { id: 'closed lift', position: { x: 50, y: 86 } },
  ];
  for (const sample of noWalkPoints) {
    assert.equal(
      capsuleIsWorldLegal(sample.position),
      false,
      `${sample.id} was incorrectly classified as floor`,
    );
  }
  assert.equal(capsuleIsWorldLegal({ x: 50, y: 57.143 }), true);
  assert.equal(capsuleIsWorldLegal({ x: 50, y: 75 }), true);
});

void test('world collision resolution rejects a capsule displaced into a doorway jamb', () => {
  const previous = avatar('vesper', { x: 50, y: 57.143 });
  const proposed = {
    ...previous,
    position: { x: 47.5, y: 57.143 },
    isMoving: true,
  };
  assert.ok(worldCollisionIds(proposed.position).some((id) => id.includes('jamb')));
  const [resolved] = resolveAvatarCollisions([previous], [proposed], 32);
  assert.equal(capsuleIsWorldLegal(resolved.position), true);
  assert.notDeepEqual(resolved.position, proposed.position);
});

void test('navigation owns location until arrival and reassignment restores the authoritative place', async () => {
  const vite = await createViteServer({
    root: resolve(import.meta.dirname, '..'),
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  const { agentArenaReducer, createAgentArenaState } = await vite.ssrLoadModule(
    '/lib/arena/agentic-reducer.ts',
  );
  const base = Date.now();
  const event = (sequence, kind, payload, extra = {}) => ({
    eventId: `event-${sequence}`,
    runId: 'run-embodied',
    sequence,
    occurredAt: new Date(base + sequence * 100).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(1, 'run.started', { objective: 'Navigate causally' }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        2,
        'agent.spawned',
        { name: 'Sage', role: 'Research lead' },
        { agentId: 'sage' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        3,
        'task.assigned',
        { objective: 'Inspect the archive' },
        { agentId: 'sage', taskId: 'task-one' },
      ),
    });
    const beforeSpeech = {
      agent: state.agents[0],
      avatar: state.avatars[0],
    };
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        4,
        'proximity.spoken',
        {
          actionId: 'say-one',
          observationId: 'obs-social',
          speechId: 'speech-one',
          speechAct: 'say',
          speakerLocationId: 'spawn-lift',
          targetLocationId: 'spawn-lift',
          targetAgentId: 'atlas',
          heardByAgentIds: ['atlas'],
          distancePx: 10,
          text: 'A situated utterance.',
          preview: 'A situated utterance.',
        },
        { agentId: 'sage' },
      ),
    });
    assert.deepEqual(state.agents[0], beforeSpeech.agent);
    assert.deepEqual(state.avatars[0], beforeSpeech.avatar);

    const startedAt = new Date(base + 400).toISOString();
    const arrivesAt = new Date(base + 60_000).toISOString();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        5,
        'world.navigation',
        {
          actionId: 'move-one',
          observationId: 'obs-one',
          fromLocationId: 'spawn-lift',
          toLocationId: 'context-hub',
          startedAt,
          arrivesAt,
        },
        { agentId: 'sage' },
      ),
    });
    assert.equal(state.agents[0].currentLocationId, 'spawn-lift');
    assert.equal(state.avatars[0].targetStationId, 'context-hub');
    assert.equal(state.avatars[0].portalTransfer, true);
    assert.equal(capsuleIsWorldLegal(state.avatars[0].position), true);

    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        6,
        'agent.completed',
        { summary: 'First assignment complete' },
        { agentId: 'sage' },
      ),
    });
    assert.equal(state.avatars.length, 0);

    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: {
        ...event(
          7,
          'task.assigned',
          { objective: 'Continue from the current place' },
          { agentId: 'sage', taskId: 'task-two' },
        ),
        occurredAt: new Date(base + 70_000).toISOString(),
      },
    });
    assert.equal(state.agents[0].currentLocationId, 'context-hub');
    assert.equal(state.agents[0].navigation, undefined);
    assert.equal(state.avatars[0].stationId, 'context-hub');
    assert.equal(state.avatars[0].isMoving, false);
  } finally {
    await vite.close();
  }
});
