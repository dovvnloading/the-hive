export type Vec2 = { x: number; y: number };
export type WorldEntityState = Record<string, string | number | boolean>;

export type AgentPhase =
  | 'spawning'
  | 'planning'
  | 'delegating'
  | 'researching'
  | 'implementing'
  | 'tooling'
  | 'verifying'
  | 'synthesizing'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'canceled';

export type RuntimeAgentStatus =
  | 'working'
  | 'idle'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'canceled';
export type RuntimeSource = 'codex' | 'operator';
export type RuntimeConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected';

export type BoardMessageType = 'update' | 'question' | 'decision' | 'handoff';
export type BoardAudience = 'broadcast' | 'direct';
export type BoardAcknowledgementState = 'read' | 'acknowledged' | 'resolved';
export type ProximitySpeechAct = 'say' | 'invite' | 'accept' | 'decline';
export type CollaborationMode = 'collaborate' | 'recruit';
export type AssignmentMode = 'directed' | 'self-directed';
export type ToolCapability =
  | 'search'
  | 'browse'
  | 'read'
  | 'shell'
  | 'filesystem'
  | 'connector'
  | 'edit'
  | 'build'
  | 'test'
  | 'review'
  | 'publish'
  | 'communicate'
  | 'context';
export type ResearchTopicStatus = 'active' | 'blocked' | 'complete' | 'dropped';
export type ArtifactKind =
  | 'source-note'
  | 'change'
  | 'test-result'
  | 'decision';
export type ChatRelayState =
  | 'received'
  | 'claimed'
  | 'dispatched'
  | 'completed'
  | 'failed';

type EventEnvelope<K extends string, P> = {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  occurredAt: string;
  source: RuntimeSource;
  runId: string;
  agentId?: string;
  parentAgentId?: string;
  taskId?: string;
  correlationId?: string;
  kind: K;
  payload: P;
};

export type RuntimeEvent =
  | EventEnvelope<
      'sandbox.changed',
      {
        operation: string;
        revision: number;
        summary: string;
        projectId?: string;
      }
    >
  | EventEnvelope<'run.started', { objective: string }>
  | EventEnvelope<'run.completed', { summary: string }>
  | EventEnvelope<'run.canceled', { reason: string }>
  | EventEnvelope<
      'chat.ingress',
      {
        ingressId: string;
        sessionId: string;
        turnId: string;
        prompt: string;
        capturedAt: string;
      }
    >
  | EventEnvelope<
      'chat.relay',
      {
        ingressId: string;
        state: Exclude<ChatRelayState, 'received'>;
        targetAgentIds: string[];
        summary: string;
      }
    >
  | EventEnvelope<
      'agent.spawned',
      { name: string; role: string; position?: Vec2 }
    >
  | EventEnvelope<
      'task.assigned',
      { objective: string; mode?: AssignmentMode; position?: Vec2 }
    >
  | EventEnvelope<
      'world.navigation',
      {
        actionId: string;
        observationId: string;
        fromLocationId: string;
        toLocationId: string;
        startedAt: string;
        arrivesAt: string;
        /**
         * Bridge-authored motor projection. Older journals omit these fields;
         * live movement requires the complete set.
         */
        fromPosition?: Vec2;
        toPosition?: Vec2;
        path?: Vec2[];
        speedPxPerSecond?: number;
        reason?: string;
      }
    >
  | EventEnvelope<
      'world.interaction',
      {
        actionId: string;
        observationId: string;
        locationId: string;
        entityId: string;
        verb: string;
        result: string;
        stateVersion: number;
        state: WorldEntityState;
      }
    >
  | EventEnvelope<
      'agent.activity',
      {
        phase: AgentPhase;
        summary: string;
        status: 'working' | 'idle' | 'blocked';
      }
    >
  | EventEnvelope<
      'tool.started',
      {
        toolCallId: string;
        tool: string;
        summary: string;
        capability?: ToolCapability;
        activityId?: string;
        topicId?: string;
        resourceId: string;
      }
    >
  | EventEnvelope<
      'tool.finished',
      {
        toolCallId: string;
        outcome: 'succeeded' | 'failed';
        summary?: string;
        artifactIds?: string[];
      }
    >
  | EventEnvelope<
      'research.topic.selected',
      {
        topicId: string;
        parentTopicId?: string;
        title: string;
        question: string;
        reason?: string;
      }
    >
  | EventEnvelope<
      'research.topic.updated',
      { topicId: string; status: ResearchTopicStatus; summary?: string }
    >
  | EventEnvelope<
      'artifact.recorded',
      {
        artifactId: string;
        kind: ArtifactKind;
        title: string;
        summary: string;
        uri?: string;
        topicId?: string;
      }
    >
  | EventEnvelope<
      'agent.message',
      { channel: 'commentary' | 'final'; text: string; targetAgentId?: string }
    >
  | EventEnvelope<
      'proximity.spoken',
      {
        actionId: string;
        observationId: string;
        speechId: string;
        speechAct: ProximitySpeechAct;
        speakerLocationId: string;
        targetLocationId: string;
        targetAgentId: string;
        heardByAgentIds: string[];
        distancePx: number;
        text: string;
        preview: string;
        replyToSpeechId?: string;
        invitationId?: string;
        invitationMode?: CollaborationMode;
        objective?: string;
      }
    >
  | EventEnvelope<
      'board.message',
      {
        messageId: string;
        clientMessageId: string;
        threadId: string;
        topic: string;
        messageType: BoardMessageType;
        audience: BoardAudience;
        recipientAgentIds: string[];
        replyToMessageId?: string;
        topicId?: string;
        artifactIds?: string[];
        text: string;
      }
    >
  | EventEnvelope<
      'board.acknowledged',
      { messageId: string; state: BoardAcknowledgementState }
    >
  | EventEnvelope<
      'agent.blocked',
      {
        promptId: string;
        reason: 'approval' | 'question' | 'error';
        request: string;
      }
    >
  | EventEnvelope<'agent.resumed', { promptId: string; response?: string }>
  | EventEnvelope<'agent.completed', { summary: string }>
  | EventEnvelope<'agent.failed', { error: string }>
  | EventEnvelope<'agent.stopped', { reason: string }>;

