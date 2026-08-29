'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { presentationFor } from '@/lib/arena/agentic-catalog';
import type {
  AgentArenaState,
  AgentPhase,
  AvatarDirection,
  AvatarProjection,
  RuntimeAgent,
} from '@/lib/arena/agentic-types';

const WORLD_WIDTH = 768;
const WORLD_HEIGHT = 448;
const FRAME_WIDTH = 16;
const FRAME_HEIGHT = 32;
const MOTIONS = ['run', 'idle_anim', 'phone', 'sit', 'sit2'] as const;

type Motion = (typeof MOTIONS)[number];
type ImageBank = Record<string, HTMLImageElement>;

type WorldProps = {
  state: AgentArenaState;
  onSelectAgent: (agentId?: string) => void;
};

type CanvasPointEvent = {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
};

const rooms = [
  { x: 24, y: 24, w: 214, h: 160, label: 'Research archive', floor: '#303a41', tile: [224, 176, 16, 16] },
  { x: 248, y: 24, w: 246, h: 160, label: 'Command room', floor: '#343a43', tile: [240, 176, 16, 16] },
  { x: 504, y: 24, w: 240, h: 160, label: 'Tool bay', floor: '#2c373d', tile: [224, 176, 16, 16] },
  { x: 24, y: 248, w: 288, h: 176, label: 'Synthesis studio', floor: '#39383c', tile: [240, 176, 16, 16] },
  { x: 472, y: 248, w: 272, h: 176, label: 'Build lab', floor: '#303941', tile: [224, 176, 16, 16] },
] as const;

function floorTexture(
  context: CanvasRenderingContext2D,
  room: (typeof rooms)[number],
  builder: HTMLImageElement | undefined,
) {
  context.fillStyle = room.floor;
  context.fillRect(room.x, room.y, room.w, room.h);
  if (builder?.complete) {
    for (let y = room.y; y < room.y + room.h; y += 16) {
      for (let x = room.x; x < room.x + room.w; x += 16) {
        context.drawImage(
          builder,
          room.tile[0],
          room.tile[1],
          room.tile[2],
          room.tile[3],
          x,
          y,
          16,
          16,
        );
      }
    }
    context.fillStyle = 'rgba(14,19,25,.38)';
    context.fillRect(room.x, room.y, room.w, room.h);
  }
}

function wallRoom(context: CanvasRenderingContext2D, room: (typeof rooms)[number]) {
  context.strokeStyle = '#10151c';
  context.lineWidth = 8;
  context.strokeRect(room.x, room.y, room.w, room.h);
  context.strokeStyle = '#59636c';
  context.lineWidth = 3;
  context.strokeRect(room.x, room.y, room.w, room.h);
  context.fillStyle = '#1c242d';
  context.fillRect(room.x + 4, room.y + 4, room.w - 8, 13);
  context.fillStyle = '#39434d';
  context.fillRect(room.x + 5, room.y + 16, room.w - 10, 2);
}

function cutDoor(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  vertical = false,
) {
  context.fillStyle = '#293139';
  if (vertical) context.fillRect(x - 7, y, 14, width);
  else context.fillRect(x, y - 7, width, 14);
  context.fillStyle = '#778089';
  if (vertical) {
    context.fillRect(x - 7, y, 3, width);
    context.fillRect(x + 4, y, 3, width);
  } else {
    context.fillRect(x, y - 7, width, 3);
    context.fillRect(x, y + 4, width, 3);
  }
}

function plaque(context: CanvasRenderingContext2D, x: number, y: number, label: string) {
  context.font = '7px ui-monospace, monospace';
  context.fillStyle = '#b8bfbe';
  context.fillText(label, x, y + 8);
}

function crop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  source: [number, number, number, number],
  destination: [number, number, number, number],
) {
  if (!image?.complete) return;
  context.drawImage(image, ...source, ...destination);
}

function sprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  source: [number, number, number, number],
  x: number,
  y: number,
  scale = 1,
) {
  crop(context, image, source, [x, y, source[2] * scale, source[3] * scale]);
}

