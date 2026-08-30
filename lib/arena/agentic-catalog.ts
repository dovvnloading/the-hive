import {
  FACILITY_COLLISION_GEOMETRY,
  FACILITY_RESOURCES,
  FACILITY_ROOMS,
  FACILITY_PROPS,
  FACILITY_WAYPOINTS,
  PHASE_RESOURCE,
  RESEARCH_TRACKS,
  WORLD_EDGES,
  WORLD_LOCATIONS,
  inferToolCapability,
  neighborsForLocation,
  resourceById,
  resourcesForCapability,
  roomById,
  roomForLocation,
  roomForResource,
  worldEntityById,
  worldLocationById,
} from './facility-protocol.mjs';
import type {
  AgentPhase,
  AgentPresentation,
  StationDefinition,
  ToolCapability,
  Vec2,
} from './agentic-types';
import {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_WIDTH,
  capsuleIsWorldLegal,
  capsulesOverlap,
} from './agentic-spatial.ts';

export {
  FACILITY_COLLISION_GEOMETRY,
  FACILITY_RESOURCES,
  FACILITY_ROOMS,
  FACILITY_PROPS,
  FACILITY_WAYPOINTS,
  RESEARCH_TRACKS,
  WORLD_EDGES,
  WORLD_LOCATIONS,
  inferToolCapability,
  neighborsForLocation,
  resourceById,
  resourcesForCapability,
  roomById,
  roomForLocation,
  roomForResource,
  worldEntityById,
  worldLocationById,
};

export const AGENT_PRESENTATION: Record<string, AgentPresentation> = {
  atlas: {
    sprite: '/assets/limezu/characters/adam',
    accent: '#c98b52',
    shortRole: 'ORCHESTRATOR',
  },
  sage: {
    sprite: '/assets/limezu/characters/alex',
    accent: '#7fa478',
    shortRole: 'RESEARCH',
  },
  nova: {
    sprite: '/assets/limezu/characters/amelia',
    accent: '#6aa6ae',
    shortRole: 'BUILDER',
  },
  kernel: {
    sprite: '/assets/limezu/characters/bob',
    accent: '#ad6663',
    shortRole: 'VERIFY',
  },
};

const PRESENTATION_POOL = Object.values(AGENT_PRESENTATION);

export const STATIONS: StationDefinition[] = WORLD_LOCATIONS.map(
  (location) => ({
    id: location.id,
    name: location.label,
    roomId: String(location.roomId),
    kind: location.kind,
    capabilities: [...location.capabilities],
    position: {
      x: Number(location.position.x),
      y: Number(location.position.y),
    },
    slots: location.slots.map((slot) => ({
      x: Number(slot.x),
      y: Number(slot.y),
    })),
  }),
);

export const PHASE_STATION = PHASE_RESOURCE as Record<AgentPhase, string>;

function hashAgent(agentId: string) {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1)
    hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0;
  return hash;
}

export function presentationFor(agentId: string): AgentPresentation {
  const known = AGENT_PRESENTATION[agentId];
  if (known) return known;
  const base = PRESENTATION_POOL[hashAgent(agentId) % PRESENTATION_POOL.length];
  return { ...base, shortRole: 'AGENT' };
}

export function stationById(stationId: string) {
  return (
    STATIONS.find((station) => station.id === stationId) ??
    STATIONS.find((station) => station.id === 'commons')!
  );
}

function positionAvailable(position: Vec2, reserved: Vec2[]) {
  return (
    capsuleIsWorldLegal(position) &&
    reserved.every((candidate) => !capsulesOverlap(position, candidate))
  );
}

const SPAWN_QUEUE_SLOTS: Vec2[] = [
  { x: 43.25, y: 50 },
  { x: 47.75, y: 50 },
  { x: 52.25, y: 50 },
  { x: 56.75, y: 50 },
];

const STATION_OVERFLOW_SLOTS: Record<string, Vec2[]> = {
  // Old journals may contain arrivals accepted before a waypoint capacity was
  // tightened. Replay queues those residents along the clear centerline rather
  // than inventing a near-identical point that visually merges their sprites.
  'context-hub': [
    { x: 49.1, y: 75.893 },
    { x: 44.792, y: 83.1 },
  ],
  'context-kiosk': [
    { x: 43.75, y: 89.286 },
    { x: 47.917, y: 89.286 },
    { x: 43.75, y: 95 },
  ],
  commons: [
    { x: 48.958, y: 86.607 },
    { x: 53.125, y: 86.607 },
    { x: 53.125, y: 94 },
  ],
};

