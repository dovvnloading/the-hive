'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  FACILITY_COLLISION_GEOMETRY,
  FACILITY_ROOMS,
  WORLD_LOCATIONS,
  presentationFor,
  resourceById,
  roomForLocation,
} from '@/lib/arena/agentic-catalog';
import type {
  AgentArenaState,
  AgentPhase,
  AvatarDirection,
  AvatarProjection,
  RuntimeAgent,
  RuntimeEvent,
} from '@/lib/arena/agentic-types';

const WORLD_WIDTH = 768;
const WORLD_HEIGHT = 448;
const ASSET_SCALE = 2;
const FRAME_WIDTH = 16;
const FRAME_HEIGHT = 32;
const MOTIONS = ['run', 'idle_anim', 'phone', 'sit', 'sit2'] as const;

type Motion = (typeof MOTIONS)[number];
type ImageBank = Record<string, HTMLImageElement>;
type Crop = readonly [number, number, number, number];
type Destination = readonly [number, number, number, number];
type HorizontalOpening = { centerX: number; width: number };
type RoomId =
  | 'research'
  | 'command'
  | 'tools'
  | 'synthesis'
  | 'context'
  | 'build';

type Room = {
  id: RoomId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: Crop;
  wall: Crop;
};

type WorldProps = {
  state: AgentArenaState;
  onSelectAgent: (agentId?: string) => void;
  onOpenJournal: (eventId?: string) => void;
  onOpenResearch: () => void;
  journalOpen: boolean;
};

type CanvasPointEvent = {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
};

const ROOM_VISUALS: Record<RoomId, { floor: Crop; wall: Crop }> = {
  research: { floor: [176, 208, 48, 32], wall: [0, 304, 48, 32] },
  command: { floor: [176, 176, 48, 32], wall: [0, 272, 48, 32] },
  tools: { floor: [176, 176, 48, 32], wall: [0, 272, 48, 32] },
  synthesis: { floor: [176, 208, 48, 32], wall: [0, 304, 48, 32] },
  context: { floor: [224, 176, 48, 32], wall: [0, 272, 48, 32] },
  build: { floor: [224, 208, 48, 32], wall: [96, 272, 48, 32] },
};

const ROOMS: Room[] = FACILITY_ROOMS.map((room) => ({
  id: room.id as RoomId,
  label: room.label,
  ...room.rect,
  ...ROOM_VISUALS[room.id as RoomId],
}));

type ExteriorPlaque = {
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'north' | 'south';
  connectorX?: number;
};

const EXTERIOR_ROOM_LABELS: Partial<Record<RoomId, ExteriorPlaque>> = {
  research: { x: 40, y: 6, width: 160, height: 20, side: 'north' },
  command: { x: 264, y: 6, width: 168, height: 20, side: 'north' },
  tools: { x: 456, y: 6, width: 144, height: 20, side: 'north' },
  synthesis: { x: 40, y: 422, width: 176, height: 20, side: 'south' },
  build: { x: 456, y: 422, width: 160, height: 20, side: 'south' },
};

const CONTEXT_PLAQUE: ExteriorPlaque = {
  x: 220,
  y: 422,
  width: 116,
  height: 22,
  side: 'south',
  connectorX: 336,
};

const ROOM_STATIONS = Object.fromEntries(
  FACILITY_ROOMS.map((room) => [
    room.id,
    WORLD_LOCATIONS.filter((resource) => resource.roomId === room.id).map(
      (resource) => resource.id,
    ),
  ]),
) as Record<RoomId, string[]>;

const CONSOLE_SOURCES: Crop[] = [
  [192, 1264, 32, 32],
  [224, 1264, 32, 32],
];

const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  B: ['110', '101', '110', '101', '110'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  R: ['110', '101', '110', '101', '101'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  Y: ['101', '101', '010', '010', '010'],
};

const NORTH_ROOM_DOORS: HorizontalOpening[] =
  FACILITY_COLLISION_GEOMETRY.northDoors.map(({ centerX, width }) => ({
    centerX,
    width,
  }));
const SOUTH_ROOM_DOORS: HorizontalOpening[] =
  FACILITY_COLLISION_GEOMETRY.southDoors.map(({ centerX, width }) => ({
    centerX,
    width,
  }));
const LIFT_OPENING: HorizontalOpening = {
  centerX: FACILITY_COLLISION_GEOMETRY.liftOpening.centerX,
  width: FACILITY_COLLISION_GEOMETRY.liftOpening.width,
};

function imageReady(
  image: HTMLImageElement | undefined,
): image is HTMLImageElement {
  return Boolean(image?.complete && image.naturalWidth > 0);
}

function crop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  source: Crop,
  destination: Destination,
) {
  if (!imageReady(image)) return;
  context.drawImage(image, ...source, ...destination);
}

function sprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  source: Crop,
  x: number,
  y: number,
  scale = ASSET_SCALE,
) {
  crop(context, image, source, [x, y, source[2] * scale, source[3] * scale]);
}

function drawPixelText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    if (character === ' ') {
      cursor += 2 * scale;
      continue;
    }
    const glyph = PIXEL_GLYPHS[character];
    if (!glyph) continue;
    context.fillStyle = color;
    glyph.forEach((row, rowIndex) => {
      row.split('').forEach((pixel, columnIndex) => {
        if (pixel !== '1') return;
        context.fillRect(
          cursor + columnIndex * scale,
          y + rowIndex * scale,
          scale,
          scale,
        );
      });
    });
    cursor += 4 * scale;
  }
}

function tiledCrop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  room: Room,
  source: Crop,
) {
  context.save();
  context.beginPath();
  context.rect(room.x, room.y, room.w, room.h);
  context.clip();
  const tileWidth = source[2] * ASSET_SCALE;
  const tileHeight = source[3] * ASSET_SCALE;
  for (let y = room.y; y < room.y + room.h; y += tileHeight) {
    for (let x = room.x; x < room.x + room.w; x += tileWidth) {
      crop(context, image, source, [x, y, tileWidth, tileHeight]);
    }
  }
  context.restore();
}

function floorRoom(
  context: CanvasRenderingContext2D,
  room: Room,
  builder: HTMLImageElement | undefined,
) {
  context.fillStyle = roomFloorColor(room);
  context.fillRect(room.x, room.y, room.w, room.h);
  tiledCrop(context, builder, room, room.floor);

  const wallHeight = 64;
  context.save();
  context.beginPath();
  context.rect(room.x, room.y, room.w, wallHeight);
  context.clip();
  for (let x = room.x; x < room.x + room.w; x += 96) {
    crop(context, builder, room.wall, [x, room.y, 96, wallHeight]);
  }
  context.restore();
}

function drawRoomWallFaceSegment(
  context: CanvasRenderingContext2D,
  builder: HTMLImageElement | undefined,
  room: Room,
  left: number,
  right: number,
) {
  if (right <= left) return;
  context.save();
  context.beginPath();
  context.rect(left, room.y, right - left, 64);
  context.clip();
  for (let x = room.x; x < room.x + room.w; x += 96) {
    crop(context, builder, room.wall, [x, room.y, 96, 64]);
  }
  context.restore();
}

