import type { ArenaRuntime, OperatorIntent, RuntimeEvent } from './agentic-types';

type Timer = ReturnType<typeof setTimeout>;

export class MockAgentRuntime implements ArenaRuntime {
  private listeners = new Set<(event: RuntimeEvent) => void>();
  private timers: Timer[] = [];
  private sequence = 0;
  private runNumber = 0;
  private runId = 'mock-boot';
  private objective = '';
  private blockedPrompts = new Map<string, string>();

  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.clearTimers();
    this.listeners.clear();
  }

  start(objective: string) {
    this.clearTimers();
    this.blockedPrompts.clear();
    this.runNumber += 1;
    this.runId = `mock-run-${this.runNumber}`;
    this.objective = objective;

    this.emit('run.started', { objective });
    this.scheduleScenario();
  }

  async command(intent: OperatorIntent) {
    const intentId = `intent-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    if (intent.type === 'SubmitObjective') {
      const objective = intent.objective.trim();
      if (!objective) return { intentId, accepted: false, receivedAt: new Date().toISOString(), reason: 'Objective is empty' };
      this.later(120, () => this.start(objective));
    } else if (intent.type === 'ApprovePrompt') {
      const agentId = this.blockedPrompts.get(intent.promptId);
      if (!agentId) return { intentId, accepted: false, receivedAt: new Date().toISOString(), reason: 'Prompt is no longer active' };
      this.resumeBlocked(agentId, intent.promptId, intent.approved ? 'Approval received' : 'Request denied');
      if (!intent.approved) this.emit('agent.stopped', { reason: 'Operator denied the requested action' }, { agentId });
    } else if (intent.type === 'ReplyToPrompt') {
      const agentId = this.blockedPrompts.get(intent.promptId);
      if (!agentId) return { intentId, accepted: false, receivedAt: new Date().toISOString(), reason: 'Prompt is no longer active' };
      this.resumeBlocked(agentId, intent.promptId, intent.content);
    } else if (intent.type === 'SendFollowUp') {
      this.emit('agent.message', { channel: 'commentary', text: `Follow-up received: ${intent.content}` }, { agentId: intent.agentId });
      this.emit('agent.activity', { phase: 'planning', status: 'working', summary: 'Revising the approach from operator feedback' }, { agentId: intent.agentId });
    } else if (intent.type === 'InterruptAgent') {
      this.emit('agent.stopped', { reason: 'Interrupted by the operator' }, { agentId: intent.agentId });
    } else if (intent.type === 'CancelRun') {
      this.clearTimers();
      this.emit('run.canceled', { reason: intent.reason ?? 'Canceled by the operator' });
    } else if (intent.type === 'RetryRun') {
      this.later(120, () => this.start(this.objective));
    }
    return { intentId, accepted: true, receivedAt: new Date().toISOString() };
  }

  private clearTimers() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers = [];
  }

  private later(delayMs: number, action: () => void) {
    const timer = setTimeout(action, delayMs);
    this.timers.push(timer);
  }

  private emit<K extends RuntimeEvent['kind']>(
    kind: K,
    payload: Extract<RuntimeEvent, { kind: K }>['payload'],
    meta: { agentId?: string; parentAgentId?: string; taskId?: string; correlationId?: string } = {},
  ) {
    this.sequence += 1;
    const event = {
      schemaVersion: 1,
      eventId: `${this.runId}-${this.sequence}`,
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
      source: 'mock',
      runId: this.runId,
      kind,
      payload,
      ...meta,
    } as Extract<RuntimeEvent, { kind: K }>;
    this.listeners.forEach((listener) => listener(event));
  }

  private resumeBlocked(agentId: string, promptId: string, response: string) {
    if (!this.blockedPrompts.has(promptId)) return;
    this.blockedPrompts.delete(promptId);
    this.emit('agent.resumed', { promptId, response }, { agentId });
  }

  private scheduleScenario() {
    const task = (agentId: string, taskId: string, objective: string, at: number) => {
      this.later(at, () => this.emit('task.assigned', { objective }, { agentId, taskId }));
    };
    const activity = (
      agentId: string,
      at: number,
      phase: Extract<RuntimeEvent, { kind: 'agent.activity' }>['payload']['phase'],
      summary: string,
    ) => this.later(at, () => this.emit('agent.activity', { phase, status: 'working', summary }, { agentId }));
    const spawn = (agentId: string, name: string, role: string, parentAgentId: string | undefined, at: number) =>
      this.later(at, () => this.emit('agent.spawned', { name, role }, { agentId, parentAgentId }));

    spawn('atlas', 'Atlas', 'Orchestrator', undefined, 120);
    task('atlas', 'task-atlas', `Decompose: ${this.objective}`, 300);
    activity('atlas', 650, 'planning', 'Reading the objective and forming a work graph');
    activity('atlas', 2000, 'delegating', 'Spawning specialists against independent workstreams');

    spawn('sage', 'Sage', 'Research lead', 'atlas', 2500);
    task('sage', 'task-sage', 'Audit a coherent sprite system and verify its license', 2700);
    activity('sage', 3000, 'researching', 'Inspecting authored character sheets and provenance');

    spawn('nova', 'Nova', 'Interface engineer', 'atlas', 3300);
    task('nova', 'task-nova', 'Build the spatial renderer and restrained operator surface', 3500);
    activity('nova', 3800, 'implementing', 'Composing the pixel world and runtime projection');

    spawn('kernel', 'Kernel', 'Verification', 'atlas', 4100);
    task('kernel', 'task-kernel', 'Audit the normalized event contract and replay behavior', 4300);
    activity('kernel', 4600, 'verifying', 'Constructing deterministic lifecycle checks');

    this.later(5400, () => this.emit('tool.started', { toolCallId: 'tool-sage-search', tool: 'asset.audit', summary: 'Inspecting directional frames at native scale' }, { agentId: 'sage' }));
    this.later(6100, () => this.emit('tool.started', { toolCallId: 'tool-nova-editor', tool: 'workspace.edit', summary: 'Building the full-screen arena' }, { agentId: 'nova' }));
    this.later(6800, () => this.emit('tool.started', { toolCallId: 'tool-kernel-test', tool: 'event.replay', summary: 'Replaying the normalized event stream' }, { agentId: 'kernel' }));

    this.later(9800, () => this.emit('tool.finished', { toolCallId: 'tool-sage-search', outcome: 'succeeded', summary: 'Directional run, idle, phone, and seated sheets verified' }, { agentId: 'sage' }));
    this.later(10300, () => this.emit('agent.message', { channel: 'commentary', text: 'Native sheets verified. Passing exact frame contracts to Nova.', targetAgentId: 'nova' }, { agentId: 'sage' }));
    activity('sage', 10800, 'synthesizing', 'Packaging sprite contracts and provenance notes');

    this.later(13200, () => {
      const promptId = `bridge-${this.runId}`;
      this.blockedPrompts.set(promptId, 'kernel');
      this.emit('agent.blocked', { promptId, reason: 'approval', request: 'Run the local-only event replay against the live projection?' }, { agentId: 'kernel' });
    });

    this.later(12600, () => this.emit('agent.completed', { summary: 'Sprite system verified and handed off' }, { agentId: 'sage' }));

    this.later(16400, () => {
      const promptId = `bridge-${this.runId}`;
      if (this.blockedPrompts.has(promptId)) this.resumeBlocked('kernel', promptId, 'Local prototype policy auto-approved');
    });
    this.later(17300, () => this.emit('tool.started', { toolCallId: 'tool-kernel-test-2', tool: 'event.replay', summary: 'Replaying the accepted lifecycle stream' }, { agentId: 'kernel' }));
    this.later(18800, () => this.emit('tool.finished', { toolCallId: 'tool-nova-editor', outcome: 'succeeded', summary: 'Autonomous arena renderer online' }, { agentId: 'nova' }));
    activity('nova', 19400, 'verifying', 'Checking the renderer against live lifecycle events');
    this.later(20200, () => this.emit('tool.finished', { toolCallId: 'tool-kernel-test-2', outcome: 'succeeded', summary: 'Replay rebuilt the same projection state' }, { agentId: 'kernel' }));
    activity('kernel', 20700, 'synthesizing', 'Writing the replay contract for Atlas');
    this.later(21400, () => this.emit('agent.completed', { summary: 'Event contract and replay checks passed' }, { agentId: 'kernel' }));
    this.later(22000, () => this.emit('agent.completed', { summary: 'Spatial renderer and operator surface complete' }, { agentId: 'nova' }));

    activity('atlas', 22800, 'synthesizing', 'Reviewing specialist outputs and preparing the handoff');
    this.later(24800, () => this.emit('agent.message', { channel: 'final', text: 'The autonomous arena foundation is coherent and ready for a real Codex bridge.' }, { agentId: 'atlas' }));
    this.later(25800, () => this.emit('agent.completed', { summary: 'Run orchestrated and integrated successfully' }, { agentId: 'atlas' }));
    this.later(26600, () => this.emit('run.completed', { summary: 'Four autonomous agents completed the arena foundation.' }));
  }
}
