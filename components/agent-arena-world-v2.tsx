'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  FACILITY_ROOMS,
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
const CHARACTER_SCALE = 2;
const CHARACTER_FRAME_WIDTH = 16;
const CHARACTER_FRAME_HEIGHT = 32;
const FACILITY_ASSET_ROOT = '/assets/facility-v3';
const MOTIONS = ['run', 'idle_anim', 'phone', 'sit', 'sit2'] as const;

type Motion = (typeof MOTIONS)[number];
type ImageBank = Record<string, HTMLImageElement>;
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

const ROOMS = FACILITY_ROOMS.map((room) => ({
  id: room.id as RoomId,
  label: room.label,
  ...room.rect,
})) satisfies Room[];

const FACILITY_ASSETS = {
  bookshelfA: 'cozy-cabin/sprites/bookcase-a.png',
  bookshelfB: 'cozy-cabin/sprites/bookcase-b.png',
  bookshelfC: 'cozy-cabin/sprites/bookcase-c.png',
  bookshelfFilled: 'cozy-cabin/sprites/bookcase-filled.png',
  cabinetA: 'cozy-cabin/sprites/cabinet-a.png',
  cabinetFilled: 'cozy-cabin/sprites/cabinet-filled.png',
  sideboardA: 'cozy-cabin/sprites/sideboard-a.png',
  sideboardB: 'cozy-cabin/sprites/sideboard-b.png',
  deskRect: 'cozy-cabin/sprites/desk-rect.png',
  deskSmall: 'cozy-cabin/sprites/desk-small.png',
  tableRound: 'cozy-cabin/sprites/table-round.png',
  tableBlue: 'cozy-cabin/sprites/table-blue.png',
  tableYellow: 'cozy-cabin/sprites/table-yellow.png',
  tableVertical: 'cozy-cabin/sprites/table-vertical.png',
  chairEast: 'cozy-cabin/sprites/chair-east.png',
  chairWest: 'cozy-cabin/sprites/chair-west.png',
  chairNorth: 'cozy-cabin/sprites/chair-north.png',
  chairSouth: 'cozy-cabin/sprites/chair-south.png',
  armchairGreen: 'cozy-cabin/sprites/armchair-green.png',
  armchairAmber: 'cozy-cabin/sprites/armchair-amber.png',
  sofaGreen: 'cozy-cabin/sprites/sofa-green.png',
  sofaAmber: 'cozy-cabin/sprites/sofa-amber.png',
  floorLamp: 'cozy-cabin/sprites/floor-lamp.png',
  plantSmall: 'cozy-cabin/sprites/plant-small.png',
  plantTall: 'cozy-cabin/sprites/plant-tall.png',
  flowerPot: 'cozy-cabin/sprites/flower-pot.png',
  plantPair: 'cozy-cabin/sprites/plant-pair.png',
} as const;

type FacilityAssetKey = keyof typeof FACILITY_ASSETS;

type SceneProp = {
  asset: FacilityAssetKey;
  x: number;
  y: number;
  baseline: number;
  resourceId?: string;
};

const WALL_COLORS: Record<RoomId, { paper: string; panel: string }> = {
  research: { paper: '#d8c39f', panel: '#8a5737' },
  command: { paper: '#c8c09c', panel: '#79543a' },
  tools: { paper: '#bcae8d', panel: '#71503a' },
  synthesis: { paper: '#d2b998', panel: '#87543a' },
  context: { paper: '#c2ae8d', panel: '#76513a' },
  build: { paper: '#b8ad91', panel: '#6d503e' },
};