function drawArchitecture(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  activity: { researchActive: boolean; buildActive: boolean },
) {
  context.fillStyle = '#07090d';
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  context.fillStyle = '#151b22';
  context.fillRect(10, 12, 748, 424);

  rooms.forEach((room) => floorTexture(context, room, bank.roomBuilder));

  context.fillStyle = '#252e36';
  context.fillRect(88, 188, 590, 52);
  context.fillRect(366, 176, 40, 248);
  context.fillStyle = '#303a43';
  context.fillRect(88, 189, 590, 2);
  context.fillRect(367, 176, 2, 248);

  rooms.forEach((room) => wallRoom(context, room));

  cutDoor(context, 160, 184, 32);
  cutDoor(context, 354, 184, 32);
  cutDoor(context, 606, 184, 32);
  cutDoor(context, 160, 248, 32);
  cutDoor(context, 598, 248, 32);

  context.fillStyle = '#11171e';
  context.fillRect(363, 401, 46, 31);
  context.fillStyle = '#66717a';
  context.fillRect(367, 405, 38, 2);
  context.fillStyle = '#27313a';
  for (let y = 412; y < 428; y += 5) context.fillRect(371, y, 30, 1);
  context.fillStyle = '#98a1a7';
  context.fillRect(401, 412, 2, 2);

  plaque(context, 34, 31, 'RESEARCH ARCHIVE');
  plaque(context, 258, 31, 'COMMAND ROOM');
  plaque(context, 514, 31, 'TOOL BAY');
  plaque(context, 34, 255, 'SYNTHESIS');
  plaque(context, 482, 255, 'BUILD LAB');

  const interiors = bank.interiors;

  // Research: one continuous reference wall and four aligned reading desks.
  const shelfSources: Array<[number, number, number, number]> = [
    [160, 1088, 32, 32],
    [192, 1088, 32, 32],
    [224, 1088, 32, 32],
    [160, 1136, 32, 32],
    [192, 1136, 32, 32],
  ];
  [36, 70, 104, 138, 172].forEach((x, index) =>
    sprite(context, interiors, shelfSources[index], x, 44),
  );
  [76, 115, 153, 191].forEach((x, index) =>
    sprite(context, interiors, index % 2 === 0 ? [80, 576, 32, 32] : [112, 640, 32, 32], x, 122),
  );

  // Command: a planning wall and one modular bench aligned to all four slots.
  sprite(context, interiors, [208, 608, 32, 32], 356, 42);
  sprite(context, interiors, [0, 656, 32, 16], 400, 50);
  [16, 32, 48, 32, 48, 32, 64, 32].forEach((sourceX, index) =>
    sprite(context, interiors, [sourceX, 576, 16, 32], 330 + index * 16, 122),
  );

  // Tool bay: a server bank, shared bench, and four runtime consoles.
  [526, 546, 566].forEach((x) => sprite(context, interiors, [176, 640, 16, 32], x, 44));
  sprite(context, interiors, [16, 576, 64, 32], 622, 50);
  [560, 598, 637, 675].forEach((x, index) =>
    sprite(context, interiors, index % 2 === 0 ? [192, 1264, 32, 32] : [224, 1264, 32, 32], x, 126),
  );

  // Synthesis: a single review bench and one source board.
  sprite(context, interiors, [0, 656, 32, 16], 244, 272);
  [16, 32, 48, 32, 48, 32, 48, 32, 48, 64, 32].forEach((sourceX, index) =>
    sprite(context, interiors, [sourceX, 576, 16, 32], 91 + index * 16, 336),
  );

  // The former commons is now an open lift landing with two real waiting seats.
  sprite(context, interiors, [128, 288, 32, 32], 328, 344);
  sprite(context, interiors, [128, 288, 32, 32], 416, 344);

  // Build: two shared workbenches and four aligned test consoles.
  sprite(context, interiors, [16, 576, 64, 32], 500, 280);
  sprite(context, interiors, [16, 576, 64, 32], 654, 280);
  [522, 568, 614, 660].forEach((x, index) =>
    sprite(context, interiors, index % 2 === 0 ? [192, 1264, 32, 32] : [224, 1264, 32, 32], x, 336),
  );

  context.fillStyle = activity.researchActive ? '#80c7be' : '#395b5c';
  context.fillRect(87, 130, 5, 3);
  context.fillStyle = activity.buildActive ? '#80c7be' : '#3c5b5c';
  context.fillRect(667, 344, 5, 3);
}