function drawSouthWallFaces(
  context: CanvasRenderingContext2D,
  builder: HTMLImageElement | undefined,
) {
  ROOMS.filter((room) => room.y === 256).forEach((room) => {
    const opening = SOUTH_ROOM_DOORS.find(
      ({ centerX }) => centerX > room.x && centerX < room.x + room.w,
    );
    if (!opening) {
      drawRoomWallFaceSegment(
        context,
        builder,
        room,
        room.x,
        room.x + room.w,
      );
      return;
    }
    const openingLeft = opening.centerX - opening.width / 2;
    const openingRight = opening.centerX + opening.width / 2;
    drawRoomWallFaceSegment(context, builder, room, room.x, openingLeft);
    drawRoomWallFaceSegment(
      context,
      builder,
      room,
      openingRight,
      room.x + room.w,
    );
  });
}

function roomFloorColor(room: Room) {
  return room.id === 'research' || room.id === 'synthesis'
    ? '#675a51'
    : '#57606a';
}

function drawSouthDoorAperture(
  context: CanvasRenderingContext2D,
  opening: HorizontalOpening,
) {
  const left = opening.centerX - opening.width / 2;
  const right = opening.centerX + opening.width / 2;
  const top = 256;
  const bottom = 320;

  // This is a passage through the north wall face, not room flooring pulled
  // outside its bounds. The neutral inset keeps every room material contained.
  context.fillStyle = '#0b1117';
  context.fillRect(left, top, opening.width, bottom - top);
  context.fillStyle = '#222c34';
  context.beginPath();
  context.moveTo(left + 5, top + 6);
  context.lineTo(right - 5, top + 6);
  context.lineTo(right - 7, bottom - 5);
  context.lineTo(left + 7, bottom - 5);
  context.closePath();
  context.fill();
  context.fillStyle = '#313b43';
  context.fillRect(left + 7, bottom - 18, opening.width - 14, 13);
  context.fillStyle = 'rgba(161,174,180,.11)';
  [bottom - 16, bottom - 11, bottom - 6].forEach((lineY) =>
    context.fillRect(left + 8, lineY, opening.width - 16, 1),
  );
  context.fillStyle = '#141c23';
  context.fillRect(left + 2, top + 4, 4, bottom - top - 7);
  context.fillRect(right - 6, top + 4, 4, bottom - top - 7);
}

function drawSouthDoorFrame(
  context: CanvasRenderingContext2D,
  opening: HorizontalOpening,
) {
  const left = opening.centerX - opening.width / 2;
  const right = opening.centerX + opening.width / 2;
  const top = 256;
  const bottom = 320;

  context.fillStyle = '#0b1219';
  context.fillRect(left - 4, top - 5, opening.width + 8, 7);
  context.fillRect(left - 4, top - 2, 6, bottom - top + 5);
  context.fillRect(right - 2, top - 2, 6, bottom - top + 5);
  context.fillStyle = '#66747e';
  context.fillRect(left - 2, top - 3, opening.width + 4, 2);
  context.fillRect(left - 1, top, 2, bottom - top);
  context.fillRect(right - 1, top, 2, bottom - top);
  context.fillStyle = '#9aa5aa';
  context.fillRect(left, top + 2, 1, bottom - top - 5);
  context.fillRect(right - 1, top + 2, 1, bottom - top - 5);
  context.fillStyle = '#202b33';
  context.fillRect(left + 2, bottom - 4, opening.width - 4, 5);
}

function horizontalWall(
  context: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
) {
  if (x2 <= x1) return;
  context.fillStyle = '#101722';
  context.fillRect(x1, y - 5, x2 - x1, 10);
  context.fillStyle = '#687583';
  context.fillRect(x1, y - 2, x2 - x1, 2);
  context.fillStyle = '#273442';
  context.fillRect(x1, y + 1, x2 - x1, 3);
}

function horizontalWallWithOpenings(
  context: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  openings: HorizontalOpening[],
) {
  let cursor = x1;
  [...openings]
    .sort((left, right) => left.centerX - right.centerX)
    .forEach(({ centerX, width }) => {
      const openingStart = Math.max(x1, centerX - width / 2);
      const openingEnd = Math.min(x2, centerX + width / 2);
      horizontalWall(context, cursor, openingStart, y);
      cursor = Math.max(cursor, openingEnd);
    });
  horizontalWall(context, cursor, x2, y);
}

function verticalWall(
  context: CanvasRenderingContext2D,
  x: number,
  y1: number,
  y2: number,
) {
  context.fillStyle = '#101722';
  context.fillRect(x - 5, y1, 10, y2 - y1);
  context.fillStyle = '#687583';
  context.fillRect(x - 2, y1, 2, y2 - y1);
  context.fillStyle = '#273442';
  context.fillRect(x + 1, y1, 3, y2 - y1);
}

function doorwayThreshold(
  context: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  width: number,
  corridorSide: 'north' | 'south',
) {
  const left = centerX - width / 2;
  context.fillStyle = '#4a555e';
  context.fillRect(left, y - 5, width, 10);
  context.fillStyle = 'rgba(173, 187, 190, .16)';
  context.fillRect(
    left + 2,
    corridorSide === 'south' ? y + 4 : y - 5,
    width - 4,
    1,
  );
}

function doorwayJambs(
  context: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  width: number,
) {
  const left = centerX - width / 2;
  const right = centerX + width / 2;

  // These are wall-end faces, not a lintel. The clear span stays open.
  context.fillStyle = '#0b121a';
  context.fillRect(left - 4, y - 5, 5, 10);
  context.fillRect(right - 1, y - 5, 5, 10);
  context.fillStyle = '#6f7e88';
  context.fillRect(left - 2, y - 4, 2, 8);
  context.fillRect(right, y - 4, 2, 8);
  context.fillStyle = '#a3adb2';
  context.fillRect(left - 1, y - 3, 1, 6);
  context.fillRect(right, y - 3, 1, 6);
  context.fillStyle = '#25323d';
  context.fillRect(left - 3, y + 1, 3, 3);
  context.fillRect(right, y + 1, 3, 3);
}

function statusColor(agent: RuntimeAgent) {
  if (agent.status === 'blocked') return '#d8a253';
  if (agent.status === 'failed' || agent.status === 'canceled')
    return '#c66a66';
  if (agent.status === 'completed') return '#7db69a';
  if (agent.status === 'working') return '#7cc7c0';
  return '#73808a';
}

function roomAgents(state: AgentArenaState, roomId: RoomId) {
  const stationIds = ROOM_STATIONS[roomId];
  const presentIds = new Set(
    state.avatars
      .filter(
        (avatar) =>
          (!avatar.isMoving || (avatar.routeDelayMs ?? 0) > 0) &&
          stationIds.includes(avatar.stationId),
      )
      .map((avatar) => avatar.agentId),
  );
  return state.agents.filter((agent) => presentIds.has(agent.id));
}

