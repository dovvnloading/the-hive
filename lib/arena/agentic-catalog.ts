import type { AgentPhase, AgentPresentation, StationDefinition, Vec2 } from './agentic-types';

export const AGENT_PRESENTATION: Record<string, AgentPresentation> = {
  atlas: { sprite: '/assets/limezu/characters/adam', accent: '#c98b52', shortRole: 'ORCHESTRATOR' },
  sage: { sprite: '/assets/limezu/characters/alex', accent: '#7fa478', shortRole: 'RESEARCH' },
  nova: { sprite: '/assets/limezu/characters/amelia', accent: '#6aa6ae', shortRole: 'BUILDER' },
  kernel: { sprite: '/assets/limezu/characters/bob', accent: '#ad6663', shortRole: 'VERIFY' },
};

export const STATIONS: StationDefinition[] = [
  {
    id: 'command-core',
    name: 'Command Core',
    position: { x: 50, y: 34 },
    slots: [{ x: 45, y: 35 }, { x: 49, y: 35 }, { x: 53, y: 35 }, { x: 57, y: 35 }],
  },
  {
    id: 'research-archive',
    name: 'Research Archive',
    position: { x: 18, y: 35 },
    slots: [{ x: 12, y: 35 }, { x: 17, y: 35 }, { x: 22, y: 35 }, { x: 27, y: 35 }],
  },
  {
    id: 'tool-bay',
    name: 'Tool Bay',
    position: { x: 82, y: 36 },
    slots: [{ x: 75, y: 36 }, { x: 80, y: 36 }, { x: 85, y: 36 }, { x: 90, y: 36 }],
  },
  {
    id: 'build-lab',
    name: 'Build Lab',
    position: { x: 78, y: 82 },
    slots: [{ x: 70, y: 82 }, { x: 76, y: 82 }, { x: 82, y: 82 }, { x: 88, y: 82 }],
  },
  {
    id: 'synthesis-table',
    name: 'Synthesis Table',
    position: { x: 24, y: 83 },
    slots: [{ x: 15, y: 83 }, { x: 21, y: 83 }, { x: 27, y: 83 }, { x: 33, y: 83 }],
  },
  {
    id: 'commons',
    name: 'Commons',
    position: { x: 54, y: 86 },
    slots: [{ x: 46, y: 86 }, { x: 50, y: 86 }, { x: 54, y: 86 }, { x: 58, y: 86 }],
  },
  {
    id: 'spawn-lift',
    name: 'Entry lift',
    position: { x: 54, y: 92 },
    slots: [{ x: 48, y: 92 }, { x: 52, y: 92 }, { x: 56, y: 92 }, { x: 60, y: 92 }],
  },
];

export const PHASE_STATION: Record<AgentPhase, string> = {
  spawning: 'spawn-lift',
  planning: 'command-core',
  delegating: 'command-core',
  researching: 'research-archive',
  implementing: 'build-lab',
  tooling: 'tool-bay',
  verifying: 'build-lab',
  synthesizing: 'synthesis-table',
  waiting: 'commons',
  completed: 'synthesis-table',
  failed: 'commons',
  canceled: 'commons',
};

export function presentationFor(agentId: string): AgentPresentation {
  return AGENT_PRESENTATION[agentId] ?? {
    sprite: AGENT_PRESENTATION.atlas.sprite,
    accent: '#a5b7c9',
    shortRole: 'AGENT',
  };
}

export function stationById(stationId: string) {
  return STATIONS.find((station) => station.id === stationId) ?? STATIONS[5];
}

function hashAgent(agentId: string) {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0;
  return hash;
}

const KNOWN_AGENT_SLOT: Record<string, number> = {
  atlas: 0,
  sage: 1,
  nova: 2,
  kernel: 3,
};

export function slotForAgent(stationId: string, agentId: string): Vec2 {
  const station = stationById(stationId);
  const slotIndex = KNOWN_AGENT_SLOT[agentId] ?? hashAgent(agentId);
  return station.slots[slotIndex % station.slots.length];
}

function compactPath(points: Vec2[]) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return Math.abs(previous.x - point.x) > 0.1 || Math.abs(previous.y - point.y) > 0.1;
  });
}

export function buildArenaPath(from: Vec2, to: Vec2): Vec2[] {
  const lowerFrom = from.y > 50;
  const lowerTo = to.y > 50;
  const points: Vec2[] = [];

  if (lowerFrom !== lowerTo) {
    points.push({ x: from.x, y: 50 });
    points.push({ x: 52, y: 50 });
    points.push({ x: to.x, y: 50 });
  } else if (Math.abs(from.x - to.x) > 18) {
    const corridorY = lowerFrom ? 56 : 48;
    points.push({ x: from.x, y: corridorY });
    points.push({ x: to.x, y: corridorY });
  }

  points.push({ ...to });
  return compactPath(points);
}