const SCENE_PROPS: SceneProp[] = [
  // Research / Sources — full authored sprites, never arbitrary atlas cells.
  { asset: 'bookshelfFilled', x: 47, y: 52, baseline: 104, resourceId: 'archive-desk' },
  { asset: 'bookshelfB', x: 96, y: 52, baseline: 104 },
  { asset: 'bookshelfC', x: 145, y: 52, baseline: 104 },
  { asset: 'plantTall', x: 220, y: 66, baseline: 109 },
  { asset: 'floorLamp', x: 111, y: 126, baseline: 156, resourceId: 'archive-lamp' },
  { asset: 'armchairGreen', x: 61, y: 126, baseline: 156 },
  { asset: 'deskRect', x: 146, y: 126, baseline: 158, resourceId: 'research-computer-a' },
  { asset: 'chairSouth', x: 164, y: 155, baseline: 177 },
  { asset: 'deskSmall', x: 207, y: 126, baseline: 158, resourceId: 'research-computer-b' },
  { asset: 'chairSouth', x: 216, y: 155, baseline: 177 },

  // Command / Routing — a planning table and paper archive.
  { asset: 'sideboardB', x: 271, y: 69, baseline: 96 },
  { asset: 'cabinetFilled', x: 392, y: 58, baseline: 94 },
  { asset: 'tableRound', x: 295, y: 126, baseline: 158, resourceId: 'command-table' },
  { asset: 'chairWest', x: 277, y: 129, baseline: 156 },
  { asset: 'chairEast', x: 349, y: 128, baseline: 156 },

  // Utility / Tools — warm workshop furniture instead of laboratory banks.
  { asset: 'cabinetA', x: 464, y: 58, baseline: 94 },
  { asset: 'cabinetFilled', x: 674, y: 58, baseline: 94 },
  { asset: 'deskRect', x: 455, y: 126, baseline: 158, resourceId: 'shell-console-a' },
  { asset: 'deskRect', x: 519, y: 126, baseline: 158, resourceId: 'shell-console-b' },
  { asset: 'deskSmall', x: 624, y: 126, baseline: 158, resourceId: 'connector-console-a' },
  { asset: 'deskSmall', x: 688, y: 126, baseline: 158, resourceId: 'connector-console-b' },
  { asset: 'chairSouth', x: 473, y: 155, baseline: 177 },
  { asset: 'chairSouth', x: 537, y: 155, baseline: 177 },
  { asset: 'chairSouth', x: 633, y: 155, baseline: 177 },
  { asset: 'chairSouth', x: 697, y: 155, baseline: 177 },

  // Synthesis / Decisions — a small library salon and evidence table.
  { asset: 'bookshelfA', x: 48, y: 278, baseline: 330, resourceId: 'publish-console' },
  { asset: 'bookshelfFilled', x: 97, y: 278, baseline: 330 },
  { asset: 'sofaGreen', x: 48, y: 338, baseline: 368 },
  { asset: 'tableRound', x: 119, y: 338, baseline: 370, resourceId: 'evidence-table' },
  { asset: 'armchairGreen', x: 178, y: 338, baseline: 368 },
  { asset: 'deskRect', x: 219, y: 338, baseline: 370, resourceId: 'publish-console' },
  { asset: 'chairSouth', x: 237, y: 367, baseline: 389 },

  // Commons — a clear route from the north doorway to the anchored lift.
  { asset: 'plantSmall', x: 328, y: 304, baseline: 328 },
  { asset: 'deskSmall', x: 404, y: 342, baseline: 374, resourceId: 'context-kiosk' },
  { asset: 'chairSouth', x: 413, y: 371, baseline: 393 },

  // Build / Verify — workshop benches on the left, review desk on the right.
  { asset: 'sideboardA', x: 464, y: 283, baseline: 310 },
  { asset: 'cabinetFilled', x: 674, y: 278, baseline: 314 },
  { asset: 'deskRect', x: 455, y: 338, baseline: 370, resourceId: 'build-bench-a' },
  { asset: 'deskRect', x: 519, y: 338, baseline: 370, resourceId: 'build-bench-b' },
  { asset: 'tableYellow', x: 622, y: 338, baseline: 370, resourceId: 'verify-rig-a' },
  { asset: 'deskSmall', x: 688, y: 338, baseline: 370, resourceId: 'verify-rig-b' },
  { asset: 'chairSouth', x: 473, y: 367, baseline: 389 },
  { asset: 'chairSouth', x: 537, y: 367, baseline: 389 },
  { asset: 'chairSouth', x: 633, y: 367, baseline: 389 },
  { asset: 'chairSouth', x: 697, y: 367, baseline: 389 },
  { asset: 'flowerPot', x: 711, y: 278, baseline: 318 },
];

