'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  FACILITY_COLLISION_GEOMETRY,
  FACILITY_LIGHT_LAYOUT,
  FACILITY_PROPS,
  FACILITY_ROOMS,
  presentationAt,
  presentationIndexFor,
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
  Vec2,
  WorldEntityState,
} from '@/lib/arena/agentic-types';
import {
  isSeatedMotion,
  NORTH_CHAIR_FOREGROUND_HEIGHT,
  seatedFrameOffset,
  seatedFrameHeight,
  seatedFrameWidth,
  seatedMotionFor,
  seatedSheetMotion,
  sideChairForegroundCrop,
  type SeatForegroundCrop,
} from '@/lib/arena/seated-presentation';
import {
  ambientFlies,
  lightFlickerMultiplier,
  lightTransitionLevel,
} from '@/lib/arena/environment-effects';
import {
  FIT_CAMERA,
  constrainCamera,
  focusCamera,
  zoomCamera,
  type ArenaCamera,
} from '@/lib/arena/camera';
import { roomViewport, type HomesteadRoomId } from '@/lib/arena/homestead';
import { INTERIOR_ART } from '@/lib/arena/interior-art';
import { revealKeyboardFocus } from '@/components/camera-focus';

const WORLD_WIDTH = 768;
const WORLD_HEIGHT = 448;
const WORLD_RENDER_SCALE = 8;
const BACK_WALL_HEIGHT = 64;
const BACK_WALL_FURNITURE_OVERLAP = 4;
// A 24 x 48 resident is the visual midpoint for this interior set: readable
// at arena scale without returning to the original furniture-dwarfing 32 x 64.
const CHARACTER_SCALE = 1.5;
const CHARACTER_FRAME_WIDTH = 16;
const CHARACTER_FRAME_HEIGHT = 32;
const INTERIOR_ASSET_ROOT = '/assets/homestead-v1/interiors';
const ASSET_MOTIONS = ['run', 'idle_anim', 'phone', 'sit', 'sit2'] as const;

type Motion = (typeof ASSET_MOTIONS)[number] | 'sit_back' | 'sit_front';
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
  focusRoomId?: HomesteadRoomId;
  workshopProjects?: { id: string; title: string; stage: string }[];
  state: AgentArenaState;
  onSelectAgent: (agentId?: string) => void;
  onOpenJournal: (eventId?: string) => void;
  onOpenMailbox?: () => void;
  journalOpen: boolean;
  mailboxOpen?: boolean;
  mailboxHasUnread?: boolean;
  camera?: ArenaCamera;
  onCameraChange?: (camera: ArenaCamera) => void;
  showLabels?: boolean;
};
type CanvasPointEvent = {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
};

const ROOMS = FACILITY_ROOMS.map((room) => ({
  id: room.id as RoomId,
  label: room.name.replace(' and ', ' & '),
  ...room.rect,
})) satisfies Room[];

type FacilityAssetKey = keyof typeof INTERIOR_ART;
const FACILITY_ASSETS = Object.fromEntries(
  Object.entries(INTERIOR_ART).map(([key, art]) => [
    key,
    `${INTERIOR_ASSET_ROOT}/${art.file}.png`,
  ]),
) as Record<FacilityAssetKey, string>;
function facilitySize(key: FacilityAssetKey, _image: HTMLImageElement) {
  return INTERIOR_ART[key];
}

type FacilityLighting = 'lit' | 'lightsOff';
type FacilityImageOptions = {
  state?: AgentArenaState;
  roomId?: RoomId;
  now?: number;
  lighting?: FacilityLighting;
  lightLevel?: number;
  reducedMotion?: boolean;
};

const SELF_AUTHORED_FURNITURE = new Set<FacilityAssetKey>([
  'researchDesk',
  'utilityWorkstation',
  'buildWorkbench',
  'verificationDesk',
  'writingDesk',
  'planningTable',
]);

type SceneProp = {
  asset: FacilityAssetKey;
  roomId: RoomId;
  x: number;
  y?: number;
  baseline: number;
  backWallRoomId?: RoomId;
  resourceId?: string;
  entityId?: string;
  seatForResourceId?: string;
  seatIndex?: number;
  seatForegroundHeight?: number;
  seatForegroundCrop?: SeatForegroundCrop;
};

function northWorkstationChair(
  roomId: RoomId,
  resourceId: string,
  x: number,
  y: number,
  baseline: number,
): SceneProp {
  return {
    asset: 'chairNorth',
    roomId,
    x,
    y,
    baseline,
    seatForResourceId: resourceId,
    seatForegroundHeight: NORTH_CHAIR_FOREGROUND_HEIGHT,
  };
}

const CONTEXT_KIOSK_PROP = {
  asset: 'writingDesk',
  roomId: 'context',
  x: 304,
  y: 350,
  baseline: 382,
  resourceId: 'context-kiosk',
} satisfies SceneProp;

// Match the journal action surface to the complete authored desk sprite. Its
// position is derived from the same scene prop so future desk moves cannot
// leave an invisible action target behind.
const CONTEXT_KIOSK_ACTION_STYLE = {
  left: `${(CONTEXT_KIOSK_PROP.x / WORLD_WIDTH) * 100}%`,
  top: `${(CONTEXT_KIOSK_PROP.y / WORLD_HEIGHT) * 100}%`,
  width: `${(50 / WORLD_WIDTH) * 100}%`,
  height: `${(38 / WORLD_HEIGHT) * 100}%`,
} satisfies CSSProperties;

const OPERATOR_MAILBOX_PROP = {
  asset: 'operatorMailbox',
  roomId: 'context',
  x: 308,
  y: 300,
  baseline: 320,
  entityId: 'operator-mailbox',
} satisfies SceneProp;

const OPERATOR_MAILBOX_ACTION_STYLE = {
  left: `${(OPERATOR_MAILBOX_PROP.x / WORLD_WIDTH) * 100}%`,
  top: `${((OPERATOR_MAILBOX_PROP.y ?? 0) / WORLD_HEIGHT) * 100}%`,
  width: `${(24 / WORLD_WIDTH) * 100}%`,
  height: `${(20 / WORLD_HEIGHT) * 100}%`,
} satisfies CSSProperties;

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
  {
    asset: 'bookshelfFilled',
    roomId: 'research',
    x: 47,
    baseline: 100,
    backWallRoomId: 'research',
    resourceId: 'archive-desk',
  },
  {
    asset: 'partsCabinet',
    roomId: 'research',
    x: 96,
    baseline: 100,
    backWallRoomId: 'research',
    entityId: 'parts-cabinet',
  },
  {
    asset: 'bookshelfC',
    roomId: 'research',
    x: 145,
    baseline: 100,
    backWallRoomId: 'research',
    resourceId: 'archive-desk',
  },
  {
    asset: 'floorLamp',
    roomId: 'research',
    x: 226,
    y: 88,
    baseline: 118,
    resourceId: 'archive-lamp',
  },
  {
    asset: 'armchairGreen',
    roomId: 'research',
    x: 61,
    y: 126,
    baseline: 156,
    seatForResourceId: 'archive-desk',
  },
  {
    asset: 'utilityWorkstation',
    roomId: 'research',
    x: 190,
    y: 108,
    baseline: 142,
    resourceId: 'research-computer-b',
  },
  northWorkstationChair('research', 'research-computer-b', 214, 130, 152),
  {
    asset: 'plantSmall',
    roomId: 'research',
    x: 42,
    y: 158,
    baseline: 180,
    entityId: 'plant-research',
  },

  // Command / Routing — a planning table beneath the mounted route board.
  {
    asset: 'planningTable',
    roomId: 'command',
    x: 326,
    y: 124,
    baseline: 158,
    resourceId: 'command-table',
  },
  {
    asset: 'chairEast',
    roomId: 'command',
    x: 307,
    y: 129,
    baseline: 156,
    seatForResourceId: 'command-table',
    seatIndex: 1,
    seatForegroundCrop: sideChairForegroundCrop('east'),
  },
  {
    asset: 'chairWest',
    roomId: 'command',
    // Mirror the west chair's 307..329 footprint around the table center at
    // x=351. The previous x=382 position put this chair nine pixels too far
    // east even though its resident anchor was already symmetric.
    x: 373,
    y: 128,
    baseline: 156,
    seatForResourceId: 'command-table',
    seatIndex: 0,
    seatForegroundCrop: sideChairForegroundCrop('west'),
  },
  {
    asset: 'plantSmall',
    roomId: 'command',
    x: 420,
    y: 78,
    baseline: 100,
    entityId: 'plant-command',
  },

  // Utility / Tools — one shell station and one connector station.
  {
    asset: 'utilityWorkstation',
    roomId: 'tools',
    x: 456,
    y: 108,
    baseline: 142,
    resourceId: 'shell-console-a',
  },
  {
    asset: 'utilityWorkstation',
    roomId: 'tools',
    x: 666,
    y: 108,
    baseline: 142,
    resourceId: 'connector-console-b',
  },
  northWorkstationChair('tools', 'shell-console-a', 470, 130, 152),
  northWorkstationChair('tools', 'connector-console-b', 686, 130, 152),
  {
    asset: 'plantSmall',
    roomId: 'tools',
    x: 584,
    y: 78,
    baseline: 100,
    entityId: 'plant-tools',
  },

  // Synthesis / Decisions — a small library salon and decision console.
  {
    asset: 'bookshelfA',
    roomId: 'synthesis',
    x: 48,
    baseline: 324,
    backWallRoomId: 'synthesis',
    resourceId: 'synthesis-lounge',
  },
  {
    asset: 'bookshelfFilled',
    roomId: 'synthesis',
    x: 97,
    baseline: 324,
    backWallRoomId: 'synthesis',
    resourceId: 'synthesis-lounge',
  },
  {
    asset: 'sofaGreen',
    roomId: 'synthesis',
    x: 48,
    y: 338,
    baseline: 368,
    resourceId: 'synthesis-lounge',
    seatForResourceId: 'synthesis-lounge',
  },
  {
    asset: 'verificationDesk',
    roomId: 'synthesis',
    x: 201,
    y: 318,
    baseline: 352,
    resourceId: 'publish-console',
  },
  {
    asset: 'chairNorth',
    roomId: 'synthesis',
    x: 221,
    y: 349,
    baseline: 371,
    seatForResourceId: 'publish-console',
    seatForegroundHeight: NORTH_CHAIR_FOREGROUND_HEIGHT,
  },
  {
    asset: 'plantSmall',
    roomId: 'synthesis',
    x: 42,
    y: 386,
    baseline: 408,
    entityId: 'plant-synthesis',
  },

  // Commons — a clear route from the north doorway to the anchored lift.
  OPERATOR_MAILBOX_PROP,
  CONTEXT_KIOSK_PROP,
  {
    asset: 'plantSmall',
    roomId: 'context',
    x: 456,
    y: 342,
    baseline: 364,
    entityId: 'plant-context',
  },

  // Build / Verify — one workshop bench and one diagnostic rig.
  {
    asset: 'buildWorkbench',
    roomId: 'build',
    x: 488,
    y: 336,
    baseline: 370,
    resourceId: 'build-bench-a',
  },
  {
    asset: 'verificationDesk',
    roomId: 'build',
    x: 656,
    y: 336,
    baseline: 370,
    resourceId: 'verify-rig-b',
  },
  northWorkstationChair('build', 'build-bench-a', 505, 367, 389),
  northWorkstationChair('build', 'verify-rig-b', 678, 367, 389),
  {
    asset: 'plantSmall',
    roomId: 'build',
    x: 554,
    y: 306,
    baseline: 328,
    entityId: 'plant-build',
  },
];

