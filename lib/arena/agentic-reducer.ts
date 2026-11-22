import {
  FACILITY_PROPS,
  allocatePresentationIndex,
  inferToolCapability,
  resourceById,
  slotForAgent,
  stationById,
} from './agentic-catalog';
import {
  facilityPathIsSweptLegal,
  facilityPathTimingIsConsistent,
  selectFacilityActivity,
} from './facility-protocol.mjs';
import { ARENA_WORLD_HEIGHT, ARENA_WORLD_WIDTH } from './agentic-spatial';
import type {
  AgentArenaAction,
  AgentArenaState,
  AvatarDirection,
  AvatarNavigationProjection,
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

const POSITION_EPSILON = 0.0001;
const NEARBY_DISTANCE_PX = 72;

function samePosition(left: Vec2, right: Vec2) {
  return (
    Math.abs(left.x - right.x) < POSITION_EPSILON &&
    Math.abs(left.y - right.y) < POSITION_EPSILON
  );
}

function legacyStationPosition(stationId: string): Vec2 {
  const station = stationById(stationId);
  return { ...(station.slots[0] ?? station.position) };
}

function legacyReservedPositions(
  state: AgentArenaState,
  exceptAgentId: string,
) {
  return state.avatars.flatMap((avatar) => {
    if (avatar.agentId === exceptAgentId) return [];
    return [
      avatar.position,
      ...(avatar.navigation ? [avatar.navigation.toPosition] : []),
    ];
  });
}

function legacyStationSlot(
  state: AgentArenaState,
  stationId: string,
  agentId: string,
) {
  return slotForAgent(
    stationId,
    agentId,
    legacyReservedPositions(state, agentId),
  );
}

function metricDistance(left: Vec2, right: Vec2) {
  const dx = ((right.x - left.x) / 100) * ARENA_WORLD_WIDTH;
  const dy = ((right.y - left.y) / 100) * ARENA_WORLD_HEIGHT;
  return Math.hypot(dx, dy);
}

function directionFor(delta: Vec2): AvatarDirection {
  if (Math.abs(delta.x) > Math.abs(delta.y))
    return delta.x > 0 ? 'east' : 'west';
  return delta.y > 0 ? 'south' : 'north';
}

function normalizedMotorPath(from: Vec2, path: Vec2[]) {
  return [from, ...path].reduce<Vec2[]>((points, point) => {
    if (
      points.length === 0 ||
      !samePosition(points[points.length - 1], point)
    ) {
      points.push({ ...point });
    }
    return points;
  }, []);
}

function projectNavigationAt(
  navigation: AvatarNavigationProjection,
  at: number,
  fallbackDirection: AvatarDirection,
) {
  const done = at >= navigation.arrivesAt;
  if (navigation.legacyFrozen) {
    return {
      position: {
        ...(done ? navigation.toPosition : navigation.fromPosition),
      },
      direction: fallbackDirection,
      isMoving: false,
      done,
    };
  }

  const points = navigation.path;
  const segments = points.slice(1).map((point, index) => ({
    from: points[index],
    to: point,
    distance: metricDistance(points[index], point),
  }));
  const totalDistance = segments.reduce(
    (total, segment) => total + segment.distance,
    0,
  );
  const elapsed = Math.max(0, at - navigation.startedAt);
  let remaining = done
    ? totalDistance
    : Math.min(totalDistance, (elapsed / 1_000) * navigation.speedPxPerSecond);

  for (const segment of segments) {
    if (segment.distance <= POSITION_EPSILON) continue;
    const direction = directionFor({
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y,
    });
    if (remaining <= segment.distance) {
      const segmentProgress = remaining / segment.distance;
      return {
        position: {
          x: segment.from.x + (segment.to.x - segment.from.x) * segmentProgress,
          y: segment.from.y + (segment.to.y - segment.from.y) * segmentProgress,
        },
        direction,
        isMoving:
          at >= navigation.startedAt &&
          !done &&
          navigation.speedPxPerSecond > 0 &&
          totalDistance > POSITION_EPSILON,
        done,
      };
    }
    remaining -= segment.distance;
  }

  const finalSegment = segments[segments.length - 1];
  return {
    position: { ...navigation.toPosition },
    direction: finalSegment
      ? directionFor({
          x: finalSegment.to.x - finalSegment.from.x,
          y: finalSegment.to.y - finalSegment.from.y,
        })
      : fallbackDirection,
    isMoving: false,
    done,
  };
}

function navigationProjection(
  avatar: AvatarProjection,
  event: Extract<RuntimeEvent, { kind: 'world.navigation' }>,
  receivedAt: number,
  legacyToPosition: Vec2,
): AvatarNavigationProjection | undefined {
  const { payload } = event;
  const startedAt = Date.parse(payload.startedAt);
  const arrivesAt = Date.parse(payload.arrivesAt);
  const hasAnyMotorField = [
    payload.fromPosition,
    payload.toPosition,
    payload.path,
    payload.speedPxPerSecond,
  ].some((value) => value !== undefined);
  if (
    payload.fromPosition &&
    payload.toPosition &&
    payload.path &&
    payload.path.length > 0 &&
    samePosition(payload.path[payload.path.length - 1], payload.toPosition) &&
    payload.speedPxPerSecond !== undefined &&
    Number.isFinite(payload.speedPxPerSecond) &&
    payload.speedPxPerSecond > 0 &&
    Number.isFinite(startedAt) &&
    Number.isFinite(arrivesAt) &&
    arrivesAt > startedAt &&
    facilityPathIsSweptLegal(payload.fromPosition, payload.path) &&
    facilityPathTimingIsConsistent(
      payload.fromPosition,
      payload.path,
      payload.speedPxPerSecond,
      arrivesAt - startedAt,
    )
  ) {
    return {
      actionId: payload.actionId,
      fromStationId: payload.fromLocationId,
      toStationId: payload.toLocationId,
      fromPosition: { ...payload.fromPosition },
      toPosition: { ...payload.toPosition },
      path: normalizedMotorPath(payload.fromPosition, payload.path),
      speedPxPerSecond: payload.speedPxPerSecond,
      startedAt,
      arrivesAt,
    };
  }
  if (hasAnyMotorField) return undefined;

  // An old journal has no physical route. Historical events hydrate to the
  // authored station without animation; a live legacy event remains frozen
  // until its semantic arrival rather than recreating unsafe client routing.
  return {
    actionId: payload.actionId,
    fromStationId: payload.fromLocationId,
    toStationId: payload.toLocationId,
    fromPosition: { ...avatar.position },
    toPosition: { ...legacyToPosition },
    path: normalizedMotorPath(avatar.position, [legacyToPosition]),
    speedPxPerSecond: 0,
    startedAt,
    arrivesAt,
    legacyFrozen: true,
  };
}

function projectAvatarAt(avatar: AvatarProjection, at: number) {
  if (!avatar.navigation) return avatar;
  const projection = projectNavigationAt(
    avatar.navigation,
    at,
    avatar.direction,
  );
  if (!projection.done) {
    return {
      ...avatar,
      position: projection.position,
      direction: projection.direction,
      isMoving: projection.isMoving,
    };
  }
  return {
    ...avatar,
    position: projection.position,
    path: [],
    direction: projection.direction,
    isMoving: false,
    stationId: avatar.navigation.toStationId,
    targetStationId: undefined,
    lastStationId: avatar.navigation.fromStationId,
    navigation: undefined,
    routeDelayMs: undefined,
    portalTransfer: false,
    isYielding: false,
    yieldingToAgentId: undefined,
    yieldMs: 0,
  };
}

function annotateNearbyAgents(avatars: AvatarProjection[]) {
  return avatars.map((avatar) => ({
    ...avatar,
    nearbyAgentIds: avatars
      .filter(
        (candidate) =>
          candidate.agentId !== avatar.agentId &&
          metricDistance(candidate.position, avatar.position) <=
            NEARBY_DISTANCE_PX,
      )
      .map((candidate) => candidate.agentId)
      .sort(),
  }));
}

function reactivateAvatar(state: AgentArenaState, agentId: string) {
  if (state.avatars.some((avatar) => avatar.agentId === agentId)) return state;
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  const stationId = agent?.currentLocationId ?? 'spawn-lift';
  const position = agent?.currentPosition ?? legacyStationPosition(stationId);
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
  return {
    ...state,
    avatars: [...state.avatars, avatar],
  };
}

function removeTerminalAvatar(state: AgentArenaState, agentId: string) {
  const avatar = state.avatars.find(
    (candidate) => candidate.agentId === agentId,
  );
  const terminalPosition = avatar?.navigation?.toPosition ?? avatar?.position;
  const terminalLocationId =
    avatar?.navigation?.toStationId ?? avatar?.stationId;
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            currentLocationId: terminalLocationId ?? agent.currentLocationId,
            currentPosition: terminalPosition
              ? { ...terminalPosition }
              : agent.currentPosition,
            navigation: undefined,
          }
        : agent,
    ),
    avatars: state.avatars.filter((avatar) => avatar.agentId !== agentId),
    followedAgentId:
      state.followedAgentId === agentId ? undefined : state.followedAgentId,
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
    const position = event.payload.position
      ? { ...event.payload.position }
      : legacyStationSlot(next, stationId, event.agentId);
    const agent: RuntimeAgent = {
      id: event.agentId,
      name: event.payload.name,
      role: event.payload.role,
      presentationIndex: allocatePresentationIndex(
        event.agentId,
        next.avatars.flatMap((avatar) => {
          const resident = next.agents.find(
            (candidate) => candidate.id === avatar.agentId,
          );
          return resident?.presentationIndex === undefined
            ? []
            : [resident.presentationIndex];
        }),
      ),
      parentAgentId: event.parentAgentId,
      objective: 'Waiting for an assignment',
      phase: 'spawning',
      status: 'idle',
      summary: 'Joining the run',
      currentLocationId: stationId,
      currentPosition: { ...position },
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
      assignmentMode: event.payload.mode ?? 'directed',
      objective: event.payload.objective,
      phase: 'planning',
      summary: 'Assignment received',
      status: 'working',
      activeTool: undefined,
      activeCapability: undefined,
      activeActivityId: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
      currentTopicId: undefined,
      researchQuestion: undefined,
      blocker: undefined,
      currentPosition: event.payload.position
        ? { ...event.payload.position }
        : agent.currentPosition,
    }));
    next = reactivateAvatar(next, event.agentId);
    return next;
  }

  if (event.kind === 'world.navigation') {
    const receivedAt = Date.now();
    const currentAvatar = next.avatars.find(
      (avatar) => avatar.agentId === event.agentId,
    );
    if (!currentAvatar) return next;
    const navigation = navigationProjection(
      currentAvatar,
      event,
      receivedAt,
      legacyStationSlot(next, event.payload.toLocationId, event.agentId),
    );
    if (!navigation) return next;
    const avatar = projectAvatarAt(
      {
        ...currentAvatar,
        position: { ...navigation.fromPosition },
        path: [...navigation.path],
        isMoving: false,
        navigation,
        stationId: event.payload.fromLocationId,
        targetStationId: event.payload.toLocationId,
        lastStationId: currentAvatar.stationId,
        routeDelayMs: undefined,
        portalTransfer: false,
        isYielding: false,
        yieldingToAgentId: undefined,
        yieldMs: 0,
      },
      receivedAt,
    );
    const arrived = avatar.navigation === undefined;
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      currentLocationId: arrived
        ? event.payload.toLocationId
        : event.payload.fromLocationId,
      currentPosition: { ...avatar.position },
      navigation: arrived
        ? undefined
        : {
            actionId: event.payload.actionId,
            fromLocationId: event.payload.fromLocationId,
            toLocationId: event.payload.toLocationId,
            startedAt: event.payload.startedAt,
            arrivesAt: event.payload.arrivesAt,
            fromPosition: event.payload.fromPosition
              ? { ...event.payload.fromPosition }
              : undefined,
            toPosition: event.payload.toPosition
              ? { ...event.payload.toPosition }
              : undefined,
            path: event.payload.path?.map((point) => ({ ...point })),
            speedPxPerSecond: event.payload.speedPxPerSecond,
          },
      engagedResourceId: undefined,
      currentResourceId: undefined,
      resourceQueued: undefined,
      lastInteraction: `Moved from ${event.payload.fromLocationId} to ${event.payload.toLocationId}`,
    }));
    return {
      ...next,
      avatars: next.avatars.map((candidate) =>
        candidate.agentId === event.agentId ? avatar : candidate,
      ),
    };
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
              lastChangedAt: event.occurredAt,
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
    const activity = selectFacilityActivity(event.payload.resourceId, {
      activityId: event.payload.activityId,
      capability,
    });
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      status: 'working',
      activeTool: event.payload.tool,
      activeCapability: capability,
      activeActivityId: activity?.id,
      currentResourceId: event.payload.resourceId,
      engagedResourceId: event.payload.resourceId,
      resourceQueued: false,
      summary: event.payload.summary,
    }));
    return next;
  }

  if (event.kind === 'tool.finished') {
    next = updateAgent(next, event.agentId, (agent) => ({
      ...agent,
      activeTool: undefined,
      activeCapability: undefined,
      activeActivityId: undefined,
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
      activeActivityId: undefined,
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
      activeActivityId: undefined,
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
      activeActivityId: undefined,
      currentResourceId: undefined,
      engagedResourceId: undefined,
      resourceQueued: undefined,
    }));
    return removeTerminalAvatar(next, event.agentId);
  }

  return next;
}

