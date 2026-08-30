import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createServer as createViteServer } from 'vite';

import {
  FACILITY_COLLISION_GEOMETRY,
  FACILITY_LIGHT_LAYOUT,
  FACILITY_PROPS,
  FACILITY_RESOURCES,
  LIGHT_SWITCH_REACH_PX,
  STATIONS,
  WORLD_EDGES,
  buildArenaPath,
  isFacilityPortalTransfer,
  slotForAgent,
  stationById,
} from '../lib/arena/agentic-catalog.ts';
import {
  capsuleIsWorldLegal,
  capsulesOverlap,
  resolveAvatarCollisions,
  worldCollisionIds,
} from '../lib/arena/agentic-spatial.ts';
import {
  NORTH_CHAIR_FOREGROUND_HEIGHT,
  seatedFrameOffset,
  seatedFrameHeight,
  seatedFrameWidth,
  seatedMotionFor,
  seatedSheetMotion,
  sideChairForegroundCrop,
} from '../lib/arena/seated-presentation.ts';
import { runArenaSpatialAudit } from './arena-spatial-audit.mjs';

void test('build plant remains outside the doorway opening and approach lane', () => {
  const doorway = FACILITY_COLLISION_GEOMETRY.southDoors.find(
    (door) => door.locationId === 'door-build',
  );
  const plant = FACILITY_COLLISION_GEOMETRY.solids.find(
    (solid) => solid.id === 'build-plant-body',
  );

  assert.ok(doorway);
  assert.ok(plant);

  const openingLeft = doorway.centerX - doorway.width / 2;
  const openingRight = doorway.centerX + doorway.width / 2;
  const plantRight = plant.x + plant.w;
  const plantOutsideOpening =
    plantRight <= openingLeft || plant.x >= openingRight;
  assert.equal(plantOutsideOpening, true);

  const approachCenter = { x: doorway.centerX / 7.68, y: 74.107 };
  assert.equal(
    worldCollisionIds(approachCenter).includes('build-plant-body'),
    false,
  );
});

void test('portal residents stage beside every doorway instead of inside its opening', () => {
  const doors = STATIONS.filter((station) => station.kind === 'portal');
  assert.equal(doors.length, 6);
  for (const door of doors) {
    assert.equal(door.roomId, 'corridor');
    assert.equal(door.slots.length, 1);
    const staging = door.slots[0];
    assert.equal(staging.y, 50);
    assert.equal(capsuleIsWorldLegal(staging), true);
    const horizontalClearancePx =
      Math.abs(staging.x - door.position.x) * (768 / 100);
    assert.ok(
      horizontalClearancePx >= 31,
      `${door.id} staging bay clears the 36px doorway and 10px body capsule`,
    );
  }
});

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

void test('station reservations return distinct capsule-safe working slots', () => {
  const reserved = [];
  const assigned = ['ohm', 'dalton', 'sage', 'nova', 'kernel'].map(
    (agentId) => {
      const slot = slotForAgent('command-table', agentId, reserved);
      assert.equal(capsuleIsWorldLegal(slot), true);
      for (const occupied of reserved) {
        assert.equal(capsulesOverlap(slot, occupied), false);
      }
      reserved.push(slot);
      return slot;
    },
  );
  assert.equal(
    new Set(assigned.map((slot) => `${slot.x}:${slot.y}`)).size,
    assigned.length,
  );
});

void test('coverage audit exercises the full navmesh, routes, doors, overflow, and swept motion', () => {
  const { report } = runArenaSpatialAudit({ motionSweeps: 256 });
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.equal(report.coverage.components.length, 1);
  assert.equal(report.coverage.unseededComponents.length, 0);
  assert.equal(report.stationSlots.illegal.length, 0);
  assert.equal(report.doors.length, 6);
  assert.ok(
    report.doors.every(
      (door) => door.centerlineLegal && door.minimumCapsuleLaneWidthPx >= 15,
    ),
  );
  assert.ok(report.routes.variants > 200);
  assert.ok(report.routes.sampledPoints > 50_000);
  assert.equal(report.routes.failures.length, 0);
  assert.equal(report.reservations.placements, STATIONS.length * 4);
  assert.equal(report.reservations.failures.length, 0);
  assert.equal(report.motion.sweeps, 256);
  assert.ok(report.motion.blockedChords > 0);
  assert.ok(report.motion.clearChords > 0);
  assert.equal(report.motion.failures.length, 0);
});