function imageReady(image: HTMLImageElement | undefined) {
  return Boolean(image?.complete && image.naturalWidth > 0);
}

function facilityKey(key: FacilityAssetKey) {
  return `facility:${key}`;
}

function drawFacilitySprite(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  key: FacilityAssetKey,
  x: number,
  y: number,
) {
  const image = bank[facilityKey(key)];
  if (!imageReady(image)) return;
  context.drawImage(image, Math.round(x), Math.round(y));
}

function drawWoodFloor(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tone: number,
) {
  const plankHeight = 12;
  const plankLength = 48;
  const fills = ['#aa6338', '#b76d3f', '#a75e35', '#bc7342'];
  context.fillStyle = fills[tone % fills.length];
  context.fillRect(x, y, width, height);
  for (let row = 0; row < Math.ceil(height / plankHeight); row += 1) {
    const rowY = y + row * plankHeight;
    const rowHeight = Math.min(plankHeight, y + height - rowY);
    context.fillStyle = fills[(row + tone) % fills.length];
    context.fillRect(x, rowY, width, rowHeight);
    context.fillStyle = 'rgba(73,38,24,.42)';
    context.fillRect(x, rowY, width, 1);
    context.fillStyle = 'rgba(235,166,99,.16)';
    context.fillRect(x, rowY + rowHeight - 1, width, 1);
    const offset = row % 2 === 0 ? 0 : plankLength / 2;
    for (let seamX = x - offset; seamX < x + width; seamX += plankLength) {
      if (seamX > x) {
        context.fillStyle = 'rgba(74,38,24,.36)';
        context.fillRect(Math.round(seamX), rowY + 1, 1, Math.max(1, rowHeight - 2));
      }
    }
  }
}

function drawRoom(
  context: CanvasRenderingContext2D,
  room: Room,
  index: number,
) {
  context.save();
  context.beginPath();
  context.rect(room.x, room.y, room.w, room.h);
  context.clip();
  drawWoodFloor(context, room.x + 8, room.y + 32, room.w - 16, room.h - 40, index);

  const colors = WALL_COLORS[room.id];
  context.fillStyle = colors.paper;
  context.fillRect(room.x, room.y, room.w, 32);
  context.fillStyle = colors.panel;
  context.fillRect(room.x, room.y, room.w, 7);
  context.fillRect(room.x, room.y + 25, room.w, 7);
  context.fillRect(room.x, room.y, 8, room.h);
  context.fillRect(room.x + room.w - 8, room.y, 8, room.h);
  context.fillRect(room.x, room.y + room.h - 8, room.w, 8);
  context.fillStyle = 'rgba(255,238,200,.42)';
  context.fillRect(room.x + 8, room.y + 8, room.w - 16, 2);
  context.fillStyle = 'rgba(45,25,18,.55)';
  context.fillRect(room.x + 8, room.y + 31, room.w - 16, 2);
  context.strokeStyle = '#3c251c';
  context.lineWidth = 2;
  context.strokeRect(room.x + 1, room.y + 1, room.w - 2, room.h - 2);
  context.restore();
}