type DoorGeometry = {
  locationId: string;
  centerX: number;
};

const NORTH_DOORS =
  FACILITY_COLLISION_GEOMETRY.northDoors as readonly DoorGeometry[];
const SOUTH_DOORS =
  FACILITY_COLLISION_GEOMETRY.southDoors as readonly DoorGeometry[];
const roomIdForDoor = (door: DoorGeometry) =>
  door.locationId.replace(/^door-/, '') as RoomId;
const NORTH_DOOR_CENTERS = Object.fromEntries(
  NORTH_DOORS.map((door) => [roomIdForDoor(door), door.centerX]),
) as Partial<Record<RoomId, number>>;
const LOWER_PARTITION_X = ROOMS.filter((room) => room.y >= 200)
  .sort((left, right) => left.x - right.x)
  .slice(0, -1)
  .map((room) => room.x + room.w - 4);

function imageReady(
  image: HTMLImageElement | undefined,
): image is HTMLImageElement {
  return Boolean(image?.complete && image.naturalWidth > 0);
}

function facilityKey(
  key: FacilityAssetKey,
  lighting: FacilityLighting = 'lit',
) {
  return `facility:${lighting}:${key}`;
}

function facilityAssetSource(
  key: FacilityAssetKey,
  lighting: FacilityLighting,
) {
  return lighting === 'lightsOff'
    ? `${INTERIOR_ASSET_ROOT}/lights-off/${INTERIOR_ART[key].file}.png`
    : FACILITY_ASSETS[key];
}

function resolveFacilityImage(
  bank: ImageBank,
  key: FacilityAssetKey,
  options: FacilityImageOptions = {},
) {
  const roomLevel =
    options.state && options.roomId
      ? roomLightLevel(
          options.state,
          options.roomId,
          options.now ?? Date.now(),
          options.reducedMotion,
        )
      : 1;
  const lighting =
    options.lighting ??
    ((options.lightLevel ?? roomLevel) >= 0.5 ? 'lit' : 'lightsOff');
  const selected = bank[facilityKey(key, lighting)];
  if (imageReady(selected)) return selected;
  return bank[facilityKey(key, 'lit')];
}

function facilityLightLevel(options: FacilityImageOptions) {
  if (options.lightLevel !== undefined) return options.lightLevel;
  if (options.lighting) return options.lighting === 'lit' ? 1 : 0;
  if (options.state && options.roomId) {
    return roomLightLevel(
      options.state,
      options.roomId,
      options.now ?? Date.now(),
      options.reducedMotion,
    );
  }
  return 1;
}

function drawLightingVariant(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  key: FacilityAssetKey,
  options: FacilityImageOptions,
  draw: (image: HTMLImageElement) => void,
) {
  const lit = bank[facilityKey(key, 'lit')];
  const lightsOff = bank[facilityKey(key, 'lightsOff')];
  const litReady = imageReady(lit);
  const lightsOffReady = imageReady(lightsOff);
  if (!litReady && !lightsOffReady) return;
  if (!litReady) {
    draw(lightsOff);
    return;
  }
  if (!lightsOffReady || lit.src === lightsOff.src) {
    draw(lit);
    return;
  }

  const level = Math.max(0, Math.min(1, facilityLightLevel(options)));
  if (level <= 0.001) {
    draw(lightsOff);
    return;
  }
  if (level >= 0.999) {
    draw(lit);
    return;
  }
  const startingAlpha = context.globalAlpha;
  context.save();
  context.globalAlpha = startingAlpha * (1 - level);
  draw(lightsOff);
  context.restore();
  context.save();
  context.globalAlpha = startingAlpha * level;
  draw(lit);
  context.restore();
}

function drawFacilitySprite(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  key: FacilityAssetKey,
  x: number,
  y: number,
  options: FacilityImageOptions = {},
) {
  drawLightingVariant(context, bank, key, options, (image) => {
    const { width, height } = facilitySize(key, image);
    context.drawImage(image, Math.round(x), Math.round(y), width, height);
  });
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
        context.fillRect(
          Math.round(seamX),
          rowY + 1,
          1,
          Math.max(1, rowHeight - 2),
        );
      }
    }
  }
}

function drawTiledTexture(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  reflected = false,
) {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  for (let row = 0; row * tileHeight < height; row += 1) {
    for (let column = 0; column * tileWidth < width; column += 1) {
      const flipX = reflected && column % 2 === 1;
      const flipY = reflected && row % 2 === 1;
      context.save();
      context.translate(
        x + (column + Number(flipX)) * tileWidth,
        y + (row + Number(flipY)) * tileHeight,
      );
      context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      context.drawImage(image, 0, 0, tileWidth, tileHeight);
      context.restore();
    }
  }
  context.restore();
}

function drawTimber(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  x: number,
  y: number,
  length: number,
  thickness = 8,
  vertical = false,
  lightLevel = 1,
) {
  if (length <= 0) return;
  const image = resolveFacilityImage(bank, 'architectureBeam');
  if (!imageReady(image)) {
    context.fillStyle = '#513322';
    context.fillRect(
      x,
      y,
      vertical ? thickness : length,
      vertical ? length : thickness,
    );
    return;
  }
  drawLightingVariant(
    context,
    bank,
    'architectureBeam',
    { lightLevel },
    (variant) =>
      drawTimberImage(context, variant, x, y, length, thickness, vertical),
  );
}

function drawTimberImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  length: number,
  thickness: number,
  vertical: boolean,
) {
  context.save();
  context.translate(vertical ? x + thickness : x, y);
  if (vertical) context.rotate(Math.PI / 2);
  context.drawImage(image, 0, 0, length, thickness);
  context.restore();
}

