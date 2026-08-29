'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';

import {
  resourceById,
  roomForLocation,
  worldLocationById,
} from '@/lib/arena/agentic-catalog';
import type {
  AgentArenaState,
  BoardMessageProjection,
  RuntimeEvent,
} from '@/lib/arena/agentic-types';

export type FieldJournalView = 'journal' | 'research' | 'agents';

type ArenaFieldJournalProps = {
  state: AgentArenaState;
  view: FieldJournalView;
  focusedEventId?: string;
  selectedAgentId?: string;
  onViewChange: (view: FieldJournalView) => void;
  onSelectAgent: (agentId: string) => void;
  onClose: () => void;
};

const JOURNAL_EVENT_KINDS = new Set<RuntimeEvent['kind']>([
  'agent.spawned',
  'task.assigned',
  'world.navigation',
  'world.interaction',
  'agent.activity',
  'tool.started',
  'tool.finished',
  'research.topic.selected',
  'research.topic.updated',
  'artifact.recorded',
  'agent.message',
  'proximity.spoken',
  'board.message',
  'agent.blocked',
  'agent.resumed',
  'agent.completed',
  'agent.failed',
  'agent.stopped',
]);

const TIME_FORMATTER = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function timeLabel(iso: string) {
  return TIME_FORMATTER.format(new Date(iso));
}

function isJournalEvent(event: RuntimeEvent) {
  return Boolean(event.agentId) && JOURNAL_EVENT_KINDS.has(event.kind);
}

function isCommunicationEvent(event: RuntimeEvent) {
  return (
    event.kind === 'proximity.spoken' ||
    event.kind === 'board.message' ||
    event.kind === 'agent.message'
  );
}

function phaseLabel(phase: string) {
  return phase.replaceAll('-', ' ');
}