function drawCorridor(context: CanvasRenderingContext2D) {
  const x = 32;
  const y = 192;
  const width = 704;
  const height = 64;
  context.fillStyle = '#706157';
  context.fillRect(x, y, width, height);
  for (let row = 0; row < 4; row += 1) {
    const tileY = y + row * 16;
    const offset = row % 2 === 0 ? 0 : 24;
    context.fillStyle = row % 2 === 0 ? '#75665b' : '#6b5c53';
    context.fillRect(x, tileY, width, 15);
    context.fillStyle = '#4d423b';
    context.fillRect(x, tileY + 15, width, 1);
    for (let tileX = x - offset; tileX < x + width; tileX += 48) {
      if (tileX > x) context.fillRect(tileX, tileY, 1, 16);
    }
  }
  context.fillStyle = '#513325';
  context.fillRect(32, 192, 704, 6);
  context.fillRect(32, 250, 704, 6);
  context.fillStyle = 'rgba(237,204,151,.28)';
  context.fillRect(42, 222, 684, 2);
}

function drawThreshold(
  context: CanvasRenderingContext2D,
  centerX: number,
  roomSide: 'north' | 'south',
) {
  const openingLeft = centerX - 18;
  if (roomSide === 'north') {
    drawWoodFloor(context, openingLeft, 180, 36, 12, 1);
    context.fillStyle = '#4a2d20';
    context.fillRect(openingLeft - 5, 176, 5, 20);
    context.fillRect(openingLeft + 36, 176, 5, 20);
    context.fillStyle = '#c08a55';
    context.fillRect(openingLeft, 188, 36, 3);
    return;
  }
  drawWoodFloor(context, openingLeft, 256, 36, 38, 3);
  context.fillStyle = '#4a2d20';
  context.fillRect(openingLeft - 5, 254, 5, 40);
  context.fillRect(openingLeft + 36, 254, 5, 40);
  context.fillStyle = '#c08a55';
  context.fillRect(openingLeft, 256, 36, 3);
  context.fillRect(openingLeft, 290, 36, 3);
}

function drawDoorways(context: CanvasRenderingContext2D) {
  [144, 352, 592].forEach((centerX) => {
    drawThreshold(context, centerX, 'north');
  });
  [176, 344, 592].forEach((centerX) => {
    drawThreshold(context, centerX, 'south');
  });
}

function drawShell(context: CanvasRenderingContext2D) {
  context.fillStyle = '#12100d';
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  context.fillStyle = '#18130f';
  context.fillRect(20, 20, 728, 408);
  context.fillStyle = '#2d2018';
  context.fillRect(25, 25, 718, 398);
  context.strokeStyle = '#8b6544';
  context.lineWidth = 4;
  context.strokeRect(28, 28, 712, 392);
  context.strokeStyle = '#3b271c';
  context.lineWidth = 2;
  context.strokeRect(33, 33, 702, 382);
}

function drawPartitions(context: CanvasRenderingContext2D) {
  context.fillStyle = '#3e271c';
  [252, 444].forEach((x) => context.fillRect(x, 32, 8, 160));
  [316, 444].forEach((x) => context.fillRect(x, 256, 8, 160));
  context.fillStyle = '#a7784e';
  [255, 447].forEach((x) => context.fillRect(x, 35, 2, 154));
  [319, 447].forEach((x) => context.fillRect(x, 259, 2, 154));
}

function drawPlanBoard(context: CanvasRenderingContext2D) {
  context.fillStyle = '#513b29';
  context.fillRect(284, 47, 132, 50);
  context.fillStyle = '#d6c7a5';
  context.fillRect(291, 54, 86, 36);
  context.strokeStyle = '#7d6f58';
  context.lineWidth = 1;
  context.strokeRect(296, 59, 27, 11);
  context.strokeRect(323, 59, 45, 11);
  context.strokeRect(296, 70, 45, 12);
  context.strokeRect(341, 70, 27, 12);
  context.fillStyle = '#b46c4f';
  context.fillRect(318, 65, 3, 3);
  context.fillStyle = '#728f76';
  context.fillRect(348, 76, 3, 3);

  context.fillStyle = '#32271f';
  context.fillRect(382, 55, 27, 34);
  context.fillStyle = '#d7caa8';
  context.fillRect(387, 61, 17, 3);
  context.fillRect(387, 68, 13, 3);
  context.fillRect(387, 75, 15, 3);
}