function drawRoom(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  room: Room,
  index: number,
  now: number,
  reducedMotion: boolean,
) {
  context.save();
  context.beginPath();
  context.rect(room.x, room.y, room.w, room.h);
  context.clip();
  const north = room.y < 200;
  const lightLevel = roomLightLevel(state, room.id, now, reducedMotion);
  const floorY = room.y + BACK_WALL_HEIGHT;
  const floorHeight = room.h - BACK_WALL_HEIGHT - (north ? 0 : 8);
  const floorTexture = resolveFacilityImage(bank, 'architectureFloor', {
    lighting: 'lit',
  });
  if (imageReady(floorTexture)) {
    drawLightingVariant(
      context,
      bank,
      'architectureFloor',
      { state, roomId: room.id, now, reducedMotion },
      (image) =>
        context.drawImage(image, room.x + 8, floorY, room.w - 16, floorHeight),
    );
  } else {
    drawWoodFloor(context, room.x + 8, floorY, room.w - 16, floorHeight, index);
  }

  const colors = WALL_COLORS[room.id];
  // A real back-wall assembly: dark cap, plaster face, and a wood baseboard.
  // Floor-standing sprites overlap the baseboard by their own authored depth;
  // wall-mounted pieces stay entirely inside this sixty-four-pixel plane.
  const wallTexture = resolveFacilityImage(bank, 'architectureWall', {
    lighting: 'lit',
  });
  if (imageReady(wallTexture)) {
    drawLightingVariant(
      context,
      bank,
      'architectureWall',
      { state, roomId: room.id, now, reducedMotion },
      (image) =>
        context.drawImage(
          image,
          room.x + 8,
          room.y,
          room.w - 16,
          BACK_WALL_HEIGHT,
        ),
    );
  } else {
    context.fillStyle = colors.panel;
    context.fillRect(room.x, room.y, room.w, 7);
    context.fillStyle = colors.paper;
    context.fillRect(
      room.x + 8,
      room.y + 7,
      room.w - 16,
      BACK_WALL_HEIGHT - 13,
    );
    context.fillStyle = colors.panel;
    context.fillRect(room.x + 8, room.y + BACK_WALL_HEIGHT - 6, room.w - 16, 6);
  }
  drawTimber(context, bank, room.x, room.y, room.w, 5, false, lightLevel);
  drawTimber(context, bank, room.x, room.y, room.h, 8, true, lightLevel);
  drawTimber(
    context,
    bank,
    room.x + room.w - 8,
    room.y,
    room.h,
    8,
    true,
    lightLevel,
  );
  if (north) {
    const doorCenter = NORTH_DOOR_CENTERS[room.id];
    const openingLeft = (doorCenter ?? room.x) - 18;
    drawTimber(
      context,
      bank,
      room.x,
      room.y + room.h - 8,
      Math.max(0, openingLeft - room.x),
      8,
      false,
      lightLevel,
    );
    drawTimber(
      context,
      bank,
      openingLeft + 36,
      room.y + room.h - 8,
      room.x + room.w - (openingLeft + 36),
      8,
      false,
      lightLevel,
    );
  } else {
    drawTimber(
      context,
      bank,
      room.x,
      room.y + room.h - 8,
      room.w,
      8,
      false,
      lightLevel,
    );
  }
  if (room.id === 'context' || room.id === 'synthesis') {
    drawLightingVariant(
      context,
      bank,
      'wovenRug',
      { state, roomId: room.id, now, reducedMotion },
      (rug) => {
        if (room.id === 'context') context.drawImage(rug, 330, 338, 112, 63);
        else context.drawImage(rug, 70, 351, 113, 55);
      },
    );
  }
  context.restore();
}

function drawCorridor(context: CanvasRenderingContext2D, bank: ImageBank) {
  const x = 32;
  const y = 192;
  const width = 704;
  const height = 64;
  const corridorTexture = resolveFacilityImage(bank, 'architectureCorridor');
  if (imageReady(corridorTexture)) {
    drawTiledTexture(
      context,
      corridorTexture,
      x,
      y,
      width,
      height,
      96,
      96,
      true,
    );
  } else {
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
  }
  drawTimber(context, bank, 32, 192, 704, 6);
  drawTimber(context, bank, 32, 250, 704, 6);
}

function drawUpwardDoor(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  roomId: RoomId,
  centerX: number,
  now: number,
  reducedMotion: boolean,
) {
  const openingLeft = centerX - 18;
  const lightLevel = roomLightLevel(state, roomId, now, reducedMotion);
  // Keep a real shadowed opening behind the transparent generated frame. The
  // aperture remains clear; only the substantial walnut jambs occupy pixels.
  context.fillStyle = '#241c18';
  context.fillRect(openingLeft, 256, 36, BACK_WALL_HEIGHT);
  context.fillStyle = lightLevel > 0.5 ? '#3b2a20' : '#242a33';
  context.fillRect(openingLeft + 3, 260, 30, BACK_WALL_HEIGHT - 4);
  context.fillStyle = 'rgba(0,0,0,.3)';
  context.fillRect(openingLeft + 3, 260, 30, 5);
  drawFacilitySprite(context, bank, 'doorwayFront', centerX - 22, 256, {
    state,
    roomId,
    now,
    reducedMotion,
  });
}

function drawDownwardDoor(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  centerX: number,
  lightLevel: number,
) {
  // Upper rooms expose only the south-wall cutaway: embed a shallow U-frame
  // in that seam without a door leaf, loose sprite, or corridor projection.
  context.fillStyle = '#241c18';
  context.fillRect(centerX - 18, 184, 36, 8);
  drawDownwardDoorFrame(context, bank, centerX, lightLevel);
}

function drawDownwardDoorFrame(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  centerX: number,
  lightLevel: number,
) {
  drawTimber(context, bank, centerX - 21, 181, 42, 4, false, lightLevel);
  drawTimber(context, bank, centerX - 21, 181, 11, 4, true, lightLevel);
  drawTimber(context, bank, centerX + 17, 181, 11, 4, true, lightLevel);
}

function drawDoorwayForegrounds(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  // Upper openings occupy the south-wall seam, so their shallow rim remains
  // in front of a crossing body. Lower generated frames already surround a
  // 36px aperture around a 24px resident; repainting those sprites here cuts
  // moving residents apart at the jamb and must not happen.
  NORTH_DOORS.forEach((door) => {
    drawDownwardDoorFrame(
      context,
      bank,
      door.centerX,
      roomLightLevel(state, roomIdForDoor(door), now, reducedMotion),
    );
  });
}

function drawDoorways(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  NORTH_DOORS.forEach((door) => {
    drawDownwardDoor(
      context,
      bank,
      door.centerX,
      roomLightLevel(state, roomIdForDoor(door), now, reducedMotion),
    );
  });
  SOUTH_DOORS.forEach((door) => {
    drawUpwardDoor(
      context,
      bank,
      state,
      roomIdForDoor(door),
      door.centerX,
      now,
      reducedMotion,
    );
  });
}

function drawShell(context: CanvasRenderingContext2D, bank: ImageBank) {
  context.fillStyle = '#211910';
  context.fillRect(26, 26, 716, 396);
  drawTimber(context, bank, 24, 24, 720, 8);
  drawTimber(context, bank, 24, 416, 720, 8);
  drawTimber(context, bank, 24, 24, 400, 8, true);
  drawTimber(context, bank, 736, 24, 400, 8, true);
}

function drawPartitions(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  for (const room of ROOMS) {
    const level = roomLightLevel(state, room.id, now, reducedMotion);
    context.save();
    context.beginPath();
    context.rect(room.x, room.y, room.w, room.h);
    context.clip();
    [252, 444].forEach((x) =>
      drawTimber(context, bank, x, 32, 160, 8, true, level),
    );
    LOWER_PARTITION_X.forEach((x) =>
      drawTimber(context, bank, x, 256, 160, 8, true, level),
    );
    context.restore();
  }
}

function drawWallDetails(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  // Every wall mark describes an in-world resource; none are dashboard chrome.
  drawFacilitySprite(context, bank, 'commandRoutingBoard', 284, 38, {
    state,
    roomId: 'command',
    now,
    reducedMotion,
  });
  drawFacilitySprite(context, bank, 'utilityToolsBoard', 528, 38, {
    state,
    roomId: 'tools',
    now,
    reducedMotion,
  });
  drawFacilitySprite(context, bank, 'buildVerificationChart', 650, 262, {
    state,
    roomId: 'build',
    now,
    reducedMotion,
  });
}

function drawArchitecture(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  drawShell(context, bank);
  ROOMS.forEach((room, index) =>
    drawRoom(context, bank, state, room, index, now, reducedMotion),
  );
  drawCorridor(context, bank);
  drawPartitions(context, bank, state, now, reducedMotion);
  drawDoorways(context, bank, state, now, reducedMotion);
  drawWallDetails(context, bank, state, now, reducedMotion);
}

type ResourceWorkState = {
  mode: 'idle' | 'ready' | 'active';
  capability?: string;
};

function resourceWorkState(
  state: AgentArenaState,
  resourceId?: string,
): ResourceWorkState {
  if (!resourceId) return { mode: 'idle' };
  const residents = state.agents.filter(
    (agent) =>
      agent.currentResourceId === resourceId ||
      agent.engagedResourceId === resourceId,
  );
  const activeResident = residents.find((resident) => resident.activeTool);
  if (activeResident) {
    return {
      mode: 'active',
      capability: activeResident.activeCapability,
    };
  }
  return residents.length > 0 ? { mode: 'ready' } : { mode: 'idle' };
}