export type OperatorIntent =
  | { type: 'SubmitObjective'; objective: string }
  | { type: 'ReplyToPrompt'; promptId: string; content: string }
  | { type: 'ApprovePrompt'; promptId: string; approved: boolean }
  | { type: 'SendFollowUp'; agentId: string; content: string }
  | {
      type: 'SendMailboxMessage';
      recipientAgentIds: string[];
      content: string;
    }
  | { type: 'InterruptAgent'; agentId: string }
  | { type: 'CancelRun'; reason?: string }
  | { type: 'RetryRun' };

export type OperatorMailboxDraft = {
  content: string;
  updatedAt?: string;
};

export type OperatorMailboxStatus = {
  runId: string;
  unreadDeliveryCount: number;
};

export type CommandReceipt = {
  intentId: string;
  accepted: boolean;
  receivedAt: string;
  reason?: string;
};

export interface ArenaRuntime {
  start(objective: string): void;
  command(
    intent: OperatorIntent,
    idempotencyKey?: string,
  ): Promise<CommandReceipt>;
  readMailboxDraft(): Promise<OperatorMailboxDraft>;
  writeMailboxDraft(content: string): Promise<OperatorMailboxDraft>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  subscribeConnection(
    listener: (status: RuntimeConnectionStatus) => void,
  ): () => void;
  subscribeMailboxStatus(
    listener: (status: OperatorMailboxStatus) => void,
  ): () => void;
  destroy(): void;
}

export type RuntimeAgent = {
  id: string;
  name: string;
  role: string;
  presentationIndex?: number;
  parentAgentId?: string;
  taskId?: string;
  assignmentMode?: AssignmentMode;
  objective: string;
  phase: AgentPhase;
  status: RuntimeAgentStatus;
  summary: string;
  activeTool?: string;
  activeCapability?: ToolCapability;
  activeActivityId?: string;
  currentResourceId?: string;
  currentLocationId: string;
  currentPosition?: Vec2;
  navigation?: {
    actionId: string;
    fromLocationId: string;
    toLocationId: string;
    startedAt: string;
    arrivesAt: string;
    fromPosition?: Vec2;
    toPosition?: Vec2;
    path?: Vec2[];
    speedPxPerSecond?: number;
  };
  engagedResourceId?: string;
  resourceQueued?: boolean;
  currentTopicId?: string;
  researchQuestion?: string;
  lastToolResult?: string;
  artifactIds: string[];
  lastMessage?: string;
  lastInteraction?: string;
  blocker?: {
    promptId: string;
    reason: 'approval' | 'question' | 'error';
    request: string;
  };
  completedSummary?: string;
};