function roomActivityLabel(agents: RuntimeAgent[]) {
  const blocked = agents.filter((agent) => agent.status === 'blocked').length;
  const working = agents.filter((agent) => agent.status === 'working').length;
  const completed = agents.filter(
    (agent) => agent.status === 'completed',
  ).length;
  if (blocked > 0) return `${String(blocked).padStart(2, '0')} BLOCKED`;
  if (working > 0) return `${String(working).padStart(2, '0')} ACTIVE`;
  if (completed > 0) return `${String(completed).padStart(2, '0')} DONE`;
  if (agents.length > 0)
    return `${String(agents.length).padStart(2, '0')} PRESENT`;
  return 'IDLE';
}

function drawExteriorPlaque(
  context: CanvasRenderingContext2D,
  plaque: ExteriorPlaque,
  accent: string,
) {
  const connectorX = plaque.connectorX ?? plaque.x + 8;
  const shellY = plaque.side === 'north' ? 29 : 419;
  const plaqueEdgeY =
    plaque.side === 'north' ? plaque.y + plaque.height : plaque.y;

  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(connectorX + 0.5, shellY);
  context.lineTo(connectorX + 0.5, plaqueEdgeY);
  context.stroke();

  context.fillStyle = 'rgba(6,10,14,.95)';
  context.fillRect(plaque.x, plaque.y, plaque.width, plaque.height);
  context.strokeStyle = 'rgba(111,126,136,.72)';
  context.strokeRect(
    plaque.x + 0.5,
    plaque.y + 0.5,
    plaque.width - 1,
    plaque.height - 1,
  );
  context.fillStyle = accent;
  context.fillRect(plaque.x, plaque.y, 3, plaque.height);
}

function roomLabel(
  context: CanvasRenderingContext2D,
  room: Room,
  agents: RuntimeAgent[],
) {
  const plaque = EXTERIOR_ROOM_LABELS[room.id];
  if (!plaque) return;
  const activity = roomActivityLabel(agents);
  const activeColor = agents.some((agent) => agent.status === 'blocked')
    ? '#d8a253'
    : agents.some((agent) => agent.status === 'working')
      ? '#7cc7c0'
      : '#86919a';

  drawExteriorPlaque(context, plaque, activeColor);
  context.font = '8px ui-monospace, monospace';
  context.fillStyle = '#d8dedd';
  context.fillText(room.label, plaque.x + 10, plaque.y + 13);
  const activityWidth = context.measureText(activity).width;
  context.fillStyle = activeColor;
  context.fillText(
    activity,
    plaque.x + plaque.width - activityWidth - 7,
    plaque.y + 13,
  );
}

function drawFieldJournal(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
) {
  drawExteriorPlaque(context, CONTEXT_PLAQUE, '#c3a77c');
  context.font = '7px ui-monospace, monospace';
  context.fillStyle = '#77858c';
  context.fillText(
    'CONTEXT / COMMONS',
    CONTEXT_PLAQUE.x + 7,
    CONTEXT_PLAQUE.y + 9,
  );
  context.fillStyle = '#c3a77c';
  context.fillText(
    `JOURNAL ${String(state.boardMessages.length).padStart(2, '0')} / ${String(state.avatars.length).padStart(2, '0')} PRESENT`,
    CONTEXT_PLAQUE.x + 7,
    CONTEXT_PLAQUE.y + 18,
  );
}

function drawResourceSessions(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
) {
  state.agents
    .filter((agent) => agent.activeTool && agent.currentResourceId)
    .forEach((agent) => {
      const resource = resourceById(agent.currentResourceId!);
      if (!resource) return;
      const x = (resource.position.x / 100) * WORLD_WIDTH;
      const y = (resource.position.y / 100) * WORLD_HEIGHT - 52;
      const capability = (agent.activeCapability ?? 'tool').toUpperCase();
      const topic = agent.currentTopicId
        ? ` · ${agent.currentTopicId.slice(0, 12).toUpperCase()}`
        : '';
      const label = `${agent.name.toUpperCase()} · ${capability}${topic}`;
      context.font = '6px ui-monospace, monospace';
      const width = Math.min(132, context.measureText(label).width + 8);
      const left = Math.max(34, Math.min(734 - width, x - width / 2));
      context.fillStyle = 'rgba(5,10,14,.92)';
      context.fillRect(left, y, width, 14);
      context.fillStyle = agent.resourceQueued ? '#d8a253' : '#7cc7c0';
      context.fillRect(left, y, 2, 14);
      context.fillStyle = '#d8dedd';
      context.fillText(label, left + 5, y + 9);
    });
}

function drawSemanticLabels(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
) {
  ROOMS.filter((room) => room.id !== 'context').forEach((room) =>
    roomLabel(context, room, roomAgents(state, room.id)),
  );
  drawFieldJournal(context, state);
  drawResourceSessions(context, state);
}

function drawCorridor(
  context: CanvasRenderingContext2D,
  builder: HTMLImageElement | undefined,
) {
  const corridor: Room = {
    id: 'context',
    label: '',
    x: 32,
    y: 192,
    w: 704,
    h: 64,
    floor: [224, 112, 48, 32],
    wall: [0, 272, 48, 32],
  };
  context.fillStyle = '#46515b';
  context.fillRect(corridor.x, corridor.y, corridor.w, corridor.h);
  tiledCrop(context, builder, corridor, corridor.floor);
  context.fillStyle = 'rgba(11,20,29,.2)';
  context.fillRect(32, 192, 704, 64);
  context.fillStyle = 'rgba(169,187,190,.18)';
  context.fillRect(40, 222, 688, 2);
  context.fillStyle = 'rgba(8,14,20,.32)';
  context.fillRect(40, 225, 688, 1);
}

function resourceIsActive(state: AgentArenaState, resourceId: string) {
  return state.agents.some(
    (agent) =>
      agent.currentResourceId === resourceId &&
      Boolean(agent.activeTool || agent.engagedResourceId === resourceId),
  );
}

function drawFunctionalFloorZones(context: CanvasRenderingContext2D) {
  context.save();
  context.beginPath();
  context.rect(448, 256, 288, 160);
  context.clip();

  // The west bank is a warm fabrication deck. The east bank is a bounded,
  // cool inspection deck. A full 48px of unmarked floor preserves the door
  // route between them.
  context.fillStyle = 'rgba(83,61,43,.42)';
  context.fillRect(456, 320, 112, 88);
  context.fillStyle = 'rgba(36,64,73,.43)';
  context.fillRect(616, 320, 112, 88);

  context.fillStyle = 'rgba(213,164,95,.36)';
  context.fillRect(456, 320, 112, 2);
  context.fillRect(566, 320, 2, 88);
  context.fillStyle = 'rgba(119,185,184,.34)';
  context.fillRect(616, 320, 2, 88);
  context.fillRect(616, 406, 112, 2);

  context.fillStyle = 'rgba(8,12,15,.22)';
  for (let x = 464; x < 568; x += 16) context.fillRect(x, 323, 1, 82);
  for (let y = 328; y < 408; y += 16) context.fillRect(458, y, 108, 1);
  for (let x = 624; x < 728; x += 24) context.fillRect(x, 323, 1, 82);
  for (let y = 328; y < 408; y += 24) context.fillRect(618, y, 108, 1);

  // Small floor ticks communicate where equipment belongs without making the
  // route feel like a decorative UI grid.
  context.fillStyle = '#b6844f';
  [328, 352, 376].forEach((y) => context.fillRect(562, y, 4, 2));
  context.fillStyle = '#6da7a6';
  [328, 352, 376].forEach((y) => context.fillRect(618, y, 4, 2));
  context.restore();
}

