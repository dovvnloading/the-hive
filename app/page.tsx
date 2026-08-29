'use client';

import { useMemo, useState, type SyntheticEvent } from 'react';

import { AgentArenaWorld } from '@/components/agent-arena-world';
import { useAgentArena } from '@/hooks/use-agent-arena';
import type {
  AgentPhase,
  CommandReceipt,
  RuntimeConnectionStatus,
  RuntimeEvent,
} from '@/lib/arena/agentic-types';

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function eventCopy(event: RuntimeEvent) {
  if (event.kind === 'run.started') return `started the objective: ${event.payload.objective}`;
  if (event.kind === 'run.completed') return event.payload.summary;
  if (event.kind === 'run.canceled') return event.payload.reason;
  if (event.kind === 'agent.spawned') return `entered as ${event.payload.role}`;
  if (event.kind === 'task.assigned') return `accepted: ${event.payload.objective}`;
  if (event.kind === 'agent.activity') return event.payload.summary;
  if (event.kind === 'tool.started') return `${event.payload.tool} — ${event.payload.summary}`;
  if (event.kind === 'tool.finished')
    return event.payload.summary ?? `${event.payload.toolCallId} ${event.payload.outcome}`;
  if (event.kind === 'agent.message') return event.payload.text;
  if (event.kind === 'agent.blocked') return event.payload.request;
  if (event.kind === 'agent.resumed') return 'resumed after operator input';
  if (event.kind === 'agent.completed') return event.payload.summary;
  if (event.kind === 'agent.failed') return event.payload.error;
  if (event.kind === 'agent.stopped') return event.payload.reason;
  return 'runtime event';
}

function phaseLabel(phase: AgentPhase) {
  return phase.replace('-', ' ');
}

function connectionLabel(status: RuntimeConnectionStatus) {
  if (status === 'connected') return 'bridge live';
  if (status === 'connecting') return 'connecting';
  return 'bridge offline';
}

type DeliveryNotice = { kind: 'accepted' | 'rejected'; text: string };