function identifierLabel(value: string) {
  const label = value.replace(/[-_]+/gu, ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function eventCategory(event: RuntimeEvent) {
  if (event.kind === 'proximity.spoken') {
    return event.payload.speechAct === 'say' ? 'speech' : 'collaboration';
  }
  if (event.kind === 'board.message' || event.kind === 'agent.message')
    return 'message';
  if (event.kind === 'world.navigation' || event.kind === 'world.interaction')
    return 'environment';
  if (
    event.kind === 'research.topic.selected' ||
    event.kind === 'research.topic.updated' ||
    event.kind === 'artifact.recorded'
  )
    return 'research';
  if (event.kind === 'tool.started' || event.kind === 'tool.finished')
    return 'tool';
  if (
    event.kind === 'agent.completed' ||
    event.kind === 'agent.failed' ||
    event.kind === 'agent.stopped'
  )
    return 'terminal';
  return 'activity';
}

function eventCopy(event: RuntimeEvent) {
  if (event.kind === 'agent.spawned')
    return `Entered the facility as ${event.payload.role}.`;
  if (event.kind === 'task.assigned') return event.payload.objective;
  if (event.kind === 'world.navigation')
    return `Moved from ${event.payload.fromLocationId} to ${event.payload.toLocationId}.`;
  if (event.kind === 'world.interaction') return event.payload.result;
  if (event.kind === 'agent.activity') return event.payload.summary;
  if (event.kind === 'tool.started')
    return `${event.payload.summary} — using ${event.payload.tool}.`;
  if (event.kind === 'tool.finished')
    return (
      event.payload.summary ??
      `${event.payload.toolCallId} ${event.payload.outcome}.`
    );
  if (event.kind === 'research.topic.selected')
    return `Selected “${event.payload.title}”: ${event.payload.question}`;
  if (event.kind === 'research.topic.updated')
    return (
      event.payload.summary ??
      `${event.payload.topicId} is now ${event.payload.status}.`
    );
  if (event.kind === 'artifact.recorded')
    return `Recorded ${event.payload.kind}: ${event.payload.title}.`;
  if (event.kind === 'agent.message') return event.payload.text;
  if (event.kind === 'proximity.spoken') return event.payload.text;
  if (event.kind === 'board.message') return event.payload.text;
  if (event.kind === 'agent.blocked') return event.payload.request;
  if (event.kind === 'agent.resumed')
    return (
      event.payload.response ?? 'Resumed after receiving operator context.'
    );
  if (event.kind === 'agent.completed') return event.payload.summary;
  if (event.kind === 'agent.failed') return event.payload.error;
  if (event.kind === 'agent.stopped') return event.payload.reason;
  return 'Recorded facility activity.';
}

function messageDestination(
  message: BoardMessageProjection,
  names: Map<string, string>,
) {
  if (message.audience === 'broadcast') return 'everyone';
  return message.recipientAgentIds
    .map((agentId) => names.get(agentId) ?? agentId)
    .join(', ');
}

type JournalFeedProps = Pick<
  AgentArenaState,
  'events' | 'agents' | 'boardMessages' | 'researchTopics' | 'artifacts'
> & { focusedEventId?: string };

const JournalFeed = memo(function JournalFeed({
  events,
  agents,
  boardMessages,
  researchTopics,
  artifacts,
  focusedEventId,
}: JournalFeedProps) {
  const names = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const journalEvents = events.filter(isJournalEvent);
  const entries = journalEvents.filter(
    (event, index) => index < 600 || isCommunicationEvent(event),
  );
  const omittedActivityCount = journalEvents.length - entries.length;
  const focusedEntryAvailable = Boolean(
    focusedEventId && entries.some((event) => event.eventId === focusedEventId),
  );

  useEffect(() => {
    if (!focusedEventId || !focusedEntryAvailable) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`journal-event-${focusedEventId}`)
        ?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedEntryAvailable, focusedEventId]);

  if (entries.length === 0) {
    return (
      <div className="journal-empty">
        <strong>The journal is quiet.</strong>
        <p>
          Resident-authored speech, messages, and activity will appear here.
        </p>
      </div>
    );
  }

  return (
    <ol className="journal-feed" aria-label="Agent journal entries">
      {omittedActivityCount > 0 && (
        <li className="journal-feed-limit">
          {omittedActivityCount} older non-communication activity entries are
          compacted; every speech and message remains in this journal.
        </li>
      )}
      {entries.map((event) => {
        const author = event.agentId
          ? (names.get(event.agentId) ?? event.agentId)
          : 'Facility';
        const boardMessage =
          event.kind === 'board.message'
            ? boardMessages.find(
                (message) => message.messageId === event.payload.messageId,
              )
            : undefined;
        const topic = boardMessage?.topicId
          ? researchTopics.find(
              (candidate) => candidate.topicId === boardMessage.topicId,
            )
          : undefined;
        const linkedArtifacts = (boardMessage?.artifactIds ?? [])
          .map((artifactId) =>
            artifacts.find((artifact) => artifact.artifactId === artifactId),
          )
          .filter((artifact) => artifact !== undefined);
        const parentMessage = boardMessage?.replyToMessageId
          ? boardMessages.find(
              (message) => message.messageId === boardMessage.replyToMessageId,
            )
          : undefined;
        const directTarget =
          event.kind === 'agent.message' && event.payload.targetAgentId
            ? (names.get(event.payload.targetAgentId) ??
              event.payload.targetAgentId)
            : undefined;
        const speechTarget =
          event.kind === 'proximity.spoken'
            ? (names.get(event.payload.targetAgentId) ??
              event.payload.targetAgentId)
            : undefined;
        const speechMeta =
          event.kind === 'proximity.spoken'
            ? event.payload.speechAct === 'say'
              ? `to ${speechTarget} · heard by ${event.payload.heardByAgentIds.length} nearby`
              : event.payload.speechAct === 'invite'
                ? `invited ${speechTarget} · ${event.payload.invitationMode}`
                : `${event.payload.speechAct === 'accept' ? 'accepted' : 'declined'} ${speechTarget} · ${event.payload.invitationMode}`
            : undefined;

        return (
          <li key={event.eventId} id={`journal-event-${event.eventId}`}>
            <article
              className={`journal-entry journal-entry-${eventCategory(event)}${event.eventId === focusedEventId ? ' journal-entry-focused' : ''}`}
            >
              <header>
                <div>
                  <strong>{author}</strong>
                  {boardMessage && (
                    <span>
                      to {messageDestination(boardMessage, names)} ·{' '}
                      {boardMessage.topic}
                    </span>
                  )}
                  {!boardMessage && directTarget && (
                    <span>to {directTarget}</span>
                  )}
                  {speechMeta && <span>{speechMeta}</span>}
                </div>
                <div>
                  <span>{eventCategory(event)}</span>
                  <time dateTime={event.occurredAt}>
                    {timeLabel(event.occurredAt)}
                  </time>
                </div>
              </header>
              {parentMessage && (
                <small className="journal-reply-reference">
                  Reply to{' '}
                  {names.get(parentMessage.authorAgentId) ??
                    parentMessage.authorAgentId}{' '}
                  · {parentMessage.topic}
                </small>
              )}
              <p>{eventCopy(event)}</p>
              {event.kind === 'proximity.spoken' && event.payload.objective && (
                <small className="journal-social-objective">
                  Shared objective · {event.payload.objective}
                </small>
              )}
              {(topic || linkedArtifacts.length > 0) && (
                <div className="journal-entry-links">
                  {topic && <span>Research · {topic.title}</span>}
                  {linkedArtifacts.map((artifact) =>
                    artifact.uri && /^https?:\/\//u.test(artifact.uri) ? (
                      <a
                        key={artifact.artifactId}
                        href={artifact.uri}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {artifact.title}
                      </a>
                    ) : (
                      <span key={artifact.artifactId}>{artifact.title}</span>
                    ),
                  )}
                </div>
              )}
              {boardMessage && boardMessage.acknowledgements.length > 0 && (
                <small className="journal-receipts">
                  {boardMessage.acknowledgements
                    .map(
                      (receipt) =>
                        `${names.get(receipt.agentId) ?? receipt.agentId} ${receipt.state}`,
                    )
                    .join(' · ')}
                </small>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
});

type ResearchViewProps = Pick<
  AgentArenaState,
  'researchTopics' | 'artifacts' | 'agents'
>;

const ResearchView = memo(function ResearchView({
  researchTopics,
  artifacts: recordedArtifacts,
  agents,
}: ResearchViewProps) {
  const [selectedTopicId, setSelectedTopicId] = useState<string>();
  const names = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const topics = useMemo(
    () =>
      [...researchTopics].sort(
        (left, right) => right.lastSequence - left.lastSequence,
      ),
    [researchTopics],
  );
  const activeTopicId = topics.some(
    (topic) => topic.topicId === selectedTopicId,
  )
    ? selectedTopicId
    : topics[0]?.topicId;
  const selected = topics.find((topic) => topic.topicId === activeTopicId);
  const artifacts = selected
    ? recordedArtifacts.filter(
        (artifact) => artifact.topicId === selected.topicId,
      )
    : [];
  const children = selected
    ? topics.filter((topic) => topic.parentTopicId === selected.topicId)
    : [];

  if (topics.length === 0) {
    return (
      <div className="journal-empty">
        <strong>No research has been recorded.</strong>
        <p>An agent’s selected question and evidence will appear here.</p>
      </div>
    );
  }

  return (
    <div className="journal-split journal-research">
      <nav className="journal-index" aria-label="Recorded research topics">
        <ol>
          {topics.map((topic) => (
            <li key={topic.topicId}>
              <button
                type="button"
                className={topic.topicId === activeTopicId ? 'selected' : ''}
                aria-current={
                  topic.topicId === activeTopicId ? 'true' : undefined
                }
                onClick={() => setSelectedTopicId(topic.topicId)}
              >
                <strong>{topic.title}</strong>
                <span>
                  {names.get(topic.ownerAgentId) ?? topic.ownerAgentId} ·{' '}
                  {topic.status}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="journal-detail" aria-live="polite">
        {selected && (
          <>
            <header className="journal-detail-heading">
              <div>
                <p>{selected.status}</p>
                <h3>{selected.title}</h3>
              </div>
              <time dateTime={selected.occurredAt}>
                {timeLabel(selected.occurredAt)}
              </time>
            </header>

            <dl className="journal-facts">
              <div>
                <dt>Owner</dt>
                <dd>
                  {names.get(selected.ownerAgentId) ?? selected.ownerAgentId}
                </dd>
              </div>
              <div>
                <dt>Parent track</dt>
                <dd>
                  {selected.parentTopicId
                    ? identifierLabel(selected.parentTopicId)
                    : 'Independent'}
                </dd>
              </div>
            </dl>

            <section className="journal-section">
              <h4>Question</h4>
              <p>{selected.question}</p>
              {selected.reason && <small>{selected.reason}</small>}
            </section>

            {selected.summary && (
              <section className="journal-section">
                <h4>Finding</h4>
                <p>{selected.summary}</p>
              </section>
            )}

            {children.length > 0 && (
              <section className="journal-section">
                <h4>Subtopics</h4>
                <div className="journal-related-topics">
                  {children.map((topic) => (
                    <button
                      type="button"
                      key={topic.topicId}
                      onClick={() => setSelectedTopicId(topic.topicId)}
                    >
                      {topic.title}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="journal-section">
              <h4>Evidence</h4>
              {artifacts.length > 0 ? (
                <ol className="journal-artifacts">
                  {artifacts.map((artifact) => (
                    <li key={artifact.artifactId}>
                      <div>
                        <strong>{artifact.title}</strong>
                        <span>{artifact.kind}</span>
                      </div>
                      <p>{artifact.summary}</p>
                      {artifact.uri && /^https?:\/\//u.test(artifact.uri) ? (
                        <a href={artifact.uri} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      ) : (
                        artifact.uri && <code>{artifact.uri}</code>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No evidence artifact is linked to this topic.</p>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
});

function AgentsView({
  state,
  selectedAgentId,
  onSelectAgent,
}: {
  state: AgentArenaState;
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
}) {
  const activeIds = useMemo(
    () => new Set(state.avatars.map((avatar) => avatar.agentId)),
    [state.avatars],
  );
  const agents = state.agents.filter((agent) => activeIds.has(agent.id));
  const selected =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const avatar = selected
    ? state.avatars.find((candidate) => candidate.agentId === selected.id)
    : undefined;
  const location = selected
    ? worldLocationById(
        selected.currentLocationId ??
          avatar?.targetStationId ??
          avatar?.stationId ??
          'spawn-lift',
      )
    : undefined;
  const resource = selected?.currentResourceId
    ? resourceById(selected.currentResourceId)
    : undefined;
  const room = location ? roomForLocation(location.id) : undefined;
  const topic = selected?.currentTopicId
    ? state.researchTopics.find(
        (candidate) => candidate.topicId === selected.currentTopicId,
      )
    : undefined;
  const nearby = (avatar?.nearbyAgentIds ?? [])
    .map((agentId) => agents.find((agent) => agent.id === agentId)?.name)
    .filter((name) => name !== undefined);
  const artifacts = selected
    ? state.artifacts.filter((artifact) =>
        selected.artifactIds.includes(artifact.artifactId),
      )
    : [];
  const events = selected
    ? state.events
        .filter(
          (event) =>
            event.agentId === selected.id &&
            JOURNAL_EVENT_KINDS.has(event.kind),
        )
        .slice(0, 8)
    : [];

  if (agents.length === 0) {
    return (
      <div className="journal-empty">
        <strong>No agents are currently present.</strong>
        <p>
          Completed agents remain in the journal but leave the active floor.
        </p>
      </div>
    );
  }

  return (
    <div className="journal-split journal-agents">
      <nav className="journal-index" aria-label="Agents currently present">
        <ol>
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                className={agent.id === selected?.id ? 'selected' : ''}
                aria-current={agent.id === selected?.id ? 'true' : undefined}
                onClick={() => onSelectAgent(agent.id)}
              >
                <strong>{agent.name}</strong>
                <span>
                  {phaseLabel(agent.phase)} · {agent.status}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="journal-detail" aria-live="polite">
        {selected && (
          <>
            <header className="journal-detail-heading">
              <div>
                <p>{phaseLabel(selected.phase)}</p>
                <h3>{selected.name}</h3>
                <span>{selected.role}</span>
              </div>
              <span className={`journal-agent-state ${selected.status}`}>
                {selected.status}
              </span>
            </header>

            <section className="journal-agent-summary">
              <p>{selected.summary}</p>
            </section>

            <dl className="journal-facts journal-agent-facts">
              <div>
                <dt>Assignment</dt>
                <dd>{selected.objective}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{room?.name ?? 'In transit'}</dd>
                <small>{resource?.label ?? location?.label}</small>
              </div>
              <div>
                <dt>Present with</dt>
                <dd>
                  {nearby.length > 0 ? nearby.join(', ') : 'No one nearby'}
                </dd>
              </div>
              {topic && (
                <div>
                  <dt>Research</dt>
                  <dd>{topic.title}</dd>
                </div>
              )}
              {(selected.activeTool || selected.lastToolResult) && (
                <div>
                  <dt>Utility</dt>
                  {selected.activeTool && <dd>{selected.activeTool}</dd>}
                  {selected.lastToolResult && (
                    <small>{selected.lastToolResult}</small>
                  )}
                </div>
              )}
              {artifacts.length > 0 && (
                <div>
                  <dt>Outputs</dt>
                  <dd>
                    {artifacts.map((artifact) => artifact.title).join(' · ')}
                  </dd>
                </div>
              )}
              {selected.lastInteraction && (
                <div>
                  <dt>Last interaction</dt>
                  <dd>{selected.lastInteraction}</dd>
                </div>
              )}
            </dl>

            {events.length > 0 && (
              <section className="journal-section">
                <h4>Recent activity</h4>
                <ol className="journal-agent-events">
                  {events.map((event) => (
                    <li key={event.eventId}>
                      <time dateTime={event.occurredAt}>
                        {timeLabel(event.occurredAt)}
                      </time>
                      <span>{eventCopy(event)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function ArenaFieldJournal({
  state,
  view,
  focusedEventId,
  selectedAgentId,
  onViewChange,
  onSelectAgent,
  onClose,
}: ArenaFieldJournalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeSectionRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    activeSectionRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const activeCount = state.avatars.length;

  return (
    <dialog
      id="hive-field-journal"
      ref={dialogRef}
      className="field-journal"
      aria-labelledby="hive-field-journal-title"
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outside) onCloseRef.current();
      }}
    >
      <header className="journal-heading">
        <h2 id="hive-field-journal-title">Field journal</h2>
        <button type="button" onClick={() => onCloseRef.current()}>
          Close
        </button>
      </header>

      <nav className="journal-tabs" aria-label="Field journal sections">
        <button
          ref={view === 'journal' ? activeSectionRef : undefined}
          type="button"
          aria-current={view === 'journal' ? 'page' : undefined}
          onClick={() => onViewChange('journal')}
        >
          Journal <span>{state.events.filter(isJournalEvent).length}</span>
        </button>
        <button
          ref={view === 'research' ? activeSectionRef : undefined}
          type="button"
          aria-current={view === 'research' ? 'page' : undefined}
          onClick={() => onViewChange('research')}
        >
          Research <span>{state.researchTopics.length}</span>
        </button>
        <button
          ref={view === 'agents' ? activeSectionRef : undefined}
          type="button"
          aria-current={view === 'agents' ? 'page' : undefined}
          onClick={() => onViewChange('agents')}
        >
          Present <span>{activeCount}</span>
        </button>
      </nav>

      <div className="journal-content">
        {view === 'journal' && (
          <JournalFeed
            events={state.events}
            agents={state.agents}
            boardMessages={state.boardMessages}
            researchTopics={state.researchTopics}
            artifacts={state.artifacts}
            focusedEventId={focusedEventId}
          />
        )}
        {view === 'research' && (
          <ResearchView
            researchTopics={state.researchTopics}
            artifacts={state.artifacts}
            agents={state.agents}
          />
        )}
        {view === 'agents' && (
          <AgentsView
            state={state}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
          />
        )}
      </div>
    </dialog>
  );
}