function activityScreenColor(work: ResourceWorkState) {
  if (work.mode === 'ready') return '#8e7746';
  if (work.mode !== 'active') return '#596f69';
  if (new Set(['search', 'browse']).has(work.capability ?? ''))
    return '#4f8f91';
  if (new Set(['shell', 'filesystem']).has(work.capability ?? ''))
    return '#4f7d57';
  if (work.capability === 'connector') return '#526f9b';
  if (new Set(['test', 'review']).has(work.capability ?? '')) return '#756692';
  return '#9a6f48';
}

type StatefulFacilityProp = {
  id: string;
  kind: string;
  initialState: WorldEntityState;
  dynamics?: { kind: 'plant'; decayPerMinute: number };
};

const STATEFUL_PROPS = new Map(
  (FACILITY_PROPS as unknown as readonly StatefulFacilityProp[]).map((prop) => [
    prop.id,
    prop,
  ]),
);

const LIGHT_FIXTURES = FACILITY_LIGHT_LAYOUT as Record<
  RoomId,
  {
    fixtureX: number;
    fixtureY: number;
    switchX: number;
    switchY: number;
    variant: 'single' | 'dual';
  }
>;

function runStartedAt(state: AgentArenaState) {
  const started = state.events.find((event) => event.kind === 'run.started');
  return started ? Date.parse(started.occurredAt) : Date.now();
}

function effectiveEntityState(
  state: AgentArenaState,
  entityId: string,
  now: number,
) {
  const definition = STATEFUL_PROPS.get(entityId);
  const projected = state.worldEntities.find(
    (entity) => entity.id === entityId,
  );
  const stored = projected?.state ?? definition?.initialState ?? {};
  if (definition?.dynamics?.kind !== 'plant') return stored;
  const baseHydration = Number(
    stored._hydrationBase ?? definition.initialState._hydrationBase ?? 0,
  );
  const rawBaseAt = String(
    stored._hydrationBaseAt ??
      definition.initialState._hydrationBaseAt ??
      'run-start',
  );
  const parsedBaseAt =
    rawBaseAt === 'run-start' ? runStartedAt(state) : Date.parse(rawBaseAt);
  const elapsedMinutes = Math.max(
    0,
    (now - (Number.isFinite(parsedBaseAt) ? parsedBaseAt : now)) / 60_000,
  );
  const hydration = Math.max(
    0,
    baseHydration - elapsedMinutes * definition.dynamics.decayPerMinute,
  );
  return {
    ...stored,
    hydration,
    condition:
      hydration <= 0
        ? 'dead'
        : hydration < 25
          ? 'wilted'
          : hydration < 55
            ? 'thirsty'
            : 'healthy',
  };
}

function entityLightLevel(
  state: AgentArenaState,
  entityId: string,
  now: number,
  reducedMotion = false,
) {
  const power =
    effectiveEntityState(state, entityId, now).power === 'on' ? 'on' : 'off';
  // Entity timestamps also advance for harmless actions such as `inspect`.
  // Animate only from a real power transition so inspection cannot make a
  // settled fixture appear to switch again.
  const powerTransition = state.events.find(
    (event) =>
      event.kind === 'world.interaction' &&
      event.payload.entityId === entityId &&
      (event.payload.verb === 'switch_on' ||
        event.payload.verb === 'switch_off'),
  );
  return lightTransitionLevel(
    power,
    powerTransition?.occurredAt,
    now,
    reducedMotion,
  );
}

function roomLightLevel(
  state: AgentArenaState,
  roomId: RoomId,
  now: number,
  reducedMotion = false,
) {
  return entityLightLevel(state, `room-light-${roomId}`, now, reducedMotion);
}

function drawRoomLightFixtures(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  ROOMS.forEach((room) => {
    const fixture = LIGHT_FIXTURES[room.id];
    const lightLevel = roomLightLevel(state, room.id, now, reducedMotion);
    const single = fixture.variant === 'single';
    const onKey = single ? 'wallLightSingle' : 'wallLightDual';
    const offKey = single ? 'wallLightSingleOff' : 'wallLightDualOff';
    const onImage = bank[facilityKey(onKey, 'lit')];
    const darkOffImage = bank[facilityKey(offKey, 'lightsOff')];
    const regularOffImage = bank[facilityKey(offKey, 'lit')];
    const offImage = imageReady(darkOffImage) ? darkOffImage : regularOffImage;
    const fixtureX = fixture.fixtureX - (single ? 11 : 24);
    const fixtureY = fixture.fixtureY - (single ? 13 : 14);
    if (imageReady(offImage) && lightLevel < 0.999) {
      context.save();
      context.globalAlpha = 1 - lightLevel;
      context.drawImage(
        offImage,
        fixtureX,
        fixtureY,
        single ? 22 : 48,
        single ? 26 : 28,
      );
      context.restore();
    }
    if (imageReady(onImage) && lightLevel > 0.001) {
      context.save();
      context.globalAlpha = lightLevel;
      context.drawImage(
        onImage,
        fixtureX,
        fixtureY,
        single ? 22 : 48,
        single ? 26 : 28,
      );
      context.restore();
    }
    const switchOn = resolveFacilityImage(bank, 'switchOn');
    const switchOff = resolveFacilityImage(bank, 'switchOff', {
      lighting: 'lightsOff',
    });
    if (imageReady(switchOn) && imageReady(switchOff)) {
      context.save();
      context.globalAlpha = 1 - lightLevel;
      context.drawImage(
        switchOff,
        fixture.switchX - 3,
        fixture.switchY - 5,
        6,
        10,
      );
      context.globalAlpha = lightLevel;
      context.drawImage(
        switchOn,
        fixture.switchX - 3,
        fixture.switchY - 5,
        6,
        10,
      );
      context.restore();
      return;
    }
    context.fillStyle = 'rgba(35,25,18,.38)';
    context.fillRect(fixture.switchX - 2, fixture.switchY - 3, 7, 9);
    context.fillStyle = '#6d5845';
    context.fillRect(fixture.switchX - 3, fixture.switchY - 5, 6, 10);
    context.fillStyle = '#382b22';
    context.fillRect(fixture.switchX - 2, fixture.switchY - 4, 4, 8);
    context.fillStyle = '#777064';
    context.fillRect(fixture.switchX - 1, fixture.switchY + 1, 2, 3);
    if (lightLevel > 0.001) {
      context.save();
      context.globalAlpha = lightLevel;
      context.fillStyle = '#d9b967';
      context.fillRect(fixture.switchX - 1, fixture.switchY - 3, 2, 3);
      context.restore();
    }
  });
}

function drawEnvironmentalLighting(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  context.save();
  ROOMS.forEach((room) => {
    const fixture = LIGHT_FIXTURES[room.id];
    const lightLevel = roomLightLevel(state, room.id, now, reducedMotion);
    if (lightLevel < 0.999) {
      context.save();
      context.beginPath();
      // The darkness veil covers the complete room so no light seam can appear
      // around dark assets while the switch transition is in flight.
      context.rect(room.x, room.y, room.w, room.h);
      context.clip();
      // Asset variants and the architecture material pass carry room lighting.
      // This veil keeps residents and their surroundings in the same darkness.
      context.fillStyle = `rgba(5,8,15,${0.12 * (1 - lightLevel)})`;
      context.fillRect(room.x, room.y, room.w, room.h);
      context.restore();
    }
    if (lightLevel > 0.001) {
      const shimmer = lightFlickerMultiplier(room.id, now, reducedMotion);
      const luminousLevel = Math.max(0, Math.min(1.015, lightLevel * shimmer));
      context.save();
      context.beginPath();
      // Bloom is clipped inside the timber uprights. This preserves the hard
      // room boundaries even at the brightest point of a transition.
      context.rect(room.x + 8, room.y, room.w - 16, room.h);
      context.clip();
      context.globalCompositeOperation = 'screen';

      const roomGlow = context.createRadialGradient(
        fixture.fixtureX,
        fixture.fixtureY + 22,
        4,
        fixture.fixtureX,
        fixture.fixtureY + 34,
        Math.max(room.w * 0.58, 112),
      );
      roomGlow.addColorStop(0, `rgba(255,225,157,${0.22 * luminousLevel})`);
      roomGlow.addColorStop(0.5, `rgba(234,183,106,${0.085 * luminousLevel})`);
      roomGlow.addColorStop(1, 'rgba(234,183,106,0)');
      context.fillStyle = roomGlow;
      context.fillRect(room.x, room.y, room.w, room.h);

      const fixtureBloom = context.createRadialGradient(
        fixture.fixtureX,
        fixture.fixtureY + 7,
        1,
        fixture.fixtureX,
        fixture.fixtureY + 10,
        fixture.variant === 'single' ? 28 : 42,
      );
      fixtureBloom.addColorStop(0, `rgba(255,241,190,${0.31 * luminousLevel})`);
      fixtureBloom.addColorStop(
        0.36,
        `rgba(255,204,112,${0.13 * luminousLevel})`,
      );
      fixtureBloom.addColorStop(1, 'rgba(255,188,88,0)');
      context.fillStyle = fixtureBloom;
      context.fillRect(fixture.fixtureX - 48, fixture.fixtureY - 22, 96, 78);
      context.globalCompositeOperation = 'source-over';
      context.restore();
    }
  });

  const researchRoom = ROOMS.find((room) => room.id === 'research');
  const taskLampLevel = entityLightLevel(
    state,
    'archive-lamp',
    now,
    reducedMotion,
  );
  if (researchRoom && taskLampLevel > 0.001) {
    const shimmer = lightFlickerMultiplier('archive-lamp', now, reducedMotion);
    const luminousLevel = Math.max(0, Math.min(1.015, taskLampLevel * shimmer));
    context.save();
    context.beginPath();
    context.rect(
      researchRoom.x + 8,
      researchRoom.y,
      researchRoom.w - 16,
      researchRoom.h,
    );
    context.clip();
    const taskGlow = context.createRadialGradient(234, 109, 3, 234, 109, 62);
    taskGlow.addColorStop(0, `rgba(255,211,121,${0.34 * luminousLevel})`);
    taskGlow.addColorStop(0.55, `rgba(239,172,82,${0.13 * luminousLevel})`);
    taskGlow.addColorStop(1, 'rgba(239,172,82,0)');
    context.globalCompositeOperation = 'screen';
    context.fillStyle = taskGlow;
    context.fillRect(178, 64, 96, 104);
    context.restore();
  }
  context.restore();
}