function drawLift(context: CanvasRenderingContext2D) {
  // The lift is inset into Commons' north wall, rather than floating below
  // the building. Its approach remains open on the room side.
  const x = 376;
  const y = 258;
  context.fillStyle = '#3b281f';
  context.fillRect(x - 4, y - 6, 76, 66);
  context.fillStyle = '#8f765d';
  context.fillRect(x, y, 68, 58);
  context.fillStyle = '#c6b89c';
  context.fillRect(x + 5, y + 5, 27, 49);
  context.fillRect(x + 36, y + 5, 27, 49);
  context.fillStyle = '#6e5a48';
  context.fillRect(x + 31, y + 5, 6, 49);
  context.fillStyle = '#e0d4bd';
  context.fillRect(x + 7, y + 8, 23, 3);
  context.fillRect(x + 38, y + 8, 23, 3);
  context.fillStyle = '#4b3426';
  context.fillRect(x - 6, y + 58, 80, 7);
}

function drawWallDetails(context: CanvasRenderingContext2D) {
  // Every wall mark describes an in-world resource; none are dashboard chrome.
  drawPlanBoard(context);
  context.fillStyle = '#5c3a28';
  context.fillRect(54, 47, 166, 8);
  context.fillStyle = '#c9b78f';
  context.fillRect(61, 49, 42, 3);
  context.fillRect(111, 49, 31, 3);
  context.fillRect(150, 49, 59, 3);
  context.fillStyle = '#72533a';
  context.fillRect(522, 47, 158, 42);
  context.fillStyle = '#d8c69f';
  context.fillRect(530, 54, 142, 27);
  context.strokeStyle = '#795b3e';
  for (let x = 537; x < 665; x += 24) {
    context.strokeRect(x, 60, 10, 14);
  }
  context.fillStyle = '#493126';
  context.fillRect(670, 276, 48, 38);
  context.fillStyle = '#bcae91';
  context.fillRect(676, 282, 36, 25);
  context.strokeStyle = '#6e8069';
  context.beginPath();
  context.moveTo(680, 299);
  context.lineTo(689, 290);
  context.lineTo(698, 296);
  context.lineTo(708, 286);
  context.stroke();
}

function drawArchitecture(context: CanvasRenderingContext2D) {
  drawShell(context);
  ROOMS.forEach((room, index) => drawRoom(context, room, index));
  drawCorridor(context);
  drawPartitions(context);
  drawDoorways(context);
  drawWallDetails(context);
  drawLift(context);
}

function resourceIsActive(state: AgentArenaState, resourceId?: string) {
  if (!resourceId) return false;
  return state.agents.some(
    (agent) =>
      agent.status === 'working' &&
      (agent.currentResourceId === resourceId ||
        agent.engagedResourceId === resourceId),
  );
}

const COMPUTER_SURFACES = new Set([
  'research-computer-a',
  'research-computer-b',
  'shell-console-a',
  'shell-console-b',
  'connector-console-a',
  'connector-console-b',
]);

