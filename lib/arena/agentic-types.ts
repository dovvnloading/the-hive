export type Vec2 = { x: number; y: number };

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

export type RuntimeAgentStatus = 'working' | 'idle' | 'blocked' | 'completed' | 'failed' | 'canceled';
export type RuntimeSource = 'mock' | 'codex';

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
  | EventEnvelope<'run.started', { objective: string }>
  | EventEnvelope<'run.completed', { summary: string }>
  | EventEnvelope<'run.canceled', { reason: string }>
  | EventEnvelope<'agent.spawned', { name: string; role: string }>
  | EventEnvelope<'task.assigned', { objective: string }>
  | EventEnvelope<
      'agent.activity',
      { phase: AgentPhase; summary: string; status: 'working' | 'idle' | 'blocked' }
    >
  | EventEnvelope<'tool.started', { toolCallId: string; tool: string; summary: string }>
  | EventEnvelope<
      'tool.finished',
      { toolCallId: string; outcome: 'succeeded' | 'failed'; summary?: string }
    >
  | EventEnvelope<
      'agent.message',
      { channel: 'commentary' | 'final'; text: string; targetAgentId?: string }
    >
  | EventEnvelope<
      'agent.blocked',
      { promptId: string; reason: 'approval' | 'question' | 'error'; request: string }
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
  | { type: 'InterruptAgent'; agentId: string }
  | { type: 'CancelRun'; reason?: string }
  | { type: 'RetryRun' };

export type CommandReceipt = {
  intentId: string;
  accepted: boolean;
  receivedAt: string;
  reason?: string;
};

export interface ArenaRuntime {
  start(objective: string): void;
  command(intent: OperatorIntent): Promise<CommandReceipt>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  destroy(): void;
}

export type RuntimeAgent = {
  id: string;
  name: string;
  role: string;
  parentAgentId?: string;
  taskId?: string;
  objective: string;
  phase: AgentPhase;
  status: RuntimeAgentStatus;
  summary: string;
  activeTool?: string;
  lastMessage?: string;
  blocker?: {
    promptId: string;
    reason: 'approval' | 'question' | 'error';
    request: string;
  };
  completedSummary?: string;
};

export type AvatarDirection = 'north' | 'south' | 'east' | 'west';

export type AvatarProjection = {
  agentId: string;
  position: Vec2;
  path: Vec2[];
  direction: AvatarDirection;
  isMoving: boolean;
  stationId: string;
  lastStationId: string;
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
  events: RuntimeEvent[];
  lastSequence: number;
  selectedAgentId?: string;
  followedAgentId?: string;
};

export type AgentArenaAction =
  | { type: 'runtime.event'; event: RuntimeEvent }
  | { type: 'projection.tick'; deltaMs: number }
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
  position: Vec2;
  slots: Vec2[];
};
