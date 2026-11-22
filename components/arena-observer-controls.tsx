'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HiveIcon } from './hive-ui-art';
import {
  presentationAt,
  presentationIndexFor,
  worldLocationById,
} from '@/lib/arena/agentic-catalog';
import { FIT_CAMERA, zoomCamera, type ArenaCamera } from '@/lib/arena/camera';
import type {
  AgentArenaState,
  RuntimeAgent,
  RuntimeConnectionStatus,
  RuntimeEvent,
} from '@/lib/arena/agentic-types';
import type { FieldJournalView } from './arena-field-journal';
import {
  HOMESTEAD_BUILDINGS,
  type HomesteadRoomId,
} from '@/lib/arena/homestead';

type Props = {
  roomId?: HomesteadRoomId;
  onGoOutside: () => void;
  state: AgentArenaState;
  connection: RuntimeConnectionStatus;
  camera: ArenaCamera;
  onCameraChange: (camera: ArenaCamera) => void;
  onSelectAgent: (id?: string) => void;
  onFollowAgent: (id?: string) => void;
  onOpenJournal: (view: FieldJournalView, eventId?: string) => void;
  onOpenMailbox: () => void;
  mailboxCount: number;
  audioStatus: 'locked' | 'loading' | 'on' | 'muted' | 'unavailable';
  onToggleAudio: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  immersive: boolean;
  onToggleImmersive: () => void;
  modalOpen: boolean;
};

function residentPresentation(agent: RuntimeAgent) {
  return presentationAt(
    agent.presentationIndex ?? presentationIndexFor(agent.id),
  );
}

function eventPreview(event?: RuntimeEvent): string | undefined {
  if (!event) return;
  switch (event.kind) {
    case 'agent.activity':
      return event.payload.summary;
    case 'proximity.spoken':
      return `“${event.payload.preview}”`;
    case 'artifact.recorded':
      return event.payload.title;
    case 'agent.completed':
      return event.payload.summary;
    case 'world.interaction':
      return event.payload.result;
    case 'research.topic.selected':
      return event.payload.title;
    default:
      return;
  }
}