function drawSurfaceDetail(
  context: CanvasRenderingContext2D,
  prop: SceneProp,
  width: number,
) {
  const resourceId = prop.resourceId;
  if (!resourceId) return;
  const centerX = Math.round(prop.x + width / 2);

  if (COMPUTER_SURFACES.has(resourceId)) {
    const left = centerX - 8;
    const top = prop.y + 5;
    context.fillStyle = '#302922';
    context.fillRect(left - 1, top - 1, 18, 10);
    context.fillStyle = '#596f69';
    context.fillRect(left + 1, top + 1, 14, 6);
    context.fillStyle = '#9db69f';
    context.fillRect(left + 3, top + 2, 6, 1);
    context.fillStyle = '#4b3b2c';
    context.fillRect(left - 3, top + 9, 22, 3);
    context.fillStyle = '#b58855';
    context.fillRect(left + 1, top + 9, 14, 1);
    return;
  }

  if (resourceId === 'command-table') {
    context.fillStyle = '#ead8b3';
    context.fillRect(centerX - 9, prop.y + 7, 8, 6);
    context.fillRect(centerX + 2, prop.y + 8, 7, 5);
    context.fillStyle = '#9e6042';
    context.fillRect(centerX - 5, prop.y + 9, 2, 2);
    context.fillStyle = '#63867a';
    context.fillRect(centerX + 5, prop.y + 10, 2, 1);
    return;
  }

  if (resourceId === 'evidence-table' || resourceId === 'publish-console') {
    context.fillStyle = '#eadfc6';
    context.fillRect(centerX - 8, prop.y + 6, 15, 10);
    context.fillStyle = '#8b765e';
    context.fillRect(centerX - 5, prop.y + 9, 9, 1);
    context.fillRect(centerX - 5, prop.y + 12, 7, 1);
    if (resourceId === 'publish-console') {
      context.fillStyle = '#4f4538';
      context.fillRect(centerX + 8, prop.y + 8, 3, 7);
    }
    return;
  }

  if (resourceId.startsWith('build-bench')) {
    context.fillStyle = '#d7b16e';
    context.fillRect(centerX - 10, prop.y + 7, 16, 3);
    context.fillStyle = '#51453a';
    context.fillRect(centerX + 6, prop.y + 5, 3, 9);
    context.fillStyle = '#a56f45';
    context.fillRect(centerX - 7, prop.y + 12, 12, 3);
    return;
  }

  if (resourceId.startsWith('verify-rig')) {
    context.fillStyle = '#d7e0c6';
    context.fillRect(centerX - 8, prop.y + 6, 16, 10);
    context.fillStyle = '#667765';
    context.fillRect(centerX - 5, prop.y + 9, 2, 2);
    context.fillRect(centerX - 5, prop.y + 13, 2, 2);
    context.fillStyle = '#65706b';
    context.fillRect(centerX - 1, prop.y + 10, 6, 1);
    context.fillRect(centerX - 1, prop.y + 14, 5, 1);
    return;
  }

  if (resourceId === 'context-kiosk') {
    context.fillStyle = '#eee1c2';
    context.fillRect(centerX - 10, prop.y + 6, 9, 9);
    context.fillRect(centerX + 1, prop.y + 6, 9, 9);
    context.fillStyle = '#86735a';
    context.fillRect(centerX, prop.y + 6, 1, 9);
  }
}

function drawSceneProp(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  prop: SceneProp,
) {
  const image = bank[facilityKey(prop.asset)];
  if (!imageReady(image)) return;
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (resourceIsActive(state, prop.resourceId)) {
    context.fillStyle = 'rgba(224,181,104,.16)';
    context.fillRect(prop.x - 3, prop.y - 3, width + 6, height + 6);
    context.fillStyle = '#d8a85f';
    context.fillRect(prop.x, prop.y + height + 1, width, 2);
  }
  drawFacilitySprite(context, bank, prop.asset, prop.x, prop.y);
  drawSurfaceDetail(context, prop, width);
}

function statusColor(agent: RuntimeAgent) {
  if (agent.status === 'failed') return '#c86c65';
  if (agent.status === 'blocked') return '#d2a05d';
  if (agent.status === 'completed') return '#769b78';
  if (agent.status === 'working') return presentationFor(agent.id).accent;
  return '#7d898e';
}

function roomAgents(state: AgentArenaState, roomId: RoomId) {
  return state.agents.filter((agent) => {
    const locationId =
      agent.navigation?.toLocationId ?? agent.currentLocationId ?? 'spawn-lift';
    return roomForLocation(locationId)?.id === roomId;
  });
}

