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
  activitiesForResource,
  activityForCapability,
  allocatePresentationIndex,
  buildArenaPath,
  doorwayTraversalDistancePx,
  isFacilityPortalTransfer,
  inferToolCapability,
  slotForAgent,
  stationById,
} from '../lib/arena/agentic-catalog.ts';
import {
  FACILITY_SPAWN_QUEUE_SLOTS,
  RESIDENT_BODY_CLEARANCE_PX,
  activityById,
  activityForResource,
  facilityPathIsSweptLegal,
  selectFacilityActivity,
} from '../lib/arena/facility-protocol.mjs';
import {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_WIDTH,
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

void test('concurrent residents receive distinct character sheets', () => {
  const occupied = [];
  for (const agentId of [
    'orion_live_02',
    'vesper_live_02',
    'lyra_live_02',
    'atlas',
  ]) {
    occupied.push(allocatePresentationIndex(agentId, occupied));
  }
  assert.equal(new Set(occupied).size, 4);
});

void test('facility activities are unique, capability-backed, and physically discoverable', () => {
  const allowedArtifactKinds = new Set([
    'source-note',
    'change',
    'test-result',
    'decision',
  ]);
  const activityIds = new Set();
  for (const resource of FACILITY_RESOURCES) {
    const activities = activitiesForResource(resource.id);
    for (const activity of activities) {
      assert.equal(activityIds.has(activity.id), false, activity.id);
      assert.equal(
        resource.capabilities.includes(activity.capability),
        true,
        `${activity.id} is not backed by ${resource.id}`,
      );
      const capabilityMatches = activities.filter(
        (candidate) => candidate.capability === activity.capability,
      );
      assert.equal(
        activityForCapability(resource.id, activity.capability)?.id,
        capabilityMatches.length === 1 ? activity.id : undefined,
      );
      assert.equal(activityById(activity.id), activity);
      assert.equal(activityForResource(resource.id, activity.id), activity);
      assert.equal(
        selectFacilityActivity(resource.id, {
          activityId: activity.id,
          capability: activity.capability,
        }),
        activity,
      );
      assert.equal(typeof activity.description, 'string');
      assert.ok(activity.description.length > 20);
      assert.equal(typeof activity.proofPolicy.requiredOnSuccess, 'boolean');
      assert.equal(
        activity.proofPolicy.artifactKinds.every((kind) =>
          allowedArtifactKinds.has(kind),
        ),
        true,
      );
      activityIds.add(activity.id);
    }
  }

  assert.equal(activityById('activity-that-does-not-exist'), undefined);
  assert.equal(
    activityForResource('shell-console-a', 'research.search-primary-sources'),
    undefined,
  );
  assert.equal(
    selectFacilityActivity('research-computer-b', {
      activityId: 'research.search-primary-sources',
      capability: 'filesystem',
    }),
    undefined,
  );

  assert.deepEqual(
    [...activityIds].sort((left, right) => left.localeCompare(right)),
    [
      'archive.review-local-evidence',
      'build.compile-project',
      'build.implement-linked-change',
      'command.reconcile-evidence',
      'connector.query-configured-service',
      'lounge.review-linked-evidence',
      'publish.record-decision',
      'publish.review-evidence-chain',
      'research.browse-authoritative-source',
      'research.search-primary-sources',
      'shell.inspect-project-state',
      'shell.run-scoped-command',
      'verify.independent-review',
      'verify.run-scoped-validation',
    ],
  );
  assert.equal(inferToolCapability('review'), 'review');
  assert.equal(inferToolCapability('code review'), 'review');
  assert.equal(inferToolCapability('view file'), 'read');
  assert.equal(inferToolCapability('audit'), 'test');

  for (const propId of ['utility-tools-board', 'build-verification-chart']) {
    const prop = FACILITY_PROPS.find((candidate) => candidate.id === propId);
    assert.ok(prop, `${propId} is not in the authoritative facility catalog`);
    assert.equal(
      prop.interactions.some(({ verb }) => verb === 'inspect'),
      true,
    );
    assert.equal(capsuleIsWorldLegal(prop.slots[0]), true);
    assert.equal(
      WORLD_EDGES.some(
        ([left, right]) =>
          (left === prop.id && right === `${prop.roomId}-hub`) ||
          (right === prop.id && left === `${prop.roomId}-hub`),
      ),
      true,
    );
  }
});

void test('four simultaneous arrivals receive capsule-safe Commons positions', () => {
  const occupied = [];
  for (const agentId of ['orion', 'vesper', 'lyra', 'atlas']) {
    const position = slotForAgent('spawn-lift', agentId, occupied);
    assert.equal(capsuleIsWorldLegal(position), true);
    assert.equal(
      occupied.every((candidate) => !capsulesOverlap(position, candidate)),
      true,
    );
    assert.ok(position.y > 70, 'arrival overflow remains inside Commons');
    occupied.push(position);
  }
});

void test('every authored Commons arrival lane preserves body clearance and a swept exit', () => {
  const liftSlots = stationById('spawn-lift').slots;
  const allSpawnPositions = [...liftSlots, ...FACILITY_SPAWN_QUEUE_SLOTS];
  assert.equal(allSpawnPositions.length, 4);
  for (let left = 0; left < allSpawnPositions.length; left += 1) {
    for (let right = left + 1; right < allSpawnPositions.length; right += 1) {
      assert.ok(
        pixelDistance(allSpawnPositions[left], allSpawnPositions[right]) >=
          RESIDENT_BODY_CLEARANCE_PX,
        `spawn slots ${left} and ${right} are less than ${RESIDENT_BODY_CLEARANCE_PX}px apart`,
      );
      assert.equal(
        capsulesOverlap(allSpawnPositions[left], allSpawnPositions[right]),
        false,
      );
    }
  }

  const contextHub = stationById('context-hub').slots[0];
  const plantTarget = stationById('plant-context').slots[0];
  const westSlot = FACILITY_SPAWN_QUEUE_SLOTS.find(
    (slot) => slot.x <= 47 && slot.y < 80,
  );
  const lowSlot = FACILITY_SPAWN_QUEUE_SLOTS.find((slot) => slot.y > 80);
  assert.ok(westSlot);
  assert.ok(lowSlot);
  assert.ok(
    pixelDistance(lowSlot, plantTarget) >= RESIDENT_BODY_CLEARANCE_PX,
    'the low spawn queue bay must not block the Commons plant target',
  );
  assert.equal(capsulesOverlap(lowSlot, plantTarget), false);

  const westExit = buildArenaPath(
    westSlot,
    contextHub,
    'spawn-lift',
    'context-hub',
  );
  assert.deepEqual(westExit, [contextHub], 'the west bay has direct egress');

  const lowExit = buildArenaPath(
    lowSlot,
    contextHub,
    'spawn-lift',
    'context-hub',
  );
  const lowReturn = buildArenaPath(
    contextHub,
    lowSlot,
    'context-hub',
    'spawn-lift',
  );
  assert.deepEqual(lowExit.slice(0, 2), [
    { x: 44.661, y: 89.286 },
    { x: 44.661, y: 74.107 },
  ]);
  assert.equal(facilityPathIsSweptLegal(lowSlot, lowExit), true);
  assert.equal(facilityPathIsSweptLegal(contextHub, lowReturn), true);

  const mainLiftExit = buildArenaPath(
    liftSlots[0],
    contextHub,
    'spawn-lift',
    'context-hub',
  );
  assert.deepEqual(mainLiftExit.slice(0, 2), [
    { x: 52.083, y: 74.5 },
    { x: 47, y: 74.5 },
  ]);
  assert.equal(facilityPathIsSweptLegal(liftSlots[0], mainLiftExit), true);
});

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

void test('portal residents stage legally on every doorway centerline at the corridor mouth', () => {
  const doors = STATIONS.filter((station) => station.kind === 'portal');
  assert.equal(doors.length, 6);
  for (const door of doors) {
    assert.equal(door.roomId, 'corridor');
    assert.equal(door.slots.length, 1);
    const staging = door.slots[0];
    assert.equal(staging.x, door.position.x);
    assert.equal(staging.y, 50);
    assert.equal(capsuleIsWorldLegal(staging), true);
  }
});

void test('every occupied portal has collision-free room egress past coexisting adjacent corridor residents', () => {
  const doors = STATIONS.filter((station) => station.kind === 'portal');
  for (const door of doors) {
    const neighbors = WORLD_EDGES.filter((edge) => edge.includes(door.id)).map(
      (edge) => edge.find((stationId) => stationId !== door.id),
    );
    const hub = neighbors
      .map((stationId) => stationById(stationId))
      .find((station) => station.roomId !== 'corridor');
    const corridor = neighbors
      .map((stationId) => stationById(stationId))
      .find(
        (station) =>
          station.roomId === 'corridor' && station.kind !== 'portal',
      );
    assert.ok(hub, `${door.id} needs a room-side neighbor`);
    assert.ok(corridor, `${door.id} needs a corridor-side neighbor`);

    const from = door.slots[0];
    const path = buildArenaPath(from, hub.slots[0], door.id, hub.id);
    const coexistingResidents = corridor.slots.filter(
      (slot) => !capsulesOverlap(slot, from),
    );
    assert.ok(
      coexistingResidents.length > 0,
      `${door.id} needs at least one coexisting corridor position`,
    );
    assert.equal(
      pathClearsStationaryBodies(from, path, coexistingResidents),
      true,
      `${door.id}->${hub.id} recrosses a coexisting ${corridor.id} resident`,
    );
  }
});

void test('every room doorway uses a continuous centerline traversal in both directions', () => {
  const doorEdges = WORLD_EDGES.filter(([left, right]) => {
    const leftStation = stationById(left);
    const rightStation = stationById(right);
    return (
      (leftStation.kind === 'portal' && right.endsWith('-hub')) ||
      (rightStation.kind === 'portal' && left.endsWith('-hub'))
    );
  });
  assert.equal(doorEdges.length, 6);

  for (const [left, right] of doorEdges) {
    for (const [fromId, toId] of [
      [left, right],
      [right, left],
    ]) {
      assert.equal(isFacilityPortalTransfer(fromId, toId), false);
      const from = stationById(fromId);
      const to = stationById(toId);
      const path = buildArenaPath(from.slots[0], to.slots[0], fromId, toId);
      assert.ok(
        path.length >= 4,
        `${fromId}->${toId} needs staged jamb points`,
      );
      assert.ok(
        (doorwayTraversalDistancePx(fromId, toId) ?? 0) >= 72,
        `${fromId}->${toId} must budget the visible threshold distance`,
      );
      assert.deepEqual(path.at(-1), to.slots[0]);
    }
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

function pixelDistance(left, right) {
  return Math.hypot(
    ((right.x - left.x) / 100) * ARENA_WORLD_WIDTH,
    ((right.y - left.y) / 100) * ARENA_WORLD_HEIGHT,
  );
}

function pixelPathDistance(fromPosition, path) {
  let previous = fromPosition;
  return path.reduce((total, point) => {
    const distance = pixelDistance(previous, point);
    previous = point;
    return total + distance;
  }, 0);
}

function positionsArePairwiseClear(positions) {
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      if (capsulesOverlap(positions[left], positions[right])) return false;
    }
  }
  return true;
}

function pathClearsStationaryBodies(fromPosition, path, stationaryPositions) {
  let previous = fromPosition;
  for (const target of path) {
    const samples = Math.max(
      1,
      Math.ceil(pixelDistance(previous, target) / 0.5),
    );
    for (let sample = 0; sample <= samples; sample += 1) {
      const progress = sample / samples;
      const position = {
        x: previous.x + (target.x - previous.x) * progress,
        y: previous.y + (target.y - previous.y) * progress,
      };
      if (
        stationaryPositions.some((stationary) =>
          capsulesOverlap(position, stationary),
        )
      ) {
        return false;
      }
    }
    previous = target;
  }
  return true;
}

void test('door-context egress retains a later hash-ordered hall slot when the first route crosses a parked resident', () => {
  const fromPosition = { ...stationById('door-context').slots[0] };
  const parkedPosition = { x: 52.25, y: 50 };
  const reserved = [];
  const hashOrderedSlots = stationById('hall-center').slots.map(() => {
    const slot = slotForAgent('hall-center', 'mover-smoke', reserved);
    reserved.push(slot);
    return slot;
  });

  assert.deepEqual(hashOrderedSlots, [
    { x: 56.75, y: 50 },
    { x: 43.25, y: 50 },
    { x: 47.75, y: 50 },
    { x: 52.25, y: 50 },
  ]);
  assert.equal(capsulesOverlap(hashOrderedSlots[0], parkedPosition), false);
  const firstPath = buildArenaPath(
    fromPosition,
    hashOrderedSlots[0],
    'door-context',
    'hall-center',
  );
  assert.equal(facilityPathIsSweptLegal(fromPosition, firstPath), true);
  assert.equal(
    pathClearsStationaryBodies(fromPosition, firstPath, [parkedPosition]),
    false,
  );

  const selectedSlot = hashOrderedSlots.find((slot) => {
    if (capsulesOverlap(slot, parkedPosition)) return false;
    const path = buildArenaPath(
      fromPosition,
      slot,
      'door-context',
      'hall-center',
    );
    return (
      facilityPathIsSweptLegal(fromPosition, path) &&
      pathClearsStationaryBodies(fromPosition, path, [parkedPosition])
    );
  });
  assert.deepEqual(selectedSlot, { x: 43.25, y: 50 });
});

function assertVecAlmostEqual(actual, expected, message, epsilon = 0.0001) {
  assert.ok(
    Math.abs(actual.x - expected.x) <= epsilon &&
      Math.abs(actual.y - expected.y) <= epsilon,
    `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
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
  assert.ok(
    report.routes.portalSweptPoints > 2,
    'portal routes are swept between endpoints instead of exempted as jumps',
  );
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
    avatar('atlas', { x: 40, y: 50 }, 0),
    avatar('sage', { x: 50, y: 50 }, 1),
    avatar('nova', { x: 60, y: 50 }, 2),
  ];
  const proposals = previous.map((item) => ({
    ...item,
    position: { x: 50, y: 50 },
    isMoving: true,
  }));
  const resolved = resolveAvatarCollisions(previous, proposals, 32);
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

void test('a moving resident yields without displacing a stationary resident', () => {
  const stationary = avatar('stationary', { x: 50, y: 50 }, 0);
  const mover = {
    ...avatar('mover', { x: 44, y: 50 }, 1),
    path: [{ x: 56, y: 50 }],
    targetStationId: 'hall-center',
    isMoving: true,
  };
  const proposedMover = {
    ...mover,
    position: { x: 47.5, y: 50 },
  };

  const resolved = resolveAvatarCollisions(
    [stationary, mover],
    [stationary, proposedMover],
    32,
  );
  const resolvedStationary = resolved.find(
    (candidate) => candidate.agentId === stationary.agentId,
  );
  const resolvedMover = resolved.find(
    (candidate) => candidate.agentId === mover.agentId,
  );

  assert.deepEqual(resolvedStationary.position, stationary.position);
  assert.equal(resolvedStationary.isMoving, false);
  assert.equal(resolvedMover.isYielding, true);
  assert.equal(resolvedMover.yieldingToAgentId, stationary.agentId);
  assert.equal(
    capsulesOverlap(resolvedStationary.position, resolvedMover.position),
    false,
  );
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
      assert.deepEqual(
        path.at(-1),
        toStation.slots[0],
        `${fromId}->${toId} does not end at its exact authored target`,
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

  const arrival = stationById('spawn-lift');
  for (const slot of arrival.slots) {
    const pixelY = (slot.y / 100) * 448;
    assert.equal(capsuleIsWorldLegal(slot), true);
    assert.ok(pixelY >= 339 && pixelY <= 341);
  }
});

void test('non-portal edges provide occupant-aware egress without trapping full corridor or arrival rows', () => {
  const failures = [];
  const exercisedMultiSlotStations = new Set();
  const exercisedDrainStates = new Set();
  let directedEdges = 0;
  let sourceSlots = 0;
  let validTargetSiblingScenarios = 0;
  let impossibleTargetSiblingScenarios = 0;

  const occupancySlotsFor = (locationId) =>
    locationId === 'spawn-lift'
      ? [...stationById('spawn-lift').slots, ...FACILITY_SPAWN_QUEUE_SLOTS]
      : stationById(locationId).slots;

  function safeTargetOption(fromId, toId, fromSlot, sourceSiblings) {
    const targetSlots = occupancySlotsFor(toId);
    const targetOptions = targetSlots.map((toSlot, toSlotIndex) => {
      const authoredTargetSiblings = targetSlots.filter(
        (_, index) => index !== toSlotIndex,
      );
      const sourceBodies = [fromSlot, ...sourceSiblings];
      const targetSiblings = authoredTargetSiblings.filter((candidate) =>
        positionsArePairwiseClear([...sourceBodies, candidate]),
      );
      validTargetSiblingScenarios += targetSiblings.length;
      impossibleTargetSiblingScenarios +=
        authoredTargetSiblings.length - targetSiblings.length;
      return {
        toSlot,
        targetSiblings,
      };
    });
    // Adjacent portal and corridor slots can physically overlap. A target
    // sibling that already overlaps the mover at its source is not a
    // possible world state, so it cannot be used as evidence of a trap.
    return targetOptions.find((option) => {
      const path = buildArenaPath(fromSlot, option.toSlot, fromId, toId);
      return (
        path.length > 0 &&
        facilityPathIsSweptLegal(fromSlot, path) &&
        pathClearsStationaryBodies(fromSlot, path, [
          ...sourceSiblings,
          ...option.targetSiblings,
        ])
      );
    });
  }

  for (const edge of WORLD_EDGES) {
    for (const [fromId, toId] of [edge, [edge[1], edge[0]]]) {
      directedEdges += 1;
      const from = stationById(fromId);
      if (from.slots.length > 1) exercisedMultiSlotStations.add(fromId);

      if (
        ['spawn-lift', 'hall-west', 'hall-center', 'hall-east'].includes(fromId)
      ) {
        const sourceSlotsForDrain = occupancySlotsFor(fromId);
        assert.equal(
          positionsArePairwiseClear(sourceSlotsForDrain),
          true,
          `${fromId} has an invalid full authored occupancy`,
        );
        if (stationById(toId).kind === 'portal') {
          // A full single-file corridor row must first drain longitudinally;
          // its doorway mouth is intentionally a chokepoint rather than an
          // outer bay beyond the row. Portal-to-room liveness is covered by
          // the reciprocal-egress regression above.
          sourceSlots += sourceSlotsForDrain.length;
          continue;
        }
        const remainingSlotIndexes = sourceSlotsForDrain.map(
          (_, index) => index,
        );
        while (remainingSlotIndexes.length > 0) {
          exercisedDrainStates.add(
            `${fromId}->${toId}:${remainingSlotIndexes.join(',')}`,
          );
          const safeSourceIndex = remainingSlotIndexes.find((fromSlotIndex) => {
            const fromSlot = sourceSlotsForDrain[fromSlotIndex];
            const sourceSiblings = remainingSlotIndexes
              .filter((index) => index !== fromSlotIndex)
              .map((index) => sourceSlotsForDrain[index]);
            return safeTargetOption(fromId, toId, fromSlot, sourceSiblings);
          });
          if (safeSourceIndex === undefined) {
            failures.push(
              `${fromId}[${remainingSlotIndexes.join(',')}]->${toId}`,
            );
            break;
          }
          remainingSlotIndexes.splice(
            remainingSlotIndexes.indexOf(safeSourceIndex),
            1,
          );
        }
        sourceSlots += sourceSlotsForDrain.length;
        continue;
      }

      from.slots.forEach((fromSlot, fromSlotIndex) => {
        sourceSlots += 1;
        const sourceSiblings = from.slots.filter(
          (_, index) => index !== fromSlotIndex,
        );
        assert.equal(
          positionsArePairwiseClear([fromSlot, ...sourceSiblings]),
          true,
          `${fromId} has an invalid full authored occupancy`,
        );

        const safeOption = safeTargetOption(
          fromId,
          toId,
          fromSlot,
          sourceSiblings,
        );
        if (!safeOption) {
          failures.push(`${fromId}[${fromSlotIndex}]->${toId}`);
        }
      });
    }
  }

  assert.equal(directedEdges, WORLD_EDGES.length * 2);
  assert.ok(sourceSlots > directedEdges);
  assert.ok(validTargetSiblingScenarios > 0);
  assert.ok(impossibleTargetSiblingScenarios > 0);
  assert.ok(exercisedDrainStates.size > 0);

  for (const stationId of [
    'command-table',
    'comms-board',
    'context-kiosk',
    'commons',
    'research-hub',
    'command-hub',
    'tools-hub',
  ]) {
    assert.equal(stationById(stationId).slots.length, 2, stationId);
    assert.equal(
      exercisedMultiSlotStations.has(stationId),
      true,
      `${stationId} was not exercised as a full shared source`,
    );
  }
  assert.equal(stationById('spawn-lift').slots.length, 2);
  assert.equal(FACILITY_SPAWN_QUEUE_SLOTS.length, 2);
  assert.equal(exercisedMultiSlotStations.has('spawn-lift'), true);
  assert.equal(
    [...exercisedDrainStates].some((state) => state.startsWith('spawn-lift->')),
    true,
    'the full four-position arrival row was not drained',
  );
  for (const corridorId of ['hall-west', 'hall-center', 'hall-east']) {
    assert.equal(stationById(corridorId).slots.length, 4, corridorId);
    assert.equal(
      exercisedMultiSlotStations.has(corridorId),
      true,
      `${corridorId} full row was not exercised`,
    );
    assert.equal(
      [...exercisedDrainStates].some((state) =>
        state.startsWith(`${corridorId}->`),
      ),
      true,
      `${corridorId} drain order was not exercised`,
    );
  }
  assert.deepEqual(
    failures,
    [],
    `occupant-aware egress traps: ${failures.join(', ')}`,
  );
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

    const fromPosition = { ...state.avatars[0].position };
    const toPosition = { ...stationById('context-hub').slots[0] };
    const path = buildArenaPath(
      fromPosition,
      toPosition,
      'spawn-lift',
      'context-hub',
    );
    const speedPxPerSecond = 96;
    const startedAtMs = base + 400;
    const durationMs = Math.ceil(
      (pixelPathDistance(fromPosition, path) / speedPxPerSecond) * 1_000,
    );
    const startedAt = new Date(startedAtMs).toISOString();
    const arrivesAt = new Date(startedAtMs + durationMs).toISOString();
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
          fromPosition,
          toPosition,
          path,
          speedPxPerSecond,
          startedAt,
          arrivesAt,
        },
        { agentId: 'sage' },
      ),
    });
    assert.equal(state.agents[0].currentLocationId, 'spawn-lift');
    assert.equal(state.avatars[0].targetStationId, 'context-hub');
    assert.notEqual(state.avatars[0].portalTransfer, true);
    assert.ok(state.avatars[0].navigation);
    assert.equal(capsuleIsWorldLegal(state.avatars[0].position), true);

    state = agentArenaReducer(state, {
      type: 'projection.tick',
      now: Date.parse(arrivesAt),
    });
    assert.equal(state.agents[0].currentLocationId, 'context-hub');
    assert.equal(state.agents[0].navigation, undefined);
    assert.equal(state.avatars[0].stationId, 'context-hub');
    assertVecAlmostEqual(
      state.avatars[0].position,
      toPosition,
      'authoritative arrival settles on its declared endpoint',
    );

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

    const doorPosition = { ...stationById('door-context').slots[0] };
    const doorPath = buildArenaPath(
      toPosition,
      doorPosition,
      'context-hub',
      'door-context',
    );
    const doorStartedAtMs = base + 70_100;
    const doorDurationMs = Math.ceil(
      (pixelPathDistance(toPosition, doorPath) / speedPxPerSecond) * 1_000,
    );
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
          fromPosition: toPosition,
          toPosition: doorPosition,
          path: doorPath,
          speedPxPerSecond,
          startedAt: new Date(doorStartedAtMs).toISOString(),
          arrivesAt: new Date(doorStartedAtMs + doorDurationMs).toISOString(),
        },
        { agentId: 'sage' },
      ),
    });
    assert.equal(state.avatars[0].portalTransfer, false);
    assert.equal(state.avatars[0].routeDelayMs, undefined);
    assert.ok(state.avatars[0].navigation.path.length >= 5);
    assert.equal(capsuleIsWorldLegal(state.avatars[0].position), true);
  } finally {
    await vite.close();
  }
});

void test('live navigation never teleports, stalls in a run cycle, or moves on an unrelated event', async () => {
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
  const base = Date.now() + 60_000;
  const runtimeEvent = (sequence, kind, payload, extra = {}) => ({
    schemaVersion: 1,
    eventId: `navigation-invariant-${sequence}`,
    runId: 'run-navigation-invariant',
    sequence,
    occurredAt: new Date(base + sequence * 10).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: runtimeEvent(1, 'run.started', {
        objective: 'Preserve continuous authored motion',
      }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: runtimeEvent(
        2,
        'agent.spawned',
        { name: 'Walker', role: 'Navigation verifier' },
        { agentId: 'walker' },
      ),
    });

    const fromPosition = { ...state.avatars[0].position };
    const toPosition = { ...stationById('context-hub').slots[0] };
    const path = buildArenaPath(
      fromPosition,
      toPosition,
      'spawn-lift',
      'context-hub',
    );
    const speedPxPerSecond = 96;
    const durationMs =
      (pixelPathDistance(fromPosition, path) / speedPxPerSecond) * 1_000;
    const startedAt = new Date(base + 100).toISOString();
    const arrivesAt = new Date(base + 100 + durationMs).toISOString();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: {
        ...runtimeEvent(
          3,
          'world.navigation',
          {
            actionId: 'continuous-spawn-exit',
            observationId: 'obs-continuous-spawn-exit',
            fromLocationId: 'spawn-lift',
            toLocationId: 'context-hub',
            fromPosition,
            toPosition,
            path,
            speedPxPerSecond,
            startedAt,
            arrivesAt,
          },
          { agentId: 'walker' },
        ),
        occurredAt: startedAt,
      },
    });

    const beforeUnrelatedPosition = { ...state.avatars[0].position };
    const beforeUnrelatedNavigation = state.avatars[0].navigation;
    const beforeUnrelatedPath = state.avatars[0].path;
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: {
        ...runtimeEvent(
          4,
          'agent.activity',
          {
            phase: 'planning',
            status: 'working',
            summary: 'An unrelated event must not settle visual movement',
          },
          { agentId: 'walker' },
        ),
        occurredAt: new Date(Date.parse(arrivesAt) + 5_000).toISOString(),
      },
    });
    assert.deepEqual(state.avatars[0].position, beforeUnrelatedPosition);
    assert.strictEqual(
      state.avatars[0].navigation,
      beforeUnrelatedNavigation,
      'an unrelated event cannot replace or settle visual navigation',
    );
    assert.strictEqual(
      state.avatars[0].path,
      beforeUnrelatedPath,
      'an unrelated event cannot rewrite the visual route',
    );
    assert.notEqual(
      state.avatars[0].portalTransfer,
      true,
      'the arrival lift must use swept motion rather than an unswept portal jump',
    );

    let previous = { ...state.avatars[0].position };
    let movingFrames = 0;
    let nonYieldingStallFrames = 0;
    let projectionNow = Date.parse(startedAt);
    for (
      let frame = 0;
      frame < 240 && state.avatars[0].navigation;
      frame += 1
    ) {
      projectionNow += 16;
      state = agentArenaReducer(state, {
        type: 'projection.tick',
        now: projectionNow,
      });
      const current = state.avatars[0];
      const displacement = pixelDistance(previous, current.position);
      assert.ok(
        displacement <= (speedPxPerSecond * 16) / 1_000 + 0.02,
        `frame ${frame} jumped ${displacement.toFixed(3)}px`,
      );
      if (current.isMoving) {
        movingFrames += 1;
        if (!current.isYielding && displacement < 0.01) {
          nonYieldingStallFrames += 1;
        } else {
          nonYieldingStallFrames = 0;
        }
        assert.ok(
          nonYieldingStallFrames < 16,
          'a running avatar made no progress for more than 250ms',
        );
      }
      previous = { ...current.position };
    }
    assert.ok(movingFrames > 1, 'movement is visibly interpolated');
    assert.equal(state.avatars[0].isMoving, false);
    assertVecAlmostEqual(
      state.avatars[0].position,
      toPosition,
      'continuous navigation ends at the authoritative destination',
    );
  } finally {
    await vite.close();
  }
});

void test('the canceled four-resident Commons sequence preserves bodies across authored movement', async () => {
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
  const base = Date.now() + 120_000;
  let sequence = 0;
  const runtimeEvent = (kind, payload, extra = {}, occurredAt = base) => ({
    schemaVersion: 1,
    eventId: `canceled-sequence-${++sequence}`,
    runId: 'run-canceled-sequence-replay',
    sequence,
    occurredAt: new Date(occurredAt).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  const spawnPositions = new Map([
    ['steward-live', { x: 56.25, y: 75.893 }],
    ['explorer-live', { x: 52.083, y: 75.893 }],
    ['maker-live', { x: 45, y: 75 }],
    ['critic-live', { x: 48, y: 86.2 }],
  ]);
  const identities = [
    ['steward-live', 'Mara', 'Steward'],
    ['explorer-live', 'Lumen', 'Explorer'],
    ['maker-live', 'Forge', 'Maker'],
    ['critic-live', 'Vale', 'Critic'],
  ];
  const positionFor = (state, agentId) => ({
    ...state.avatars.find((avatar) => avatar.agentId === agentId).position,
  });
  const snapshotExcept = (state, movingAgentId) =>
    new Map(
      state.avatars
        .filter((avatar) => avatar.agentId !== movingAgentId)
        .map((avatar) => [avatar.agentId, { ...avatar.position }]),
    );
  const assertStationarySnapshot = (state, snapshot, context) => {
    for (const [agentId, position] of snapshot) {
      assert.deepEqual(
        positionFor(state, agentId),
        position,
        `${agentId} was displaced during ${context}`,
      );
    }
  };

  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: runtimeEvent('run.started', {
        objective: 'Replay the failed four-resident Commons sequence safely',
      }),
    });
    for (const [agentId, name, role] of identities) {
      state = agentArenaReducer(state, {
        type: 'runtime.event',
        event: runtimeEvent(
          'agent.spawned',
          { name, role, position: spawnPositions.get(agentId) },
          { agentId },
        ),
      });
    }

    for (let left = 0; left < state.avatars.length; left += 1) {
      assert.equal(capsuleIsWorldLegal(state.avatars[left].position), true);
      for (let right = left + 1; right < state.avatars.length; right += 1) {
        assert.equal(
          capsulesOverlap(
            state.avatars[left].position,
            state.avatars[right].position,
          ),
          false,
          `${state.avatars[left].agentId} overlaps ${state.avatars[right].agentId} at spawn`,
        );
      }
    }

    let logicalNow = base + 1_000;
    const runMove = (
      agentId,
      fromLocationId,
      toLocationId,
      toPosition,
      actionId,
      beforeTicks,
    ) => {
      const fromPosition = positionFor(state, agentId);
      const path = buildArenaPath(
        fromPosition,
        toPosition,
        fromLocationId,
        toLocationId,
      );
      assert.equal(
        facilityPathIsSweptLegal(fromPosition, path),
        true,
        `${actionId} must have a wall-safe authored path`,
      );
      const speedPxPerSecond = 96;
      const durationMs = Math.max(
        1,
        Math.ceil(
          (pixelPathDistance(fromPosition, path) / speedPxPerSecond) * 1_000,
        ),
      );
      const startedAt = logicalNow;
      const arrivesAt = startedAt + durationMs;
      const stationary = snapshotExcept(state, agentId);
      state = agentArenaReducer(state, {
        type: 'runtime.event',
        event: runtimeEvent(
          'world.navigation',
          {
            actionId,
            observationId: `obs-${actionId}`,
            fromLocationId,
            toLocationId,
            fromPosition,
            toPosition,
            path,
            speedPxPerSecond,
            startedAt: new Date(startedAt).toISOString(),
            arrivesAt: new Date(arrivesAt).toISOString(),
          },
          { agentId },
          startedAt,
        ),
      });
      assertStationarySnapshot(state, stationary, `${actionId} receipt`);
      beforeTicks?.({
        arrivesAt,
        fromPosition,
        path,
        stationary,
      });

      let previousPosition = positionFor(state, agentId);
      let projectionNow = startedAt;
      while (projectionNow < arrivesAt) {
        const nextNow = Math.min(arrivesAt, projectionNow + 16);
        state = agentArenaReducer(state, {
          type: 'projection.tick',
          now: nextNow,
        });
        const movingPosition = positionFor(state, agentId);
        const displacement = pixelDistance(previousPosition, movingPosition);
        assert.ok(
          displacement <=
            (speedPxPerSecond * (nextNow - projectionNow)) / 1_000 + 0.02,
          `${actionId} jumped ${displacement.toFixed(3)}px`,
        );
        assert.deepEqual(
          worldCollisionIds(movingPosition),
          [],
          `${actionId} entered wall geometry`,
        );
        assertStationarySnapshot(state, stationary, actionId);
        for (let left = 0; left < state.avatars.length; left += 1) {
          for (let right = left + 1; right < state.avatars.length; right += 1) {
            assert.equal(
              capsulesOverlap(
                state.avatars[left].position,
                state.avatars[right].position,
              ),
              false,
              `${state.avatars[left].agentId} overlapped ${state.avatars[right].agentId} during ${actionId}`,
            );
          }
        }
        previousPosition = movingPosition;
        projectionNow = nextNow;
      }
      const mover = state.avatars.find((avatar) => avatar.agentId === agentId);
      assert.equal(mover.stationId, toLocationId);
      assert.equal(mover.isMoving, false);
      assert.equal(mover.navigation, undefined);
      assertVecAlmostEqual(
        mover.position,
        toPosition,
        `${actionId} must finish at its authored endpoint`,
      );
      logicalNow = arrivesAt + 100;
    };

    const contextHub = { ...stationById('context-hub').slots[0] };
    const contextDoor = { ...stationById('door-context').slots[0] };
    const contextPlant = { ...stationById('plant-context').slots[0] };

    // In the corrected recovery order Forge clears the shared landing first;
    // Lumen then traverses the exact two routes that previously pushed Forge
    // and wall-rode against the Commons plant.
    runMove(
      'maker-live',
      'spawn-lift',
      'context-hub',
      contextHub,
      'maker-clears-spawn',
    );
    runMove(
      'maker-live',
      'context-hub',
      'door-context',
      contextDoor,
      'maker-clears-landing',
    );
    runMove(
      'explorer-live',
      'spawn-lift',
      'context-hub',
      contextHub,
      'explorer-recovers-to-context',
    );
    runMove(
      'explorer-live',
      'context-hub',
      'plant-context',
      contextPlant,
      'explorer-approaches-plant',
      ({ arrivesAt, stationary }) => {
        const beforeUnrelatedPosition = positionFor(state, 'explorer-live');
        const beforeUnrelatedNavigation = state.avatars.find(
          (avatar) => avatar.agentId === 'explorer-live',
        ).navigation;
        state = agentArenaReducer(state, {
          type: 'runtime.event',
          event: runtimeEvent(
            'agent.activity',
            {
              phase: 'planning',
              status: 'working',
              summary:
                'An unrelated event cannot settle the plant approach early.',
            },
            { agentId: 'critic-live' },
            arrivesAt + 5_000,
          ),
        });
        assert.deepEqual(
          positionFor(state, 'explorer-live'),
          beforeUnrelatedPosition,
          'an unrelated event snapped the Explorer along its path',
        );
        assert.strictEqual(
          state.avatars.find((avatar) => avatar.agentId === 'explorer-live')
            .navigation,
          beforeUnrelatedNavigation,
          'an unrelated event replaced the active trajectory',
        );
        assertStationarySnapshot(
          state,
          stationary,
          'the unrelated event during the plant approach',
        );
      },
    );
  } finally {
    await vite.close();
  }
});

void test('delayed navigation hydration lands atomically at its authoritative endpoint', async () => {
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
  const now = Date.now();
  const event = (sequence, kind, payload, extra = {}) => ({
    schemaVersion: 1,
    eventId: `delayed-navigation-${sequence}`,
    runId: 'run-delayed-navigation',
    sequence,
    occurredAt: new Date(now - 10_000 + sequence).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(1, 'run.started', {
        objective: 'Hydrate without replay motion',
      }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        2,
        'agent.spawned',
        { name: 'Late', role: 'Replay verifier' },
        { agentId: 'late' },
      ),
    });
    const fromPosition = { ...state.avatars[0].position };
    const toPosition = { ...stationById('context-hub').slots[0] };
    const path = buildArenaPath(
      fromPosition,
      toPosition,
      'spawn-lift',
      'context-hub',
    );
    const speedPxPerSecond = 96;
    const durationMs = Math.ceil(
      (pixelPathDistance(fromPosition, path) / speedPxPerSecond) * 1_000,
    );
    const arrivesAtMs = now - 7_000;
    const startedAt = new Date(arrivesAtMs - durationMs).toISOString();
    const arrivesAt = new Date(arrivesAtMs).toISOString();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: {
        ...event(
          3,
          'world.navigation',
          {
            actionId: 'delayed-complete-move',
            observationId: 'obs-delayed-complete-move',
            fromLocationId: 'spawn-lift',
            toLocationId: 'context-hub',
            fromPosition,
            toPosition,
            path,
            speedPxPerSecond,
            startedAt,
            arrivesAt,
          },
          { agentId: 'late' },
        ),
        occurredAt: startedAt,
      },
    });

    assertVecAlmostEqual(
      state.avatars[0].position,
      toPosition,
      'hydration applies the completed move in one reducer action',
    );
    assert.equal(state.avatars[0].isMoving, false);
    assert.deepEqual(state.avatars[0].path, []);
    assert.equal(state.avatars[0].stationId, 'context-hub');
    assert.equal(state.agents[0].currentLocationId, 'context-hub');
    assert.equal(state.agents[0].navigation, undefined);
  } finally {
    await vite.close();
  }
});

void test('legacy journals hydrate five positionless spawns into distinct Commons bodies', async () => {
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
    schemaVersion: 1,
    eventId: `legacy-spawn-${sequence}`,
    runId: 'run-legacy-spawns',
    sequence,
    occurredAt: new Date(base + sequence).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(1, 'run.started', { objective: 'Hydrate old residents' }),
    });
    for (const [index, agentId] of [
      'steward-live',
      'explorer-live',
      'maker-live',
      'critic-live',
      'archivist-live',
    ].entries()) {
      state = agentArenaReducer(state, {
        type: 'runtime.event',
        event: event(
          index + 2,
          'agent.spawned',
          { name: agentId, role: 'Legacy resident' },
          { agentId },
        ),
      });
    }

    assert.equal(state.avatars.length, 5);
    assert.equal(
      new Set(
        state.avatars.map(
          (avatar) => `${avatar.position.x}:${avatar.position.y}`,
        ),
      ).size,
      5,
      'positionless legacy residents collapsed onto one spawn point',
    );
    for (let left = 0; left < state.avatars.length; left += 1) {
      assert.equal(capsuleIsWorldLegal(state.avatars[left].position), true);
      for (let right = left + 1; right < state.avatars.length; right += 1) {
        assert.equal(
          capsulesOverlap(
            state.avatars[left].position,
            state.avatars[right].position,
          ),
          false,
          `${state.avatars[left].agentId} overlaps ${state.avatars[right].agentId}`,
        );
      }
    }
  } finally {
    await vite.close();
  }
});

void test('an in-flight legacy navigation lands both body and semantic state at its deadline', async () => {
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
  const base = Date.now() + 60_000;
  const event = (sequence, kind, payload, extra = {}) => ({
    schemaVersion: 1,
    eventId: `legacy-navigation-${sequence}`,
    runId: 'run-legacy-navigation',
    sequence,
    occurredAt: new Date(base + sequence).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(1, 'run.started', { objective: 'Finish an old move' }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        2,
        'agent.spawned',
        { name: 'Legacy', role: 'Resident' },
        { agentId: 'legacy' },
      ),
    });
    const fromPosition = { ...state.avatars[0].position };
    const startedAt = base + 100;
    const arrivesAt = base + 1_000;
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: {
        ...event(
          3,
          'world.navigation',
          {
            actionId: 'legacy-in-flight',
            observationId: 'obs-legacy-in-flight',
            fromLocationId: 'spawn-lift',
            toLocationId: 'context-hub',
            startedAt: new Date(startedAt).toISOString(),
            arrivesAt: new Date(arrivesAt).toISOString(),
          },
          { agentId: 'legacy' },
        ),
        occurredAt: new Date(startedAt).toISOString(),
      },
    });

    const reservedTarget = { ...state.avatars[0].navigation.toPosition };
    assert.ok(
      pixelDistance(fromPosition, reservedTarget) > 1,
      'legacy navigation did not reserve a distinct target body position',
    );
    assert.deepEqual(state.avatars[0].position, fromPosition);
    assert.equal(state.avatars[0].isMoving, false);
    assert.equal(state.avatars[0].stationId, 'spawn-lift');
    assert.equal(state.agents[0].currentLocationId, 'spawn-lift');

    state = agentArenaReducer(state, {
      type: 'projection.tick',
      now: arrivesAt,
    });
    assertVecAlmostEqual(
      state.avatars[0].position,
      reservedTarget,
      'legacy body did not land at its reserved target',
    );
    assert.equal(capsuleIsWorldLegal(state.avatars[0].position), true);
    assert.equal(state.avatars[0].stationId, 'context-hub');
    assert.equal(state.avatars[0].navigation, undefined);
    assert.equal(state.agents[0].currentLocationId, 'context-hub');
    assert.equal(state.agents[0].navigation, undefined);
  } finally {
    await vite.close();
  }
});

void test('malformed motor payloads cannot project, move, or snap a resident', async () => {
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
  const base = Date.now() + 60_000;
  const event = (sequence, kind, payload, extra = {}) => ({
    schemaVersion: 1,
    eventId: `invalid-motor-${sequence}`,
    runId: 'run-invalid-motor',
    sequence,
    occurredAt: new Date(base + sequence).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(1, 'run.started', { objective: 'Reject invalid motors' }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        2,
        'agent.spawned',
        { name: 'Motor Guard', role: 'Verifier' },
        { agentId: 'motor-guard' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        3,
        'task.assigned',
        { objective: 'Remain at the authoritative spawn' },
        { agentId: 'motor-guard', taskId: 'task-motor-guard' },
      ),
    });

    const originalAvatar = structuredClone(state.avatars[0]);
    const originalAgent = structuredClone(state.agents[0]);
    const assertMotorStateUnchanged = () => {
      assertVecAlmostEqual(
        state.avatars[0].position,
        originalAvatar.position,
        'an invalid motor changed the body position',
      );
      assert.deepEqual(state.avatars[0].path, originalAvatar.path);
      assert.equal(state.avatars[0].stationId, originalAvatar.stationId);
      assert.equal(state.avatars[0].targetStationId, undefined);
      assert.equal(state.avatars[0].navigation, undefined);
      assert.equal(state.avatars[0].isMoving, false);
      assert.equal(
        state.agents[0].currentLocationId,
        originalAgent.currentLocationId,
      );
      assert.deepEqual(
        state.agents[0].currentPosition,
        originalAgent.currentPosition,
      );
      assert.equal(state.agents[0].navigation, undefined);
    };
    const fromPosition = { ...originalAvatar.position };
    const toPosition = { ...stationById('context-hub').slots[0] };
    const path = buildArenaPath(
      fromPosition,
      toPosition,
      'spawn-lift',
      'context-hub',
    );
    const speedPxPerSecond = 96;
    const exactDurationMs = Math.ceil(
      (pixelPathDistance(fromPosition, path) / speedPxPerSecond) * 1_000,
    );
    const timingStartMs = base + 10_000;
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        4,
        'world.navigation',
        {
          actionId: 'invalid-duration',
          observationId: 'obs-invalid-duration',
          fromLocationId: 'spawn-lift',
          toLocationId: 'context-hub',
          fromPosition,
          toPosition,
          path,
          speedPxPerSecond,
          startedAt: new Date(timingStartMs).toISOString(),
          arrivesAt: new Date(
            timingStartMs + exactDurationMs + 5_000,
          ).toISOString(),
        },
        { agentId: 'motor-guard' },
      ),
    });
    assertMotorStateUnchanged();
    state = agentArenaReducer(state, {
      type: 'projection.tick',
      now: timingStartMs + exactDurationMs + 6_000,
    });
    assertMotorStateUnchanged();

    const illegalEndpoint = { x: 49, y: 60 };
    assert.ok(worldCollisionIds(illegalEndpoint).length > 0);
    const illegalPath = [illegalEndpoint];
    const illegalDurationMs = Math.ceil(
      (pixelPathDistance(fromPosition, illegalPath) / speedPxPerSecond) * 1_000,
    );
    const illegalStartMs = base + 30_000;
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        5,
        'world.navigation',
        {
          actionId: 'invalid-swept-path',
          observationId: 'obs-invalid-swept-path',
          fromLocationId: 'spawn-lift',
          toLocationId: 'context-hub',
          fromPosition,
          toPosition: illegalEndpoint,
          path: illegalPath,
          speedPxPerSecond,
          startedAt: new Date(illegalStartMs).toISOString(),
          arrivesAt: new Date(illegalStartMs + illegalDurationMs).toISOString(),
        },
        { agentId: 'motor-guard' },
      ),
    });
    assertMotorStateUnchanged();
    state = agentArenaReducer(state, {
      type: 'projection.tick',
      now: illegalStartMs + illegalDurationMs + 1,
    });
    assertMotorStateUnchanged();
  } finally {
    await vite.close();
  }
});

void test('a terminal resident reactivates at the authoritative in-flight endpoint', async () => {
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
  const base = Date.now() + 60_000;
  const event = (sequence, kind, payload, extra = {}) => ({
    schemaVersion: 1,
    eventId: `terminal-endpoint-${sequence}`,
    runId: 'run-terminal-endpoint',
    sequence,
    occurredAt: new Date(base + sequence).toISOString(),
    source: 'codex',
    kind,
    payload,
    ...extra,
  });
  try {
    let state = createAgentArenaState();
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(1, 'run.started', {
        objective: 'Reactivate only at the authored endpoint',
      }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        2,
        'agent.spawned',
        { name: 'Endpoint Keeper', role: 'Resident' },
        { agentId: 'endpoint-keeper' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        3,
        'task.assigned',
        { objective: 'Complete while moving' },
        { agentId: 'endpoint-keeper', taskId: 'task-before-endpoint' },
      ),
    });
    const fromPosition = { ...state.avatars[0].position };
    const toPosition = { ...stationById('context-hub').slots[0] };
    const path = buildArenaPath(
      fromPosition,
      toPosition,
      'spawn-lift',
      'context-hub',
    );
    const speedPxPerSecond = 96;
    const durationMs = Math.ceil(
      (pixelPathDistance(fromPosition, path) / speedPxPerSecond) * 1_000,
    );
    const startedAtMs = base + 10_000;
    const arrivesAtMs = startedAtMs + durationMs;
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        4,
        'world.navigation',
        {
          actionId: 'terminal-in-flight-move',
          observationId: 'obs-terminal-in-flight-move',
          fromLocationId: 'spawn-lift',
          toLocationId: 'context-hub',
          fromPosition,
          toPosition,
          path,
          speedPxPerSecond,
          startedAt: new Date(startedAtMs).toISOString(),
          arrivesAt: new Date(arrivesAtMs).toISOString(),
        },
        { agentId: 'endpoint-keeper' },
      ),
    });
    assert.ok(state.avatars[0].navigation);
    assert.equal(state.agents[0].currentLocationId, 'spawn-lift');

    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        5,
        'agent.completed',
        { summary: 'Complete while the authoritative motor settles' },
        { agentId: 'endpoint-keeper' },
      ),
    });
    assert.equal(state.avatars.length, 0);
    assert.equal(state.agents[0].currentLocationId, 'context-hub');
    assertVecAlmostEqual(
      state.agents[0].currentPosition,
      toPosition,
      'terminal lifecycle retains the authored endpoint',
    );

    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: {
        ...event(
          6,
          'task.assigned',
          { objective: 'Resume after the movement deadline' },
          { agentId: 'endpoint-keeper', taskId: 'task-after-endpoint' },
        ),
        occurredAt: new Date(arrivesAtMs + 1).toISOString(),
      },
    });
    assert.equal(state.avatars.length, 1);
    assert.equal(state.avatars[0].stationId, 'context-hub');
    assert.equal(state.avatars[0].isMoving, false);
    assert.equal(state.avatars[0].navigation, undefined);
    assertVecAlmostEqual(
      state.avatars[0].position,
      toPosition,
      'reactivation restores the exact motor endpoint',
    );
  } finally {
    await vite.close();
  }
});

void test('contributed tool work preserves topic ownership and a failure does not terminalize the resident', async () => {
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
    eventId: `event-tool-${sequence}`,
    runId: 'run-tool-lifecycle',
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
      event: event(1, 'run.started', {
        objective: 'Keep utility failures separate from resident lifecycle',
      }),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        2,
        'agent.spawned',
        { name: 'Sage', role: 'Maker' },
        { agentId: 'sage' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        3,
        'task.assigned',
        { objective: 'Implement one verified change' },
        { agentId: 'sage', taskId: 'task-tool-lifecycle' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        4,
        'research.topic.selected',
        {
          topicId: 'topic-owned',
          title: 'Owned inquiry',
          question: 'What should Sage pursue?',
        },
        { agentId: 'sage' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        5,
        'research.topic.selected',
        {
          topicId: 'topic-contributed',
          title: 'Shared change',
          question: "Does another resident's change hold?",
        },
        { agentId: 'maker' },
      ),
    });
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        6,
        'tool.started',
        {
          toolCallId: 'tool-edit-1',
          tool: 'filesystem.edit',
          capability: 'edit',
          activityId: 'build.implement-linked-change',
          resourceId: 'build-bench-a',
          topicId: 'topic-contributed',
          summary: 'Applying a focused change',
        },
        { agentId: 'sage' },
      ),
    });
    let resident = state.agents.find((agent) => agent.id === 'sage');
    assert.equal(resident.currentTopicId, 'topic-owned');
    assert.equal(resident.activeTool, 'filesystem.edit');
    assert.equal(resident.activeCapability, 'edit');
    assert.equal(resident.activeActivityId, 'build.implement-linked-change');
    state = agentArenaReducer(state, {
      type: 'runtime.event',
      event: event(
        7,
        'tool.finished',
        {
          toolCallId: 'tool-edit-1',
          outcome: 'failed',
          summary: 'The edit failed and needs another attempt',
        },
        { agentId: 'sage' },
      ),
    });

    resident = state.agents.find((agent) => agent.id === 'sage');
    assert.equal(resident.status, 'working');
    assert.equal(resident.currentTopicId, 'topic-owned');
    assert.equal(resident.activeTool, undefined);
    assert.equal(resident.activeCapability, undefined);
    assert.equal(resident.activeActivityId, undefined);
    assert.equal(resident.currentResourceId, undefined);
    assert.equal(resident.engagedResourceId, undefined);
    assert.equal(
      resident.lastToolResult,
      'The edit failed and needs another attempt',
    );
    assert.equal(resident.summary, 'The edit failed and needs another attempt');
  } finally {
    await vite.close();
  }
});
