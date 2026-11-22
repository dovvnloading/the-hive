#!/usr/bin/env node
/**
 * Layout and style mockups for the Hive visual remake. Each mockup is drawn in
 * world units from the live facility geometry, then rasterized for use as a
 * reference image when generating the final art.
 *
 *   mockups/rooms/<room>.png   empty room shell on a 1536 x 1024 canvas
 *   mockups/props/<prop>.png   one interactable prop on a 1024 x 1024 canvas
 *   mockups/layout.json        where each room sits inside its canvas
 *
 * Usage: node design/hive-remake-v1/make-mockups.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = resolve(HERE, 'mockups');
const OL = '#3d2b2e';
const SW = 0.6;
const KEY = '#ff00ff';

// ---------------------------------------------------------------- primitives
const n = (v) => Number(v.toFixed(2));
const paint = (fill, stroke = OL, width = SW, extra = '') =>
  `fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"` : ''}${extra}`;
const rect = (x, y, w, h, fill, r = 0, stroke, width, extra) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ${paint(fill, stroke, width, extra)}/>`;
const ell = (cx, cy, rx, ry, fill, stroke, width, extra) =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${paint(fill, stroke, width, extra)}/>`;
const circ = (cx, cy, r, fill, stroke, width, extra) =>
  ell(cx, cy, r, r, fill, stroke, width, extra);
const path = (d, fill, stroke, width, extra) =>
  `<path d="${d}" ${paint(fill, stroke, width, extra)}/>`;
const line = (d, stroke, width = 0.4, extra = '') =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${extra}/>`;
const range = (from, to, step) => {
  const out = [];
  for (let v = from; v < to; v += step) out.push(v);
  return out;
};

// ------------------------------------------------------------------- rooms
// World rects and door centres come from lib/arena/facility-protocol.mjs.
const ROOMS = {
  research: {
    rect: [32, 32, 224, 160],
    north: true,
    door: 144,
    wall: {
      paper: '#8fa77a',
      pattern: 'leaf',
      ink: '#7a9269',
      wainscot: '#7a4e32',
    },
    floor: { kind: 'planks', base: '#c8935a', seam: '#9c6a3c' },
    windows: [],
  },
  command: {
    rect: [256, 32, 192, 160],
    north: true,
    door: 352,
    wall: {
      paper: '#ead2a6',
      pattern: 'stripe',
      ink: '#dcbf8e',
      wainscot: '#8a5a3a',
    },
    floor: { kind: 'planks', base: '#d2a066', seam: '#a5743f' },
    windows: [],
  },
  tools: {
    rect: [448, 32, 288, 160],
    north: true,
    door: 592,
    wall: {
      paper: '#c49464',
      pattern: 'boards',
      ink: '#a57849',
      wainscot: '#6f4a33',
    },
    floor: { kind: 'planks', base: '#a98360', seam: '#7d5e43' },
    windows: [[14, 56]],
  },
  synthesis: {
    rect: [32, 256, 256, 160],
    north: false,
    door: 176,
    wall: {
      paper: '#a58bb0',
      pattern: 'damask',
      ink: '#937a9f',
      wainscot: '#5e3d2f',
    },
    floor: { kind: 'herringbone', base: '#b9844f', seam: '#8b5d34' },
    rug: [70, 351, 113, 55, '#8f4b5a', '#e8c983'],
    windows: [],
  },
  context: {
    rect: [288, 256, 192, 160],
    north: false,
    door: 384,
    wall: {
      paper: '#f1d898',
      pattern: 'flower',
      ink: '#e0be78',
      wainscot: '#8aa07a',
    },
    floor: { kind: 'planks', base: '#cf9a5f', seam: '#a06e3e' },
    rug: [330, 338, 112, 63, '#7f9a6b', '#f3dfae'],
    windows: [[24, 62]],
  },
  build: {
    rect: [480, 256, 256, 160],
    north: false,
    door: 592,
    wall: {
      paper: '#d9c3a0',
      pattern: 'brick',
      ink: '#b9573f',
      wainscot: '#6d503e',
    },
    floor: { kind: 'flagstone', base: '#b4a38c', seam: '#857561' },
    windows: [[68, 90]],
  },
};

function wallPattern(kind, x0, x1, y0, y1, ink) {
  let out = '';
  if (kind === 'stripe')
    for (const x of range(x0 + 4, x1, 8))
      out += rect(x, y0, 3, y1 - y0, ink, 0, null);
  if (kind === 'boards')
    for (const x of range(x0, x1, 9))
      out += line(`M${x} ${y0} L${x} ${y1}`, ink, 0.6);
  if (kind === 'leaf' || kind === 'flower' || kind === 'damask')
    for (const y of range(y0 + 5, y1 - 2, 9))
      for (const x of range(x0 + ((y / 9) % 2 ? 5 : 9), x1 - 2, 9))
        out +=
          kind === 'leaf'
            ? path(
                `M${x - 1.5} ${y} Q${x} ${y - 2} ${x + 1.5} ${y} Q${x} ${y + 2} ${x - 1.5} ${y} Z`,
                ink,
                null,
              )
            : kind === 'flower'
              ? circ(x, y, 0.9, ink, null) + circ(x, y, 0.35, '#fff6dc', null)
              : path(
                  `M${x} ${y - 2} L${x + 1.4} ${y} L${x} ${y + 2} L${x - 1.4} ${y} Z`,
                  ink,
                  null,
                );
  if (kind === 'brick')
    for (const [row, y] of range(y0 + 22, y1, 4).entries())
      for (const x of range(x0 + (row % 2 ? 0 : 4), x1, 8))
        out += rect(x, y, 7.4, 3.4, '#c46a4c', 0.4, '#8f4433', 0.25);
  return out;
}

function floorPattern(f, x0, x1, y0, y1) {
  let out = rect(x0, y0, x1 - x0, y1 - y0, f.base, 0, null);
  if (f.kind === 'planks')
    for (const [row, y] of range(y0, y1, 7).entries()) {
      out += line(`M${x0} ${y} L${x1} ${y}`, f.seam, 0.45);
      for (const x of range(x0 + (row % 3) * 17, x1, 52))
        out += line(`M${x} ${y} L${x} ${y + 7}`, f.seam, 0.35);
    }
  if (f.kind === 'herringbone')
    for (const y of range(y0, y1 + 8, 6))
      for (const x of range(x0 - 8, x1 + 8, 12))
        out +=
          line(`M${x} ${y} l6 -3`, f.seam, 0.35) +
          line(`M${x + 6} ${y - 3} l6 3`, f.seam, 0.35);
  if (f.kind === 'flagstone')
    for (const [row, y] of range(y0, y1, 12).entries())
      for (const x of range(x0 + (row % 2 ? 0 : 10), x1, 20))
        out += rect(
          x + 0.6,
          y + 0.6,
          18.8,
          10.8,
          row % 3 ? f.base : '#bdae98',
          1.6,
          f.seam,
          0.35,
        );
  return out;
}

function roomSvg(id) {
  const room = ROOMS[id];
  const [rx, ry, w, h] = room.rect;
  const door = room.door - rx;
  let body = '';
  // Floor, then the sixty-four-unit back wall.
  body += floorPattern(room.floor, 8, w - 8, 64, h - 8);
  body += rect(8, 64, w - 16, 5, '#000', 0, null, 0, ' opacity="0.12"');
  body += rect(8, 5, w - 16, 59, room.wall.paper, 0, null);
  body += wallPattern(room.wall.pattern, 8, w - 8, 5, 40, room.wall.ink);
  body += rect(8, 40, w - 16, 18, room.wall.wainscot, 0, OL, 0.4);
  for (const x of range(14, w - 10, 16))
    body += rect(x, 43, 12, 12, '#000', 0.8, null, 0, ' opacity="0.12"');
  body += rect(8, 58, w - 16, 6, '#5a3a28', 0, OL, 0.4);
  for (const [a, b] of room.windows) {
    body += rect(a, 9, b - a, 27, '#bfe3ef', 1, OL, 0.7);
    body += path(
      `M${a} 28 Q${(a + b) / 2} 20 ${b} 26 L${b} 36 L${a} 36 Z`,
      '#8fbf6a',
      null,
    );
    body += line(
      `M${(a + b) / 2} 9 L${(a + b) / 2} 36 M${a} 22 L${b} 22`,
      '#7a4e32',
      1.2,
    );
    body += rect(a - 2, 35, b - a + 4, 3, '#8a5a3a', 0.5, OL, 0.4);
  }
  if (room.rug) {
    const [gx, gy, gw, gh, c1, c2] = room.rug;
    const x = gx - rx;
    const y = gy - ry;
    body += rect(x, y, gw, gh, c1, 3, OL, 0.5);
    body += rect(x + 4, y + 4, gw - 8, gh - 8, 'none', 2, c2, 1.2);
    body += ell(x + gw / 2, y + gh / 2, gw / 5, gh / 5, 'none', c2, 0.9);
  }
  // Timber frame: cap, side posts, front sill.
  body += rect(0, 0, w, 5, '#6b4329', 0, OL, 0.5);
  body += rect(0, 0, 8, h, '#6b4329', 0, OL, 0.5);
  body += rect(w - 8, 0, 8, h, '#6b4329', 0, OL, 0.5);
  if (room.north) {
    body += rect(0, h - 8, door - 18, 8, '#6b4329', 0, OL, 0.5);
    body += rect(door + 18, h - 8, w - door - 18, 8, '#6b4329', 0, OL, 0.5);
    body += rect(door - 18, h - 8, 36, 8, '#241c18', 0, null);
  } else {
    body += rect(0, h - 8, w, 8, '#6b4329', 0, OL, 0.5);
    body += rect(door - 18, 0, 36, 64, '#241c18', 0, null);
    body += rect(door - 15, 4, 30, 60, '#3b2a20', 0, null);
  }
  return { w, h, body };
}

// ------------------------------------------------------------------- props
const WOOD = '#9a6a42';
const WOOD_D = '#7a4e32';
const WOOD_L = '#c08a58';
const BRASS = '#d9a441';

const books = (x, y, w, h, seed) => {
  const colors = [
    '#b84a3e',
    '#4f7bbd',
    '#e2a93b',
    '#6f935e',
    '#8c4a70',
    '#e8d7b0',
    '#3f5a8a',
  ];
  let out = '';
  let cx = x;
  let i = seed;
  while (cx < x + w - 2) {
    const bw = 2 + ((i * 7) % 3);
    const bh = h - ((i * 5) % 4);
    out += rect(
      cx,
      y + h - bh,
      bw,
      bh,
      colors[i % colors.length],
      0.3,
      OL,
      0.3,
    );
    cx += bw + 0.3;
    i += 1;
  }
  return out;
};

const PROPS = {
  'utility-workstation': [
    54,
    40,
    () =>
      rect(4, 24, 3, 15, WOOD_D) +
      rect(47, 24, 3, 15, WOOD_D) +
      rect(34, 24, 15, 13, WOOD) +
      line('M34 30.5 L49 30.5', OL, 0.4) +
      circ(41.5, 27, 0.7, BRASS, null) +
      circ(41.5, 33.5, 0.7, BRASS, null) +
      rect(2, 18, 50, 6.5, WOOD_L, 1) +
      rect(16, 1.5, 22, 15, '#3a3440', 1.5) +
      rect(18, 3.5, 18, 11, '#8fd3c9', 0.8, null) +
      line('M20 6 L30 6 M20 8.5 L33 8.5 M20 11 L27 11', '#3f7f78', 0.6) +
      rect(25, 16.5, 4, 2, '#3a3440', 0, null) +
      rect(14, 19, 20, 2.6, '#efe6d2', 0.6, OL, 0.35) +
      rect(39, 15.5, 3.4, 3.8, '#e86f5a', 0.6, OL, 0.35),
  ],
  'verification-desk': [
    62,
    40,
    () =>
      rect(4, 24, 3, 15, WOOD_D) +
      rect(55, 24, 3, 15, WOOD_D) +
      rect(8, 24, 16, 13, WOOD) +
      rect(2, 18, 58, 6.5, WOOD_L, 1) +
      rect(6, 4, 20, 14, '#4b5562', 1.5) +
      rect(8, 6, 11, 9, '#163b33', 0.5, null) +
      line('M8.5 11 Q10.5 7 12.5 11 T16.5 11 T19 11', '#7dffb0', 0.6) +
      circ(22, 8, 1.4, '#e2a93b') +
      circ(22, 13, 1.4, '#6aa6ae') +
      rect(31, 2, 20, 14.5, '#3a3440', 1.5) +
      rect(33, 4, 16, 10.5, '#9fe3c0', 0.8, null) +
      line('M35 7 l2 2 l4 -4', '#2f8a57', 0.8) +
      line('M35 11.5 L46 11.5', '#2f8a57', 0.6) +
      rect(39, 16.5, 4, 2, '#3a3440', 0, null) +
      rect(52, 14, 6, 5, '#f4efe6', 0.4, OL, 0.35),
  ],
  'writing-desk': [
    50,
    38,
    () =>
      rect(5, 22, 3, 15, WOOD_D) +
      rect(42, 22, 3, 15, WOOD_D) +
      rect(27, 22, 14, 11, WOOD) +
      circ(34, 27.5, 0.8, BRASS, null) +
      path('M2 16 L48 16 L46 22.5 L4 22.5 Z', WOOD_L) +
      path('M12 9 Q18 7 24.5 9.5 L24.5 18 Q18 16 12 18 Z', '#fbf1dc') +
      path('M24.5 9.5 Q31 7 37 9 L37 18 Q31 16 24.5 18 Z', '#f4e6c6') +
      line(
        'M14 11 L22 11.6 M14 13 L22 13.6 M27 11.4 L35 10.8 M27 13.4 L34 12.9',
        '#a58a6a',
        0.35,
      ) +
      path(
        'M11.5 8.5 L12 18.6 L24.5 19 L37.5 18.6 L37.5 8.5',
        'none',
        '#6b3f2a',
        0.7,
      ) +
      circ(42, 14, 2.2, '#2f3b5a') +
      line('M41 13 L45 4', '#f4efe6', 0.7),
  ],
  'build-workbench': [
    70,
    40,
    () =>
      rect(4, 22, 4, 17, WOOD_D) +
      rect(62, 22, 4, 17, WOOD_D) +
      rect(6, 31, 58, 3, WOOD) +
      rect(12, 26, 10, 5, '#c9a46c', 0.4) +
      rect(46, 25, 12, 6, '#8aa07a', 0.4) +
      rect(1, 15, 68, 7.5, WOOD_L, 1) +
      line('M1 18.5 L69 18.5', WOOD, 0.4) +
      rect(4, 9, 10, 6.5, '#6f7680', 1) +
      rect(6, 6, 6, 3.5, '#8d96a1', 0.5) +
      path('M24 13 L36 13 L36 15.5 L24 15.5 Z', '#d9dde3') +
      rect(36, 12.5, 4, 3.5, WOOD, 0.6) +
      rect(48, 8, 2, 7.5, WOOD) +
      rect(45.5, 6, 7, 3, '#7b838d', 0.6) +
      rect(57, 10, 8, 5.5, '#e2a93b', 0.8) +
      circ(61, 12.8, 1.2, '#c18a25'),
  ],
  'planning-table': [
    54,
    40,
    () =>
      rect(9, 22, 4, 17, WOOD_D) +
      rect(41, 22, 4, 17, WOOD_D) +
      path('M1 14 Q27 6 53 14 L53 20 Q27 28 1 20 Z', WOOD_L) +
      path('M9 12.5 L45 12.5 L46 19 L8 19 Z', '#efe2bf', OL, 0.4) +
      rect(12, 13.5, 8, 4, '#cfe3c0', 0.4, OL, 0.3) +
      rect(23, 13.5, 8, 4, '#e8cfa4', 0.4, OL, 0.3) +
      rect(34, 13.5, 8, 4, '#c9d9ec', 0.4, OL, 0.3) +
      line('M20 15.5 L23 15.5 M31 15.5 L34 15.5', '#b84a3e', 0.5) +
      circ(16, 12.6, 0.8, '#b84a3e') +
      circ(38, 12.6, 0.8, '#4f7bbd') +
      path('M47.5 13.5 L50 13.5 L49.6 17 L47.9 17 Z', '#f4efe6'),
  ],
  'bookshelf-filled': [
    50,
    64,
    () =>
      rect(2, 2, 46, 61, WOOD, 1.5) +
      rect(5, 5, 40, 55, WOOD_D, 0.5) +
      [6, 19, 32, 45]
        .map(
          (y, i) =>
            books(6, y, 38, 11, i * 3) +
            rect(5, y + 11, 40, 2, WOOD_L, 0, OL, 0.35),
        )
        .join('') +
      rect(0, 0, 50, 4, WOOD_L, 1),
  ],
  'bookshelf-sparse': [
    50,
    64,
    () =>
      rect(2, 2, 46, 61, WOOD, 1.5) +
      rect(5, 5, 40, 55, WOOD_D, 0.5) +
      [6, 19, 32, 45]
        .map((y) => rect(5, y + 11, 40, 2, WOOD_L, 0, OL, 0.35))
        .join('') +
      books(7, 6, 12, 11, 1) +
      rect(30, 9, 9, 8, '#c9a46c', 0.4) +
      books(26, 19, 10, 11, 4) +
      ell(13, 41, 3.5, 2.5, '#b9573f') +
      circ(13, 37, 3.5, '#6f935e') +
      books(8, 45, 16, 11, 2) +
      rect(0, 0, 50, 4, WOOD_L, 1),
  ],
  'parts-cabinet': [
    48,
    64,
    () =>
      rect(2, 2, 44, 61, WOOD, 1.5) +
      rect(5, 5, 18, 26, '#cfe7ec', 0.6) +
      rect(25, 5, 18, 26, '#cfe7ec', 0.6) +
      circ(11, 12, 3, '#c9a46c', OL, 0.4) +
      circ(16, 22, 2.5, BRASS, OL, 0.4) +
      rect(28, 10, 8, 5, '#8d96a1', 0.4) +
      circ(35, 22, 3, '#d9a441', OL, 0.4) +
      [34, 43, 52]
        .map(
          (y) =>
            rect(5, y, 38, 7.5, WOOD_L, 0.6) +
            rect(20, y + 2.5, 8, 2.4, '#f4efe6', 0.3, OL, 0.3) +
            circ(24, y + 6, 0.7, BRASS, null),
        )
        .join('') +
      rect(0, 0, 48, 4, WOOD_L, 1),
  ],
  'reading-armchair': [
    30,
    38,
    () =>
      rect(3, 30, 3, 7, WOOD_D) +
      rect(24, 30, 3, 7, WOOD_D) +
      path('M5 4 Q15 0 25 4 L25 22 L5 22 Z', '#5f8a5a') +
      rect(1, 14, 7, 17, '#6f9a68', 3) +
      rect(22, 14, 7, 17, '#6f9a68', 3) +
      rect(6, 20, 18, 10, '#7fa478', 2) +
      line('M10 8 L10 18 M15 6 L15 18 M20 8 L20 18', '#4c7347', 0.4),
  ],
  'lounge-couch': [
    52,
    38,
    () =>
      rect(4, 31, 3, 6, WOOD_D) +
      rect(45, 31, 3, 6, WOOD_D) +
      path('M4 6 Q26 1 48 6 L48 22 L4 22 Z', '#5f8a5a') +
      rect(0, 13, 8, 19, '#6f9a68', 3.5) +
      rect(44, 13, 8, 19, '#6f9a68', 3.5) +
      rect(7, 20, 19, 11, '#7fa478', 2) +
      rect(26, 20, 19, 11, '#7fa478', 2) +
      rect(10, 10, 9, 9, '#e8c983', 2.5) +
      rect(33, 10, 9, 9, '#c96f5f', 2.5),
  ],
  'chair-north': [
    20,
    32,
    () =>
      rect(3, 24, 2.4, 7.5, WOOD_D) +
      rect(14.6, 24, 2.4, 7.5, WOOD_D) +
      rect(2, 19, 16, 5, WOOD_L, 1) +
      rect(3, 1, 14, 3.5, WOOD, 1) +
      [5, 8.5, 12, 15]
        .map((x) => rect(x - 0.8, 4, 1.6, 15, WOOD, 0.5))
        .join('') +
      rect(2.4, 1, 2.2, 19, WOOD, 0.8) +
      rect(15.4, 1, 2.2, 19, WOOD, 0.8),
  ],
  'chair-east': [
    22,
    32,
    () =>
      rect(2, 1, 3.2, 30, WOOD, 1) +
      rect(4, 17, 16, 4.5, WOOD_L, 1) +
      rect(17, 21, 2.6, 10, WOOD_D) +
      rect(5, 21, 2.6, 10, WOOD_D) +
      rect(4.8, 4, 1.6, 13, WOOD_D, 0.5),
  ],
  'floor-lamp-on': [
    13,
    30,
    () =>
      ell(6.5, 28.5, 4.5, 1.4, WOOD_D) +
      rect(5.8, 9, 1.4, 19.5, BRASS, 0.5) +
      path('M1.5 10 L11.5 10 L9.5 2 L3.5 2 Z', '#f6e2a8') +
      ell(6.5, 10, 6, 1.2, '#fff3c4', null, 0, ' opacity="0.8"'),
  ],
  'plant-healthy': [
    14,
    24,
    () =>
      path('M3 15 L11 15 L10 23 L4 23 Z', '#c46a4c') +
      rect(2.4, 14, 9.2, 2.4, '#d98a6a', 0.6) +
      path('M7 14 Q2 10 1.5 4 Q6 7 7 14 Z', '#6f9a58') +
      path('M7 14 Q12 10 12.5 3 Q8 7 7 14 Z', '#7fae64') +
      path('M7 14 Q6 6 7.5 0.8 Q9.5 7 7 14 Z', '#8fbf6a') +
      path('M7 14 Q3.5 12 2 9', 'none', '#4f7a3f', 0.4),
  ],
  'mailbox-full': [
    24,
    20,
    () =>
      rect(3, 3, 18, 16, WOOD, 2) +
      path('M3 7 Q12 1 21 7', 'none', OL, 0.6) +
      rect(6, 9, 12, 2.2, '#3b2a20', 0.8, null) +
      rect(8, 6.5, 8, 4, '#fbf1dc', 0.4, OL, 0.35) +
      path('M8 6.5 L12 9 L16 6.5', 'none', '#b84a3e', 0.4) +
      rect(20.5, 2, 1.4, 9, '#7b838d', 0.4) +
      rect(21.4, 2, 2.4, 3, '#d9544f', 0.3),
  ],
  'command-board': [
    132,
    52,
    () =>
      rect(1, 1, 130, 50, '#7a4e32', 2) +
      rect(5, 5, 122, 42, '#c9a06a', 1) +
      [
        [12, 10],
        [52, 10],
        [92, 10],
        [12, 28],
        [52, 28],
        [92, 28],
      ]
        .map(
          ([x, y], i) =>
            rect(
              x,
              y,
              28,
              13,
              [
                '#cfe3c0',
                '#e8cfa4',
                '#c9d9ec',
                '#e3c9e6',
                '#f6e3a0',
                '#d9c3a0',
              ][i],
              0.8,
              OL,
              0.4,
            ) +
            line(
              `M${x + 4} ${y + 5} L${x + 20} ${y + 5} M${x + 4} ${y + 8.5} L${x + 15} ${y + 8.5}`,
              '#8a6a4a',
              0.5,
            ) +
            circ(x + 14, y + 0.8, 1, '#b84a3e'),
        )
        .join('') +
      line(
        'M40 16.5 L52 16.5 M80 16.5 L92 16.5 M26 23 L26 28 M66 23 L66 28 M106 23 L106 28',
        '#b84a3e',
        0.8,
      ),
  ],
  'tool-board': [
    140,
    36,
    () =>
      rect(1, 1, 138, 34, '#d6b07c', 1.5) +
      range(6, 136, 6)
        .map((x) =>
          range(6, 32, 6)
            .map((y) => circ(x, y, 0.5, '#9a7a52', null))
            .join(''),
        )
        .join('') +
      path('M14 6 L17 6 L16.6 22 L14.4 22 Z', '#8d96a1') +
      circ(15.5, 25, 3, 'none', '#8d96a1', 1.4) +
      rect(30, 6, 3, 14, '#c96f5f', 1) +
      rect(30.8, 20, 1.4, 9, '#8d96a1') +
      rect(46, 6, 14, 4, '#7b838d', 1) +
      rect(52, 10, 2.4, 18, WOOD, 0.6) +
      path('M70 8 L92 8 L92 18 L70 22 Z', '#d9dde3') +
      rect(92, 7, 6, 12, WOOD, 1) +
      circ(112, 16, 6, '#e2a93b') +
      circ(112, 16, 2.4, '#c18a25') +
      rect(124, 6, 4, 20, '#4f7bbd', 1.5),
  ],
  'verification-chart': [
    68,
    34,
    () =>
      rect(1, 1, 66, 32, '#fbf1dc', 1.5) +
      rect(1, 1, 66, 6, '#8aa07a', 1.5) +
      [11, 17, 23]
        .map(
          (y, i) =>
            line(`M6 ${y} L44 ${y}`, '#b9a07c', 0.6) +
            (i < 2
              ? line(`M50 ${y} l1.5 1.5 l3 -3.5`, '#3f8a4f', 0.9)
              : rect(49.5, y - 2, 4, 4, 'none', 0.5, OL, 0.4)),
        )
        .join('') +
      rect(6, 27, 56, 3, '#e8dcc0', 1.5, OL, 0.35) +
      rect(6, 27, 38, 3, '#7fae64', 1.5, null),
  ],
  'wall-lamp-single-on': [
    22,
    26,
    () =>
      rect(9, 14, 4, 10, BRASS, 1) +
      path('M11 16 Q4 15 4 9', 'none', BRASS, 1.2) +
      path('M0.5 9 L7.5 9 L6 2 L2 2 Z', '#fff3c4') +
      circ(4, 6, 5.5, '#ffe9a0', null, 0, ' opacity="0.35"'),
  ],
  'wall-lamp-dual-on': [
    48,
    28,
    () =>
      rect(21, 16, 6, 10, BRASS, 1.5) +
      path('M24 18 Q10 18 9 10 M24 18 Q38 18 39 10', 'none', BRASS, 1.2) +
      path('M5 10 L13 10 L11.5 3 L6.5 3 Z', '#fff3c4') +
      path('M35 10 L43 10 L41.5 3 L36.5 3 Z', '#fff3c4') +
      circ(9, 7, 6, '#ffe9a0', null, 0, ' opacity="0.35"') +
      circ(39, 7, 6, '#ffe9a0', null, 0, ' opacity="0.35"'),
  ],
  'switch-on': [
    6,
    10,
    () =>
      rect(0.5, 0.5, 5, 9, '#f4efe6', 1, OL, 0.35) +
      rect(2.2, 2.2, 1.6, 3, '#d9a441', 0.5, OL, 0.25) +
      circ(3, 8, 0.4, '#a58a6a', null),
  ],
  doorway: [
    44,
    64,
    () =>
      rect(0, 0, 44, 64, '#6b4329', 2) +
      rect(4, 6, 36, 58, KEY, 0, null) +
      rect(0, 0, 44, 6, '#7a4e32', 2) +
      rect(14, 1.5, 16, 3, '#c08a58', 1, OL, 0.3) +
      line('M2 10 L2 62 M42 10 L42 62', '#8a5a3a', 0.6),
  ],
};

function propSvg(name) {
  const [w, h, draw] = PROPS[name];
  return { w, h, body: draw() };
}

// ----------------------------------------------------------------- output
async function renderRoom(id) {
  const { w, h, body } = roomSvg(id);
  const W = 1536;
  const H = 1024;
  const scale = Math.min(W / w, H / h);
  const left = (W - w * scale) / 2;
  const top = (H - h * scale) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#1b1410"/>
<g transform="translate(${n(left)} ${n(top)}) scale(${n(scale)})">${body}</g></svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(OUT, 'rooms', `${id}.png`));
  return {
    id,
    world: ROOMS[id].rect,
    canvas: [W, H],
    placed: [n(left), n(top), n(w * scale), n(h * scale)],
  };
}

async function renderProp(name) {
  const { w, h, body } = propSvg(name);
  const S = 1024;
  const scale = (S * 0.78) / Math.max(w, h);
  const left = (S - w * scale) / 2;
  const top = (S - h * scale) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
<rect width="${S}" height="${S}" fill="${KEY}"/>
<g transform="translate(${n(left)} ${n(top)}) scale(${n(scale)})">${body}</g></svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(OUT, 'props', `${name}.png`));
  return {
    name,
    footprint: [w, h],
    placed: [n(left), n(top), n(w * scale), n(h * scale)],
  };
}

await mkdir(resolve(OUT, 'rooms'), { recursive: true });
await mkdir(resolve(OUT, 'props'), { recursive: true });
const layout = { rooms: [], props: [] };
for (const id of Object.keys(ROOMS)) layout.rooms.push(await renderRoom(id));
for (const name of Object.keys(PROPS))
  layout.props.push(await renderProp(name));
await writeFile(
  resolve(OUT, 'layout.json'),
  `${JSON.stringify(layout, null, 2)}\n`,
);
console.log(`rooms ${layout.rooms.length}, props ${layout.props.length}`);
