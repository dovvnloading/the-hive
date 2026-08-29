import {
  FACILITY_PROPS,
  buildArenaPath,
  inferToolCapability,
  isFacilityPortalTransfer,
  resourceById,
  slotForAgent,
  stationById,
} from './agentic-catalog';
import {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_WIDTH,
  resolveAvatarCollisions,
} from './agentic-spatial';
import type {
  AgentArenaAction,
  AgentArenaState,
  AvatarDirection,
  AvatarProjection,
  BoardMessageProjection,
  ChatIngressProjection,
  RuntimeAgent,
  RuntimeEvent,
  ToolCapability,
  Vec2,
  WorldEntityProjection,
  WorldEntityState,
} from './agentic-types';

function initialWorldEntities(): WorldEntityProjection[] {
  return FACILITY_PROPS.map((entity) => ({
    id: entity.id,
    roomId: entity.roomId,
    label: entity.label,
    kind: entity.kind,
    state: { ...entity.initialState } as WorldEntityState,
    stateVersion: 0,
  }));
}

const INITIAL_STATE: AgentArenaState = {
  runId: 'boot',
  runStatus: 'booting',
  objective: 'Waiting for real Codex subagent events from 127.0.0.1:8787…',
  source: 'codex',
  agents: [],
  avatars: [],
  boardMessages: [],
  chatIngresses: [],
  researchTopics: [],
  artifacts: [],
  worldEntities: initialWorldEntities(),
  events: [],
  lastSequence: 0,
};

export function createAgentArenaState(): AgentArenaState {
  return {
    ...INITIAL_STATE,
    agents: [],
    avatars: [],
    boardMessages: [],
    chatIngresses: [],
    researchTopics: [],
    artifacts: [],
    worldEntities: initialWorldEntities(),
    events: [],
  };
}

function reservedStationPositions(
  state: AgentArenaState,
  stationId: string,
  exceptAgentId: string,
) {
  const targetRoomId = stationById(stationId).roomId;
  return state.avatars
    .filter(
      (avatar) => {
        if (avatar.agentId === exceptAgentId) return false;
        const occupiedStationId = avatar.targetStationId ?? avatar.stationId;
        return stationById(occupiedStationId).roomId === targetRoomId;
      },
    )
    .map((avatar) =>
      avatar.targetStationId === stationId && avatar.path.length > 0
        ? avatar.path[avatar.path.length - 1]
        : avatar.position,
    );
}

function reactivateAvatar(state: AgentArenaState, agentId: string) {
  if (state.avatars.some((avatar) => avatar.agentId === agentId)) return state;
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  const stationId = agent?.currentLocationId ?? 'spawn-lift';
  const position = slotForAgent(
    stationId,
    agentId,
    reservedStationPositions(state, stationId, agentId),
  );
  const routeOrder =
    state.avatars.reduce(
      (maximum, avatar) => Math.max(maximum, avatar.routeOrder ?? 0),
      -1,
    ) + 1;
  const avatar: AvatarProjection = {
    agentId,
    position,
    path: [],
    direction: 'south' as const,
    isMoving: false,
    routeOrder,
    stationId,
    lastStationId: stationId,
  };
  const restored =
    agent?.navigation && Date.now() < Date.parse(agent.navigation.arrivesAt)
      ? routeAvatarToStation(
          avatar,
          agent.navigation.toLocationId,
          slotForAgent(
            agent.navigation.toLocationId,
            agentId,
            reservedStationPositions(
              state,
              agent.navigation.toLocationId,
              agentId,
            ),
          ),
        )
      : avatar;
  return {
    ...state,
    avatars: [...state.avatars, restored],
  };
}

function removeTerminalAvatar(state: AgentArenaState, agentId: string) {
  return {
    ...state,
    avatars: state.avatars.filter((avatar) => avatar.agentId !== agentId),
    followedAgentId:
      state.followedAgentId === agentId ? undefined : state.followedAgentId,
  };
}

