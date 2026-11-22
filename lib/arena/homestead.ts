import { FACILITY_ROOMS } from './facility-protocol.mjs';
import type { Vec2 } from './agentic-types';

export const HOMESTEAD_SIZE = { w: 1536, h: 1024 };
export const HOMESTEAD_BUILDINGS = [
  {
    id: 'research',
    name: 'Library',
    purpose: 'Sources, books & discoveries',
    bounds: { x: 210, y: 100, w: 295, h: 306 },
  },
  {
    id: 'command',
    name: 'Meeting hall',
    purpose: 'Plans & conversations',
    bounds: { x: 620, y: 35, w: 312, h: 370 },
  },
  {
    id: 'tools',
    name: 'Tool shed',
    purpose: 'Tools & useful work',
    bounds: { x: 1090, y: 120, w: 310, h: 292 },
  },
  {
    id: 'synthesis',
    name: 'Study',
    purpose: 'Ideas & decisions',
    bounds: { x: 180, y: 575, w: 305, h: 250 },
  },
  {
    id: 'context',
    name: 'Commons',
    purpose: 'Shared notes & a place to gather',
    bounds: { x: 610, y: 545, w: 320, h: 290 },
  },
  {
    id: 'build',
    name: 'Workshop',
    purpose: 'Making & testing',
    bounds: { x: 1080, y: 575, w: 325, h: 265 },
  },
] as const;
export type HomesteadRoomId = (typeof HOMESTEAD_BUILDINGS)[number]['id'];

/** The illustrated village is an overview of the existing rooms, not a second motor world. */
export function roomAtPosition(position: Vec2): HomesteadRoomId | undefined {
  const x = (position.x * 768) / 100;
  const y = (position.y * 448) / 100;
  return FACILITY_ROOMS.find(
    ({ rect }) =>
      x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h,
  )?.id as HomesteadRoomId | undefined;
}

export function roomViewport(roomId?: HomesteadRoomId) {
  const room = FACILITY_ROOMS.find((candidate) => candidate.id === roomId);
  return room ? { ...room.rect } : { x: 0, y: 0, w: 768, h: 448 };
}

export function positionInRoom(position: Vec2, roomId: HomesteadRoomId): Vec2 {
  const view = roomViewport(roomId);
  return {
    x: (((position.x * 768) / 100 - view.x) / view.w) * 100,
    y: (((position.y * 448) / 100 - view.y) / view.h) * 100,
  };
}

/** Project only actual corridor positions; indoor people stay inside their building. */
export function positionOnLane(position: Vec2): Vec2 | undefined {
  if (roomAtPosition(position)) return;
  const x = (position.x * 768) / 100;
  const y = (position.y * 448) / 100;
  if (y < 192 || y > 256) return;
  const anchors = [
    [0, 45],
    [160, 350],
    [384, 770],
    [608, 1220],
    [768, 1490],
  ];
  const index = anchors.findIndex(([worldX]) => worldX >= x);
  const right = anchors[Math.max(1, index === -1 ? anchors.length - 1 : index)];
  const left =
    anchors[Math.max(0, (index === -1 ? anchors.length - 1 : index) - 1)];
  const projectedX =
    left[1] + ((right[1] - left[1]) * (x - left[0])) / (right[0] - left[0]);
  return {
    x: Math.max(0, Math.min(100, (projectedX / 1536) * 100)),
    y: ((482 + ((y - 192) / 64) * 74) / 1024) * 100,
  };
}