function drawBuildWallPanels(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
) {
  const buildArtifacts = state.artifacts.filter(
    (artifact) => artifact.kind === 'change',
  ).length;
  const testArtifacts = state.artifacts.filter(
    (artifact) => artifact.kind === 'test-result',
  ).length;

  // Parts board / build manifest.
  context.fillStyle = '#0b1014';
  context.fillRect(462, 288, 104, 29);
  context.fillStyle = '#584a3b';
  context.fillRect(464, 290, 100, 25);
  context.fillStyle = '#17191a';
  context.fillRect(466, 292, 96, 21);
  drawPixelText(context, 'BUILD', 469, 294, '#d3b17a');
  [469, 483, 497, 511, 525, 539].forEach((x, index) => {
    context.fillStyle =
      index < Math.min(buildArtifacts, 6) ? '#c49a67' : '#51483c';
    context.fillRect(x, 304, 9, 6);
    context.fillStyle = '#191715';
    context.fillRect(x + 2, 305, 5, 1);
  });

  // QA wall: a diagnostic trace and artifact-backed result lamps.
  context.fillStyle = '#071014';
  context.fillRect(618, 288, 108, 29);
  context.fillStyle = '#344b52';
  context.fillRect(620, 290, 104, 25);
  context.fillStyle = '#11191d';
  context.fillRect(622, 292, 100, 21);
  drawPixelText(context, 'VERIFY', 625, 294, '#9fcac7');
  context.fillStyle = '#496f73';
  [0, 1, 2, 3, 4, 5].forEach((step) => {
    const heights = [3, 6, 2, 7, 4, 5];
    context.fillRect(626 + step * 6, 309 - heights[step], 4, 1);
  });
  [683, 694, 705].forEach((x, index) => {
    context.fillStyle =
      index < Math.min(testArtifacts, 3) ? '#78b5a2' : '#3f5154';
    context.fillRect(x, 303, 7, 7);
    context.fillStyle = '#0b1113';
    context.fillRect(x + 2, 305, 3, 3);
  });
}

function drawFabricationBench(
  context: CanvasRenderingContext2D,
  x: number,
  active: boolean,
  variant: 'assembly' | 'finish',
) {
  const live = active ? '#d2a663' : '#796b58';
  context.fillStyle = 'rgba(3,6,8,.46)';
  context.fillRect(x + 3, 379, 49, 4);
  context.fillStyle = '#0a0e12';
  context.fillRect(x, 331, 54, 48);
  context.fillStyle = '#8b684b';
  context.fillRect(x + 2, 333, 50, 8);
  context.fillStyle = '#c09360';
  context.fillRect(x + 3, 333, 48, 2);
  context.fillStyle = '#4b3f34';
  context.fillRect(x + 4, 342, 46, 34);
  context.fillStyle = '#181a1a';
  context.fillRect(x + 6, 344, 19, 29);
  context.fillRect(x + 29, 344, 19, 29);
  context.fillStyle = '#6a5c49';
  [349, 356, 363].forEach((y) => {
    context.fillRect(x + 8, y, 15, 5);
    context.fillRect(x + 31, y, 15, 5);
  });
  context.fillStyle = live;
  context.fillRect(x + 9, 350, 11, 1);
  context.fillRect(x + 32, 364, 11, 1);
  context.fillStyle = '#16191b';
  context.fillRect(x + 2, 376, 5, 6);
  context.fillRect(x + 47, 376, 5, 6);

  if (variant === 'assembly') {
    context.fillStyle = '#182126';
    context.fillRect(x + 7, 319, 23, 13);
    context.fillStyle = active ? '#6ba5a5' : '#42565b';
    context.fillRect(x + 9, 321, 19, 8);
    context.fillStyle = '#b58b59';
    context.fillRect(x + 35, 324, 12, 7);
    context.fillStyle = '#111518';
    context.fillRect(x + 38, 321, 2, 4);
    context.fillRect(x + 44, 321, 2, 4);
  } else {
    context.fillStyle = '#2b3132';
    context.fillRect(x + 7, 324, 9, 7);
    context.fillStyle = '#c0a06f';
    context.fillRect(x + 19, 321, 18, 10);
    context.fillStyle = '#171b1d';
    context.fillRect(x + 22, 323, 12, 2);
    context.fillStyle = active ? '#c49a67' : '#655844';
    context.fillRect(x + 40, 326, 8, 5);
  }
}

function drawVerifyRig(
  context: CanvasRenderingContext2D,
  x: number,
  active: boolean,
  variant: 'trace' | 'matrix',
) {
  const live = active ? '#7cc7c0' : '#50666a';
  context.fillStyle = 'rgba(3,6,8,.48)';
  context.fillRect(x + 3, 380, 49, 4);
  context.fillStyle = '#080d11';
  context.fillRect(x, 319, 54, 62);
  context.fillStyle = '#50606a';
  context.fillRect(x + 2, 321, 50, 27);
  context.fillStyle = '#10171c';
  context.fillRect(x + 5, 324, 44, 20);
  context.fillStyle = live;
  context.fillRect(x + 7, 326, 2, 2);

  if (variant === 'trace') {
    const trace = [6, 10, 5, 13, 8, 15, 7];
    trace.forEach((height, index) => {
      context.fillRect(x + 11 + index * 5, 341 - height, 3, 1);
    });
  } else {
    [0, 1, 2].forEach((column) =>
      [0, 1].forEach((row) => {
        context.fillStyle =
          active && (column + row) % 2 === 0 ? '#85b8b3' : '#33474c';
        context.fillRect(x + 13 + column * 10, 329 + row * 7, 7, 4);
      }),
    );
  }

  context.fillStyle = '#6a7479';
  context.fillRect(x + 4, 350, 46, 27);
  context.fillStyle = '#252e34';
  context.fillRect(x + 7, 353, 40, 9);
  context.fillRect(x + 7, 365, 40, 9);
  context.fillStyle = live;
  context.fillRect(x + 10, 356, active ? 25 : 10, 2);
  context.fillStyle = '#11161a';
  context.fillRect(x + 5, 377, 7, 5);
  context.fillRect(x + 42, 377, 7, 5);
}

function drawBuildRoom(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
) {
  drawBuildWallPanels(context, state);
  drawFabricationBench(
    context,
    456,
    resourceIsActive(state, 'build-bench-a'),
    'assembly',
  );
  drawFabricationBench(
    context,
    514,
    resourceIsActive(state, 'build-bench-b'),
    'finish',
  );
  drawVerifyRig(
    context,
    618,
    resourceIsActive(state, 'verify-rig-a'),
    'trace',
  );
  drawVerifyRig(
    context,
    674,
    resourceIsActive(state, 'verify-rig-b'),
    'matrix',
  );

}