void test('Commons arrivals stage in visually separated capsule slots', () => {
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
      if (isFacilityPortalTransfer(fromId, toId)) {
        assert.equal(capsuleIsWorldLegal(fromStation.slots[0]), true);
        assert.equal(capsuleIsWorldLegal(toStation.slots[0]), true);
        continue;
      }
      let previous = fromStation.slots[0];
      const path = buildArenaPath(previous, toStation.slots[0], fromId, toId);
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

  const arrival = stationById('spawn-lift');
  for (const slot of arrival.slots) {
    const pixelY = (slot.y / 100) * 448;
    assert.equal(capsuleIsWorldLegal(slot), true);
    assert.ok(pixelY >= 339 && pixelY <= 341);
  }
});

void test('seated resources stage walkers outside their seat collision bodies', () => {
  const seatedResources = FACILITY_RESOURCES.filter(
    (resource) => resource.seatedPositions?.length,
  );
  assert.ok(seatedResources.length > 0);

  for (const resource of seatedResources) {
    assert.equal(
      resource.slots.length,
      resource.seatedPositions.length,
      `${resource.id} needs one seated projection per standing slot`,
    );
    assert.equal(
      resource.seatedDirections?.length,
      resource.seatedPositions.length,
      `${resource.id} needs one authored facing direction per chair`,
    );
    resource.slots.forEach((slot, index) => {
      const seat = resource.seatedPositions[index];
      assert.notDeepEqual(
        slot,
        seat,
        `${resource.id} still walks directly onto its chair`,
      );
      assert.equal(
        capsuleIsWorldLegal(slot),
        true,
        `${resource.id} standing approach collides with ${worldCollisionIds(slot).join(', ')}`,
      );
      assert.ok(
        worldCollisionIds(seat).some(
          (id) => id.startsWith('chair-') || id.endsWith('-sofa-body'),
        ),
        `${resource.id} seated projection is not anchored to a seat body`,
      );
    });
  }
});

void test('Research workstation routes stay west of the full desk body', () => {
  const workstation = FACILITY_COLLISION_GEOMETRY.solids.find(
    (solid) => solid.id === 'research-desk-b-body',
  );
  const hub = stationById('research-hub');
  const light = stationById('room-light-research');
  const computer = stationById('research-computer-b');

  assert.deepEqual(workstation, {
    id: 'research-desk-b-body',
    x: 190,
    y: 108,
    w: 54,
    h: 40,
  });
  assert.ok(light.slots[0].x < (190 / 768) * 100);
  assert.ok(computer.slots[0].x < (190 / 768) * 100);

  for (const { target, targetId } of [
    { target: light.slots[0], targetId: 'room-light-research' },
    { target: computer.slots[0], targetId: 'research-computer-b' },
  ]) {
    let previous = hub.slots[0];
    for (const point of buildArenaPath(
      previous,
      target,
      'research-hub',
      targetId,
    )) {
      const samples = Math.max(
        1,
        Math.ceil(
          Math.hypot(
            ((point.x - previous.x) / 100) * 768,
            ((point.y - previous.y) / 100) * 448,
          ),
        ),
      );
      for (let sample = 0; sample <= samples; sample += 1) {
        const progress = sample / samples;
        const candidate = {
          x: previous.x + (point.x - previous.x) * progress,
          y: previous.y + (point.y - previous.y) * progress,
        };
        assert.equal(
          worldCollisionIds(candidate).includes('research-desk-b-body'),
          false,
          `${targetId} route enters the Research workstation`,
        );
      }
      previous = point;
    }
  }
});