export type AvatarDirection = 'north' | 'south' | 'east' | 'west';

export type AvatarNavigationProjection = {
  actionId: string;
  fromStationId: string;
  toStationId: string;
  fromPosition: Vec2;
  toPosition: Vec2;
  /** Ordered bridge-authored route, normalized to include both endpoints. */
  path: Vec2[];
  speedPxPerSecond: number;
  startedAt: number;
  arrivesAt: number;
  /** Legacy events can retain semantic timing without inventing a route. */
  legacyFrozen?: boolean;
};

export type AvatarProjection = {
  agentId: string;
  position: Vec2;
  path: Vec2[];
  direction: AvatarDirection;
  isMoving: boolean;
  navigation?: AvatarNavigationProjection;
  routeOrder?: number;
  routeDelayMs?: number;
  portalTransfer?: boolean;
  stationId: string;
  targetStationId?: string;
  lastStationId: string;
  isYielding?: boolean;
  yieldingToAgentId?: string;
  yieldMs?: number;
  nearbyAgentIds?: string[];
};

export type BoardAcknowledgementProjection = {
  agentId: string;
  state: BoardAcknowledgementState;
  sequence: number;
  occurredAt: string;
};

export type BoardMessageProjection = {
  eventId: string;
  sequence: number;
  occurredAt: string;
  authorAgentId: string;
  messageId: string;
  clientMessageId: string;
  threadId: string;
  topic: string;
  messageType: BoardMessageType;
  audience: BoardAudience;
  recipientAgentIds: string[];
  replyToMessageId?: string;
  topicId?: string;
  artifactIds?: string[];
  text: string;
  correlationId?: string;
  acknowledgements: BoardAcknowledgementProjection[];
};

export type ChatIngressStage = {
  state: ChatRelayState;
  sequence: number;
  occurredAt: string;
  summary?: string;
  targetAgentIds: string[];
};

export type ChatIngressProjection = {
  ingressId: string;
  sessionId: string;
  turnId: string;
  prompt: string;
  capturedAt: string;
  sequence: number;
  occurredAt: string;
  state: ChatRelayState;
  summary?: string;
  targetAgentIds: string[];
  stages: ChatIngressStage[];
  lastSequence: number;
};

export type ResearchTopicProjection = {
  eventId: string;
  sequence: number;
  occurredAt: string;
  topicId: string;
  parentTopicId?: string;
  ownerAgentId: string;
  title: string;
  question: string;
  reason?: string;
  status: ResearchTopicStatus;
  summary?: string;
  lastSequence: number;
};

export type ArtifactProjection = {
  eventId: string;
  sequence: number;
  occurredAt: string;
  artifactId: string;
  authorAgentId: string;
  kind: ArtifactKind;
  title: string;
  summary: string;
  uri?: string;
  topicId?: string;
};

export type WorldEntityProjection = {
  id: string;
  roomId: string;
  label: string;
  kind: string;
  state: WorldEntityState;
  stateVersion: number;
  lastChangedBy?: string;
  lastChangedAt?: string;
};

export type RunStatus = 'booting' | 'running' | 'completed' | 'canceled';

export type AgentArenaState = {
  runId: string;
  runStatus: RunStatus;
  objective: string;
  summary?: string;
  source: RuntimeSource;
  agents: RuntimeAgent[];
  avatars: AvatarProjection[];
  boardMessages: BoardMessageProjection[];
  chatIngresses: ChatIngressProjection[];
  researchTopics: ResearchTopicProjection[];
  artifacts: ArtifactProjection[];
  worldEntities: WorldEntityProjection[];
  events: RuntimeEvent[];
  lastSequence: number;
  selectedAgentId?: string;
  followedAgentId?: string;
};

export type AgentArenaAction =
  | { type: 'runtime.event'; event: RuntimeEvent }
  | { type: 'projection.tick'; now: number; deltaMs?: never }
  /** Compatibility for archived worktree callers; the reducer ignores deltaMs. */
  | { type: 'projection.tick'; deltaMs: number; now?: never }
  | { type: 'selection.changed'; agentId?: string }
  | { type: 'follow.changed'; agentId?: string };

export type AgentPresentation = {
  sprite: string;
  accent: string;
  shortRole: string;
};

export type StationDefinition = {
  id: string;
  name: string;
  roomId: string;
  kind: string;
  capabilities: string[];
  position: Vec2;
  slots: Vec2[];
};