export function slotForAgent(
  stationId: string,
  agentId: string,
  reserved: Vec2[] = [],
): Vec2 {
  const station = stationById(stationId);
  const start = hashAgent(agentId) % station.slots.length;
  for (let offset = 0; offset < station.slots.length; offset += 1) {
    const slot = station.slots[(start + offset) % station.slots.length];
    if (positionAvailable(slot, reserved)) return { ...slot };
  }

  if (stationId === 'spawn-lift') {
    const queueStart = hashAgent(agentId) % SPAWN_QUEUE_SLOTS.length;
    for (let offset = 0; offset < SPAWN_QUEUE_SLOTS.length; offset += 1) {
      const slot =
        SPAWN_QUEUE_SLOTS[(queueStart + offset) % SPAWN_QUEUE_SLOTS.length];
      if (positionAvailable(slot, reserved)) return { ...slot };
    }
  }

  const overflowSlots = STATION_OVERFLOW_SLOTS[stationId] ?? [];
  for (const slot of overflowSlots) {
    if (positionAvailable(slot, reserved)) return { ...slot };
  }

  // Search an expanding deterministic ring around the owned location. Every
  // fallback is validated against both the real world capsule and all reserved
  // room positions, so overflow can never be projected into a wall, chair, or
  // another resident merely because the authored station reached capacity.
  const anchors = [...station.slots, station.position];
  const phase = hashAgent(agentId) % 16;
  for (const radiusPx of [28, 36, 44, 52, 60, 72, 84, 96]) {
    for (let index = 0; index < 16; index += 1) {
      const angle = ((index + phase) / 16) * Math.PI * 2;
      for (const anchor of anchors) {
        const candidate = {
          x: anchor.x + (Math.cos(angle) * radiusPx * 100) / ARENA_WORLD_WIDTH,
          y: anchor.y + (Math.sin(angle) * radiusPx * 100) / ARENA_WORLD_HEIGHT,
        };
        if (positionAvailable(candidate, reserved)) return candidate;
      }
    }
  }

  // The collective solver remains the final guard for pathological historical
  // replays, but returning the known legal primary slot is safer than inventing
  // an unchecked coordinate.
  return { ...station.slots[0] };
}

export function resourceCandidatesForCapability(capability: ToolCapability) {
  return resourcesForCapability(capability).map((resource) => resource.id);
}

function compactPath(points: Vec2[]) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return (
      Math.abs(previous.x - point.x) > 0.1 ||
      Math.abs(previous.y - point.y) > 0.1
    );
  });
}

const ROOM_ROUTES: Record<
  string,
  { hubId: string; doorId: string; centerX: number; aisleY: number }
> = {
  research: {
    hubId: 'research-hub',
    doorId: 'door-research',
    centerX: 18.75,
    aisleY: 37.5,
  },
  command: {
    hubId: 'command-hub',
    doorId: 'door-command',
    centerX: 45.833,
    aisleY: 37.5,
  },
  tools: {
    hubId: 'tools-hub',
    doorId: 'door-tools',
    centerX: 77.083,
    aisleY: 37.5,
  },
  synthesis: {
    hubId: 'synthesis-hub',
    doorId: 'door-synthesis',
    centerX: 22.917,
    aisleY: 88,
  },
  context: {
    hubId: 'context-hub',
    doorId: 'door-context',
    centerX: 50,
    aisleY: 89.286,
  },
  build: {
    hubId: 'build-hub',
    doorId: 'door-build',
    centerX: 77.083,
    // Keep the walking capsule below the four physical chair footprints. The
    // station `use` transition performs the final seated snap afterward.
    aisleY: 90.067,
  },
};

const ENTITY_HUB_APPROACH_PATHS: Record<string, readonly Vec2[]> = {
  // Reach the wall board on its unobstructed east side, then fan out across
  // the board face. The west chair beside the planning table is physical.
  'comms-board': [
    { x: 54.688, y: 37.5 },
    { x: 54.688, y: 25 },
  ],
  'plant-tools': [{ x: 77.083, y: 25 }],
};