function roomActivityLabel(agents: RuntimeAgent[]) {
  const active = agents.filter((agent) => agent.status === 'working').length;
  if (active > 0) return `${String(active).padStart(2, '0')} ACTIVE`;
  const blocked = agents.filter((agent) => agent.status === 'blocked').length;
  if (blocked > 0) return `${String(blocked).padStart(2, '0')} BLOCKED`;
  return 'IDLE';
}

function drawPlaque(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
  room: Room,
) {
  const north = room.y < 200;
  const top = north ? 5 : 422;
  const left = room.x + 5;
  const width = room.w - 10;
  const agents = roomAgents(state, room.id);
  const activity = roomActivityLabel(agents);
  const accent = agents.find((agent) => agent.status === 'working')?.id;

  context.fillStyle = 'rgba(28,20,15,.97)';
  context.fillRect(left, top, width, 21);
  context.strokeStyle = '#795b41';
  context.lineWidth = 1;
  context.strokeRect(left + 0.5, top + 0.5, width - 1, 20);
  context.fillStyle = accent ? presentationFor(accent).accent : '#a67a4d';
  context.fillRect(left, top, 3, 21);
  context.fillStyle = '#f0e3c8';
  context.font = `${room.id === 'context' ? 9 : 10}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.textBaseline = 'middle';
  context.fillText(room.label, left + 11, top + 11);
  context.fillStyle = agents.length > 0 ? '#d4b67a' : '#9b8974';
  if (room.id === 'context') {
    context.fillRect(left + width - 9, top + 8, 3, 6);
  } else {
    context.textAlign = 'right';
    context.fillText(activity, left + width - 9, top + 11);
  }
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';

  const connectorX = room.id === 'context' ? 344 : room.x + room.w / 2;
  context.strokeStyle = '#76583f';
  context.beginPath();
  context.moveTo(connectorX + 0.5, north ? 26 : 416);
  context.lineTo(connectorX + 0.5, north ? 31 : 421);
  context.stroke();
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
  if (fixture && new Set(['table', 'board', 'waiting']).has(fixture.kind)) {
    return 'sit';
  }
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

function drawAgent(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  agent: RuntimeAgent,
  avatar: AvatarProjection,
  selected: boolean,
  followed: boolean,
  now: number,
) {
  const motion = motionFor(agent, avatar);
  const sheet = bank[`${agent.id}:${motion}`];
  if (!imageReady(sheet)) return;

  const seated = motion === 'sit' || motion === 'sit2';
  const frameWidth = seated ? 32 : CHARACTER_FRAME_WIDTH;
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
  const width = frameWidth * CHARACTER_SCALE;
  const height = CHARACTER_FRAME_HEIGHT * CHARACTER_SCALE;

  context.fillStyle = 'rgba(0,0,0,.38)';
  context.beginPath();
  context.ellipse(x, y, seated ? 17 : 11, 4, 0, 0, Math.PI * 2);
  context.fill();
  context.drawImage(
    sheet,
    sourceFrame * frameWidth,
    0,
    frameWidth,
    CHARACTER_FRAME_HEIGHT,
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
    drawBracket(context, x, y, statusColor(agent));
  }
}

function drawDepthSortedScene(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  agentsById: Map<string, RuntimeAgent>,
  now: number,
) {
  const entries: Array<{
    baseline: number;
    stableOrder: number;
    draw: () => void;
  }> = SCENE_PROPS.map((prop, index) => ({
    baseline: prop.baseline,
    stableOrder: index,
    draw: () => drawSceneProp(context, bank, state, prop),
  }));

  state.avatars.forEach((avatar, index) => {
    const agent = agentsById.get(avatar.agentId);
    if (!agent) return;
    entries.push({
      baseline: (avatar.position.y / 100) * WORLD_HEIGHT,
      stableOrder: 1000 + index,
      draw: () =>
        drawAgent(
          context,
          bank,
          agent,
          avatar,
          state.selectedAgentId === agent.id,
          state.followedAgentId === agent.id,
          now,
        ),
    });
  });

  entries
    .sort(
      (left, right) =>
        left.baseline - right.baseline || left.stableOrder - right.stableOrder,
    )
    .forEach((entry) => entry.draw());
}

function drawNameplate(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  agent: RuntimeAgent,
  avatar: AvatarProjection,
) {
  context.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
  const activity = avatar.isYielding
    ? `YIELDING TO ${avatar.yieldingToAgentId?.toUpperCase() ?? 'TRAFFIC'}`
    : agent.activeTool
      ? `${(agent.activeCapability ?? 'TOOL').toUpperCase()} @ ${
          resourceById(agent.currentResourceId ?? '')?.label.toUpperCase() ??
          'UTILITY'
        }`
      : verbForPhase(agent.phase).toUpperCase();
  const label = `${agent.name.toUpperCase()} / ${activity}`;
  const width = Math.ceil(context.measureText(label).width) + 12;
  const left = Math.max(4, Math.min(WORLD_WIDTH - width - 4, x - width / 2));
  context.fillStyle = 'rgba(7,11,14,.96)';
  context.fillRect(left, y + 5, width, 19);
  context.fillStyle = statusColor(agent);
  context.fillRect(left, y + 5, 3, 19);
  context.fillStyle = '#edf1ee';
  context.fillText(label, left + 7, y + 18);
}

function drawLabels(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
  agentsById: Map<string, RuntimeAgent>,
  hoveredAgentId?: string,
) {
  ROOMS.forEach((room) => drawPlaque(context, state, room));
  state.avatars.forEach((avatar) => {
    const agent = agentsById.get(avatar.agentId);
    if (!agent) return;
    if (state.selectedAgentId !== agent.id && hoveredAgentId !== agent.id) return;
    drawNameplate(
      context,
      Math.round((avatar.position.x / 100) * WORLD_WIDTH),
      Math.round((avatar.position.y / 100) * WORLD_HEIGHT),
      agent,
      avatar,
    );
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
    projected.push({
      event,
      speaker,
      left: Math.max(14, Math.min(86, avatar.position.x)),
      top: Math.max(
        9,
        Math.min(90, avatar.position.y - 13 - (overlapsEarlier ? 10 : 0)),
      ),
    });
    roomCounts.set(roomId, roomCount + 1);
  }
  return projected;
}

export function AgentArenaWorldV2({
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
    const sources: Array<[string, string]> = Object.entries(FACILITY_ASSETS).map(
      ([key, filename]) => [
        facilityKey(key as FacilityAssetKey),
        encodeURI(`${FACILITY_ASSET_ROOT}/${filename}`),
      ],
    );
    state.agents.forEach((agent) => {
      const folder = presentationFor(agent.id).sprite;
      MOTIONS.forEach((motion) => {
        sources.push([`${agent.id}:${motion}`, `${folder}/${motion}.png`]);
      });
    });

    const missing = sources.filter(([key]) => !bankRef.current[key]);
    if (missing.length === 0) {
      setAssetsReady(imageReady(bankRef.current[facilityKey('bookshelfFilled')]));
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
      setAssetsReady(imageReady(bankRef.current[facilityKey('bookshelfFilled')]));
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
    drawArchitecture(context);
    drawDepthSortedScene(
      context,
      bank,
      state,
      agentsById,
      performance.now(),
    );

    labelContext.setTransform(1, 0, 0, 1, 0, 0);
    labelContext.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    labelContext.setTransform(2, 0, 0, 2, 0, 0);
    labelContext.imageSmoothingEnabled = true;
    drawLabels(labelContext, state, agentsById, hoveredAgentId);
    if (!assetsReady) {
      labelContext.fillStyle = '#aeb8b9';
      labelContext.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
      labelContext.fillText('Loading facility assets…', 31, 414);
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
    return {
      x:
        (event.clientX - bounds.left - (bounds.width - renderedWidth) / 2) /
        scale,
      y:
        (event.clientY - bounds.top - (bounds.height - renderedHeight) / 2) /
        scale,
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