void test('every authored chair selects the matching directional seated sheet', () => {
  const directionsByResource = Object.fromEntries(
    FACILITY_RESOURCES.filter(
      (resource) => resource.seatedPositions?.length,
    ).map((resource) => [resource.id, resource.seatedDirections]),
  );
  assert.deepEqual(directionsByResource, {
    'archive-desk': ['south'],
    'research-computer-b': ['north'],
    'command-table': ['west', 'east'],
    'shell-console-a': ['north'],
    'connector-console-b': ['north'],
    'synthesis-lounge': ['south'],
    'publish-console': ['north'],
    'build-bench-a': ['north'],
    'verify-rig-b': ['north'],
  });

  assert.equal(seatedMotionFor('north', true), 'sit_back');
  assert.equal(seatedMotionFor('south', false), 'sit_front');
  assert.equal(seatedMotionFor('east', false), 'sit');
  assert.equal(seatedMotionFor('west', true), 'sit2');
  assert.equal(seatedFrameWidth('sit_back'), 16);
  assert.equal(seatedFrameWidth('sit'), 32);
  assert.equal(seatedFrameHeight('sit_back'), 27);
  assert.equal(seatedFrameHeight('sit_front'), 32);
  assert.equal(seatedSheetMotion('sit_back'), 'idle_anim');
  assert.equal(seatedFrameOffset('sit_back', 'north'), 6);
  assert.equal(seatedFrameOffset('sit_front', 'south'), 18);
  assert.equal(seatedFrameOffset('sit', 'east'), 0);
  assert.equal(seatedFrameOffset('sit2', 'west'), 6);
  assert.equal(NORTH_CHAIR_FOREGROUND_HEIGHT, 32);
  assert.deepEqual(sideChairForegroundCrop('east'), {
    x: 0,
    y: 0,
    width: 6,
    height: 32,
  });
  assert.deepEqual(sideChairForegroundCrop('west'), {
    x: 16,
    y: 0,
    width: 6,
    height: 32,
  });

  const commandTable = FACILITY_RESOURCES.find(
    (resource) => resource.id === 'command-table',
  );
  assert.deepEqual(commandTable?.capabilities, ['review']);
  assert.deepEqual(commandTable?.seatedPositions, [
    { x: 49.219, y: 33.929 },
    { x: 42.188, y: 33.929 },
  ]);
  const commandSeatPixels = commandTable.seatedPositions.map((seat) =>
    Math.round((seat.x / 100) * 768),
  );
  assert.deepEqual(commandSeatPixels, [378, 324]);
  assert.equal(
    commandSeatPixels[0] + commandSeatPixels[1],
    351 * 2,
    'Command seated projections must mirror around the planning table',
  );
  const commandWestChair = FACILITY_COLLISION_GEOMETRY.solids.find(
    (solid) => solid.id === 'chair-command-west-body',
  );
  const commandEastChair = FACILITY_COLLISION_GEOMETRY.solids.find(
    (solid) => solid.id === 'chair-command-east-body',
  );
  assert.ok(commandWestChair);
  assert.ok(commandEastChair);
  const commandTableCenterX = 351;
  assert.equal(
    commandWestChair.x,
    commandTableCenterX * 2 - (commandEastChair.x + commandEastChair.w),
    'Command chair collision bodies must mirror around the planning table',
  );

  const publish = FACILITY_RESOURCES.find(
    (resource) => resource.id === 'publish-console',
  );
  assert.deepEqual(publish?.seatedPositions, [{ x: 32.161, y: 81.027 }]);

  const lounge = FACILITY_RESOURCES.find(
    (resource) => resource.id === 'synthesis-lounge',
  );
  assert.deepEqual(lounge?.seatedPositions, [{ x: 9.635, y: 83.036 }]);

  const clonedNorthWorkstations = [
    ['research-computer-b', 214, 130],
    ['shell-console-a', 470, 130],
    ['connector-console-b', 686, 130],
    ['build-bench-a', 473, 367],
    ['verify-rig-b', 678, 367],
  ];
  for (const [resourceId, chairX, chairY] of clonedNorthWorkstations) {
    const resource = FACILITY_RESOURCES.find(
      (candidate) => candidate.id === resourceId,
    );
    assert.ok(resource);
    assert.deepEqual(resource.seatedDirections, ['north']);
    assert.equal(
      Math.round((resource.seatedPositions[0].x / 100) * 768),
      chairX + 10,
      `${resourceId} must retain the proven north-chair horizontal anchor`,
    );
    assert.equal(
      Math.round((resource.seatedPositions[0].y / 100) * 448),
      chairY + 14,
      `${resourceId} must retain the proven north-chair vertical anchor`,
    );
  }
});