const PORTAL_TRANSFER_PAIRS = [
  ['spawn-lift', 'context-hub'],
  ['door-research', 'research-hub'],
  ['door-command', 'command-hub'],
  ['door-tools', 'tools-hub'],
  ['door-synthesis', 'synthesis-hub'],
  ['door-context', 'context-hub'],
  ['door-build', 'build-hub'],
] as const;

const PORTAL_TRANSFER_KEYS = new Set(
  PORTAL_TRANSFER_PAIRS.map(([left, right]) => [left, right].sort().join('|')),
);

export function isFacilityPortalTransfer(
  fromStationId: string | undefined,
  toStationId: string | undefined,
) {
  if (!fromStationId || !toStationId) return false;
  return PORTAL_TRANSFER_KEYS.has(
    [fromStationId, toStationId].sort().join('|'),
  );
}

function routeBetweenRoomEntityAndHub(
  from: Vec2,
  to: Vec2,
  fromStationId: string,
  toStationId: string,
  route: (typeof ROOM_ROUTES)[string],
) {
  if (fromStationId === route.hubId) {
    return [
      { x: route.centerX, y: from.y },
      { x: route.centerX, y: route.aisleY },
      { x: to.x, y: route.aisleY },
      to,
    ];
  }
  if (toStationId === route.hubId) {
    return [
      { x: from.x, y: route.aisleY },
      { x: route.centerX, y: route.aisleY },
      { x: route.centerX, y: to.y },
      to,
    ];
  }
  return [to];
}

export function buildArenaPath(
  from: Vec2,
  to: Vec2,
  fromStationId?: string,
  toStationId?: string,
): Vec2[] {
  if (!fromStationId || !toStationId) return compactPath([{ ...to }]);
  if (fromStationId === toStationId) return compactPath([{ ...to }]);

  const fromLocation = worldLocationById(fromStationId);
  const toLocation = worldLocationById(toStationId);
  if (!fromLocation || !toLocation) return compactPath([{ ...to }]);

  // Doors and the lift are semantic portals, not walkable strips painted over
  // wall art. The reducer delays then transfers between two legal endpoints.
  if (isFacilityPortalTransfer(fromStationId, toStationId)) {
    return compactPath([{ ...to }]);
  }

  if (fromLocation.roomId === toLocation.roomId) {
    const route = ROOM_ROUTES[String(fromLocation.roomId)];
    if (!route) return compactPath([{ ...to }]);

    // Room hubs meet doors on the door centerline; no lateral displacement is
    // allowed while the capsule is inside a narrow jamb span.
    if (
      new Set([fromStationId, toStationId]).has(route.hubId) &&
      new Set([fromStationId, toStationId]).has(route.doorId)
    ) {
      return compactPath(
        fromStationId === route.hubId
          ? [{ x: route.centerX, y: from.y }, to]
          : [{ x: route.centerX, y: to.y }, to],
      );
    }

    if (fromStationId === route.hubId || toStationId === route.hubId) {
      const entityId =
        fromStationId === route.hubId ? toStationId : fromStationId;
      const approach = ENTITY_HUB_APPROACH_PATHS[entityId];
      if (approach) {
        return compactPath(
          fromStationId === route.hubId
            ? [...approach, to]
            : [...approach].reverse().concat(to),
        );
      }
      return compactPath(
        routeBetweenRoomEntityAndHub(
          from,
          to,
          fromStationId,
          toStationId,
          route,
        ),
      );
    }
  }

  const fromIsDoor = fromLocation.kind === 'portal';
  const toIsDoor = toLocation.kind === 'portal';
  const fromIsHall = fromLocation.roomId === 'corridor';
  const toIsHall = toLocation.roomId === 'corridor';
  if ((fromIsDoor && toIsHall) || (toIsDoor && fromIsHall)) {
    const door = fromIsDoor ? fromLocation : toLocation;
    return compactPath(
      fromIsDoor
        ? [{ x: Number(door.position.x), y: to.y }, to]
        : [{ x: Number(door.position.x), y: from.y }, to],
    );
  }

  // Corridor waypoints and the short threshold step between a door and its
  // hall node are already obstacle-free; their stable slots create two-way
  // lanes without asking a model to micromanage foot placement.
  return compactPath([{ ...to }]);
}