function motionFor(agent: RuntimeAgent, avatar: AvatarProjection): Motion {
  if (avatar.isMoving) return 'run';
  if (agent.status === 'blocked' || agent.status === 'failed' || agent.status === 'canceled') return 'idle_anim';
  if (agent.phase === 'researching') return 'phone';
  if (['implementing', 'tooling'].includes(agent.phase)) return 'sit2';
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
    tooling: 'using a tool',
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
  context.strokeStyle = color;
  context.lineWidth = 1;
  const left = x - 18;
  const top = y - 53;
  const right = x + 18;
  const bottom = y + 3;
  context.beginPath();
  context.moveTo(left, top + 7);
  context.lineTo(left, top);
  context.lineTo(left + 7, top);
  context.moveTo(right - 7, top);
  context.lineTo(right, top);
  context.lineTo(right, top + 7);
  context.moveTo(left, bottom - 7);
  context.lineTo(left, bottom);
  context.lineTo(left + 7, bottom);
  context.moveTo(right - 7, bottom);
  context.lineTo(right, bottom);
  context.lineTo(right, bottom - 7);
  context.stroke();
}

function drawCaption(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
) {
  const compact = text.length > 52 ? `${text.slice(0, 49)}…` : text;
  context.font = '7px ui-monospace, monospace';
  const width = Math.min(214, Math.ceil(context.measureText(compact).width) + 12);
  const left = Math.max(6, Math.min(WORLD_WIDTH - width - 6, x - width / 2));
  context.fillStyle = 'rgba(10,13,17,.94)';
  context.fillRect(left, y - 75, width, 19);
  context.fillStyle = '#6f7c82';
  context.fillRect(left, y - 75, 2, 19);
  context.fillStyle = '#e1e2dc';
  context.fillText(compact, left + 7, y - 63);
}

function drawNameplate(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  agent: RuntimeAgent,
) {
  context.font = '8px ui-monospace, monospace';
  const label = `${agent.name}  ${verbForPhase(agent.phase)}`;
  const width = Math.ceil(context.measureText(label).width) + 10;
  const left = Math.max(4, Math.min(WORLD_WIDTH - width - 4, x - width / 2));
  context.fillStyle = 'rgba(8,10,14,.9)';
  context.fillRect(left, y + 7, width, 16);
  context.fillStyle = '#e2e4df';
  context.fillText(label, left + 5, y + 18);
}

function drawAgent(
  context: CanvasRenderingContext2D,
  bank: ImageBank,
  agent: RuntimeAgent,
  avatar: AvatarProjection,
  selected: boolean,
  followed: boolean,
  hovered: boolean,
  now: number,
  showMessage: boolean,
) {
  const presentation = presentationFor(agent.id);
  const motion = motionFor(agent, avatar);
  const sheet = bank[`${agent.id}:${motion}`];
  if (!sheet?.complete) return;

  const seated = motion === 'sit' || motion === 'sit2';
  const frameWidth = seated ? 32 : FRAME_WIDTH;
  const frameCount = motion === 'phone' ? 9 : 6;
  const frame = Math.floor(now / (motion === 'run' ? 95 : 150)) % frameCount;
  const seatedDirection = avatar.direction === 'west' || avatar.direction === 'north' ? 6 : 0;
  const sourceFrame = motion === 'phone'
    ? frame
    : seated
      ? seatedDirection + frame
      : directionOffset(avatar.direction) + frame;
  const x = Math.round((avatar.position.x / 100) * WORLD_WIDTH);
  const y = Math.round((avatar.position.y / 100) * WORLD_HEIGHT);
  const width = seated ? 54 : 27;
  const height = 54;

  context.fillStyle = 'rgba(0,0,0,.34)';
  context.beginPath();
  context.ellipse(x, y, 12, 4, 0, 0, Math.PI * 2);
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

  if (selected || followed || agent.status === 'blocked' || agent.status === 'failed') {
    const color = agent.status === 'blocked' ? '#d09a50' : agent.status === 'failed' ? '#b85f5c' : presentation.accent;
    drawBracket(context, x, y, color);
  }
  if (selected || hovered) drawNameplate(context, x, y, agent);
  if (showMessage) drawCaption(context, x, y, agent.lastMessage ?? '');
}