function routeAvatarToStation(
  avatar: AvatarProjection,
  stationId: string,
  destination = slotForAgent(stationId, avatar.agentId),
): AvatarProjection {
  const currentTarget = avatar.targetStationId ?? avatar.stationId;
  if (!stationId || stationId === currentTarget) return avatar;

  const portalTransfer = isFacilityPortalTransfer(avatar.stationId, stationId);
  if (!avatar.isMoving && portalTransfer) {
    const includesLift = new Set([avatar.stationId, stationId]).has(
      'spawn-lift',
    );
    return {
      ...avatar,
      lastStationId: avatar.stationId,
      targetStationId: stationId,
      routeDelayMs: includesLift ? 420 : 260,
      portalTransfer: true,
      path: [{ ...destination }],
      isMoving: true,
    };
  }

  if (avatar.isMoving && avatar.path.length > 0 && avatar.targetStationId) {
    const extensionStart = avatar.path[avatar.path.length - 1];
    const extension = buildArenaPath(
      extensionStart,
      destination,
      avatar.targetStationId,
      stationId,
    );
    return {
      ...avatar,
      targetStationId: stationId,
      path: [...avatar.path, ...extension],
      portalTransfer: false,
      isMoving: true,
    };
  }

  const path = buildArenaPath(
    avatar.position,
    destination,
    avatar.stationId,
    stationId,
  );

  return {
    ...avatar,
    lastStationId: avatar.stationId,
    targetStationId: stationId,
    routeDelayMs: undefined,
    portalTransfer: false,
    path,
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
    agents: state.agents.map((agent) =>
      agent.id === agentId ? updater(agent) : agent,
    ),
  };
}

function routeAvatarForNavigation(
  state: AgentArenaState,
  agentId: string,
  locationId: string,
) {
  const destination = slotForAgent(
    locationId,
    agentId,
    reservedStationPositions(state, locationId, agentId),
  );
  return {
    ...state,
    avatars: state.avatars.map((avatar) =>
      avatar.agentId === agentId
        ? routeAvatarToStation(avatar, locationId, destination)
        : avatar,
    ),
  };
}

function settleElapsedNavigations(state: AgentArenaState, at: number) {
  const arrived = new Map(
    state.agents
      .filter(
        (agent) =>
          agent.navigation && at >= Date.parse(agent.navigation.arrivesAt),
      )
      .map((agent) => [agent.id, agent.navigation!.toLocationId]),
  );
  if (arrived.size === 0) return state;
  return {
    ...state,
    agents: state.agents.map((agent) =>
      arrived.has(agent.id)
        ? {
            ...agent,
            currentLocationId: arrived.get(agent.id)!,
            navigation: undefined,
          }
        : agent,
    ),
    avatars: state.avatars.map((avatar) => {
      const stationId = arrived.get(avatar.agentId);
      if (!stationId) return avatar;
      const destination =
        avatar.targetStationId === stationId && avatar.path.length > 0
          ? avatar.path[avatar.path.length - 1]
          : slotForAgent(
              stationId,
              avatar.agentId,
              reservedStationPositions(state, stationId, avatar.agentId),
            );
      return {
        ...avatar,
        position: { ...destination },
        path: [],
        stationId,
        targetStationId: undefined,
        lastStationId: avatar.stationId,
        portalTransfer: false,
        isMoving: false,
      };
    }),
  };
}

function boardProjection(
  event: Extract<RuntimeEvent, { kind: 'board.message' }>,
) {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    authorAgentId: event.agentId!,
    correlationId: event.correlationId,
    ...event.payload,
    acknowledgements: [],
  } satisfies BoardMessageProjection;
}

function researchTopicProjection(
  event: Extract<RuntimeEvent, { kind: 'research.topic.selected' }>,
) {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    ownerAgentId: event.agentId!,
    ...event.payload,
    status: 'active' as const,
    lastSequence: event.sequence,
  };
}