export default function Home() {
  const arena = useAgentArena();
  const { state, selectedAgent, activePrompt } = arena;
  const [objective, setObjective] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [commandPending, setCommandPending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<DeliveryNotice>();

  const agentNames = useMemo(
    () => new Map(state.agents.map((agent) => [agent.id, agent.name])),
    [state.agents],
  );
  const activeCount = state.agents.filter((agent) => agent.status === 'working').length;
  const waitingCount = state.agents.filter((agent) => agent.status === 'blocked').length;
  const latestEvent = state.events[0];
  const selectedEvents = selectedAgent
    ? state.events.filter((event) => event.agentId === selectedAgent.id).slice(0, 4)
    : [];

  const commandsUnavailable = arena.connectionStatus !== 'connected' || commandPending;

  async function queueCommand(
    command: () => Promise<CommandReceipt>,
    acceptedCopy: string,
    onAccepted?: () => void,
  ) {
    if (commandsUnavailable) return;
    setCommandPending(true);
    setDeliveryNotice(undefined);
    try {
      const receipt = await command();
      if (receipt.accepted) {
        onAccepted?.();
        setDeliveryNotice({ kind: 'accepted', text: acceptedCopy });
      } else {
        setDeliveryNotice({
          kind: 'rejected',
          text: receipt.reason ?? 'Command was not queued',
        });
      }
    } catch {
      setDeliveryNotice({
        kind: 'rejected',
        text: 'Command delivery failed',
      });
    } finally {
      setCommandPending(false);
    }
  }

  function submitObjective(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = objective.trim();
    if (!next) return;
    void queueCommand(
      () => arena.submitObjective(next),
      'Objective queued for the Codex orchestrator',
      () => setObjective(''),
    );
  }

  function submitFollowUp(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = followUp.trim();
    if (!selectedAgent || !next) return;
    void queueCommand(
      () => arena.sendFollowUp(selectedAgent.id, next),
      `Follow-up queued for ${selectedAgent.name}`,
      () => setFollowUp(''),
    );
  }

  return (
    <main className="arena-app">
      <AgentArenaWorld state={state} onSelectAgent={arena.selectAgent} />

      <header className="run-line">
        <div className="run-title">
          <strong>Hive</strong>
          <span>autonomous field</span>
        </div>
        <p className="run-objective">{state.objective}</p>
        <div className="run-state">
          <span>{activeCount} working</span>
          {waitingCount > 0 && <span>{waitingCount} awaiting input</span>}
          <span>{connectionLabel(arena.connectionStatus)}</span>
          <span>{state.runStatus}</span>
        </div>
      </header>

      {activePrompt && (
        <section className="approval-prompt" aria-live="assertive">
          <div>
            <span>Operator decision</span>
            <p>{activePrompt.request}</p>
          </div>
          <div className="prompt-actions">
            <button
              type="button"
              disabled={commandsUnavailable}
              onClick={() =>
                void queueCommand(
                  () => arena.approvePrompt(activePrompt.promptId, true),
                  'Approval queued for the Codex orchestrator',
                )
              }
            >
              Approve
            </button>
            <button
              type="button"
              disabled={commandsUnavailable}
              onClick={() =>
                void queueCommand(
                  () => arena.approvePrompt(activePrompt.promptId, false),
                  'Denial queued for the Codex orchestrator',
                )
              }
            >
              Deny
            </button>
          </div>
        </section>
      )}

      {selectedAgent && (
        <aside className="agent-drawer" aria-label={`${selectedAgent.name} details`}>
          <div className="drawer-heading">
            <div>
              <h2>{selectedAgent.name}</h2>
              <p>{selectedAgent.role}</p>
            </div>
            <button
              type="button"
              className="quiet-control"
              onClick={() => arena.selectAgent(undefined)}
            >
              Close
            </button>
          </div>

          <div className="agent-current">
            <span>{phaseLabel(selectedAgent.phase)}</span>
            <p>{selectedAgent.summary}</p>
            {selectedAgent.activeTool && <code>{selectedAgent.activeTool}</code>}
          </div>

          <ol className="agent-events">
            {selectedEvents.map((event) => (
              <li key={event.eventId}>
                <time>{timeLabel(event.occurredAt)}</time>
                <span>{eventCopy(event)}</span>
              </li>
            ))}
          </ol>

          <div className="drawer-controls">
            <button
              type="button"
              onClick={() =>
                arena.followAgent(
                  state.followedAgentId === selectedAgent.id ? undefined : selectedAgent.id,
                )
              }
            >
              {state.followedAgentId === selectedAgent.id ? 'Unfollow' : 'Follow'}
            </button>
            <button
              type="button"
              disabled={commandsUnavailable}
              onClick={() =>
                void queueCommand(
                  () => arena.interruptAgent(selectedAgent.id),
                  `Interrupt queued for ${selectedAgent.name}`,
                )
              }
            >
              Interrupt
            </button>
          </div>

          <form className="follow-up" onSubmit={submitFollowUp}>
            <input
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder={`Send ${selectedAgent.name} a follow-up`}
              aria-label={`Follow-up for ${selectedAgent.name}`}
            />
            <button type="submit" disabled={!followUp.trim() || commandsUnavailable}>
              Queue
            </button>
          </form>
        </aside>
      )}

      <footer className="operator-dock">
        <div className="event-line" aria-live="polite">
          {latestEvent ? (
            <>
              <time>{timeLabel(latestEvent.occurredAt)}</time>
              <strong>
                {latestEvent.agentId
                  ? agentNames.get(latestEvent.agentId) ?? 'Agent'
                  : 'Runtime'}
              </strong>
              <span>{eventCopy(latestEvent)}</span>
            </>
          ) : (
            <span>Waiting for the first runtime event</span>
          )}
          {deliveryNotice && (
            <output
              className={`delivery-note ${deliveryNotice.kind}`}
              aria-live="polite"
            >
              {deliveryNotice.text}
            </output>
          )}
          <a
            href="https://limezu.itch.io/moderninteriors"
            target="_blank"
            rel="noreferrer"
          >
            Art by LimeZu
          </a>
        </div>

        <form className="objective-entry" onSubmit={submitObjective}>
          <label htmlFor="objective">Objective</label>
          <input
            id="objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Set a new objective for the runtime…"
          />
          <button type="submit" disabled={!objective.trim() || commandsUnavailable}>
            {commandPending ? 'Queuing' : 'Queue'}
          </button>
        </form>
      </footer>
    </main>
  );
}
