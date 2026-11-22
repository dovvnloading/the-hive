'use client';

import { useRef, useState } from 'react';

import { AgentArenaWorldV2 } from '@/components/agent-arena-world-v2';
import { HomesteadWorld } from '@/components/homestead-world';
import {
  ArenaFieldJournal,
  type FieldJournalView,
} from '@/components/arena-field-journal';
import { OperatorMailbox } from '@/components/operator-mailbox';
import { useAgentArena } from '@/hooks/use-agent-arena';
import { useArenaAudio } from '@/hooks/use-arena-audio';
import { useSandbox } from '@/hooks/use-sandbox';
import { ArenaObserverControls } from '@/components/arena-observer-controls';
import { FIT_CAMERA, focusCamera, type ArenaCamera } from '@/lib/arena/camera';
import {
  positionInRoom,
  positionOnLane,
  roomAtPosition,
  type HomesteadRoomId,
} from '@/lib/arena/homestead';

export default function Home() {
  const arena = useAgentArena();
  const workshop = useSandbox();
  const [journalView, setJournalView] = useState<FieldJournalView>();
  const [focusedEventId, setFocusedEventId] = useState<string>();
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [camera, setCamera] = useState<ArenaCamera>(FIT_CAMERA);
  const [showLabels, setShowLabels] = useState(true);
  const [immersive, setImmersive] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<HomesteadRoomId>();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const followedAvatar = arena.state.avatars.find(
    (avatar) => avatar.agentId === arena.state.followedAgentId,
  );
  const roomId = followedAvatar
    ? roomAtPosition(followedAvatar.position)
    : selectedRoom;
  const followedPosition = followedAvatar
    ? roomId
      ? positionInRoom(followedAvatar.position, roomId)
      : positionOnLane(followedAvatar.position)
    : undefined;
  const effectiveCamera = followedPosition
    ? focusCamera(
        { x: followedPosition.x, y: followedPosition.y - 5 },
        Math.max(1.3, camera.zoom),
      )
    : camera;
  const audio = useArenaAudio(
    arena.state,
    arena.connectionStatus,
    journalView !== undefined || mailboxOpen,
  );

  function openJournal(view: FieldJournalView, eventId?: string) {
    if (!journalView)
      returnFocusRef.current = document.activeElement as HTMLElement;
    setMailboxOpen(false);
    if (view !== 'agents') arena.selectAgent(undefined);
    setFocusedEventId(view === 'journal' ? eventId : undefined);
    setJournalView(view);
  }

  function openMailbox() {
    returnFocusRef.current = document.activeElement as HTMLElement;
    setJournalView(undefined);
    setFocusedEventId(undefined);
    void audio.playMailboxCue();
    setMailboxOpen(true);
  }

  function closeMailbox() {
    setMailboxOpen(false);
    window.requestAnimationFrame(() => {
      if (
        returnFocusRef.current?.isConnected &&
        returnFocusRef.current !== document.body
      )
        returnFocusRef.current.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLButtonElement>('[data-hive-action="dispatch"]')
          ?.focus({ preventScroll: true });
    });
  }

  function closeJournal() {
    setJournalView(undefined);
    setFocusedEventId(undefined);
    window.requestAnimationFrame(() => {
      if (
        returnFocusRef.current?.isConnected &&
        returnFocusRef.current !== document.body
      )
        returnFocusRef.current.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLButtonElement>('[data-hive-action="journal"]')
          ?.focus({ preventScroll: true });
    });
  }

  function changeCamera(next: ArenaCamera) {
    setSelectedRoom(roomId);
    arena.followAgent(undefined);
    setCamera(next);
  }

  function followResident(agentId?: string) {
    if (!agentId) {
      setCamera(effectiveCamera);
      setSelectedRoom(roomId);
    }
    arena.followAgent(agentId);
  }

  function enterRoom(next: HomesteadRoomId) {
    arena.followAgent(undefined);
    setSelectedRoom(next);
    setCamera(FIT_CAMERA);
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[data-hive-action="outside"]')
        ?.focus({ preventScroll: true }),
    );
  }

  function goOutside() {
    const previous = roomId;
    arena.followAgent(undefined);
    setSelectedRoom(undefined);
    setCamera(FIT_CAMERA);
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(`[data-room="${previous}"]`)
        ?.focus({ preventScroll: true }),
    );
  }

  return (
    <main
      className={`arena-app${immersive ? ' arena-immersive' : ''}`}
      data-view={roomId ? 'room' : 'homestead'}
    >
      {roomId ? (
        <AgentArenaWorldV2
          focusRoomId={roomId}
          state={arena.state}
          journalOpen={journalView !== undefined}
          mailboxOpen={mailboxOpen}
          mailboxHasUnread={arena.mailboxUnreadDeliveryCount > 0}
          onOpenJournal={(eventId) => openJournal('journal', eventId)}
          onOpenMailbox={openMailbox}
          onSelectAgent={arena.selectAgent}
          camera={effectiveCamera}
          onCameraChange={changeCamera}
          showLabels={showLabels}
          workshopProjects={
            workshop.snapshot?.projects.filter(
              (project) => !project.archived,
            ) ?? []
          }
        />
      ) : (
        <HomesteadWorld
          state={arena.state}
          camera={effectiveCamera}
          onCameraChange={changeCamera}
          onEnterRoom={enterRoom}
          onSelectAgent={arena.selectAgent}
          onOpenJournal={() => openJournal('journal')}
          onOpenMailbox={openMailbox}
          mailboxCount={arena.mailboxUnreadDeliveryCount}
          showLabels={showLabels}
        />
      )}

      <ArenaObserverControls
        roomId={roomId}
        onGoOutside={goOutside}
        state={arena.state}
        connection={arena.connectionStatus}
        camera={effectiveCamera}
        onCameraChange={changeCamera}
        onSelectAgent={arena.selectAgent}
        onFollowAgent={followResident}
        onOpenJournal={openJournal}
        onOpenMailbox={openMailbox}
        mailboxCount={arena.mailboxUnreadDeliveryCount}
        audioStatus={audio.status}
        onToggleAudio={audio.toggle}
        showLabels={showLabels}
        onToggleLabels={() => setShowLabels((value) => !value)}
        immersive={immersive}
        onToggleImmersive={() => setImmersive((value) => !value)}
        modalOpen={journalView !== undefined || mailboxOpen}
      />

      {journalView && (
        <ArenaFieldJournal
          state={arena.state}
          view={journalView}
          focusedEventId={focusedEventId}
          selectedAgentId={arena.state.selectedAgentId}
          onViewChange={openJournal}
          onSelectAgent={arena.selectAgent}
          onClose={closeJournal}
        />
      )}

      {mailboxOpen && (
        <OperatorMailbox
          agents={arena.state.agents}
          connectionStatus={arena.connectionStatus}
          onReadDraft={arena.readMailboxDraft}
          onWriteDraft={arena.writeMailboxDraft}
          onSend={arena.sendMailboxMessage}
          onClose={closeMailbox}
        />
      )}
    </main>
  );
}