function drawAmbientLife(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
  now: number,
  reducedMotion: boolean,
) {
  ROOMS.forEach((room) => {
    const lightLevel = roomLightLevel(state, room.id, now, reducedMotion);
    const plant = SCENE_PROPS.find(
      (prop) => prop.roomId === room.id && prop.entityId?.startsWith('plant-'),
    );
    if (!plant) return;
    const flies = ambientFlies(
      room.id,
      room,
      { x: plant.x + 8, y: (plant.y ?? room.y + room.h - 30) + 9 },
      now,
      lightLevel,
      reducedMotion,
    );
    flies.forEach((fly) => {
      context.fillStyle = 'rgba(18,13,10,.82)';
      context.fillRect(fly.x, fly.y, 1, 1);
      if (fly.wing === 1) {
        context.fillStyle = 'rgba(218,196,146,.42)';
        context.fillRect(fly.x + 1, fly.y - 1, 1, 1);
      }
    });
  });
}

function drawSurfaceDetail(
  context: CanvasRenderingContext2D,
  state: AgentArenaState,
  prop: SceneProp,
  width: number,
  y: number,
) {
  const resourceId = prop.resourceId;
  if (!resourceId) return;
  // Authored furniture sprites already contain their computers, tools, and
  // desk contents. Resource behavior is bound through resourceId; painting a
  // second surface here would duplicate the physical prop.
  if (SELF_AUTHORED_FURNITURE.has(prop.asset)) return;
  const centerX = Math.round(prop.x + width / 2);
  const work = resourceWorkState(state, resourceId);

  if (resourceId === 'command-table') {
    context.fillStyle = '#ead8b3';
    context.fillRect(centerX - 9, y + 7, 8, 6);
    context.fillRect(centerX + 2, y + 8, 7, 5);
    context.fillStyle = '#9e6042';
    context.fillRect(centerX - 5, y + 9, 2, 2);
    context.fillStyle = '#63867a';
    context.fillRect(centerX + 5, y + 10, 2, 1);
    return;
  }

  if (resourceId === 'publish-console') {
    context.fillStyle = '#eadfc6';
    context.fillRect(centerX - 8, y + 6, 15, 10);
    context.fillStyle = '#8b765e';
    context.fillRect(centerX - 5, y + 9, 9, 1);
    context.fillRect(centerX - 5, y + 12, 7, 1);
    context.fillStyle = '#4f4538';
    context.fillRect(centerX + 8, y + 8, 3, 7);
    return;
  }

  if (resourceId.startsWith('build-bench')) {
    context.fillStyle = '#d7b16e';
    context.fillRect(centerX - 10, y + 7, 16, 3);
    context.fillStyle = '#51453a';
    context.fillRect(centerX + 6, y + 5, 3, 9);
    context.fillStyle = '#a56f45';
    context.fillRect(centerX - 7, y + 12, 12, 3);
    return;
  }

  if (resourceId.startsWith('verify-rig')) {
    context.fillStyle = '#d7e0c6';
    context.fillRect(centerX - 8, y + 6, 16, 10);
    context.fillStyle = activityScreenColor(work);
    context.fillRect(centerX - 5, y + 9, 2, 2);
    context.fillRect(centerX - 5, y + 13, 2, 2);
    context.fillStyle = '#65706b';
    context.fillRect(centerX - 1, y + 10, 6, 1);
    context.fillRect(centerX - 1, y + 14, 5, 1);
    return;
  }

  if (resourceId === 'context-kiosk') {
    // A visibly bound, open journal rather than generic loose paper. The
    // bridge presents a different private volume to each resident who uses
    // this physical desk.
    context.fillStyle = '#5b3030';
    context.fillRect(centerX - 11, y + 5, 22, 12);
    context.fillStyle = '#d5bd87';
    context.fillRect(centerX - 9, y + 6, 8, 9);
    context.fillRect(centerX + 1, y + 6, 8, 9);
    context.fillStyle = '#f1e1b8';
    context.fillRect(centerX - 8, y + 6, 7, 8);
    context.fillRect(centerX + 1, y + 6, 7, 8);
    context.fillStyle = '#80694d';
    context.fillRect(centerX, y + 5, 1, 11);
    context.fillRect(centerX - 6, y + 9, 4, 1);
    context.fillRect(centerX + 2, y + 9, 4, 1);
    context.fillRect(centerX - 6, y + 12, 3, 1);
    context.fillRect(centerX + 2, y + 12, 5, 1);
    context.fillStyle = '#c69b4a';
    context.fillRect(centerX + 10, y + 8, 1, 5);
  }
}

function drawSceneProp(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  prop: SceneProp,
  mailboxHasUnread: boolean,
  now: number,
  reducedMotion: boolean,
) {
  // Resolve the mailbox's physical state before selecting the room-lighting
  // variant so full and empty boxes both have faithful illuminated/dark art.
  let asset: FacilityAssetKey =
    prop.entityId === 'operator-mailbox' && !mailboxHasUnread
      ? 'operatorMailboxEmpty'
      : prop.asset;
  if (prop.entityId?.startsWith('plant-')) {
    const condition = effectiveEntityState(state, prop.entityId, now).condition;
    asset =
      condition === 'dead'
        ? 'plantDead'
        : condition === 'wilted'
          ? 'plantWilted'
          : 'plantSmall';
  }
  if (
    prop.resourceId === 'archive-lamp' &&
    effectiveEntityState(state, 'archive-lamp', now).power !== 'on'
  )
    asset = 'floorLampOff';
  const archiveTaskLampLevel =
    prop.resourceId === 'archive-lamp'
      ? Math.max(
          roomLightLevel(state, prop.roomId, now, reducedMotion),
          entityLightLevel(state, 'archive-lamp', now, reducedMotion),
        )
      : undefined;
  const lightingOptions = {
    state,
    roomId: prop.roomId,
    now,
    reducedMotion,
    ...(archiveTaskLampLevel === undefined
      ? {}
      : { lightLevel: archiveTaskLampLevel }),
  } satisfies FacilityImageOptions;
  const image = resolveFacilityImage(bank, asset, {
    lighting: 'lit',
  });
  if (!imageReady(image)) return;
  const { width, height } = facilitySize(asset, image);
  const anchoredRoom = prop.backWallRoomId
    ? ROOMS.find((room) => room.id === prop.backWallRoomId)
    : undefined;
  const y = anchoredRoom
    ? anchoredRoom.y + BACK_WALL_HEIGHT - height + BACK_WALL_FURNITURE_OVERLAP
    : (prop.y ?? 0);
  const work = resourceWorkState(state, prop.resourceId);
  if (work.mode !== 'idle') {
    context.fillStyle =
      work.mode === 'active' ? 'rgba(224,181,104,.24)' : 'rgba(224,181,104,.1)';
    context.fillRect(prop.x - 3, y - 3, width + 6, height + 6);
    context.fillStyle =
      work.mode === 'active' ? activityScreenColor(work) : '#a88c56';
    context.fillRect(prop.x, y + height + 1, width, 2);
  }
  drawLightingVariant(context, bank, asset, lightingOptions, (variant) => {
    context.drawImage(
      variant,
      Math.round(prop.x),
      Math.round(y),
      width,
      height,
    );
  });
  drawSurfaceDetail(context, state, prop, width, y);
}