function artifactProjection(
  event: Extract<RuntimeEvent, { kind: 'artifact.recorded' }>,
) {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    authorAgentId: event.agentId!,
    ...event.payload,
  };
}

function boardPostingSummary(
  event: Extract<RuntimeEvent, { kind: 'board.message' }>,
) {
  if (event.payload.audience === 'broadcast')
    return 'Posted to the shared board';
  return `Posted to board → ${event.payload.recipientAgentIds
    .map((agentId) => `@${agentId}`)
    .join(', ')}`;
}

function applyBoardAcknowledgement(
  messages: BoardMessageProjection[],
  event: Extract<RuntimeEvent, { kind: 'board.acknowledged' }>,
) {
  return messages.map((message) => {
    if (message.messageId !== event.payload.messageId) return message;
    const acknowledgement = {
      agentId: event.agentId!,
      state: event.payload.state,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
    };
    return {
      ...message,
      acknowledgements: [
        ...message.acknowledgements.filter(
          (item) => item.agentId !== event.agentId,
        ),
        acknowledgement,
      ].sort((left, right) => left.sequence - right.sequence),
    };
  });
}

function applyRuntimeEvent(
  state: AgentArenaState,
  event: RuntimeEvent,
): AgentArenaState {
  if (
    event.sequence <= state.lastSequence &&
    state.events.some((item) => item.eventId === event.eventId)
  )
    return state;

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
    events: [event, ...state.events],
    lastSequence: Math.max(state.lastSequence, event.sequence),
  };
  const eventTime = Date.parse(event.occurredAt);
  next = settleElapsedNavigations(
    next,
    Number.isFinite(eventTime) ? eventTime : Date.now(),
  );

  if (event.kind === 'run.completed') {
    return { ...next, runStatus: 'completed', summary: event.payload.summary };
  }
  if (event.kind === 'run.canceled') {
    return { ...next, runStatus: 'canceled', summary: event.payload.reason };
  }

  if (event.kind === 'chat.ingress') {
    const projection: ChatIngressProjection = {
      ...event.payload,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      state: 'received',
      targetAgentIds: [],
      stages: [
        {
          state: 'received',
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          targetAgentIds: [],
        },
      ],
      lastSequence: event.sequence,
    };
    return {
      ...next,
      objective: event.payload.prompt,
      runStatus: 'running',
      chatIngresses: [
        ...next.chatIngresses.filter(
          (item) => item.ingressId !== projection.ingressId,
        ),
        projection,
      ]
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-100),
    };
  }

  if (event.kind === 'chat.relay') {
    return {
      ...next,
      chatIngresses: next.chatIngresses.map((ingress) =>
        ingress.ingressId !== event.payload.ingressId
          ? ingress
          : {
              ...ingress,
              state: event.payload.state,
              summary: event.payload.summary,
              targetAgentIds: event.payload.targetAgentIds,
              stages: [
                ...ingress.stages,
                {
                  state: event.payload.state,
                  sequence: event.sequence,
                  occurredAt: event.occurredAt,
                  summary: event.payload.summary,
                  targetAgentIds: event.payload.targetAgentIds,
                },
              ],
              lastSequence: event.sequence,
            },
      ),
    };
  }

  if (!event.agentId) return next;

  if (event.kind === 'agent.spawned') {
    const stationId = 'spawn-lift';
    const position = slotForAgent(
      stationId,
      event.agentId,
      reservedStationPositions(next, stationId, event.agentId),
    );
    const agent: RuntimeAgent = {
      id: event.agentId,
      name: event.payload.name,
      role: event.payload.role,
      parentAgentId: event.parentAgentId,
      objective: 'Waiting for an assignment',
      phase: 'spawning',
      status: 'idle',
      summary: 'Joining the run',
      currentLocationId: stationId,
      artifactIds: [],
    };
    const avatar: AvatarProjection = {
      agentId: event.agentId,
      position,
      path: [],
      direction: 'south',
      isMoving: false,
      routeOrder: next.avatars.length,
      stationId,
      lastStationId: stationId,
    };
    return {
      ...next,
      agents: [...next.agents.filter((item) => item.id !== agent.id), agent],
      avatars: [
        ...next.avatars.filter((item) => item.agentId !== avatar.agentId),
        avatar,
      ],
    };
  }

  if (event.kind === 'task.assigned') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      taskId: event.taskId,
      objective: event.payload.objective,
      phase: 'planning',
      summary: 'Assignment received',
      status: 'working',
      activeTool: undefined,
      activeCapability: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
      currentTopicId: undefined,
      researchQuestion: undefined,
      blocker: undefined,
    }));
    next = reactivateAvatar(next, event.agentId);
    return next;
  }

  if (event.kind === 'world.navigation') {
    const alreadyArrived = Date.now() >= Date.parse(event.payload.arrivesAt);
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      currentLocationId: event.payload.fromLocationId,
      navigation: {
        actionId: event.payload.actionId,
        fromLocationId: event.payload.fromLocationId,
        toLocationId: event.payload.toLocationId,
        startedAt: event.payload.startedAt,
        arrivesAt: event.payload.arrivesAt,
      },
      engagedResourceId: undefined,
      currentResourceId: undefined,
      resourceQueued: undefined,
      lastInteraction: `Moved from ${event.payload.fromLocationId} to ${event.payload.toLocationId}`,
    }));
    if (!alreadyArrived) {
      return routeAvatarForNavigation(
        next,
        event.agentId,
        event.payload.toLocationId,
      );
    }
    return settleElapsedNavigations(next, Date.now());
  }

  if (event.kind === 'world.interaction') {
    next = {
      ...next,
      worldEntities: next.worldEntities.map((entity) =>
        entity.id === event.payload.entityId
          ? {
              ...entity,
              state: { ...event.payload.state },
              stateVersion: event.payload.stateVersion,
              lastChangedBy: event.agentId,
            }
          : entity,
      ),
    };
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      engagedResourceId:
        event.payload.verb === 'use' && resourceById(event.payload.entityId)
          ? event.payload.entityId
          : agent.engagedResourceId,
      lastInteraction: event.payload.result,
      summary: event.payload.result,
    }));
  }

  if (event.kind === 'agent.activity') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: event.payload.phase,
      status: event.payload.status,
      summary: event.payload.summary,
    }));
    return next;
  }

  if (event.kind === 'research.topic.selected') {
    const topic = researchTopicProjection(event);
    next = {
      ...next,
      researchTopics: [
        ...next.researchTopics.filter(
          (candidate) => candidate.topicId !== topic.topicId,
        ),
        topic,
      ]
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-200),
    };
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'researching',
      status: 'working',
      currentTopicId: event.payload.topicId,
      researchQuestion: event.payload.question,
      summary: `Researching ${event.payload.title}`,
    }));
    return next;
  }

  if (event.kind === 'research.topic.updated') {
    next = {
      ...next,
      researchTopics: next.researchTopics.map((topic) =>
        topic.topicId === event.payload.topicId
          ? {
              ...topic,
              status: event.payload.status,
              summary: event.payload.summary ?? topic.summary,
              lastSequence: event.sequence,
            }
          : topic,
      ),
    };
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      summary:
        event.payload.summary ??
        `Research topic ${event.payload.status}: ${event.payload.topicId}`,
    }));
  }

  if (event.kind === 'artifact.recorded') {
    const artifact = artifactProjection(event);
    next = {
      ...next,
      artifacts: [
        ...next.artifacts.filter(
          (candidate) => candidate.artifactId !== artifact.artifactId,
        ),
        artifact,
      ]
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-500),
    };
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      artifactIds: [...new Set([...agent.artifactIds, artifact.artifactId])],
      summary: `Recorded ${artifact.kind}: ${artifact.title}`,
    }));
  }

  if (event.kind === 'tool.started') {
    const capability = (event.payload.capability ??
      inferToolCapability(event.payload.tool)) as ToolCapability;
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      status: 'working',
      activeTool: event.payload.tool,
      activeCapability: capability,
      currentResourceId: event.payload.resourceId,
      engagedResourceId: event.payload.resourceId,
      resourceQueued: false,
      currentTopicId: event.payload.topicId ?? agent.currentTopicId,
      summary: event.payload.summary,
    }));
    return next;
  }

  if (event.kind === 'tool.finished') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      activeTool: undefined,
      activeCapability: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
      lastToolResult:
        event.payload.summary ??
        `${event.payload.toolCallId} ${event.payload.outcome}`,
      artifactIds: [
        ...new Set([
          ...agent.artifactIds,
          ...(event.payload.artifactIds ?? []),
        ]),
      ],
      status: event.payload.outcome === 'failed' ? 'failed' : agent.status,
      summary:
        event.payload.summary ??
        `${event.payload.toolCallId} ${event.payload.outcome}`,
    }));
    return next;
  }

  if (event.kind === 'proximity.spoken') {
    // Speech is a social record, not a movement, work, or lifecycle command.
    // The world and journal project it directly from the append-only event.
    return next;
  }

  if (event.kind === 'agent.message') {
    return updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      lastMessage: event.payload.text,
      summary:
        event.payload.channel === 'final'
          ? 'Final response ready'
          : agent.summary,
    }));
  }

  if (event.kind === 'board.message') {
    const projection = boardProjection(event);
    next = {
      ...next,
      boardMessages: [
        ...next.boardMessages.filter(
          (message) => message.messageId !== projection.messageId,
        ),
        projection,
      ]
        .sort((left, right) => left.sequence - right.sequence)
        .slice(-500),
    };
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      lastMessage: boardPostingSummary(event),
    }));
    return next;
  }

  if (event.kind === 'board.acknowledged') {
    next = {
      ...next,
      boardMessages: applyBoardAcknowledgement(next.boardMessages, event),
    };
    return next;
  }

  if (event.kind === 'agent.blocked') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'waiting',
      status: 'blocked',
      summary: event.payload.request,
      blocker: { ...event.payload },
    }));
    return next;
  }

  if (event.kind === 'agent.resumed') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'tooling',
      status: 'working',
      blocker: undefined,
      summary: event.payload.response ?? 'Resuming runtime work',
    }));
    return next;
  }

  if (event.kind === 'agent.completed') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'completed',
      status: 'completed',
      summary: event.payload.summary,
      completedSummary: event.payload.summary,
      activeTool: undefined,
      activeCapability: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
      blocker: undefined,
    }));
    return removeTerminalAvatar(next, event.agentId);
  }

  if (event.kind === 'agent.failed') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'failed',
      status: 'failed',
      summary: event.payload.error,
      activeTool: undefined,
      activeCapability: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
    }));
    return removeTerminalAvatar(next, event.agentId);
  }

  if (event.kind === 'agent.stopped') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      phase: 'canceled',
      status: 'canceled',
      summary: event.payload.reason,
      activeTool: undefined,
      activeCapability: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
    }));
    return removeTerminalAvatar(next, event.agentId);
  }

  return next;
}