function messageAwaitsReceipt(
  state: AgentArenaState,
  message: AgentArenaState['boardMessages'][number],
) {
  const expected =
    message.audience === 'direct'
      ? message.recipientAgentIds
      : state.agents
          .map((agent) => agent.id)
          .filter((agentId) => agentId !== message.authorAgentId);
  const acknowledged = new Set(
    message.acknowledgements.map((item) => item.agentId),
  );
  return expected.some((agentId) => !acknowledged.has(agentId));
}

function drawCommandRoom(
  context: CanvasRenderingContext2D,
  interiors: HTMLImageElement | undefined,
  state: AgentArenaState,
) {
  const x = 270;
  const y = 42;
  const width = 164;
  const height = 51;

  // A single physical routing board replaces the unrelated globe/map crops
  // and the semantic comms overlay. The plan, cards, pins, and strings are
  // part of the room; full message content remains in the field journal.
  context.fillStyle = 'rgba(3,6,8,.42)';
  context.fillRect(x + 3, y + 4, width, height);
  context.fillStyle = '#11161a';
  context.fillRect(x, y, width, height);
  context.fillStyle = '#8a7458';
  context.fillRect(x + 3, y + 3, width - 6, height - 6);
  context.fillStyle = '#5f5140';
  context.fillRect(x + 6, y + 6, width - 12, height - 12);

  // Facility plan: six rooms, one corridor, and the entry approach.
  context.fillStyle = '#c9c0ae';
  context.fillRect(x + 9, y + 8, 84, 35);
  context.strokeStyle = '#595a55';
  context.lineWidth = 1;
  context.strokeRect(x + 11.5, y + 10.5, 78, 29);
  context.beginPath();
  context.moveTo(x + 37.5, y + 11);
  context.lineTo(x + 37.5, y + 22);
  context.moveTo(x + 63.5, y + 11);
  context.lineTo(x + 63.5, y + 22);
  context.moveTo(x + 12, y + 22.5);
  context.lineTo(x + 90, y + 22.5);
  context.moveTo(x + 43.5, y + 29);
  context.lineTo(x + 43.5, y + 40);
  context.moveTo(x + 63.5, y + 29);
  context.lineTo(x + 63.5, y + 40);
  context.moveTo(x + 12, y + 28.5);
  context.lineTo(x + 90, y + 28.5);
  context.stroke();
  context.fillStyle = '#a97355';
  context.fillRect(x + 51, y + 24, 4, 3);
  context.fillStyle = '#6f9189';
  context.fillRect(x + 73, y + 14, 3, 3);
  context.fillRect(x + 21, y + 33, 3, 3);

  const latestMessages = state.boardMessages.slice(-3);
  latestMessages.forEach((message, index) => {
    const cardX = x + 103 + (index % 2) * 25;
    const cardY = y + 8 + index * 12;
    const waiting = messageAwaitsReceipt(state, message);
    context.fillStyle = index % 2 === 0 ? '#d5cbb8' : '#b8c1ba';
    context.fillRect(cardX, cardY, 35, 9);
    context.fillStyle = '#67655d';
    context.fillRect(cardX + 5, cardY + 3, 23, 1);
    context.fillRect(cardX + 5, cardY + 6, 17, 1);
    context.fillStyle = waiting ? '#c99655' : '#719889';
    context.fillRect(cardX + 2, cardY + 2, 2, 2);
    context.strokeStyle = waiting ? '#a97355' : '#607e78';
    context.beginPath();
    context.moveTo(x + 87, y + 17 + index * 7);
    context.lineTo(cardX + 2, cardY + 3);
    context.stroke();
  });

  // The existing authored desk remains the physical directive/comms station.
  sprite(context, interiors, [16, 576, 64, 32], 288, 96);
  context.fillStyle = resourceIsActive(state, 'comms-board')
    ? '#7cc7c0'
    : latestMessages.some((message) => messageAwaitsReceipt(state, message))
      ? '#d8a253'
      : '#65777a';
  context.fillRect(400, 116, 4, 2);
}

function drawUtilityRoom(
  context: CanvasRenderingContext2D,
  interiors: HTMLImageElement | undefined,
  state: AgentArenaState,
) {
  const stations = [
    { id: 'shell-console-a', x: 448, center: 480 },
    { id: 'shell-console-b', x: 512, center: 544 },
    { id: 'connector-console-a', x: 608, center: 640 },
    { id: 'connector-console-b', x: 672, center: 704 },
  ];

  // A shallow, bracketed cable tray and patch bays replace the unrelated
  // chalkboard/locker crops. Every conduit terminates at a real tool station.
  context.fillStyle = '#11171c';
  context.fillRect(462, 47, 260, 8);
  context.fillStyle = '#68747b';
  context.fillRect(465, 49, 254, 3);
  context.fillStyle = '#2c363d';
  context.fillRect(468, 54, 248, 3);
  stations.forEach((station, index) => {
    const active = resourceIsActive(state, station.id);
    const bayX = station.center - 19;
    context.fillStyle = '#12191f';
    context.fillRect(bayX, 60, 38, 22);
    context.fillStyle = '#4b5860';
    context.fillRect(bayX + 2, 62, 34, 18);
    context.fillStyle = '#222d34';
    context.fillRect(bayX + 5, 65, 28, 11);
    [0, 1, 2, 3].forEach((port) => {
      context.fillStyle =
        active && port <= 1
          ? '#7cc7c0'
          : index < 2
            ? '#70818a'
            : '#8a7964';
      context.fillRect(bayX + 7 + port * 7, 68, 3, 3);
    });
    context.fillStyle = '#1a232a';
    context.fillRect(station.center - 2, 82, 4, 14);
    context.fillStyle = '#69767d';
    context.fillRect(station.center - 1, 83, 1, 13);
    sprite(
      context,
      interiors,
      CONSOLE_SOURCES[index % CONSOLE_SOURCES.length],
      station.x,
      96,
    );
  });
}

function drawFurniture(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
) {
  const interiors = bank.interiors;

  // Research: reference wall, one source-reading desk, and two actual lookup
  // computers. Tool events reserve these computers; they are not click-to-run.
  sprite(context, interiors, [160, 1088, 96, 32], 48, 32);
  sprite(context, interiors, [16, 576, 32, 32], 48, 96);
  sprite(context, interiors, CONSOLE_SOURCES[0], 144, 96);
  sprite(context, interiors, CONSOLE_SOURCES[1], 192, 96);

  // Command: a coherent physical routing wall and authenticated desk terminal.
  drawCommandRoom(context, interiors, state);

  // Utility: four stations connected to a real wall-mounted patch rail.
  drawUtilityRoom(context, interiors, state);

  // Synthesis: source board and paired review benches leave the door lane open.
  sprite(context, interiors, [0, 656, 32, 16], 64, 272);
  sprite(context, interiors, [16, 576, 32, 32], 96, 320);
  sprite(context, interiors, [48, 576, 32, 32], 192, 320);

  // Commons remains an open circulation landing. Residents occupy grounded
  // standing anchors; no decorative seat is allowed to obstruct the lift path.

  // Build and Verify deliberately do not reuse the Utility terminal farm.
  // The west bank is a fabrication shop; the east bank is a diagnostic lab.
  drawBuildRoom(context, state);

  const lamp = state.worldEntities.find(
    (entity) => entity.id === 'archive-lamp',
  );
  if (lamp?.state.power === 'on') {
    context.save();
    context.beginPath();
    context.rect(32, 32, 224, 160);
    context.clip();
    const glow = context.createRadialGradient(92, 118, 4, 92, 118, 74);
    glow.addColorStop(0, 'rgba(255, 222, 157, .28)');
    glow.addColorStop(0.45, 'rgba(231, 189, 119, .12)');
    glow.addColorStop(1, 'rgba(231, 189, 119, 0)');
    context.fillStyle = glow;
    context.fillRect(32, 32, 160, 160);
    context.restore();
  }
}

