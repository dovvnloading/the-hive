import { buildArenaPath, PHASE_STATION, slotForAgent } from './agentic-catalog';
import type {
  AgentArenaAction,
  AgentArenaState,
  AgentPhase,
  AvatarDirection,
  AvatarProjection,
  RuntimeAgent,
  RuntimeEvent,
  Vec2,
} from './agentic-types';

const INITIAL_STATE: AgentArenaState = {
  runId: 'boot',
  runStatus: 'booting',
  objective: 'Waiting for real Codex subagent events from 127.0.0.1:8787…',
  source: 'codex',
  agents: [],
  avatars: [],
  events: [],
  lastSequence: 0,
};

export function createAgentArenaState(): AgentArenaState {
  return { ...INITIAL_STATE, agents: [], avatars: [], events: [] };
}

function stationForPhase(phase: AgentPhase, currentStationId?: string) {
  if (phase === 'waiting' || phase === 'failed' || phase === 'canceled') return currentStationId;
  return PHASE_STATION[phase];
}

function routeAvatar(avatar: AvatarProjection, phase: AgentPhase) {
  const stationId = stationForPhase(phase, avatar.stationId);
  if (!stationId || stationId === avatar.stationId) return avatar;
  const destination = slotForAgent(stationId, avatar.agentId);
  return {
    ...avatar,
    lastStationId: avatar.stationId,
    stationId,
    path: buildArenaPath(avatar.position, destination),
    isMoving: true,
  };
}

function updateAgent(
  state: AgentArenaState,
  agentId: string,
  updater: (agent: RuntimeAgent) => RuntimeAgent,
) {
  return {
    ...state,
    agents: state.agents.map((agent) => (agent.id === agentId ? updater(agent) : agent)),
  };
}

function routeForAgent(state: AgentArenaState, agentId: string, phase: AgentPhase) {
  return {
    ...state,
    avatars: state.avatars.map((avatar) =>
      avatar.agentId === agentId ? routeAvatar(avatar, phase) : avatar,
    ),
  };
}

function applyRuntimeEvent(state: AgentArenaState, event: RuntimeEvent): AgentArenaState {
  if (event.sequence <= state.lastSequence && state.events.some((item) => item.eventId === event.eventId)) return state;

  if (event.kind === 'run.started') {
    return {
      ...createAgentArenaState(),
      runId: event.runId,
      runStatus: 'running',
      objective: event.payload.objective,
      source: event.source,
      events: [event],
      lastSequence: event.sequence,
    };
  }

  let next: AgentArenaState = {
    ...state,
    events: [event, ...state.events].slice(0, 160),
    lastSequence: Math.max(state.lastSequence, event.sequence),
  };

  if (event.kind === 'run.completed') {
    return { ...next, runStatus: 'completed', summary: event.payload.summary };
  }
  if (event.kind === 'run.canceled') {
    return { ...next, runStatus: 'canceled', summary: event.payload.reason };
  }

  if (!event.agentId) return next;

  if (event.kind === 'agent.spawned') {
    const stationId = event.agentId === 'atlas' ? 'command-core' : 'spawn-lift';
    const position = slotForAgent(stationId, event.agentId);
    const agent: RuntimeAgent = {
      id: event.agentId,
      name: event.payload.name,
      role: event.payload.role,
      parentAgentId: event.parentAgentId,
      objective: 'Waiting for an assignment',
      phase: 'spawning',
      status: 'idle',
      summary: 'Joining the run',
    };
    const avatar: AvatarProjection = {
      agentId: event.agentId,
      position,
      path: [],
      direction: 'south',
      isMoving: false,
      stationId,
      lastStationId: stationId,
    };
    return {
      ...next,
      agents: [...next.agents.filter((item) => item.id !== agent.id), agent],
      avatars: [...next.avatars.filter((item) => item.agentId !== avatar.agentId), avatar],
    };
  }

  if (event.kind === 'task.assigned') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      taskId: event.taskId,
      objective: event.payload.objective,
      summary: 'Assignment received',
      status: 'working',
    }));
  }

  if (event.kind === 'agent.activity') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: event.payload.phase,
      status: event.payload.status,
      summary: event.payload.summary,
    }));
    return routeForAgent(next, event.agentId, event.payload.phase);
  }

  if (event.kind === 'tool.started') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      status: 'working',
      activeTool: event.payload.tool,
      summary: event.payload.summary,
    }));
  }

  if (event.kind === 'tool.finished') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      activeTool: undefined,
      status: event.payload.outcome === 'failed' ? 'failed' : agent.status,
      summary: event.payload.summary ?? `${event.payload.toolCallId} ${event.payload.outcome}`,
    }));
  }

  if (event.kind === 'agent.message') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      lastMessage: event.payload.text,
      summary: event.payload.channel === 'final' ? 'Final response ready' : agent.summary,
    }));
  }

  if (event.kind === 'agent.blocked') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'waiting',
      status: 'blocked',
      summary: event.payload.request,
      blocker: { ...event.payload },
    }));
  }

  if (event.kind === 'agent.resumed') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'tooling',
      status: 'working',
      blocker: undefined,
      summary: event.payload.response ?? 'Resuming runtime work',
    }));
    return routeForAgent(next, event.agentId, 'tooling');
  }

  if (event.kind === 'agent.completed') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'completed',
      status: 'completed',
      summary: event.payload.summary,
      completedSummary: event.payload.summary,
      activeTool: undefined,
      blocker: undefined,
    }));
    return routeForAgent(next, event.agentId, 'completed');
  }

  if (event.kind === 'agent.failed') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'failed',
      status: 'failed',
      summary: event.payload.error,
      activeTool: undefined,
    }));
  }

  if (event.kind === 'agent.stopped') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'canceled',
      status: 'canceled',
      summary: event.payload.reason,
      activeTool: undefined,
    }));
  }

  return next;
}

function directionFor(delta: Vec2): AvatarDirection {
  if (Math.abs(delta.x) > Math.abs(delta.y)) return delta.x > 0 ? 'east' : 'west';
  return delta.y > 0 ? 'south' : 'north';
}

function advanceAvatar(avatar: AvatarProjection, deltaMs: number): AvatarProjection {
  if (avatar.path.length === 0) return avatar.isMoving ? { ...avatar, isMoving: false } : avatar;
  const target = avatar.path[0];
  const dx = target.x - avatar.position.x;
  const dy = target.y - avatar.position.y;
  const distance = Math.hypot(dx, dy);
  const step = (deltaMs / 1000) * 24;
  const direction = directionFor({ x: dx, y: dy });

  if (distance <= step || distance < 0.12) {
    const path = avatar.path.slice(1);
    return {
      ...avatar,
      position: { ...target },
      path,
      direction,
      isMoving: path.length > 0,
    };
  }

  return {
    ...avatar,
    position: {
      x: avatar.position.x + (dx / distance) * step,
      y: avatar.position.y + (dy / distance) * step,
    },
    direction,
    isMoving: true,
  };
}

export function agentArenaReducer(state: AgentArenaState, action: AgentArenaAction): AgentArenaState {
  if (action.type === 'runtime.event') return applyRuntimeEvent(state, action.event);
  if (action.type === 'projection.tick') {
    return { ...state, avatars: state.avatars.map((avatar) => advanceAvatar(avatar, action.deltaMs)) };
  }
  if (action.type === 'selection.changed') return { ...state, selectedAgentId: action.agentId };
  if (action.type === 'follow.changed') return { ...state, followedAgentId: action.agentId };
  return state;
}