function directionFor(delta: Vec2): AvatarDirection {
  if (Math.abs(delta.x) > Math.abs(delta.y))
    return delta.x > 0 ? 'east' : 'west';
  return delta.y > 0 ? 'south' : 'north';
}

function advanceAvatar(
  avatar: AvatarProjection,
  deltaMs: number,
): AvatarProjection {
  if ((avatar.routeDelayMs ?? 0) > 0) {
    return {
      ...avatar,
      routeDelayMs: Math.max(0, (avatar.routeDelayMs ?? 0) - deltaMs),
    };
  }
  if (avatar.portalTransfer && avatar.path.length > 0) {
    const target = avatar.path[avatar.path.length - 1];
    return {
      ...avatar,
      position: { ...target },
      path: [],
      stationId: avatar.targetStationId ?? avatar.stationId,
      targetStationId: undefined,
      routeDelayMs: undefined,
      portalTransfer: false,
      isMoving: false,
    };
  }
  if (avatar.path.length === 0) {
    if (!avatar.isMoving && !avatar.targetStationId) return avatar;
    return {
      ...avatar,
      stationId: avatar.targetStationId ?? avatar.stationId,
      targetStationId: undefined,
      routeDelayMs: undefined,
      portalTransfer: false,
      isMoving: false,
    };
  }
  const target = avatar.path[0];
  const dx = target.x - avatar.position.x;
  const dy = target.y - avatar.position.y;
  const dxPixels = (dx / 100) * ARENA_WORLD_WIDTH;
  const dyPixels = (dy / 100) * ARENA_WORLD_HEIGHT;
  const distancePixels = Math.hypot(dxPixels, dyPixels);
  const stepPixels = (deltaMs / 1000) * 96;
  const direction = directionFor({ x: dx, y: dy });

  if (distancePixels <= stepPixels || distancePixels < 0.75) {
    const path = avatar.path.slice(1);
    const arrived: AvatarProjection = {
      ...avatar,
      position: { ...target },
      path,
      direction,
      stationId:
        path.length === 0 && avatar.targetStationId
          ? avatar.targetStationId
          : avatar.stationId,
      targetStationId: path.length === 0 ? undefined : avatar.targetStationId,
      routeDelayMs: undefined,
      portalTransfer: false,
      isMoving: path.length > 0,
    };
    if (path.length > 0) return arrived;
    return arrived;
  }

  return {
    ...avatar,
    position: {
      x:
        avatar.position.x +
        ((dxPixels / distancePixels) * stepPixels * 100) / ARENA_WORLD_WIDTH,
      y:
        avatar.position.y +
        ((dyPixels / distancePixels) * stepPixels * 100) / ARENA_WORLD_HEIGHT,
    },
    direction,
    isMoving: true,
  };
}

