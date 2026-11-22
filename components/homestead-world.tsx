'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Image from 'next/image';
import { revealKeyboardFocus } from '@/components/camera-focus';
import {
  presentationAt,
  presentationIndexFor,
} from '@/lib/arena/agentic-catalog';
import {
  constrainCamera,
  zoomCamera,
  type ArenaCamera,
} from '@/lib/arena/camera';
import {
  HOMESTEAD_BUILDINGS,
  HOMESTEAD_SIZE,
  positionOnLane,
  roomAtPosition,
  type HomesteadRoomId,
} from '@/lib/arena/homestead';
import type { AgentArenaState } from '@/lib/arena/agentic-types';

type Props = {
  state: AgentArenaState;
  camera: ArenaCamera;
  onCameraChange: (camera: ArenaCamera) => void;
  onEnterRoom: (roomId: HomesteadRoomId) => void;
  onSelectAgent: (agentId: string) => void;
  onOpenJournal: () => void;
  onOpenMailbox: () => void;
  mailboxCount: number;
  showLabels: boolean;
};

export function HomesteadWorld(props: Props) {
  const {
    state,
    camera,
    onCameraChange,
    onEnterRoom,
    onSelectAgent,
    onOpenJournal,
    onOpenMailbox,
    mailboxCount,
    showLabels,
  } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    camera: ArenaCamera;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const bounds = frame.getBoundingClientRect();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? bounds.height
            : 1);
      const current = latest.current;
      current.onCameraChange(
        zoomCamera(
          current.camera,
          current.camera.zoom * Math.exp(-delta * 0.0015),
          {
            x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 100,
            y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 100,
          },
        ),
      );
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <section className="homestead-stage" aria-label="The Hive homestead">
      <div
        ref={frameRef}
        className="homestead-frame"
        data-dragging={dragging}
        data-zoomed={camera.zoom > 1}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          suppressClick.current = false;
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            camera,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId || start.camera.zoom <= 1)
            return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.hypot(dx, dy) < 6 && !suppressClick.current) return;
          suppressClick.current = true;
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          onCameraChange(
            constrainCamera({
              zoom: start.camera.zoom,
              x: start.camera.x + (dx / bounds.width) * 100,
              y: start.camera.y + (dy / bounds.height) * 100,
            }),
          );
        }}
        onPointerUp={(event) => {
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setDragging(false);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className="homestead-surface"
          onFocusCapture={(event) =>
            revealKeyboardFocus(event, frameRef.current, camera, onCameraChange)
          }
          style={{
            transform: `translate(${camera.x}%, ${camera.y}%) scale(${camera.zoom})`,
          }}
        >
          <Image
            className="homestead-map"
            src={`/assets/homestead-v1/homestead-map.png${imageAttempt ? `?retry=${imageAttempt}` : ''}`}
            width={1536}
            height={1024}
            alt="Six cozy cottages along a garden lane, surrounded by woodland, a pond and beehives."
            draggable={false}
            priority
            unoptimized
            onError={() => setImageFailed(true)}
            onLoad={() => setImageFailed(false)}
          />
          {HOMESTEAD_BUILDINGS.map((building) => {
            const residents = state.avatars.filter(
              (avatar) => roomAtPosition(avatar.position) === building.id,
            );
            return (
              <button
                key={building.id}
                type="button"
                className="homestead-building"
                data-room={building.id}
                data-labels={showLabels}
                aria-label={`Enter ${building.name}${residents.length ? `, ${residents.length} ${residents.length === 1 ? 'resident' : 'residents'} inside` : ''}`}
                style={{
                  left: `${(building.bounds.x / HOMESTEAD_SIZE.w) * 100}%`,
                  top: `${(building.bounds.y / HOMESTEAD_SIZE.h) * 100}%`,
                  width: `${(building.bounds.w / HOMESTEAD_SIZE.w) * 100}%`,
                  height: `${(building.bounds.h / HOMESTEAD_SIZE.h) * 100}%`,
                }}
                onClick={() => onEnterRoom(building.id)}
              >
                <span className="homestead-building-label">
                  {building.name}
                  {residents.length > 0 && (
                    <span className="homestead-occupancy">
                      {residents.length}
                    </span>
                  )}
                </span>
                <span className="homestead-building-invitation">
                  {building.purpose}
                  <b>Come inside →</b>
                </span>
              </button>
            );
          })}
          <button
            className="homestead-object homestead-board"
            type="button"
            aria-label="Read the noticeboard"
            title="Read the noticeboard"
            onClick={onOpenJournal}
          >
            <span>Noticeboard</span>
          </button>
          <button
            className="homestead-object homestead-mailbox"
            type="button"
            aria-label={`Open mailbox${mailboxCount ? `, ${mailboxCount} unread` : ''}`}
            title="Open mailbox"
            onClick={onOpenMailbox}
          >
            <span>Mailbox{mailboxCount > 0 && ` · ${mailboxCount}`}</span>
            {mailboxCount > 0 && <i aria-hidden="true">!</i>}
          </button>
          {state.avatars.map((avatar) => {
            const position = positionOnLane(avatar.position);
            const agent = state.agents.find(
              (candidate) => candidate.id === avatar.agentId,
            );
            if (!position || !agent) return null;
            const presentation = presentationAt(
              agent.presentationIndex ?? presentationIndexFor(agent.id),
            );
            const direction = { east: 0, north: 6, west: 12, south: 18 }[
              avatar.direction
            ];
            return (
              <button
                key={agent.id}
                type="button"
                className="homestead-resident"
                aria-label={`Select ${agent.name}`}
                onClick={() => onSelectAgent(agent.id)}
                style={
                  {
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                    '--sprite': `url('${presentation.sprite}/${avatar.isMoving ? 'run' : 'idle_anim'}.png')`,
                    '--direction': direction,
                    '--sprite-speed': avatar.isMoving ? '570ms' : '900ms',
                  } as CSSProperties
                }
              >
                <span className="homestead-person" />
                <span className="homestead-person-name">{agent.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      {imageFailed && (
        <button
          type="button"
          className="arena-asset-retry"
          onClick={() => setImageAttempt((value) => value + 1)}
        >
          The map couldn’t load · Try again
        </button>
      )}
    </section>
  );
}