function drawExteriorEntrance(
  context: CanvasRenderingContext2D,
  interiors: HTMLImageElement | undefined,
) {
  // The lift face terminates at the south wall. The exterior pad is visual
  // infrastructure only; residents stage on the interior floor above the
  // closed doors and never stand on the door artwork.
  context.fillStyle = 'rgba(2,4,6,.56)';
  context.fillRect(340, 419, 88, 29);
  context.fillStyle = '#28323a';
  context.fillRect(342, 416, 84, 32);
  context.fillStyle = '#46515a';
  context.fillRect(346, 418, 76, 30);
  context.fillStyle = 'rgba(166,179,183,.14)';
  [423, 432, 441].forEach((lineY) => context.fillRect(348, lineY, 72, 1));

  drawLiftFace(context, interiors);
}

function drawLiftFace(
  context: CanvasRenderingContext2D,
  interiors: HTMLImageElement | undefined,
) {
  context.fillStyle = '#0b1117';
  context.fillRect(338, 351, 92, 68);
  context.fillStyle = '#222d35';
  context.fillRect(341, 354, 86, 63);
  context.fillStyle = '#10171d';
  context.fillRect(338, 351, 92, 15);
  context.fillStyle = '#68757d';
  context.fillRect(342, 354, 84, 3);
  context.fillStyle = '#0e151b';
  context.fillRect(338, 360, 8, 59);
  context.fillRect(422, 360, 8, 59);
  context.fillStyle = '#718089';
  context.fillRect(342, 362, 3, 54);
  context.fillRect(423, 362, 3, 54);
  crop(context, interiors, [13, 423, 38, 25], [346, 366, 76, 50]);
  context.fillStyle = '#111820';
  context.fillRect(342, 415, 84, 5);
  context.fillStyle = '#77858d';
  context.fillRect(346, 415, 76, 2);
}

function drawArchitecture(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
) {
  context.fillStyle = '#070a0f';
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  context.fillStyle = '#020407';
  context.fillRect(23, 23, 722, 402);
  context.fillStyle = '#121923';
  context.fillRect(28, 28, 712, 392);

  ROOMS.forEach((room) => floorRoom(context, room, bank.roomBuilder));
  drawFunctionalFloorZones(context);
  drawCorridor(context, bank.roomBuilder);
  SOUTH_ROOM_DOORS.forEach((opening) =>
    drawSouthDoorAperture(context, opening),
  );
  NORTH_ROOM_DOORS.forEach(({ centerX, width }) =>
    doorwayThreshold(context, centerX, 192, width, 'south'),
  );
  drawFurniture(context, bank, state);

  // One shared structure: outer shell, internal partitions, and explicit doors.
  horizontalWall(context, 32, 736, 32);
  verticalWall(context, 32, 32, 416);
  verticalWall(context, 736, 32, 416);
  horizontalWallWithOpenings(context, 32, 736, 416, [LIFT_OPENING]);

  verticalWall(context, 256, 32, 192);
  verticalWall(context, 448, 32, 192);
  verticalWall(context, 320, 256, 416);
  verticalWall(context, 448, 256, 416);

  horizontalWallWithOpenings(context, 32, 736, 192, NORTH_ROOM_DOORS);
  horizontalWallWithOpenings(context, 32, 736, 256, SOUTH_ROOM_DOORS);

  // A single restrained wash unifies the authored atlas without crushing it.
  context.fillStyle = 'rgba(5,12,20,.18)';
  context.fillRect(32, 32, 704, 384);

  drawExteriorEntrance(context, bank.interiors);
}

function drawForeground(context: CanvasRenderingContext2D, bank: ImageBank) {
  // Portal faces are foreground occluders. Collision keeps foot capsules out
  // of the jambs; this pass also prevents a tall sprite from painting over the
  // wall face while it legitimately walks beneath a doorway header.
  drawSouthWallFaces(context, bank.roomBuilder);
  // Restore the one wall-mounted south-room fixture after the wall face is
  // composited over residents standing on the floor below it.
  sprite(context, bank.interiors, [0, 656, 32, 16], 64, 272);
  NORTH_ROOM_DOORS.forEach(({ centerX, width }) =>
    doorwayJambs(context, centerX, 192, width),
  );
  SOUTH_ROOM_DOORS.forEach((opening) =>
    drawSouthDoorFrame(context, opening),
  );
  horizontalWallWithOpenings(context, 32, 736, 192, NORTH_ROOM_DOORS);
  horizontalWallWithOpenings(context, 32, 736, 256, SOUTH_ROOM_DOORS);
  verticalWall(context, 256, 32, 192);
  verticalWall(context, 448, 32, 192);
  verticalWall(context, 320, 256, 416);
  verticalWall(context, 448, 256, 416);
  drawLiftFace(context, bank.interiors);

  context.fillStyle = 'rgba(4,8,12,.42)';
  context.fillRect(80, 158, 128, 3);
  context.fillRect(288, 158, 128, 3);
  [448, 512, 608, 672].forEach((x) => context.fillRect(x, 158, 64, 3));
  context.fillRect(96, 382, 64, 3);
  context.fillRect(192, 382, 64, 3);
}

function motionFor(agent: RuntimeAgent, avatar: AvatarProjection): Motion {
  if (avatar.isMoving && (avatar.routeDelayMs ?? 0) <= 0) return 'run';
  if (
    agent.status === 'blocked' ||
    agent.status === 'failed' ||
    agent.status === 'canceled'
  ) {
    return 'idle_anim';
  }
  const fixture = resourceById(avatar.stationId);
  if (agent.activeTool && fixture) return 'sit2';
  if (agent.engagedResourceId === avatar.stationId) return 'sit';
  if (fixture && new Set(['table', 'board', 'waiting']).has(fixture.kind))
    return 'sit';
  return 'idle_anim';
}

function directionOffset(direction: AvatarDirection) {
  return { east: 0, north: 6, west: 12, south: 18 }[direction];
}

function verbForPhase(phase: AgentPhase) {
  const labels: Record<AgentPhase, string> = {
    spawning: 'arriving',
    planning: 'planning',
    delegating: 'delegating',
    researching: 'researching',
    implementing: 'building',
    tooling: 'using tool',
    verifying: 'verifying',
    synthesizing: 'synthesizing',
    waiting: 'awaiting input',
    completed: 'complete',
    failed: 'failed',
    canceled: 'interrupted',
  };
  return labels[phase];
}

