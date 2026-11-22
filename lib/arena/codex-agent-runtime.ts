import type {
  AgentPhase,
  ArenaRuntime,
  CommandReceipt,
  OperatorMailboxDraft,
  OperatorMailboxStatus,
  OperatorIntent,
  RuntimeConnectionStatus,
  RuntimeEvent,
  Vec2,
} from './agentic-types';
import {
  facilityPathIsSweptLegal,
  facilityPathTimingIsConsistent,
} from './facility-protocol.mjs';

const DEFAULT_BRIDGE_ORIGIN = 'http://127.0.0.1:8787';
const CONNECTED_POLL_DELAY_MS = 450;
const FIRST_RECONNECT_DELAY_MS = 600;
const MAX_RECONNECT_DELAY_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;
const REMEMBERED_EVENT_IDS = 2_048;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function hasOptionalString(record: JsonRecord, key: string) {
  return record[key] === undefined || isString(record[key]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function mailboxDraftFromResponse(
  value: unknown,
): OperatorMailboxDraft | undefined {
  if (!isRecord(value) || !isString(value.content)) return undefined;
  if (!hasOptionalString(value, 'updatedAt')) return undefined;
  return {
    content: value.content,
    ...(isString(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
  };
}

function mailboxStatusFromResponse(
  value: unknown,
): OperatorMailboxStatus | undefined {
  if (
    !isRecord(value) ||
    !isString(value.runId) ||
    !Number.isSafeInteger(value.mailboxUnreadDeliveryCount) ||
    (value.mailboxUnreadDeliveryCount as number) < 0
  ) {
    return undefined;
  }
  return {
    runId: value.runId,
    unreadDeliveryCount: value.mailboxUnreadDeliveryCount as number,
  };
}

function isVec2(value: unknown): value is Vec2 {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  );
}

function isVec2Array(value: unknown): value is Vec2[] {
  return Array.isArray(value) && value.every(isVec2);
}

function sameVec2(left: unknown, right: unknown) {
  return (
    isVec2(left) &&
    isVec2(right) &&
    Math.abs(left.x - right.x) < 0.0001 &&
    Math.abs(left.y - right.y) < 0.0001
  );
}

function hasOptionalStringArray(record: JsonRecord, key: string) {
  return record[key] === undefined || isStringArray(record[key]);
}

function isWorldState(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  );
}

const AGENT_PHASES = new Set<AgentPhase>([
  'spawning',
  'planning',
  'delegating',
  'researching',
  'implementing',
  'tooling',
  'verifying',
  'synthesizing',
  'waiting',
  'completed',
  'failed',
  'canceled',
]);
const TOOL_CAPABILITIES = new Set([
  'search',
  'browse',
  'read',
  'shell',
  'filesystem',
  'connector',
  'edit',
  'build',
  'test',
  'review',
  'publish',
  'communicate',
  'context',
]);
const RESEARCH_TOPIC_STATES = new Set([
  'active',
  'blocked',
  'complete',
  'dropped',
]);
const ARTIFACT_KINDS = new Set([
  'source-note',
  'change',
  'test-result',
  'decision',
]);

function hasValidPayload(kind: RuntimeEvent['kind'], payload: JsonRecord) {
  if (kind === 'sandbox.changed')
    return (
      isString(payload.operation) &&
      Number.isSafeInteger(payload.revision) &&
      isString(payload.summary)
    );
  if (kind === 'run.started') return isString(payload.objective);
  if (kind === 'run.completed') return isString(payload.summary);
  if (kind === 'run.canceled') return isString(payload.reason);
  if (kind === 'chat.ingress') {
    return (
      isString(payload.ingressId) &&
      isString(payload.sessionId) &&
      isString(payload.turnId) &&
      isString(payload.prompt) &&
      isString(payload.capturedAt) &&
      !Number.isNaN(Date.parse(payload.capturedAt))
    );
  }
  if (kind === 'chat.relay') {
    return (
      isString(payload.ingressId) &&
      (payload.state === 'claimed' ||
        payload.state === 'dispatched' ||
        payload.state === 'completed' ||
        payload.state === 'failed') &&
      isStringArray(payload.targetAgentIds) &&
      isString(payload.summary)
    );
  }
  if (kind === 'agent.spawned')
    return (
      isString(payload.name) &&
      isString(payload.role) &&
      (payload.position === undefined || isVec2(payload.position))
    );
  if (kind === 'task.assigned')
    return (
      isString(payload.objective) &&
      (payload.position === undefined || isVec2(payload.position))
    );
  if (kind === 'world.navigation') {
    const startedAt = Date.parse(String(payload.startedAt));
    const arrivesAt = Date.parse(String(payload.arrivesAt));
    const motionFields = [
      payload.fromPosition,
      payload.toPosition,
      payload.path,
      payload.speedPxPerSecond,
    ];
    const motionFieldCount = motionFields.filter(
      (value) => value !== undefined,
    ).length;
    const hasValidMotionProjection =
      motionFieldCount === 0 ||
      (motionFieldCount === motionFields.length &&
        isVec2(payload.fromPosition) &&
        isVec2(payload.toPosition) &&
        isVec2Array(payload.path) &&
        payload.path.length > 0 &&
        sameVec2(payload.path[payload.path.length - 1], payload.toPosition) &&
        typeof payload.speedPxPerSecond === 'number' &&
        Number.isFinite(payload.speedPxPerSecond) &&
        payload.speedPxPerSecond > 0 &&
        facilityPathIsSweptLegal(payload.fromPosition, payload.path) &&
        facilityPathTimingIsConsistent(
          payload.fromPosition,
          payload.path,
          payload.speedPxPerSecond,
          arrivesAt - startedAt,
        ));
    return (
      isString(payload.actionId) &&
      isString(payload.observationId) &&
      isString(payload.fromLocationId) &&
      isString(payload.toLocationId) &&
      isString(payload.startedAt) &&
      isString(payload.arrivesAt) &&
      !Number.isNaN(startedAt) &&
      !Number.isNaN(arrivesAt) &&
      arrivesAt > startedAt &&
      hasValidMotionProjection &&
      hasOptionalString(payload, 'reason')
    );
  }
  if (kind === 'world.interaction') {
    return (
      isString(payload.actionId) &&
      isString(payload.observationId) &&
      isString(payload.locationId) &&
      isString(payload.entityId) &&
      isString(payload.verb) &&
      isString(payload.result) &&
      typeof payload.stateVersion === 'number' &&
      isWorldState(payload.state)
    );
  }
  if (kind === 'agent.activity') {
    return (
      isString(payload.phase) &&
      AGENT_PHASES.has(payload.phase as AgentPhase) &&
      isString(payload.summary) &&
      (payload.status === 'working' ||
        payload.status === 'idle' ||
        payload.status === 'blocked')
    );
  }
  if (kind === 'tool.started') {
    return (
      isString(payload.toolCallId) &&
      isString(payload.tool) &&
      isString(payload.summary) &&
      isString(payload.resourceId) &&
      (payload.capability === undefined ||
        (isString(payload.capability) &&
          TOOL_CAPABILITIES.has(payload.capability))) &&
      hasOptionalString(payload, 'topicId')
    );
  }
  if (kind === 'tool.finished') {
    return (
      isString(payload.toolCallId) &&
      (payload.outcome === 'succeeded' || payload.outcome === 'failed') &&
      hasOptionalString(payload, 'summary') &&
      hasOptionalStringArray(payload, 'artifactIds')
    );
  }
  if (kind === 'research.topic.selected') {
    return (
      isString(payload.topicId) &&
      hasOptionalString(payload, 'parentTopicId') &&
      isString(payload.title) &&
      isString(payload.question) &&
      hasOptionalString(payload, 'reason')
    );
  }
  if (kind === 'research.topic.updated') {
    return (
      isString(payload.topicId) &&
      isString(payload.status) &&
      RESEARCH_TOPIC_STATES.has(payload.status) &&
      hasOptionalString(payload, 'summary')
    );
  }
  if (kind === 'artifact.recorded') {
    return (
      isString(payload.artifactId) &&
      isString(payload.kind) &&
      ARTIFACT_KINDS.has(payload.kind) &&
      isString(payload.title) &&
      isString(payload.summary) &&
      hasOptionalString(payload, 'uri') &&
      hasOptionalString(payload, 'topicId')
    );
  }
  if (kind === 'agent.message') {
    return (
      (payload.channel === 'commentary' || payload.channel === 'final') &&
      isString(payload.text) &&
      hasOptionalString(payload, 'targetAgentId')
    );
  }
  if (kind === 'proximity.spoken') {
    return (
      isString(payload.actionId) &&
      isString(payload.observationId) &&
      isString(payload.speechId) &&
      (payload.speechAct === 'say' ||
        payload.speechAct === 'invite' ||
        payload.speechAct === 'accept' ||
        payload.speechAct === 'decline') &&
      isString(payload.speakerLocationId) &&
      isString(payload.targetLocationId) &&
      isString(payload.targetAgentId) &&
      isStringArray(payload.heardByAgentIds) &&
      typeof payload.distancePx === 'number' &&
      isString(payload.text) &&
      isString(payload.preview) &&
      hasOptionalString(payload, 'replyToSpeechId') &&
      hasOptionalString(payload, 'invitationId') &&
      (payload.invitationMode === undefined ||
        payload.invitationMode === 'collaborate' ||
        payload.invitationMode === 'recruit') &&
      hasOptionalString(payload, 'objective')
    );
  }
  if (kind === 'board.message') {
    return (
      isString(payload.messageId) &&
      isString(payload.clientMessageId) &&
      isString(payload.threadId) &&
      isString(payload.topic) &&
      (payload.messageType === 'update' ||
        payload.messageType === 'question' ||
        payload.messageType === 'decision' ||
        payload.messageType === 'handoff') &&
      (payload.audience === 'broadcast' || payload.audience === 'direct') &&
      isStringArray(payload.recipientAgentIds) &&
      hasOptionalString(payload, 'replyToMessageId') &&
      hasOptionalString(payload, 'topicId') &&
      hasOptionalStringArray(payload, 'artifactIds') &&
      isString(payload.text)
    );
  }
  if (kind === 'board.acknowledged') {
    return (
      isString(payload.messageId) &&
      (payload.state === 'read' ||
        payload.state === 'acknowledged' ||
        payload.state === 'resolved')
    );
  }
  if (kind === 'agent.blocked') {
    return (
      isString(payload.promptId) &&
      (payload.reason === 'approval' ||
        payload.reason === 'question' ||
        payload.reason === 'error') &&
      isString(payload.request)
    );
  }
  if (kind === 'agent.resumed') {
    return isString(payload.promptId) && hasOptionalString(payload, 'response');
  }
  if (kind === 'agent.completed') return isString(payload.summary);
  if (kind === 'agent.failed') return isString(payload.error);
  if (kind === 'agent.stopped') return isString(payload.reason);
  return false;
}

/**
 * The arena accepts only the normalized event contract produced by the local
 * Codex bridge. Invalid, mock, and partial objects are ignored rather than
 * being turned into plausible-looking agent activity in the browser.
 */
function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  if (
    value.schemaVersion !== 1 ||
    !isString(value.eventId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !isString(value.occurredAt) ||
    Number.isNaN(Date.parse(value.occurredAt)) ||
    (value.source !== 'codex' && value.source !== 'operator') ||
    !isString(value.runId) ||
    !isString(value.kind) ||
    !hasOptionalString(value, 'agentId') ||
    !hasOptionalString(value, 'parentAgentId') ||
    !hasOptionalString(value, 'taskId') ||
    !hasOptionalString(value, 'correlationId')
  ) {
    return false;
  }

  const kind = value.kind as RuntimeEvent['kind'];
  const isAgentEvent =
    !kind.startsWith('run.') &&
    !kind.startsWith('chat.') &&
    kind !== 'sandbox.changed';
  if (isAgentEvent && !isString(value.agentId)) return false;
  return hasValidPayload(kind, value.payload);
}

function eventsFromResponse(value: unknown): RuntimeEvent[] | undefined {
  const candidate = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.events)
      ? value.events
      : undefined;
  if (!candidate) return undefined;
  return candidate.filter(isRuntimeEvent);
}

function receiptFromResponse(value: unknown, expectedIntentId: string) {
  const candidate =
    isRecord(value) && isRecord(value.receipt) ? value.receipt : value;
  if (
    !isRecord(candidate) ||
    candidate.intentId !== expectedIntentId ||
    typeof candidate.accepted !== 'boolean' ||
    !isString(candidate.receivedAt) ||
    Number.isNaN(Date.parse(candidate.receivedAt)) ||
    !hasOptionalString(candidate, 'reason')
  ) {
    return undefined;
  }
  return candidate as CommandReceipt;
}

function intentId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `intent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rejectedReceipt(id: string, reason: string): CommandReceipt {
  return {
    intentId: id,
    accepted: false,
    receivedAt: new Date().toISOString(),
    reason,
  };
}

export class CodexAgentRuntime implements ArenaRuntime {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly connectionListeners = new Set<
    (status: RuntimeConnectionStatus) => void
  >();
  private readonly mailboxStatusListeners = new Set<
    (status: OperatorMailboxStatus) => void
  >();
  private readonly commandControllers = new Set<AbortController>();
  private readonly seenEventIds = new Set<string>();
  private readonly seenEventOrder: string[] = [];
  private readonly pendingMailboxIntentIds = new Map<string, string>();
  private pollController?: AbortController;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private running = false;
  private lastSequence = 0;
  private failedPolls = 0;
  private connectionStatus: RuntimeConnectionStatus = 'disconnected';
  private mailboxStatus: OperatorMailboxStatus = {
    runId: '',
    unreadDeliveryCount: 0,
  };

  constructor(private readonly bridgeOrigin = DEFAULT_BRIDGE_ORIGIN) {}

  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeConnection(listener: (status: RuntimeConnectionStatus) => void) {
    this.connectionListeners.add(listener);
    listener(this.connectionStatus);
    return () => this.connectionListeners.delete(listener);
  }

  subscribeMailboxStatus(listener: (status: OperatorMailboxStatus) => void) {
    this.mailboxStatusListeners.add(listener);
    listener(this.mailboxStatus);
    return () => this.mailboxStatusListeners.delete(listener);
  }

  /** Starts observation only. Objectives are sent solely by explicit commands. */
  start(_objective: string) {
    if (this.running) return;
    this.running = true;
    this.setConnectionStatus('connecting');
    this.schedulePoll(0);
  }

  async command(
    intent: OperatorIntent,
    idempotencyKey?: string,
  ): Promise<CommandReceipt> {
    const normalizedIntent =
      intent.type === 'SendMailboxMessage'
        ? {
            ...intent,
            recipientAgentIds: [...intent.recipientAgentIds].sort(
              (left, right) => left.localeCompare(right),
            ),
          }
        : intent;
    const mailboxFingerprint =
      normalizedIntent.type === 'SendMailboxMessage'
        ? JSON.stringify([
            normalizedIntent.recipientAgentIds,
            normalizedIntent.content,
          ])
        : undefined;
    const retainedId = mailboxFingerprint
      ? this.pendingMailboxIntentIds.get(mailboxFingerprint)
      : undefined;
    const id = retainedId || idempotencyKey?.trim() || intentId();
    if (mailboxFingerprint && !retainedId) {
      this.pendingMailboxIntentIds.set(mailboxFingerprint, id);
    }
    const sentAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.commandControllers.add(controller);

    try {
      const response = await fetch(`${this.bridgeOrigin}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intentId: id,
          intent: normalizedIntent,
          sentAt,
        }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => undefined);
      this.setConnectionStatus('connected');
      const receipt = receiptFromResponse(body, id);
      if (receipt) {
        if (mailboxFingerprint) {
          this.pendingMailboxIntentIds.delete(mailboxFingerprint);
        }
        return receipt;
      }
      if (!response.ok) {
        return rejectedReceipt(
          id,
          `Codex bridge rejected the command (${response.status})`,
        );
      }
      return rejectedReceipt(
        id,
        'Codex bridge returned an invalid command receipt',
      );
    } catch (error) {
      this.setConnectionStatus('disconnected');
      const reason =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Codex bridge command timed out or the arena disconnected'
          : 'Codex bridge is unavailable; the command was not delivered';
      return rejectedReceipt(id, reason);
    } finally {
      clearTimeout(timeout);
      this.commandControllers.delete(controller);
    }
  }

  async readMailboxDraft(): Promise<OperatorMailboxDraft> {
    const response = await fetch(`${this.bridgeOrigin}/mailbox/draft`, {
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => undefined);
    const draft = mailboxDraftFromResponse(body);
    if (!response.ok || !draft) {
      throw new Error('The operator mailbox draft is unavailable');
    }
    return draft;
  }

  async writeMailboxDraft(content: string): Promise<OperatorMailboxDraft> {
    const response = await fetch(`${this.bridgeOrigin}/mailbox/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => undefined);
    const draft = mailboxDraftFromResponse(body);
    if (!response.ok || !draft) {
      const reason =
        isRecord(body) && isString(body.error)
          ? body.error
          : 'The operator mailbox draft could not be saved';
      throw new Error(reason);
    }
    return draft;
  }

  destroy() {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.pollController?.abort();
    this.pollController = undefined;
    this.commandControllers.forEach((controller) => controller.abort());
    this.commandControllers.clear();
    this.pendingMailboxIntentIds.clear();
    this.setConnectionStatus('disconnected');
    this.listeners.clear();
    this.connectionListeners.clear();
    this.mailboxStatusListeners.clear();
  }

  private schedulePoll(delayMs: number) {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll();
    }, delayMs);
  }

  private async poll() {
    if (!this.running) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.pollController = controller;

    try {
      const response = await fetch(
        `${this.bridgeOrigin}/events?after=${encodeURIComponent(this.lastSequence)}`,
        { cache: 'no-store', signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Bridge responded ${response.status}`);
      const body: unknown = await response.json();
      const events = eventsFromResponse(body);
      if (!events) throw new Error('Bridge returned an invalid event envelope');
      if (!this.running) return;

      const mailboxStatus = mailboxStatusFromResponse(body);
      if (mailboxStatus) this.setMailboxStatus(mailboxStatus);

      this.failedPolls = 0;
      this.setConnectionStatus('connected');
      events
        .sort((left, right) => left.sequence - right.sequence)
        .forEach((event) => this.acceptEvent(event));
      this.schedulePoll(events.length > 0 ? 0 : CONNECTED_POLL_DELAY_MS);
    } catch {
      this.setConnectionStatus('disconnected');
      if (!this.running || controller.signal.aborted) {
        if (this.running) this.scheduleReconnect();
        return;
      }
      this.scheduleReconnect();
    } finally {
      clearTimeout(timeout);
      if (this.pollController === controller) this.pollController = undefined;
    }
  }

  private scheduleReconnect() {
    this.failedPolls += 1;
    const delay = Math.min(
      FIRST_RECONNECT_DELAY_MS * 2 ** (this.failedPolls - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    this.schedulePoll(delay);
  }

  private setConnectionStatus(status: RuntimeConnectionStatus) {
    if (status === this.connectionStatus) return;
    this.connectionStatus = status;
    this.connectionListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // Connection telemetry must not interrupt event delivery.
      }
    });
  }

  private setMailboxStatus(status: OperatorMailboxStatus) {
    if (
      status.runId === this.mailboxStatus.runId &&
      status.unreadDeliveryCount === this.mailboxStatus.unreadDeliveryCount
    ) {
      return;
    }
    this.mailboxStatus = status;
    this.mailboxStatusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // Mailbox telemetry must not interrupt authoritative event delivery.
      }
    });
  }

  private acceptEvent(event: RuntimeEvent) {
    if (
      event.sequence <= this.lastSequence ||
      this.seenEventIds.has(event.eventId)
    )
      return;
    this.lastSequence = event.sequence;
    if (event.kind === 'run.started') this.pendingMailboxIntentIds.clear();
    this.rememberEvent(event.eventId);
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // One view subscriber must not stop bridge polling for every subscriber.
      }
    });
  }

  private rememberEvent(eventId: string) {
    this.seenEventIds.add(eventId);
    this.seenEventOrder.push(eventId);
    if (this.seenEventOrder.length <= REMEMBERED_EVENT_IDS) return;
    const expired = this.seenEventOrder.shift();
    if (expired) this.seenEventIds.delete(expired);
  }
}
