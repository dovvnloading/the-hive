import {
  FACILITY_COLLISION_GEOMETRY,
  FACILITY_COMMONS_LAYOUT,
  FACILITY_LIGHT_LAYOUT,
  FACILITY_REPLAY_OVERFLOW_SLOTS,
  FACILITY_RESOURCES,
  FACILITY_ROOMS,
  FACILITY_SPAWN_QUEUE_SLOTS,
  FACILITY_PROPS,
  FACILITY_WAYPOINTS,
  LIGHT_SWITCH_REACH_PX,
  PHASE_RESOURCE,
  RESEARCH_TRACKS,
  WORLD_EDGES,
  WORLD_LOCATIONS,
  activitiesForResource,
  activityForCapability,
  buildArenaPath,
  doorwayTraversalDistancePx,
  doorwayTraversalPoints,
  inferToolCapability,
  isFacilityPortalTransfer,
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
  FACILITY_COMMONS_LAYOUT,
  FACILITY_LIGHT_LAYOUT,
  FACILITY_REPLAY_OVERFLOW_SLOTS,
  FACILITY_RESOURCES,
  FACILITY_ROOMS,
  FACILITY_SPAWN_QUEUE_SLOTS,
  FACILITY_PROPS,
  FACILITY_WAYPOINTS,
  LIGHT_SWITCH_REACH_PX,
  RESEARCH_TRACKS,
  WORLD_EDGES,
  WORLD_LOCATIONS,
  activitiesForResource,
  activityForCapability,
  buildArenaPath,
  doorwayTraversalDistancePx,
  doorwayTraversalPoints,
  inferToolCapability,
  isFacilityPortalTransfer,
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

export function presentationIndexFor(agentId: string) {
  const known = AGENT_PRESENTATION[agentId];
  if (known) {
    const index = PRESENTATION_POOL.findIndex(
      (presentation) => presentation.sprite === known.sprite,
    );
    if (index >= 0) return index;
  }
  return hashAgent(agentId) % PRESENTATION_POOL.length;
}

export function allocatePresentationIndex(
  agentId: string,
  occupiedIndices: Iterable<number>,
) {
  const occupied = new Set(occupiedIndices);
  const preferred = presentationIndexFor(agentId);
  for (let offset = 0; offset < PRESENTATION_POOL.length; offset += 1) {
    const candidate = (preferred + offset) % PRESENTATION_POOL.length;
    if (!occupied.has(candidate)) return candidate;
  }
  // The facility currently exposes four resident processes and four complete
  // character sheets. This fallback preserves deterministic rendering for a
  // historical over-capacity journal while active runs remain collision-free.
  return preferred;
}

export function presentationAt(index: number): AgentPresentation {
  return PRESENTATION_POOL[index % PRESENTATION_POOL.length];
}

export function presentationFor(agentId: string): AgentPresentation {
  const base = presentationAt(presentationIndexFor(agentId));
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

const STATION_OVERFLOW_SLOTS = FACILITY_REPLAY_OVERFLOW_SLOTS as Record<
  string,
  readonly Vec2[]
>;

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
    const queueStart = hashAgent(agentId) % FACILITY_SPAWN_QUEUE_SLOTS.length;
    for (
      let offset = 0;
      offset < FACILITY_SPAWN_QUEUE_SLOTS.length;
      offset += 1
    ) {
      const slot =
        FACILITY_SPAWN_QUEUE_SLOTS[
          (queueStart + offset) % FACILITY_SPAWN_QUEUE_SLOTS.length
        ];
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