function drawBracket(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  const left = x - 19;
  const right = x + 19;
  const top = y - 66;
  const bottom = y + 2;
  const arm = 7;
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top + arm);
  context.lineTo(left, top);
  context.lineTo(left + arm, top);
  context.moveTo(right - arm, top);
  context.lineTo(right, top);
  context.lineTo(right, top + arm);
  context.moveTo(left, bottom - arm);
  context.lineTo(left, bottom);
  context.lineTo(left + arm, bottom);
  context.moveTo(right - arm, bottom);
  context.lineTo(right, bottom);
  context.lineTo(right, bottom - arm);
  context.stroke();
}

function drawNameplate(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  agent: RuntimeAgent,
  avatar: AvatarProjection,
) {
  context.font = '9px ui-monospace, monospace';
  const activity = avatar.isYielding
    ? `YIELDING TO ${avatar.yieldingToAgentId?.toUpperCase() ?? 'TRAFFIC'}`
    : agent.activeTool
      ? `${(agent.activeCapability ?? 'TOOL').toUpperCase()} @ ${
          resourceById(agent.currentResourceId ?? '')?.label.toUpperCase() ??
          'UTILITY'
        }`
      : verbForPhase(agent.phase).toUpperCase();
  const label = `${agent.name.toUpperCase()} / ${activity}`;
  const width = Math.ceil(context.measureText(label).width) + 10;
  const left = Math.max(4, Math.min(WORLD_WIDTH - width - 4, x - width / 2));
  context.fillStyle = 'rgba(7,11,16,.94)';
  context.fillRect(left, y + 5, width, 18);
  context.fillStyle = statusColor(agent);
  context.fillRect(left, y + 5, 2, 18);
  context.fillStyle = '#e1e5e2';
  context.fillText(label, left + 6, y + 18);
}

function drawAgent(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  agent: RuntimeAgent,
  avatar: AvatarProjection,
  selected: boolean,
  followed: boolean,
  now: number,
) {
  const presentation = presentationFor(agent.id);
  const motion = motionFor(agent, avatar);
  const sheet = bank[`${agent.id}:${motion}`];
  if (!imageReady(sheet)) return;

  const seated = motion === 'sit' || motion === 'sit2';
  const frameWidth = seated ? 32 : FRAME_WIDTH;
  const frameCount = motion === 'phone' ? 9 : 6;
  const frame = Math.floor(now / (motion === 'run' ? 95 : 150)) % frameCount;
  const seatedDirection =
    avatar.direction === 'west' || avatar.direction === 'north' ? 6 : 0;
  const sourceFrame =
    motion === 'phone'
      ? frame
      : seated
        ? seatedDirection + frame
        : directionOffset(avatar.direction) + frame;
  const x = Math.round((avatar.position.x / 100) * WORLD_WIDTH);
  const y = Math.round((avatar.position.y / 100) * WORLD_HEIGHT);
  const width = frameWidth * ASSET_SCALE;
  const height = FRAME_HEIGHT * ASSET_SCALE;

  context.fillStyle = 'rgba(0,0,0,.34)';
  context.beginPath();
  context.ellipse(x, y, seated ? 17 : 11, 4, 0, 0, Math.PI * 2);
  context.fill();
  context.drawImage(
    sheet,
    sourceFrame * frameWidth,
    0,
    frameWidth,
    FRAME_HEIGHT,
    Math.round(x - width / 2),
    y - height,
    width,
    height,
  );

  if (
    selected ||
    followed ||
    agent.status === 'blocked' ||
    agent.status === 'failed'
  ) {
    const color =
      agent.status === 'blocked'
        ? '#d8a253'
        : agent.status === 'failed'
          ? '#c66a66'
          : presentation.accent;
    drawBracket(context, x, y, color);
  }
}

function drawAgentLabels(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
  agentsById: Map<string, RuntimeAgent>,
  hoveredAgentId: string | undefined,
) {
  [...state.avatars]
    .sort((left, right) => left.position.y - right.position.y)
    .forEach((avatar) => {
      const agent = agentsById.get(avatar.agentId);
      if (!agent) return;
      const x = Math.round((avatar.position.x / 100) * WORLD_WIDTH);
      const y = Math.round((avatar.position.y / 100) * WORLD_HEIGHT);
      if (state.selectedAgentId === agent.id || hoveredAgentId === agent.id) {
        drawNameplate(context, x, y, agent, avatar);
      }
    });
}

type ProximitySpeechEvent = Extract<RuntimeEvent, { kind: 'proximity.spoken' }>;

type SpeechBubbleProjection = {
  event: ProximitySpeechEvent;
  speaker: RuntimeAgent;
  left: number;
  top: number;
};

function speechBubbleLifetime(event: ProximitySpeechEvent) {
  return 14_000 + Math.min(4_000, event.payload.preview.length * 40);
}

function clearRoomTitleBand(top: number, avatarY: number, roomId: string) {
  if (!new Set(['synthesis', 'context', 'build']).has(roomId)) return top;
  const estimatedBubbleTop = top - 6;
  const titleTop = 58.7;
  const titleBottom = 63.2;
  if (top < titleTop || estimatedBubbleTop > titleBottom) return top;
  return avatarY <= 76 ? 57 : 70;
}

function projectSpeechBubbles(state: AgentArenaState, now: number) {
  const avatars = new Map(
    state.avatars.map((avatar) => [avatar.agentId, avatar]),
  );
  const agents = new Map(state.agents.map((agent) => [agent.id, agent]));
  const latestBySpeaker = new Set<string>();
  const roomCounts = new Map<string, number>();
  const projected: SpeechBubbleProjection[] = [];

  for (const event of state.events) {
    if (event.kind !== 'proximity.spoken' || !event.agentId) continue;
    if (latestBySpeaker.has(event.agentId)) continue;
    const occurredAt = Date.parse(event.occurredAt);
    if (
      !Number.isFinite(occurredAt) ||
      now - occurredAt < 0 ||
      now - occurredAt > speechBubbleLifetime(event)
    ) {
      continue;
    }
    const avatar = avatars.get(event.agentId);
    const speaker = agents.get(event.agentId);
    if (!avatar || !speaker) continue;
    latestBySpeaker.add(event.agentId);
    const roomId =
      roomForLocation(avatar.stationId)?.id ??
      roomForLocation(event.payload.speakerLocationId)?.id ??
      'context';
    const roomCount = roomCounts.get(roomId) ?? 0;
    if (roomCount >= 2 || projected.length >= 4) continue;
    const overlapsEarlier = projected.some(
      (bubble) =>
        Math.abs(bubble.left - avatar.position.x) < 24 &&
        Math.abs(bubble.top - (avatar.position.y - 13)) < 15,
    );
    const laneOffset = overlapsEarlier ? 10 : 0;
    const nominalTop = Math.max(
      8,
      Math.min(88, avatar.position.y - 13 - laneOffset),
    );
    projected.push({
      event,
      speaker,
      left: Math.max(14, Math.min(86, avatar.position.x)),
      top: clearRoomTitleBand(nominalTop, avatar.position.y, roomId),
    });
    roomCounts.set(roomId, roomCount + 1);
  }

  return projected;
}