function drawOccupiedSeatForeground(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  prop: SceneProp,
  now: number,
  reducedMotion: boolean,
) {
  if (
    prop.seatForegroundHeight === undefined &&
    prop.seatForegroundCrop === undefined
  ) {
    return;
  }
  const image = resolveFacilityImage(bank, prop.asset, {
    lighting: 'lit',
  });
  if (!imageReady(image)) return;
  const logicalSize = facilitySize(prop.asset, image);
  const requestedCrop = prop.seatForegroundCrop ?? {
    x: 0,
    y: 0,
    width: logicalSize.width,
    height: prop.seatForegroundHeight ?? logicalSize.height,
  };
  const sourceX = Math.max(0, Math.min(requestedCrop.x, logicalSize.width));
  const sourceY = Math.max(0, Math.min(requestedCrop.y, logicalSize.height));
  const width = Math.max(
    0,
    Math.min(requestedCrop.width, logicalSize.width - sourceX),
  );
  const height = Math.max(
    0,
    Math.min(requestedCrop.height, logicalSize.height - sourceY),
  );
  if (width === 0 || height === 0) return;
  const y = prop.y ?? 0;

  // The complete chair is rendered behind its occupant first. North-facing
  // chairs repaint the full authored silhouette; side-facing chairs repaint
  // only the back rail so the body remains visible on the seat.
  drawLightingVariant(
    context,
    bank,
    prop.asset,
    { state, roomId: prop.roomId, now, reducedMotion },
    (variant) =>
      context.drawImage(
        variant,
        (sourceX / logicalSize.width) * variant.naturalWidth,
        (sourceY / logicalSize.height) * variant.naturalHeight,
        (width / logicalSize.width) * variant.naturalWidth,
        (height / logicalSize.height) * variant.naturalHeight,
        Math.round(prop.x + sourceX),
        Math.round(y + sourceY),
        width,
        height,
      ),
  );
}

function statusColor(agent: RuntimeAgent) {
  if (agent.status === 'failed') return '#c86c65';
  if (agent.status === 'blocked') return '#d2a05d';
  if (agent.status === 'completed') return '#769b78';
  if (agent.status === 'working') return presentationForAgent(agent).accent;
  return '#7d898e';
}

function presentationForAgent(agent: RuntimeAgent) {
  return presentationAt(
    agent.presentationIndex ?? presentationIndexFor(agent.id),
  );
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

// Cache each fitted frame so the animation loop only draws one image per sign.
const plaqueFrames = new WeakMap<
  HTMLImageElement,
  Map<number, HTMLCanvasElement>
>();

function fittedPlaque(image: HTMLImageElement, width: number) {
  let frames = plaqueFrames.get(image);
  if (!frames) {
    frames = new Map();
    plaqueFrames.set(image, frames);
  }
  const cached = frames.get(width);
  if (cached) return cached;
  const frame = document.createElement('canvas');
  frame.width = width * 2;
  frame.height = 42;
  const context = frame.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  const sourceX = [0, 44, image.naturalWidth - 44, image.naturalWidth];
  const sourceY = [0, 44, image.naturalHeight - 44, image.naturalHeight];
  const targetX = [0, 10, frame.width - 10, frame.width];
  const targetY = [0, 8, frame.height - 8, frame.height];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      context.drawImage(
        image,
        sourceX[column],
        sourceY[row],
        sourceX[column + 1] - sourceX[column],
        sourceY[row + 1] - sourceY[row],
        targetX[column],
        targetY[row],
        targetX[column + 1] - targetX[column],
        targetY[row + 1] - targetY[row],
      );
    }
  }
  frames.set(width, frame);
  return frame;
}

function drawPlaque(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  state: AgentArenaState,
  room: Room,
) {
  const north = room.y < 200;
  const top = north ? 5 : 422;
  const left = room.x + 5;
  const width = room.w - 10;
  const agents = roomAgents(state, room.id);
  const activity = roomActivityLabel(agents);
  const accent = agents.find((agent) => agent.status === 'working');

  const plaque = bank['ui:room-plaque'];
  const frame = imageReady(plaque) ? fittedPlaque(plaque, width) : undefined;
  if (frame) {
    context.drawImage(frame, left, top, width, 21);
  } else {
    context.fillStyle = 'rgba(28,20,15,.97)';
    context.fillRect(left, top, width, 21);
    context.strokeStyle = '#795b41';
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, top + 0.5, width - 1, 20);
  }
  if (accent) {
    context.fillStyle = presentationForAgent(accent).accent;
    context.fillRect(left + 5, top + 7, 2, 7);
  }
  context.fillStyle = '#f0e3c8';
  context.font = '600 10px Georgia, serif';
  context.textBaseline = 'middle';
  context.fillText(room.label, left + 11, top + 11);
  context.fillStyle = agents.length > 0 ? '#e7c884' : '#b3ac8d';
  if (room.id === 'context') {
    context.fillRect(left + width - 9, top + 8, 3, 6);
  } else {
    context.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'right';
    context.fillText(activity, left + width - 9, top + 11);
  }
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';

  const connectorX = room.x + room.w / 2;
  context.strokeStyle = '#76583f';
  context.beginPath();
  context.moveTo(connectorX + 0.5, north ? 26 : 416);
  context.lineTo(connectorX + 0.5, north ? 31 : 421);
  context.stroke();
}

function motionFor(agent: RuntimeAgent, avatar: AvatarProjection): Motion {
  if (avatar.isMoving && (avatar.routeDelayMs ?? 0) <= 0) return 'run';
  const seatedProjection = seatedProjectionFor(agent, avatar);
  if (seatedProjection) {
    return seatedMotionFor(
      seatedProjection.direction,
      Boolean(agent.activeTool),
    );
  }
  if (
    agent.status === 'blocked' ||
    agent.status === 'failed' ||
    agent.status === 'canceled'
  ) {
    return 'idle_anim';
  }
  return 'idle_anim';
}

type SeatedResource = {
  slots: readonly Vec2[];
  seatedPositions?: readonly Vec2[];
  seatedDirections?: readonly AvatarDirection[];
};

type SeatedProjection = {
  position: Vec2;
  direction: AvatarDirection;
  seatIndex: number;
};

function seatedProjectionFor(
  agent: RuntimeAgent,
  avatar: AvatarProjection,
): SeatedProjection | undefined {
  if (agent.engagedResourceId !== avatar.stationId) return undefined;
  const fixture = resourceById(avatar.stationId) as SeatedResource | undefined;
  const seats = fixture?.seatedPositions;
  const directions = fixture?.seatedDirections;
  if (
    !fixture ||
    !seats ||
    seats.length === 0 ||
    !directions ||
    directions.length !== seats.length
  ) {
    return undefined;
  }

  let seatIndex = 0;
  if (seats.length > 1 && fixture.slots.length > 0) {
    let nearestDistance = Number.POSITIVE_INFINITY;
    fixture.slots.forEach((slot, index) => {
      const distance = Math.hypot(
        slot.x - avatar.position.x,
        slot.y - avatar.position.y,
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        seatIndex = index;
      }
    });
  }
  seatIndex = Math.min(seatIndex, seats.length - 1);
  return {
    position: seats[seatIndex],
    direction: directions[seatIndex],
    seatIndex,
  };
}

/**
 * Navigation ends at a collision-safe standing point in the aisle. Only an
 * explicit `use` engagement projects the resident onto the matching chair.
 * This keeps the motor capsule honest while allowing a deliberate seated pose
 * without animating a walking body through the furniture.
 */