void test('only authored chairs seat residents and every light switch has a reachable standing point', () => {
  const unseatedTables = FACILITY_RESOURCES.filter(
    (resource) =>
      resource.kind === 'table' && !resource.seatedPositions?.length,
  );
  assert.deepEqual(
    unseatedTables.map((resource) => resource.id),
    [],
  );

  const roomLights = FACILITY_PROPS.filter(
    (entity) => entity.kind === 'room-light',
  );
  assert.equal(roomLights.length, Object.keys(FACILITY_LIGHT_LAYOUT).length);
  for (const light of roomLights) {
    const layout = FACILITY_LIGHT_LAYOUT[light.roomId];
    assert.ok(layout, `${light.id} has no shared visual layout`);
    assert.deepEqual(light.position, layout.standPosition);
    assert.deepEqual(light.controlPosition, layout.controlPosition);
    assert.equal(
      capsuleIsWorldLegal(light.position),
      true,
      `${light.id} standing point collides with ${worldCollisionIds(light.position).join(', ')}`,
    );
    const dx = ((light.position.x - light.controlPosition.x) / 100) * 768;
    const dy = ((light.position.y - light.controlPosition.y) / 100) * 448;
    assert.ok(
      Math.hypot(dx, dy) <= LIGHT_SWITCH_REACH_PX,
      `${light.id} is too far from its wall switch`,
    );
  }
});

void test('v3 back walls remain solid while the Commons arrival area stays open', () => {
  assert.equal(
    FACILITY_COLLISION_GEOMETRY.solids.some(
      (solid) => solid.id === 'lift-face',
    ),
    false,
  );
  const noWalkPoints = [
    { id: 'north back wall', position: { x: 18.75, y: 10 } },
    { id: 'south back wall', position: { x: 26, y: 60 } },
  ];
  for (const sample of noWalkPoints) {
    assert.equal(
      capsuleIsWorldLegal(sample.position),
      false,
      `${sample.id} was incorrectly classified as floor`,
    );
  }
  assert.equal(capsuleIsWorldLegal({ x: 44.792, y: 52 }), true);
  assert.equal(capsuleIsWorldLegal({ x: 44.792, y: 75.893 }), true);
  assert.equal(capsuleIsWorldLegal({ x: 53.125, y: 75.893 }), true);
});

void test('world collision resolution rejects motion from a portal endpoint into its wall', () => {
  const previous = avatar('vesper', { x: 44.792, y: 52 });
  const proposed = {
    ...previous,
    position: { x: 49, y: 60 },
    isMoving: true,
  };
  assert.ok(
    worldCollisionIds(proposed.position).includes('back-wall-context-east'),
  );
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

    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        8,
        'world.navigation',
        {
          actionId: 'move-door',
          observationId: 'obs-door',
          fromLocationId: 'context-hub',
          toLocationId: 'door-context',
          startedAt: new Date(base + 70_100).toISOString(),
          arrivesAt: new Date(base + 71_000).toISOString(),
        },
        { agentId: 'sage' },
      ),
    });
    assert.equal(state.avatars[0].portalTransfer, true);
    assert.equal(state.avatars[0].routeDelayMs, 260);
    assert.equal(capsuleIsWorldLegal(state.avatars[0].position), true);
  } finally {
    await vite.close();
  }
});