export function agentArenaReducer(
  state: AgentArenaState,
  action: AgentArenaAction,
): AgentArenaState {
  if (action.type === 'runtime.event') {
    const next = applyRuntimeEvent(state, action.event);
    // Arrival, spawn, and departure can alter proximity without another
    // movement frame, including when replaying an already-finished route.
    return next.avatars === state.avatars
      ? next
      : {
          ...next,
          avatars: annotateNearbyAgents(next.avatars),
        };
  }
  if (action.type === 'projection.tick') {
    // Root production callers supply `now`. Archived worktree callers can
    // still compile with deltaMs, but no delta is accumulated here.
    const now = action.now ?? Date.now();
    // A quiet facility needs no React updates. Only authored navigation can
    // change the projection between incoming events.
    if (!state.avatars.some((avatar) => avatar.navigation)) return state;
    const avatars = annotateNearbyAgents(
      state.avatars.map((avatar) => projectAvatarAt(avatar, now)),
    );
    const avatarByAgentId = new Map(
      avatars.map((avatar) => [avatar.agentId, avatar]),
    );
    return {
      ...state,
      avatars,
      agents: state.agents.map((agent) => {
        const avatar = avatarByAgentId.get(agent.id);
        if (!avatar) return agent;
        const arrived =
          agent.navigation &&
          avatar.navigation === undefined &&
          avatar.stationId === agent.navigation.toLocationId;
        if (
          !arrived &&
          agent.currentPosition?.x === avatar.position.x &&
          agent.currentPosition?.y === avatar.position.y
        )
          return agent;
        return {
          ...agent,
          currentLocationId: arrived
            ? agent.navigation!.toLocationId
            : agent.currentLocationId,
          currentPosition: { ...avatar.position },
          navigation: arrived ? undefined : agent.navigation,
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