function ShortcutGuide({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="hive-guide"
      aria-labelledby="hive-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span className="hive-eyebrow">MAKE YOURSELF AT HOME</span>
          <h2 id="hive-guide-title">A closer look</h2>
        </div>
        <button
          type="button"
          className="hive-icon-button"
          aria-label="Close guide"
          onClick={onClose}
        >
          <HiveIcon name="close" size={23} />
        </button>
      </header>
      <p>
        Choose a cottage to look inside. Read the noticeboard or visit the
        mailbox. Scroll to zoom, drag to explore, and choose a resident to
        follow their work.
      </p>
      <dl>
        {[
          ['J', 'Open field journal'],
          ['R', 'Browse residents'],
          ['M', 'Open dispatch box'],
          ['F', 'Follow selected resident'],
          ['0', 'Fit the current view'],
          ['Escape', 'Close a panel or go outside'],
          ['+ / −', 'Zoom in / out'],
          ['L', 'Show or hide labels'],
          ['H', 'Hide or show controls'],
          ['?', 'Open this guide'],
        ].map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p className="hive-guide-note">
        Room lights, movement, conversations, and work reflect the residents’
        actual actions.
      </p>
    </dialog>
  );
}

export function ArenaObserverControls(props: Props) {
  const {
    state,
    roomId,
    onGoOutside,
    connection,
    camera,
    onCameraChange,
    onSelectAgent,
    onFollowAgent,
    onOpenJournal,
    onOpenMailbox,
    mailboxCount,
    audioStatus,
    onToggleAudio,
    showLabels,
    onToggleLabels,
    immersive,
    onToggleImmersive,
    modalOpen,
  } = props;
  const building = HOMESTEAD_BUILDINGS.find(
    (candidate) => candidate.id === roomId,
  );
  const [rosterOpen, setRosterOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const latest = useRef(props);
  const rosterOpenRef = useRef(rosterOpen);
  useEffect(() => {
    latest.current = props;
    rosterOpenRef.current = rosterOpen;
  });
  const activeIds = new Set(state.avatars.map((avatar) => avatar.agentId));
  const residents = state.agents.filter((agent) => activeIds.has(agent.id));
  const selected = residents.find(
    (agent) => agent.id === state.selectedAgentId,
  );
  const followed = residents.find(
    (agent) => agent.id === state.followedAgentId,
  );
  const panelOpen = (rosterOpen || Boolean(selected)) && !immersive;
  const recentEvent =
    state.runStatus === 'running'
      ? state.events.find((event) => eventPreview(event))
      : undefined;
  const recentAuthor =
    recentEvent &&
    state.agents.find((agent) => agent.id === recentEvent.agentId);
  const connected = connection === 'connected';
  const status = !connected
    ? connection === 'connecting'
      ? 'Connecting'
      : 'Disconnected'
    : state.runStatus === 'running'
      ? 'At work'
      : 'A quiet moment';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat)
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], dialog',
        )
      )
        return;
      const p = latest.current;
      if (p.modalOpen) return;
      const key = event.key.toLowerCase();
      if (
        ![
          'j',
          'r',
          'm',
          'f',
          '0',
          '+',
          '=',
          '-',
          'l',
          'h',
          '?',
          'escape',
        ].includes(key)
      )
        return;
      event.preventDefault();
      if (key === 'j') p.onOpenJournal('journal');
      if (key === 'm') p.onOpenMailbox();
      if (key === 'r') {
        if (p.state.selectedAgentId) {
          p.onSelectAgent(undefined);
          setRosterOpen(false);
        } else setRosterOpen((value) => !value);
      }
      if (key === '?') setGuideOpen(true);
      if (key === 'h') p.onToggleImmersive();
      if (key === 'l') p.onToggleLabels();
      if (key === '0') p.onCameraChange(FIT_CAMERA);
      if (key === '+' || key === '=')
        p.onCameraChange(zoomCamera(p.camera, p.camera.zoom + 0.25));
      if (key === '-')
        p.onCameraChange(zoomCamera(p.camera, p.camera.zoom - 0.25));
      if (
        key === 'f' &&
        p.state.selectedAgentId &&
        p.state.avatars.some(
          (avatar) => avatar.agentId === p.state.selectedAgentId,
        )
      )
        p.onFollowAgent(
          p.state.followedAgentId === p.state.selectedAgentId
            ? undefined
            : p.state.selectedAgentId,
        );
      if (key === 'escape') {
        if (p.state.selectedAgentId) p.onSelectAgent(undefined);
        else if (rosterOpenRef.current) setRosterOpen(false);
        else if (p.roomId) p.onGoOutside();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {!immersive && (
        <header className="hive-topbar">
          <div className="hive-brand">
            <h1 className="hive-brand-sign">
              <span className="hive-sr-only">The Hive</span>
            </h1>
          </div>
          <div className="hive-run-status">
            <span
              className="hive-status-pill"
              data-live={connected && state.runStatus === 'running'}
              data-offline={!connected}
            >
              <span />
              {status}
            </span>
            <span className="hive-resident-total">
              {residents.length}{' '}
              {residents.length === 1 ? 'resident' : 'residents'}
            </span>
          </div>
        </header>
      )}

      {building && !immersive && (
        <div className="hive-room-heading">
          <button
            type="button"
            data-hive-action="outside"
            onClick={onGoOutside}
          >
            ← Outside
          </button>
          <div>
            <h2>{building.name}</h2>
            <span>{building.purpose}</span>
          </div>
        </div>
      )}

      {!connected && !immersive && (
        <output className="hive-connection-note">
          <HiveIcon name="sound-off" size={26} />
          {connection === 'connecting'
            ? 'Connecting to the Hive…'
            : 'Connection lost. Showing the last known state.'}
        </output>
      )}

      {panelOpen && (
        <aside className="hive-residents" aria-label="Residents">
          <header>
            <div>
              <span className="hive-eyebrow">AROUND THE HOMESTEAD</span>
              <h2>
                Residents <span>{residents.length}</span>
              </h2>
            </div>
            <button
              type="button"
              className="hive-icon-button"
              aria-label="Close residents"
              onClick={() => {
                setRosterOpen(false);
                onSelectAgent(undefined);
              }}
            >
              <HiveIcon name="close" size={22} />
            </button>
          </header>
          {residents.length === 0 ? (
            <div className="hive-panel-empty">
              <HiveIcon name="residents" size={68} />
              <h3>A quiet moment.</h3>
              <p>Residents appear here when they arrive.</p>
              <button
                type="button"
                className="hive-text-button"
                onClick={() => onOpenJournal('journal')}
              >
                Read the field journal <HiveIcon name="next" size={18} />
              </button>
            </div>
          ) : (
            <ul className="hive-resident-list">
              {residents.map((agent) => {
                const presentation = residentPresentation(agent);
                const location = worldLocationById(
                  agent.navigation?.toLocationId ?? agent.currentLocationId,
                );
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      className="hive-resident-row"
                      aria-label={`Select ${agent.name}, ${agent.status}`}
                      aria-pressed={selected?.id === agent.id}
                      style={
                        {
                          '--resident-accent': presentation.accent,
                        } as CSSProperties
                      }
                      onClick={() => onSelectAgent(agent.id)}
                    >
                      <span className="hive-portrait">
                        <span
                          style={{
                            backgroundImage: `url('${presentation.sprite}/idle_anim.png')`,
                          }}
                        />
                      </span>
                      <span className="hive-resident-copy">
                        <strong>{agent.name}</strong>
                        <span>
                          {agent.navigation ? 'Walking to ' : ''}
                          {location?.label ?? 'Arriving'}
                        </span>
                      </span>
                      <span
                        className="hive-resident-status"
                        data-status={agent.status}
                        title={agent.status}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected && (
            <section className="hive-resident-detail">
              <span className="hive-eyebrow">
                {selected.role} · {selected.phase}
              </span>
              <h3>{selected.name}</h3>
              <p>{selected.summary || selected.objective}</p>
              {selected.activeTool && (
                <span className="hive-working">
                  <span />
                  {selected.activeTool}
                </span>
              )}
              <div className="hive-resident-actions">
                <button
                  type="button"
                  className="hive-follow-button"
                  aria-pressed={followed?.id === selected.id}
                  onClick={() =>
                    onFollowAgent(
                      followed?.id === selected.id ? undefined : selected.id,
                    )
                  }
                >
                  <HiveIcon name="follow" size={26} />
                  {followed?.id === selected.id
                    ? 'Following'
                    : 'Follow resident'}
                </button>
                <button
                  type="button"
                  className="hive-icon-button"
                  title="Open resident’s journal"
                  aria-label="Open resident’s journal"
                  onClick={() => onOpenJournal('agents')}
                >
                  <HiveIcon name="journal" size={26} />
                </button>
              </div>
            </section>
          )}
        </aside>
      )}

      {followed && !modalOpen && (
        <button
          type="button"
          className="hive-following"
          onClick={() => onFollowAgent(undefined)}
          title="Stop following"
        >
          <HiveIcon name="follow" size={24} />
          Following {followed.name}
          <HiveIcon name="close" size={18} />
        </button>
      )}

      {!immersive && (
        <footer className="hive-bottom-bar">
          <div className="hive-observation-line">
            {recentEvent ? (
              <button
                type="button"
                onClick={() => onOpenJournal('journal', recentEvent.eventId)}
              >
                <span className="hive-observation-dot" />
                <strong>{recentAuthor?.name ?? 'Field note'}</strong>
                <span>{eventPreview(recentEvent)}</span>
                <HiveIcon name="next" size={17} />
              </button>
            ) : (
              <span className="hive-quiet-note">
                {connected
                  ? building
                    ? 'A place for good work and curious minds.'
                    : 'Choose a cottage. Make yourself at home.'
                  : 'Waiting for the Hive connection.'}
              </span>
            )}
          </div>
          <div className="hive-dock">
            <nav aria-label="Homestead tools">
              <button
                type="button"
                aria-pressed={panelOpen}
                onClick={() => {
                  if (panelOpen) {
                    setRosterOpen(false);
                    onSelectAgent(undefined);
                  } else setRosterOpen(true);
                }}
                title="Residents (R)"
              >
                <HiveIcon name="residents" size={48} />
                <span className="hive-dock-label">
                  Residents <kbd>R</kbd>
                </span>
                <span className="hive-count">{residents.length}</span>
              </button>
              <button
                type="button"
                data-hive-action="journal"
                onClick={() => onOpenJournal('journal')}
                title="Field journal (J)"
              >
                <HiveIcon name="journal" size={48} />
                <span className="hive-dock-label">
                  Journal <kbd>J</kbd>
                </span>
              </button>
              <button
                type="button"
                data-hive-action="dispatch"
                onClick={onOpenMailbox}
                title="Mailbox (M)"
              >
                <HiveIcon name="dispatch" size={48} />
                <span className="hive-dock-label">
                  Mailbox <kbd>M</kbd>
                </span>
                {mailboxCount > 0 && (
                  <span className="hive-count">{mailboxCount}</span>
                )}
              </button>
            </nav>
            <div className="hive-camera-controls" aria-label="Camera controls">
              <div className="hive-camera-buttons">
                <button
                  type="button"
                  className="hive-sound-button"
                  aria-label={
                    audioStatus === 'on' ? 'Mute sound' : 'Enable sound'
                  }
                  aria-pressed={audioStatus === 'on'}
                  disabled={
                    audioStatus === 'unavailable' || audioStatus === 'loading'
                  }
                  onClick={onToggleAudio}
                  title={audioStatus === 'on' ? 'Sound on' : 'Enable sound'}
                >
                  <HiveIcon
                    name={audioStatus === 'on' ? 'sound-on' : 'sound-off'}
                    size={26}
                  />
                </button>

                <button
                  type="button"
                  aria-label="Zoom out"
                  title="Zoom out (−)"
                  disabled={camera.zoom <= 1 && !followed}
                  onClick={() =>
                    onCameraChange(zoomCamera(camera, camera.zoom - 0.25))
                  }
                >
                  <HiveIcon name="minus" size={24} />
                </button>
                <button
                  type="button"
                  className="hive-zoom-value"
                  title="Fit view (0)"
                  aria-label="Fit current view"
                  onClick={() => onCameraChange(FIT_CAMERA)}
                >
                  {Math.round(camera.zoom * 100)}%
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  title="Zoom in (+)"
                  disabled={camera.zoom >= 3}
                  onClick={() =>
                    onCameraChange(zoomCamera(camera, camera.zoom + 0.25))
                  }
                >
                  <HiveIcon name="plus" size={24} />
                </button>
                <button
                  type="button"
                  aria-label="Show room labels"
                  aria-pressed={showLabels}
                  title="Room labels (L)"
                  onClick={onToggleLabels}
                >
                  <HiveIcon name="labels" size={28} />
                </button>
                <button
                  type="button"
                  className="hive-console-view"
                  aria-label="Hide controls"
                  title="Hide controls (H)"
                  onClick={onToggleImmersive}
                >
                  <HiveIcon name="eye-closed" size={28} />
                </button>
              </div>
            </div>
          </div>
          <div className="hive-bottom-hint">
            <span>
              SCROLL TO ZOOM <span>·</span> DRAG TO EXPLORE
            </span>
            <button
              type="button"
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              onClick={() => setGuideOpen(true)}
            >
              <HiveIcon name="keyboard" size={29} />
            </button>
          </div>
        </footer>
      )}

      {immersive && (
        <button
          type="button"
          className="hive-immersive-toggle"
          aria-label="Show controls"
          title="Show controls (H)"
          onClick={onToggleImmersive}
        >
          <HiveIcon name="eye-open" size={30} />
        </button>
      )}
      {guideOpen && <ShortcutGuide onClose={() => setGuideOpen(false)} />}
    </>
  );
}