function eventIsRecent(state: AgentArenaState, agentId: string, now: number) {
  return state.events.some(
    (event) =>
      event.kind === 'agent.message' &&
      event.agentId === agentId &&
      now - Date.parse(event.occurredAt) < 2600,
  );
}

export function AgentArenaWorld({ state, onSelectAgent }: WorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bankRef = useRef<ImageBank>({});
  const [assetsReady, setAssetsReady] = useState(false);
  const [hoveredAgentId, setHoveredAgentId] = useState<string>();

  const agentsById = useMemo(
    () => new Map(state.agents.map((agent) => [agent.id, agent])),
    [state.agents],
  );

  useEffect(() => {
    let canceled = false;
    const sources: Array<[string, string]> = [
      ['interiors', '/assets/limezu/interiors.png'],
      ['roomBuilder', '/assets/limezu/room-builder.png'],
    ];
    ['atlas', 'sage', 'nova', 'kernel'].forEach((agentId) => {
      const folder = presentationFor(agentId).sprite;
      MOTIONS.forEach((motion) => sources.push([`${agentId}:${motion}`, `${folder}/${motion}.png`]));
    });

    void Promise.all(
      sources.map(
        ([key, source]) =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = source;
            bankRef.current[key] = image;
          }),
      ),
    ).then(
      () => {
        if (!canceled) setAssetsReady(true);
      },
      () => {
        if (!canceled) setAssetsReady(true);
      },
    );

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.imageSmoothingEnabled = false;
    const bank = bankRef.current;
    drawArchitecture(context, bank, {
      researchActive: state.agents.some(
        (agent) => agent.id === 'sage' && Boolean(agent.activeTool),
      ),
      buildActive: state.agents.some(
        (agent) => ['nova', 'kernel'].includes(agent.id) && Boolean(agent.activeTool),
      ),
    });

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
          hoveredAgentId === agent.id,
          now,
          Boolean(agent.lastMessage) && eventIsRecent(state, agent.id, Date.now()),
        );
      });

    if (!assetsReady) {
      context.fillStyle = '#aeb4b6';
      context.font = '8px ui-monospace, monospace';
      context.fillText('loading authored sprite sheets…', 22, 438);
    }
  }, [agentsById, assetsReady, hoveredAgentId, state]);

  function logicalPoint(event: CanvasPointEvent) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * WORLD_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * WORLD_HEIGHT,
    };
  }

  function agentAt(event: CanvasPointEvent) {
    const point = logicalPoint(event);
    return state.avatars
      .map((avatar) => ({
        id: avatar.agentId,
        distance: Math.hypot(
          point.x - (avatar.position.x / 100) * WORLD_WIDTH,
          point.y - (avatar.position.y / 100) * WORLD_HEIGHT + 24,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)
      .find((item) => item.distance < 34)?.id;
  }

  return (
    <canvas
      ref={canvasRef}
      width={WORLD_WIDTH}
      height={WORLD_HEIGHT}
      className="arena-world"
      aria-label="Autonomous subagents moving through an authored operations floor"
      onPointerMove={(event) => setHoveredAgentId(agentAt(event))}
      onPointerLeave={() => setHoveredAgentId(undefined)}
      onClick={(event) => onSelectAgent(agentAt(event))}
      style={{ cursor: hoveredAgentId ? 'pointer' : 'default' }}
    />
  );
}