function visualPositionFor(
  agent: RuntimeAgent,
  avatar: AvatarProjection,
): Vec2 {
  return seatedProjectionFor(agent, avatar)?.position ?? avatar.position;
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
  const left = x - 14;
  const right = x + 14;
  const top = y - 50;
  const bottom = y + 2;
  const arm = 5;
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
  reducedMotion: boolean,
) {
  const motion = motionFor(agent, avatar);
  const sheetMotion = isSeatedMotion(motion)
    ? seatedSheetMotion(motion)
    : motion;
  const sheet = bank[`${agent.id}:${sheetMotion}`];
  if (!imageReady(sheet)) return;

  const seated = isSeatedMotion(motion);
  const frameWidth = seated ? seatedFrameWidth(motion) : CHARACTER_FRAME_WIDTH;
  const frameCount = motion === 'phone' ? 9 : 6;
  const frame = reducedMotion
    ? 0
    : Math.floor(now / (motion === 'run' ? 95 : 150)) % frameCount;
  const seatedProjection = seatedProjectionFor(agent, avatar);
  const renderedDirection = seatedProjection?.direction ?? avatar.direction;
  const seatedDirection = seated
    ? seatedFrameOffset(motion, renderedDirection)
    : 0;
  const sourceFrame =
    motion === 'phone'
      ? frame
      : seated
        ? seatedDirection + frame
        : directionOffset(avatar.direction) + frame;
  const visualPosition = visualPositionFor(agent, avatar);
  const x = Math.round((visualPosition.x / 100) * WORLD_WIDTH);
  const y = Math.round((visualPosition.y / 100) * WORLD_HEIGHT);
  const width = frameWidth * CHARACTER_SCALE;
  const frameHeight = seated
    ? seatedFrameHeight(motion)
    : CHARACTER_FRAME_HEIGHT;
  const height = frameHeight * CHARACTER_SCALE;

  context.fillStyle = 'rgba(0,0,0,.38)';
  context.beginPath();
  context.ellipse(x, y, seated ? 13 : 8, 3, 0, 0, Math.PI * 2);
  context.fill();
  context.drawImage(
    sheet,
    sourceFrame * frameWidth,
    0,
    frameWidth,
    frameHeight,
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
  mailboxHasUnread: boolean,
  reducedMotion: boolean,
  workshopProjects: NonNullable<WorldProps['workshopProjects']>,
) {
  const occupiedSeats = new Map<
    string,
    Array<{ agentId: string; baseline: number; seatIndex: number }>
  >();
  state.avatars.forEach((avatar) => {
    const agent = agentsById.get(avatar.agentId);
    if (!agent) return;
    const projection = seatedProjectionFor(agent, avatar);
    if (!projection) return;
    const occupants = occupiedSeats.get(avatar.stationId) ?? [];
    occupants.push({
      agentId: agent.id,
      baseline: (projection.position.y / 100) * WORLD_HEIGHT,
      seatIndex: projection.seatIndex,
    });
    occupiedSeats.set(avatar.stationId, occupants);
  });

  const entries: Array<{
    baseline: number;
    stableOrder: number;
    draw: () => void;
  }> = SCENE_PROPS.map((prop, index) => {
    const occupiedSeat = prop.seatForResourceId
      ? occupiedSeats
          .get(prop.seatForResourceId)
          ?.find((occupant) => occupant.seatIndex === (prop.seatIndex ?? 0))
      : undefined;
    return {
      // The chair is initially present behind its resident. A separate
      // occupied-seat entry restores its complete silhouette in front.
      baseline: occupiedSeat
        ? Math.min(prop.baseline, occupiedSeat.baseline - 0.5)
        : prop.baseline,
      stableOrder: index,
      draw: () =>
        drawSceneProp(
          context,
          bank,
          state,
          prop,
          mailboxHasUnread,
          now,
          reducedMotion,
        ),
    };
  });

  if (workshopProjects.length > 0) {
    const installed = workshopProjects.some(
      (project) => project.stage === 'installed',
    );
    entries.push({
      baseline: 370,
      stableOrder: SCENE_PROPS.length,
      draw: () =>
        drawLightingVariant(
          context,
          bank,
          installed ? 'projectDevice' : 'projectBlueprint',
          { state, roomId: 'build', now, reducedMotion },
          (image) =>
            context.drawImage(
              image,
              492,
              installed ? 330 : 340,
              34,
              installed ? 34 : 23,
            ),
        ),
    });
  }

  state.avatars.forEach((avatar, index) => {
    const agent = agentsById.get(avatar.agentId);
    if (!agent) return;
    const visualPosition = visualPositionFor(agent, avatar);
    entries.push({
      baseline: (visualPosition.y / 100) * WORLD_HEIGHT,
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
          reducedMotion,
        ),
    });
  });

  SCENE_PROPS.forEach((prop, index) => {
    if (
      !prop.seatForResourceId ||
      (prop.seatForegroundHeight === undefined &&
        prop.seatForegroundCrop === undefined)
    ) {
      return;
    }
    const occupiedSeat = occupiedSeats
      .get(prop.seatForResourceId)
      ?.find((occupant) => occupant.seatIndex === (prop.seatIndex ?? 0));
    if (!occupiedSeat) return;
    entries.push({
      baseline: occupiedSeat.baseline + 0.5,
      stableOrder: 2000 + index,
      draw: () =>
        drawOccupiedSeatForeground(
          context,
          bank,
          state,
          prop,
          now,
          reducedMotion,
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
  bank: ImageBank,
  state: AgentArenaState,
  agentsById: Map<string, RuntimeAgent>,
  hoveredAgentId?: string,
) {
  ROOMS.forEach((room) => drawPlaque(context, bank, state, room));
  state.avatars.forEach((avatar) => {
    const agent = agentsById.get(avatar.agentId);
    if (!agent) return;
    if (state.selectedAgentId !== agent.id && hoveredAgentId !== agent.id)
      return;
    const visualPosition = visualPositionFor(agent, avatar);
    drawNameplate(
      context,
      Math.round((visualPosition.x / 100) * WORLD_WIDTH),
      Math.round((visualPosition.y / 100) * WORLD_HEIGHT),
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
    const visualPosition = visualPositionFor(speaker, avatar);
    latestBySpeaker.add(event.agentId);
    const roomId =
      roomForLocation(avatar.stationId)?.id ??
      roomForLocation(event.payload.speakerLocationId)?.id ??
      'context';
    const roomCount = roomCounts.get(roomId) ?? 0;
    if (roomCount >= 2 || projected.length >= 4) continue;
    const overlapsEarlier = projected.some(
      (bubble) =>
        Math.abs(bubble.left - visualPosition.x) < 24 &&
        Math.abs(bubble.top - (visualPosition.y - 10)) < 13,
    );
    projected.push({
      event,
      speaker,
      left: Math.max(14, Math.min(86, visualPosition.x)),
      top: Math.max(
        9,
        Math.min(90, visualPosition.y - 10 - (overlapsEarlier ? 9 : 0)),
      ),
    });
    roomCounts.set(roomId, roomCount + 1);
  }
  return projected;
}

export function AgentArenaWorldV2({
  focusRoomId,
  workshopProjects = [],
  state,
  onSelectAgent,
  onOpenJournal,
  onOpenMailbox = () => undefined,
  journalOpen,
  mailboxOpen = false,
  mailboxHasUnread = false,
  camera = FIT_CAMERA,
  onCameraChange = () => undefined,
  showLabels = true,
}: WorldProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  const bankRef = useRef<ImageBank>({});
  const [assetRevision, setAssetRevision] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [failedAssetCount, setFailedAssetCount] = useState(0);
  const [retryAssets, setRetryAssets] = useState(0);
  const [hoveredAgentId, setHoveredAgentId] = useState<string>();
  const [bubbleNow, setBubbleNow] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    id: number;
    x: number;
    y: number;
    camera: ArenaCamera;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const viewport = roomViewport(focusRoomId);
  const displayedCamera = camera;
  const cameraRef = useRef({ camera: displayedCamera, onCameraChange });
  useLayoutEffect(() => {
    cameraRef.current = { camera: displayedCamera, onCameraChange };
  });

  const agentsById = useMemo(
    () => new Map(state.agents.map((agent) => [agent.id, agent])),
    [state.agents],
  );
  const speechBubbles = projectSpeechBubbles(state, bubbleNow);
  const observedAgentIds = useMemo(
    () =>
      state.agents
        .map((agent) => `${agent.id}:${presentationForAgent(agent).sprite}`)
        .sort()
        .join('|'),
    [state.agents],
  );
  const latestFrame = useRef({
    state,
    agentsById,
    hoveredAgentId,
    mailboxHasUnread,
    assetsReady,
    showLabels,
    workshopProjects,
    viewport,
  });
  const residentManifest = useRef(state.agents);
  useLayoutEffect(() => {
    latestFrame.current = {
      state,
      agentsById,
      hoveredAgentId,
      mailboxHasUnread,
      assetsReady,
      showLabels,
      workshopProjects,
      viewport,
    };
    residentManifest.current = state.agents;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      // Ctrl+wheel belongs to browser page zoom and text enlargement.
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const bounds = frame.getBoundingClientRect();
      const anchor = {
        x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 100,
        y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 100,
      };
      const current = cameraRef.current;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? bounds.height
            : 1);
      current.onCameraChange(
        zoomCamera(
          current.camera,
          current.camera.zoom * Math.exp(-delta * 0.0015),
          anchor,
        ),
      );
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setBubbleNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    let canceled = false;
    const sources: Array<[string, string]> = (
      Object.keys(FACILITY_ASSETS) as FacilityAssetKey[]
    ).flatMap((key) =>
      (['lit', 'lightsOff'] as const).map(
        (lighting) =>
          [
            facilityKey(key, lighting),
            encodeURI(facilityAssetSource(key, lighting)),
          ] as [string, string],
      ),
    );
    sources.push(['ui:room-plaque', '/assets/homestead-v1/paper-frame.png']);
    residentManifest.current.forEach((agent) => {
      const folder = presentationForAgent(agent).sprite;
      ASSET_MOTIONS.forEach((motion) => {
        sources.push([`${agent.id}:${motion}`, `${folder}/${motion}.png`]);
      });
    });

    const missing = sources.filter(
      ([key, source]) =>
        !imageReady(bankRef.current[key]) ||
        bankRef.current[key]?.getAttribute('src') !== source,
    );
    if (missing.length === 0) {
      setAssetsReady(true);
      setFailedAssetCount(0);
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
      setAssetsReady(true);
      setFailedAssetCount(
        sources.filter(([key]) => !imageReady(bankRef.current[key])).length,
      );
      setAssetRevision((revision) => revision + 1);
    });

    return () => {
      canceled = true;
    };
  }, [observedAgentIds, retryAssets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelCanvas = labelCanvasRef.current;
    const context = canvas?.getContext('2d');
    const labelContext = labelCanvas?.getContext('2d');
    if (!canvas || !context || !labelCanvas || !labelContext) return;

    let animationFrame = 0;
    let previousFrame = Number.NEGATIVE_INFINITY;
    const drawFrame = (frameTime: number) => {
      if (
        document.hidden ||
        frameTime - previousFrame < 1_000 / (reducedMotion ? 12 : 30)
      ) {
        animationFrame = window.requestAnimationFrame(drawFrame);
        return;
      }
      previousFrame = frameTime;
      const environmentNow = Date.now();
      const bank = bankRef.current;
      const {
        state,
        agentsById,
        hoveredAgentId,
        mailboxHasUnread,
        assetsReady,
        showLabels,
        workshopProjects,
        viewport,
      } = latestFrame.current;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(
        WORLD_RENDER_SCALE,
        0,
        0,
        WORLD_RENDER_SCALE,
        -viewport.x * WORLD_RENDER_SCALE,
        -viewport.y * WORLD_RENDER_SCALE,
      );
      context.imageSmoothingEnabled = false;
      drawArchitecture(context, bank, state, environmentNow, reducedMotion);
      drawRoomLightFixtures(
        context,
        bank,
        state,
        environmentNow,
        reducedMotion,
      );
      drawDepthSortedScene(
        context,
        bank,
        state,
        agentsById,
        environmentNow,
        mailboxHasUnread,
        reducedMotion,
        workshopProjects,
      );
      drawDoorwayForegrounds(
        context,
        bank,
        state,
        environmentNow,
        reducedMotion,
      );
      drawEnvironmentalLighting(context, state, environmentNow, reducedMotion);
      drawAmbientLife(context, state, environmentNow, reducedMotion);

      labelContext.setTransform(1, 0, 0, 1, 0, 0);
      labelContext.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
      labelContext.setTransform(
        WORLD_RENDER_SCALE,
        0,
        0,
        WORLD_RENDER_SCALE,
        -viewport.x * WORLD_RENDER_SCALE,
        -viewport.y * WORLD_RENDER_SCALE,
      );
      labelContext.imageSmoothingEnabled = true;
      if (showLabels)
        drawLabels(labelContext, bank, state, agentsById, hoveredAgentId);
      if (!assetsReady) {
        labelContext.fillStyle = '#aeb8b9';
        labelContext.font =
          '10px ui-monospace, SFMono-Regular, Consolas, monospace';
        labelContext.fillText('Loading facility assets…', 31, 414);
      }

      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    drawFrame(0);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [assetRevision, reducedMotion]);

  function logicalPoint(event: CanvasPointEvent) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x:
        viewport.x +
        ((event.clientX - bounds.left) / bounds.width) * viewport.w,
      y:
        viewport.y +
        ((event.clientY - bounds.top) / bounds.height) * viewport.h,
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
        const sheetMotion = isSeatedMotion(motion)
          ? seatedSheetMotion(motion)
          : motion;
        if (!imageReady(bankRef.current[`${agent.id}:${sheetMotion}`]))
          return false;
        const visualPosition = visualPositionFor(agent, avatar);
        const x = (visualPosition.x / 100) * WORLD_WIDTH;
        const y = (visualPosition.y / 100) * WORLD_HEIGHT;
        const halfWidth = isSeatedMotion(motion)
          ? seatedFrameWidth(motion) * (CHARACTER_SCALE / 2) + 1
          : 13;
        return (
          point.x >= x - halfWidth &&
          point.x <= x + halfWidth &&
          point.y >= y - 50 &&
          point.y <= y + 2
        );
      })?.agentId;
  }

  return (
    <div className="arena-stage">
      <div
        ref={frameRef}
        className="arena-stage-frame"
        data-room-view={focusRoomId}
        style={{ '--room-ratio': viewport.w / viewport.h } as CSSProperties}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest('button')
          )
            return;
          suppressClickRef.current = false;
          dragRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            camera: displayedCamera,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId || drag.camera.zoom <= 1)
            return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) < 5) return;
          drag.moved = true;
          suppressClickRef.current = true;
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          onCameraChange(
            constrainCamera({
              zoom: drag.camera.zoom,
              x: drag.camera.x + (dx / bounds.width) * 100,
              y: drag.camera.y + (dy / bounds.height) * 100,
            }),
          );
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onClickCapture={(event) => {
          if (suppressClickRef.current) {
            event.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
      >
        <div
          className="arena-room-camera"
          onFocusCapture={(event) =>
            revealKeyboardFocus(
              event,
              frameRef.current,
              displayedCamera,
              onCameraChange,
            )
          }
          style={{
            transform: `translate(${displayedCamera.x}%, ${displayedCamera.y}%) scale(${displayedCamera.zoom})`,
          }}
        >
          <div
            className="arena-stage-surface"
            style={{
              position: 'absolute',
              width: `${(WORLD_WIDTH / viewport.w) * 100}%`,
              height: `${(WORLD_HEIGHT / viewport.h) * 100}%`,
              left: `${(-viewport.x / viewport.w) * 100}%`,
              top: `${(-viewport.y / viewport.h) * 100}%`,
            }}
          >
            <canvas
              ref={canvasRef}
              width={viewport.w * WORLD_RENDER_SCALE}
              height={viewport.h * WORLD_RENDER_SCALE}
              className="arena-world"
              aria-hidden="true"
              onPointerMove={(event) => setHoveredAgentId(agentAt(event))}
              onPointerLeave={() => setHoveredAgentId(undefined)}
              onClick={(event) => onSelectAgent(agentAt(event))}
              onDoubleClick={(event) => {
                const point = logicalPoint(event);
                onCameraChange(
                  focusCamera(
                    {
                      x: ((point.x - viewport.x) / viewport.w) * 100,
                      y: ((point.y - viewport.y) / viewport.h) * 100,
                    },
                    2.2,
                  ),
                );
              }}
              style={{
                left: `${(viewport.x / WORLD_WIDTH) * 100}%`,
                top: `${(viewport.y / WORLD_HEIGHT) * 100}%`,
                width: `${(viewport.w / WORLD_WIDTH) * 100}%`,
                height: `${(viewport.h / WORLD_HEIGHT) * 100}%`,
                cursor: dragging
                  ? 'grabbing'
                  : hoveredAgentId
                    ? 'pointer'
                    : displayedCamera.zoom > 1
                      ? 'grab'
                      : 'default',
              }}
            />
            <canvas
              ref={labelCanvasRef}
              width={viewport.w * WORLD_RENDER_SCALE}
              height={viewport.h * WORLD_RENDER_SCALE}
              style={{
                left: `${(viewport.x / WORLD_WIDTH) * 100}%`,
                top: `${(viewport.y / WORLD_HEIGHT) * 100}%`,
                width: `${(viewport.w / WORLD_WIDTH) * 100}%`,
                height: `${(viewport.h / WORLD_HEIGHT) * 100}%`,
              }}
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
                      '--speaker-accent': presentationForAgent(speaker).accent,
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
              hidden={Boolean(focusRoomId && focusRoomId !== 'command')}
              aria-label={`Open field journal, ${state.boardMessages.length} agent messages`}
              aria-expanded={journalOpen}
              aria-haspopup="dialog"
              onClick={() => onOpenJournal()}
            />
            <button
              type="button"
              className="field-journal-hotspot"
              hidden={Boolean(focusRoomId && focusRoomId !== 'context')}
              style={CONTEXT_KIOSK_ACTION_STYLE}
              aria-label={`Open field journal, ${state.avatars.length} agents present`}
              aria-expanded={journalOpen}
              aria-haspopup="dialog"
              onClick={() => onOpenJournal()}
            />
            <button
              type="button"
              className="operator-mailbox-hotspot"
              hidden={Boolean(focusRoomId && focusRoomId !== 'context')}
              style={OPERATOR_MAILBOX_ACTION_STYLE}
              aria-label="Open operator dispatch box"
              aria-expanded={mailboxOpen}
              aria-haspopup="dialog"
              onClick={onOpenMailbox}
            />
          </div>
        </div>
      </div>
      {failedAssetCount > 0 && (
        <button
          type="button"
          className="arena-asset-retry"
          onClick={() => setRetryAssets((value) => value + 1)}
        >
          {failedAssetCount} assets couldn’t load · Retry
        </button>
      )}
    </div>
  );
}