export function AgentArenaWorld({
  state,
  onSelectAgent,
  onOpenJournal,
  onOpenResearch,
  journalOpen,
}: WorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  const bankRef = useRef<ImageBank>({});
  const [assetRevision, setAssetRevision] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [hoveredAgentId, setHoveredAgentId] = useState<string>();
  const [bubbleNow, setBubbleNow] = useState(0);

  const agentsById = useMemo(
    () => new Map(state.agents.map((agent) => [agent.id, agent])),
    [state.agents],
  );
  const speechBubbles = projectSpeechBubbles(state, bubbleNow);
  const observedAgentIds = useMemo(
    () =>
      state.agents
        .map((agent) => agent.id)
        .sort()
        .join('|'),
    [state.agents],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setBubbleNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let canceled = false;
    const sources: Array<[string, string]> = [
      ['interiors', '/assets/limezu/interiors.png'],
      ['roomBuilder', '/assets/limezu/room-builder.png'],
    ];
    state.agents.forEach((agent) => {
      const folder = presentationFor(agent.id).sprite;
      MOTIONS.forEach((motion) => {
        sources.push([`${agent.id}:${motion}`, `${folder}/${motion}.png`]);
      });
    });

    const missing = sources.filter(([key]) => !bankRef.current[key]);
    if (missing.length === 0) {
      setAssetsReady(
        imageReady(bankRef.current.interiors) &&
          imageReady(bankRef.current.roomBuilder),
      );
      return () => {
        canceled = true;
      };
    }

    void Promise.allSettled(
      missing.map(
        ([key, source]) =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = source;
            bankRef.current[key] = image;
          }),
      ),
    ).then(() => {
      if (canceled) return;
      setAssetsReady(
        imageReady(bankRef.current.interiors) &&
          imageReady(bankRef.current.roomBuilder),
      );
      setAssetRevision((revision) => revision + 1);
    });

    return () => {
      canceled = true;
    };
  }, [observedAgentIds, state.agents]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelCanvas = labelCanvasRef.current;
    const context = canvas?.getContext('2d');
    const labelContext = labelCanvas?.getContext('2d');
    if (!canvas || !context || !labelCanvas || !labelContext) return;
    context.imageSmoothingEnabled = false;
    const bank = bankRef.current;
    drawArchitecture(context, bank, state);

    const now = performance.now();
    [...state.avatars]
      .sort((left, right) => left.position.y - right.position.y)
      .forEach((avatar) => {
        const agent = agentsById.get(avatar.agentId);
        if (!agent) return;
        drawAgent(
          context,
          bank,
          agent,
          avatar,
          state.selectedAgentId === agent.id,
          state.followedAgentId === agent.id,
          now,
        );
      });
    drawForeground(context, bank);

    labelContext.setTransform(1, 0, 0, 1, 0, 0);
    labelContext.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    labelContext.setTransform(2, 0, 0, 2, 0, 0);
    labelContext.imageSmoothingEnabled = true;
    drawSemanticLabels(labelContext, state);
    drawAgentLabels(labelContext, state, agentsById, hoveredAgentId);

    if (!assetsReady) {
      labelContext.fillStyle = '#aeb4b6';
      labelContext.font = '9px ui-monospace, monospace';
      labelContext.fillText('Loading authored sprite sheets…', 30, 438);
    }
  }, [agentsById, assetRevision, assetsReady, hoveredAgentId, state]);

  function logicalPoint(event: CanvasPointEvent) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / WORLD_WIDTH,
      bounds.height / WORLD_HEIGHT,
    );
    const renderedWidth = WORLD_WIDTH * scale;
    const renderedHeight = WORLD_HEIGHT * scale;
    const offsetX = (bounds.width - renderedWidth) / 2;
    const offsetY = (bounds.height - renderedHeight) / 2;
    return {
      x: (event.clientX - bounds.left - offsetX) / scale,
      y: (event.clientY - bounds.top - offsetY) / scale,
    };
  }

  function agentAt(event: CanvasPointEvent) {
    const point = logicalPoint(event);
    if (
      point.x < 0 ||
      point.x > WORLD_WIDTH ||
      point.y < 0 ||
      point.y > WORLD_HEIGHT
    ) {
      return undefined;
    }
    return [...state.avatars]
      .sort((left, right) => left.position.y - right.position.y)
      .reverse()
      .find((avatar) => {
        const agent = agentsById.get(avatar.agentId);
        if (!agent) return false;
        const motion = motionFor(agent, avatar);
        if (!imageReady(bankRef.current[`${agent.id}:${motion}`])) return false;
        const seated = motion === 'sit' || motion === 'sit2';
        const x = (avatar.position.x / 100) * WORLD_WIDTH;
        const y = (avatar.position.y / 100) * WORLD_HEIGHT;
        const halfWidth = seated ? 34 : 18;
        return (
          point.x >= x - halfWidth &&
          point.x <= x + halfWidth &&
          point.y >= y - 66 &&
          point.y <= y + 3
        );
      })?.agentId;
  }

  return (
    <div className="arena-stage">
      <div className="arena-stage-surface">
        <canvas
          ref={canvasRef}
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          className="arena-world"
          aria-hidden="true"
          onPointerMove={(event) => setHoveredAgentId(agentAt(event))}
          onPointerLeave={() => setHoveredAgentId(undefined)}
          onClick={(event) => onSelectAgent(agentAt(event))}
          style={{ cursor: hoveredAgentId ? 'pointer' : 'default' }}
        />
        <canvas
          ref={labelCanvasRef}
          width={WORLD_WIDTH * 2}
          height={WORLD_HEIGHT * 2}
          className="arena-world-labels"
          aria-hidden="true"
        />
        <div className="arena-bubble-layer" aria-live="polite">
          {speechBubbles.map(({ event, speaker, left, top }) => (
            <button
              key={event.eventId}
              type="button"
              className="arena-speech-bubble"
              data-speech-act={event.payload.speechAct}
              aria-label={`Open ${speaker.name}'s full speech in the field journal`}
              style={
                {
                  left: `${left}%`,
                  top: `${top}%`,
                  '--speaker-accent': presentationFor(speaker.id).accent,
                } as CSSProperties
              }
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onOpenJournal(event.eventId);
              }}
            >
              {event.payload.preview}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="comms-board-hotspot"
          aria-label={`Open field journal, ${state.boardMessages.length} agent messages`}
          aria-expanded={journalOpen}
          aria-haspopup="dialog"
          onClick={() => onOpenJournal()}
        />
        <button
          type="button"
          className="field-journal-hotspot"
          aria-label={`Open field journal, ${state.avatars.length} agents present`}
          aria-expanded={journalOpen}
          aria-haspopup="dialog"
          onClick={() => onOpenJournal()}
        />
        <button
          type="button"
          className="research-hotspot"
          aria-label={`Open research ledger, ${state.researchTopics.length} topics and ${state.artifacts.filter((artifact) => artifact.kind === 'source-note').length} source notes`}
          aria-expanded={journalOpen}
          aria-haspopup="dialog"
          onClick={onOpenResearch}
        />
      </div>
    </div>
  );
}