function advanceAvatars(avatars: AvatarProjection[], deltaMs: number) {
  const sliceCount = Math.max(1, Math.ceil(deltaMs / 32));
  const sliceMs = deltaMs / sliceCount;
  let current = avatars;
  for (let index = 0; index < sliceCount; index += 1) {
    const proposals = current.map((avatar) => advanceAvatar(avatar, sliceMs));
    current = resolveAvatarCollisions(current, proposals, sliceMs);
  }
  return current;
}

export function agentArenaReducer(
  state: AgentArenaState,
  action: AgentArenaAction,
): AgentArenaState {
  if (action.type === 'runtime.event')
    return applyRuntimeEvent(state, action.event);
  if (action.type === 'projection.tick') {
    const avatars = advanceAvatars(state.avatars, action.deltaMs);
    const avatarByAgentId = new Map(
      avatars.map((avatar) => [avatar.agentId, avatar]),
    );
    return {
      ...state,
      avatars,
      agents: state.agents.map((agent) => {
        const avatar = avatarByAgentId.get(agent.id);
        if (
          !agent.navigation ||
          !avatar ||
          avatar.isMoving ||
          avatar.stationId !== agent.navigation.toLocationId
        ) {
          return agent;
        }
        return {
          ...agent,
          currentLocationId: agent.navigation.toLocationId,
          navigation: undefined,
        };
      }),
    };
  }
  if (action.type === 'selection.changed')
    return { ...state, selectedAgentId: action.agentId };
  if (action.type === 'follow.changed')
    return { ...state, followedAgentId: action.agentId };
  return state;
}
