#!/usr/bin/env node
/**
 * Draws the original resident character sheets in public/assets/residents-v1/.
 *
 * Every frame is authored here as SVG in sprite units (a 16 x 32 standing frame,
 * a 32 x 32 seated frame) and rasterized at SCALE pixels per unit, so the sheets
 * keep the exact frame layout the renderer already slices:
 *
 *   idle_anim.png, run.png  24 frames: east 0-5, north 6-11, west 12-17, south 18-23
 *   phone.png               9 frames facing south
 *   sit.png, sit2.png       12 frames of 32 x 32: east 0-5, west 6-11
 *
 * Usage: node scripts/generate-resident-sprites.mjs [--preview out.png]
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import sharp from 'sharp';

const OUT = fileURLToPath(
  new URL('../public/assets/residents-v1/', import.meta.url),
);
const SCALE = 8;
const OL = '#3d2b2e';
const SW = 0.5;
const EYE = '#2c1f26';
const BLUSH = '#f0857f';

export const CAST = [
  {
    id: 'maple',
    skin: '#f7d4b8',
    skinShade: '#e8b394',
    hair: '#7c4a2d',
    hairShade: '#5d3420',
    hairLight: '#a8714a',
    hairStyle: 'curly',
    top: '#e6aa3d',
    topShade: '#c48a27',
    inner: '#fcf2dd',
    sleeve: '#e6aa3d',
    outfit: 'cardigan',
    pants: '#6d4c37',
    pantsShade: '#563a29',
    shoes: '#45302a',
  },
  {
    id: 'fern',
    skin: '#f5d0ae',
    skinShade: '#e3b18b',
    hair: '#eac46d',
    hairShade: '#c99c45',
    hairLight: '#f8e3a4',
    hairStyle: 'long',
    top: '#8fb57b',
    topShade: '#6f935e',
    inner: '#9a6a40',
    sleeve: '#8fb57b',
    outfit: 'tunic',
    pants: '#566046',
    pantsShade: '#434b36',
    shoes: '#6b4630',
  },
  {
    id: 'juniper',
    skin: '#e3aa80',
    skinShade: '#c98d63',
    hair: '#d9672f',
    hairShade: '#ad4b20',
    hairLight: '#f19459',
    hairStyle: 'short',
    top: '#f4d466',
    topShade: '#d8b444',
    inner: '#4f7bbd',
    sleeve: '#f4d466',
    outfit: 'overalls',
    pants: '#4f7bbd',
    pantsShade: '#3d6299',
    shoes: '#3f3a44',
  },
  {
    id: 'bram',
    skin: '#8f5b3c',
    skinShade: '#74462d',
    hair: '#2f2934',
    hairShade: '#1e1a22',
    hairLight: '#5a5163',
    hairStyle: 'neat',
    top: '#8c4a70',
    topShade: '#6f3858',
    inner: '#f5f0e7',
    sleeve: '#f5f0e7',
    outfit: 'vest',
    pants: '#3a425c',
    pantsShade: '#2c3349',
    shoes: '#2a2328',
  },
  {
    id: 'clover',
    skin: '#fbe1cd',
    skinShade: '#efc4a8',
    hair: '#f3a2b7',
    hairShade: '#d67d96',
    hairLight: '#fcd0dc',
    hairStyle: 'bun',
    top: '#aa9ce2',
    topShade: '#8b7cc7',
    inner: '#fff6e8',
    sleeve: '#aa9ce2',
    outfit: 'sweater',
    pants: '#5f4f7f',
    pantsShade: '#4a3d65',
    shoes: '#5a3f3a',
  },
  {
    id: 'ollie',
    skin: '#bb815a',
    skinShade: '#9d6845',
    hair: '#3b2a22',
    hairShade: '#2a1d17',
    hairLight: '#5d453a',
    hairStyle: 'beanie',
    top: '#405c8c',
    topShade: '#314871',
    inner: '#f3ede2',
    sleeve: '#405c8c',
    outfit: 'hoodie',
    pants: '#b89e74',
    pantsShade: '#9a825c',
    shoes: '#3b3236',
    hat: '#d9544f',
    hatShade: '#b03f3c',
  },
];

// ---------------------------------------------------------------- primitives
const n = (value) => Number(value.toFixed(3));
let clipSerial = 0;

function paint(fill, stroke = OL, width = SW, extra = '') {
  const strokeAttrs = stroke
    ? ` stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`
    : '';
  return `fill="${fill}"${strokeAttrs}${extra}`;
}
const ell = (cx, cy, rx, ry, fill, stroke, width, extra) =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${paint(fill, stroke, width, extra)}/>`;
const circ = (cx, cy, r, fill, stroke, width, extra) =>
  ell(cx, cy, r, r, fill, stroke, width, extra);
const rect = (x, y, w, h, r, fill, stroke, width, extra) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ${paint(fill, stroke, width, extra)}/>`;
const path = (d, fill, stroke, width, extra) =>
  `<path d="${d}" ${paint(fill, stroke, width, extra)}/>`;
const line = (d, stroke, width = 0.35, extra = '') =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const group = (transform, body) => `<g transform="${transform}">${body}</g>`;
const at = (dx, dy, body) => group(`translate(${n(dx)} ${n(dy)})`, body);
const turn = (angle, x, y, body) =>
  group(`rotate(${n(angle)} ${n(x)} ${n(y)})`, body);

/** Paints `content` only inside `shape` (an SVG element string). */
function clipped(shape, content) {
  const id = `c${(clipSerial += 1)}`;
  return `<clipPath id="${id}">${shape}</clipPath><g clip-path="url(#${id})">${content}</g>`;
}

/** Template tag that rounds every interpolated number in a path string. */
const d = (strings, ...values) =>
  strings.reduce(
    (out, part, index) =>
      out +
      part +
      (index < values.length
        ? typeof values[index] === 'number'
          ? n(values[index])
          : values[index]
        : ''),
    '',
  );

// --------------------------------------------------------------- body parts
function torsoShape(b, side) {
  return side
    ? d`M5.6 ${21 + b} C5.2 ${23.5 + b} 5 26 5 27.4 Q8.2 28.5 11.4 27.4 C11.4 26 11.2 ${23.5 + b} 10.8 ${21 + b} Q8.2 ${19.8 + b} 5.6 ${21 + b} Z`
    : d`M4.4 ${21 + b} C4 ${23.5 + b} 3.8 26 3.8 27.4 Q8 28.7 12.2 27.4 C12.2 26 12 ${23.5 + b} 11.6 ${21 + b} Q8 ${19.6 + b} 4.4 ${21 + b} Z`;
}

function torso(c, b, view) {
  const side = view === 'east';
  const shape = torsoShape(b, side);
  const plain = path(shape, c.top, null);
  let detail = '';
  const hem = rect(0, 26.7, 16, 2.4, 0, c.topShade, null);
  if (c.outfit === 'cardigan') {
    detail +=
      view === 'south'
        ? path(
            d`M6.9 ${20.6 + b} L9.1 ${20.6 + b} L8.7 28.4 L7.3 28.4 Z`,
            c.inner,
            null,
          ) +
          line(d`M6.9 ${20.8 + b} L7.3 28.2`, c.topShade, 0.3) +
          line(d`M9.1 ${20.8 + b} L8.7 28.2`, c.topShade, 0.3) +
          circ(9.6, 23.4 + b, 0.3, '#8a5a2e', null) +
          circ(9.5, 25.4 + b * 0.5, 0.3, '#8a5a2e', null)
        : view === 'east'
          ? rect(10.1, 20.8 + b, 0.9, 7.4, 0.3, c.inner, null)
          : '';
    detail += hem;
  } else if (c.outfit === 'tunic') {
    detail += rect(0, 24.7 + b * 0.5, 16, 0.8, 0, '#9a6a40', null);
    if (view === 'south')
      detail += line(d`M11.4 ${21.2 + b} L5.2 26.4`, '#7b4f2c', 0.75);
    if (view === 'north')
      detail += line(d`M4.6 ${21.2 + b} L10.8 26.4`, '#7b4f2c', 0.75);
    if (view === 'east')
      detail += line(d`M9.6 ${21 + b} L5.6 25.4`, '#7b4f2c', 0.75);
    detail += rect(0, 27.1, 16, 2, 0, c.topShade, null);
  } else if (c.outfit === 'overalls') {
    if (view === 'south') {
      detail +=
        rect(5.4, 23.2 + b * 0.5, 5.2, 5.4, 0.6, c.inner, null) +
        line(d`M5.9 ${23.4 + b * 0.5} L5.2 ${20.9 + b}`, c.inner, 0.9) +
        line(d`M10.1 ${23.4 + b * 0.5} L10.8 ${20.9 + b}`, c.inner, 0.9) +
        circ(6.2, 23.9 + b * 0.5, 0.32, '#f8e08a', null) +
        circ(9.8, 23.9 + b * 0.5, 0.32, '#f8e08a', null) +
        rect(6.9, 24.9 + b * 0.5, 2.2, 1.4, 0.3, c.pantsShade, null);
    } else if (view === 'north') {
      detail +=
        rect(3.6, 25.4, 8.8, 3.4, 0.4, c.inner, null) +
        line(d`M5 ${21 + b} L11 25.6`, c.inner, 0.9) +
        line(d`M11 ${21 + b} L5 25.6`, c.inner, 0.9);
    } else {
      detail +=
        rect(8.3, 23 + b * 0.5, 3.3, 5.6, 0.5, c.inner, null) +
        rect(4.6, 25.6, 7, 3.2, 0.3, c.inner, null) +
        line(d`M9.6 ${23.2 + b * 0.5} L8.6 ${20.8 + b}`, c.inner, 0.9);
    }
  } else if (c.outfit === 'vest') {
    const vest =
      view === 'south'
        ? d`M3.6 ${21.4 + b} L6.6 ${21 + b} L8 ${24.4 + b * 0.5} L9.4 ${21 + b} L12.4 ${21.4 + b} L12.6 28.6 L3.4 28.6 Z`
        : view === 'north'
          ? d`M3.4 ${20.6 + b} L12.6 ${20.6 + b} L12.6 28.6 L3.4 28.6 Z`
          : d`M4.6 ${20.6 + b} L10 ${20.8 + b} L10.9 ${23.4 + b} L11.6 28.6 L4.6 28.6 Z`;
    detail += path(vest, c.top, null);
    if (view === 'south')
      detail +=
        path(
          d`M6.4 ${20.7 + b} L8 ${22.4 + b} L7.2 ${22.9 + b} Z`,
          c.inner,
          OL,
          0.25,
        ) +
        path(
          d`M9.6 ${20.7 + b} L8 ${22.4 + b} L8.8 ${22.9 + b} Z`,
          c.inner,
          OL,
          0.25,
        ) +
        circ(8, 25.6 + b * 0.5, 0.28, '#f2d7a0', null) +
        circ(8, 27 + b * 0.25, 0.28, '#f2d7a0', null);
    if (view === 'east')
      detail += path(
        d`M9.4 ${20.6 + b} L11 ${21.2 + b} L10.2 ${22.2 + b} Z`,
        c.inner,
        OL,
        0.25,
      );
    detail += rect(0, 27.4, 16, 2, 0, c.topShade, null);
  } else if (c.outfit === 'sweater') {
    if (view === 'south')
      detail +=
        path(
          d`M5.4 ${20.8 + b} Q6.4 ${23.2 + b} 8 ${21.6 + b} Q9.6 ${23.2 + b} 10.6 ${20.8 + b} Q8 ${20.2 + b} 5.4 ${20.8 + b} Z`,
          c.inner,
          OL,
          0.3,
        ) +
        path(
          d`M8 ${24.2 + b * 0.5} c-0.5 -0.6 -1.3 -0.1 -0.9 0.5 L8 ${25.6 + b * 0.5} L8.9 ${24.7 + b * 0.5} c0.4 -0.6 -0.4 -1.1 -0.9 -0.5 Z`,
          '#f6c1cf',
          null,
        );
    if (view === 'east')
      detail += path(
        d`M8.6 ${20.6 + b} Q10.4 ${22.6 + b} 11.2 ${21 + b} Z`,
        c.inner,
        OL,
        0.3,
      );
    detail += rect(0, 26.9, 16, 0.9, 0, c.topShade, null);
    detail += rect(0, 27.8, 16, 2, 0, c.topShade, null);
  } else if (c.outfit === 'hoodie') {
    if (view === 'south')
      detail +=
        line(d`M7.1 ${21.4 + b} L7 ${23.8 + b}`, c.inner, 0.35) +
        line(d`M8.9 ${21.4 + b} L9 ${23.8 + b}`, c.inner, 0.35) +
        rect(5.4, 25 + b * 0.4, 5.2, 2.3, 0.9, c.topShade, null);
    if (view === 'east')
      detail += rect(8.4, 25 + b * 0.4, 2.9, 2.2, 0.8, c.topShade, null);
    detail += rect(0, 27.3, 16, 2, 0, c.topShade, null);
  }
  return (
    clipped(path(shape, '#000', null), plain + detail) + path(shape, 'none')
  );
}

function hood(c, b, view) {
  if (c.outfit !== 'hoodie') return '';
  if (view === 'north')
    return path(
      d`M4.4 ${19.6 + b} Q8 ${18.4 + b} 11.6 ${19.6 + b} Q12 ${23.6 + b} 8 ${24.2 + b} Q4 ${23.6 + b} 4.4 ${19.6 + b} Z`,
      c.topShade,
    );
  if (view === 'east')
    return path(
      d`M4.2 ${19.8 + b} Q6.4 ${18.8 + b} 8 ${20.4 + b} Q7.6 ${23.4 + b} 5.2 ${23.2 + b} Q3.8 ${22 + b} 4.2 ${19.8 + b} Z`,
      c.topShade,
    );
  return '';
}

function arm(c, x, shoulderY, angle, shade = false, lift = 0) {
  const sleeve = shade ? shadeOf(c.sleeve, c) : c.sleeve;
  const hand = shade ? c.skinShade : c.skin;
  return turn(
    angle,
    x,
    shoulderY,
    ell(x, shoulderY + 2.2 + lift, 1.05, 2.4, sleeve) +
      circ(x, shoulderY + 4.6 + lift, 0.88, hand),
  );
}

function shadeOf(color, c) {
  if (color === c.top) return c.topShade;
  if (color === c.inner) return '#d9d0c2';
  return color;
}

function legsFront(c, liftL, liftR) {
  let out = '';
  for (const [x, lift] of [
    [5, liftL],
    [8.4, liftR],
  ]) {
    const top = 26.2;
    const bottom = 30.5 - lift;
    out += rect(x, top, 2.6, bottom - top, 1, c.pants);
    out += ell(x + 1.3, bottom + 0.2, 1.7, 0.95, c.shoes);
  }
  return out;
}

function legSide(c, angle, far) {
  return turn(
    angle,
    8.2,
    26.4,
    rect(7, 26, 2.4, 4.6, 1, far ? c.pantsShade : c.pants) +
      ell(8.7, 30.75, 1.75, 0.95, far ? shadeOf(c.shoes, c) : c.shoes),
  );
}

// ------------------------------------------------------------------- heads
function puffs(cx, cy, rx, ry, angles, r, fill) {
  return angles
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return circ(cx + rx * Math.cos(rad), cy + ry * Math.sin(rad), r, fill);
    })
    .join('');
}

function eyesFront(y, look = 'open') {
  if (look === 'down') {
    return (
      line(d`M4.9 ${y + 0.4} Q5.7 ${y + 1} 6.5 ${y + 0.4}`, EYE, 0.45) +
      line(d`M9.5 ${y + 0.4} Q10.3 ${y + 1} 11.1 ${y + 0.4}`, EYE, 0.45)
    );
  }
  return [5.7, 10.3]
    .map(
      (x) =>
        ell(x, y, 0.8, 1.02, EYE, null) +
        circ(x - 0.26, y - 0.4, 0.33, '#ffffff', null) +
        circ(x + 0.28, y + 0.42, 0.14, '#ffffff', null, 0, ' opacity="0.8"'),
    )
    .join('');
}

function faceFront(c, y, look) {
  return (
    ell(4.3, y + 1.6, 0.95, 0.52, BLUSH, null, 0, ' opacity="0.5"') +
    ell(11.7, y + 1.6, 0.95, 0.52, BLUSH, null, 0, ' opacity="0.5"') +
    eyesFront(y, look) +
    line(d`M7.45 ${y + 2.05} Q8 ${y + 2.55} 8.55 ${y + 2.05}`, '#7a3a3e', 0.33)
  );
}

function headFront(c, b, look = 'open') {
  const y = b;
  const H = (dx, dy, body) => at(dx, dy, body);
  let behind = '';
  let cap = ell(8, 14.6 + y, 7.05, 6.4, c.hair);
  let front = '';
  const face = ell(8, 16.75 + y, 5.4, 4.5, c.skin);
  const eyeY = 16.45 + y;
  const shine = line(
    d`M4.1 ${11 + y} Q5.6 ${9.7 + y} 7.6 ${9.6 + y}`,
    c.hairLight,
    0.6,
    ' opacity="0.85"',
  );

  if (c.hairStyle === 'curly') {
    cap =
      puffs(
        8,
        14.6 + y,
        6.4,
        5.6,
        [-200, -170, -140, -110, -70, -40, -10, 20],
        1.9,
        c.hair,
      ) +
      puffs(8, 14.6 + y, 6.4, 5.6, [160], 1.9, c.hair) +
      ell(8, 14.6 + y, 6.6, 6, c.hair, null);
    front =
      [3.4, 5.1, 6.8, 8.5, 10.2, 11.9]
        .map((x, i) =>
          circ(
            x + 0.2,
            12.9 + y + (i % 2 ? 0.25 : -0.1),
            1.25,
            c.hair,
            OL,
            0.35,
          ),
        )
        .join('') +
      rect(2.6, 9.4 + y, 10.8, 3.6, 1.6, c.hair, null) +
      line(d`M4.4 ${10.6 + y} q0.8 -0.8 1.6 0`, c.hairShade, 0.35) +
      line(d`M9.4 ${10.2 + y} q0.8 -0.8 1.6 0`, c.hairShade, 0.35) +
      shine;
  } else if (c.hairStyle === 'long') {
    behind =
      path(
        d`M1.3 ${14 + y} C0.9 ${19 + y} 1.2 23.2 2.6 24.4 L13.4 24.4 C14.8 23.2 15.1 ${19 + y} 14.7 ${14 + y} Z`,
        c.hair,
      ) +
      line(d`M3.2 ${19 + y} L3.6 23.8`, c.hairShade, 0.35) +
      line(d`M12.8 ${19 + y} L12.4 23.8`, c.hairShade, 0.35);
    front =
      path(
        d`M1.6 ${15.8 + y} C1.3 ${10 + y} 4.6 ${8.2 + y} 8.2 ${8.2 + y} C11.7 ${8.2 + y} 14.7 ${10.2 + y} 14.5 ${15.4 + y} C13.5 ${13.4 + y} 12.2 ${12.5 + y} 10.4 ${12.4 + y} C8.4 ${12.3 + y} 6.3 ${13.1 + y} 4.6 ${14.6 + y} C3.6 ${15.5 + y} 2.6 ${16.3 + y} 1.6 ${15.8 + y} Z`,
        c.hair,
      ) +
      path(
        d`M1.5 ${15 + y} C1.4 ${18 + y} 1.9 ${20.6 + y} 2.9 ${22.2 + y} C3.6 ${20.4 + y} 3.7 ${17.6 + y} 3.4 ${14.8 + y} Z`,
        c.hair,
      ) +
      path(
        d`M14.5 ${15 + y} C14.6 ${18 + y} 14.1 ${20.6 + y} 13.1 ${22.2 + y} C12.4 ${20.4 + y} 12.3 ${17.6 + y} 12.6 ${14.8 + y} Z`,
        c.hair,
      ) +
      shine +
      H(
        11.8,
        11.2 + y,
        turn(
          -30,
          0,
          0,
          path('M-1.4 0 Q0 -1.3 1.4 0 Q0 1.3 -1.4 0 Z', '#6fa85a', OL, 0.3) +
            line('M-1 0 L1 0', '#4d7f3d', 0.2),
        ),
      );
  } else if (c.hairStyle === 'short') {
    cap = ell(8, 14.7 + y, 6.95, 6.25, c.hair);
    front =
      path(
        d`M2.1 ${15.2 + y} C1.9 ${10.2 + y} 4.8 ${8.5 + y} 8 ${8.5 + y} C11.2 ${8.5 + y} 14.1 ${10.2 + y} 13.9 ${15.2 + y} L12.7 ${12.9 + y} L11.5 ${14.2 + y} L10.4 ${12.7 + y} L9.2 ${14.1 + y} L8 ${12.6 + y} L6.8 ${14.1 + y} L5.6 ${12.7 + y} L4.5 ${14.2 + y} L3.3 ${12.9 + y} Z`,
        c.hair,
      ) +
      path(
        d`M1.2 ${12.4 + y} Q8 ${9.2 + y} 14.8 ${12.4 + y} L14.7 ${13.6 + y} Q8 ${10.5 + y} 1.3 ${13.6 + y} Z`,
        '#4b4049',
      ) +
      circ(5.8, 11.5 + y, 1.4, '#f2b84b') +
      circ(10.2, 11.5 + y, 1.4, '#f2b84b') +
      circ(5.4, 11.05 + y, 0.45, '#fff5d2', null) +
      circ(9.8, 11.05 + y, 0.45, '#fff5d2', null);
  } else if (c.hairStyle === 'neat') {
    front =
      path(
        d`M1.8 ${15.4 + y} C1.6 ${10 + y} 4.6 ${8.2 + y} 8 ${8.2 + y} C11.6 ${8.2 + y} 14.4 ${10.2 + y} 14.2 ${15.2 + y} C13.6 ${13.3 + y} 12.6 ${12.1 + y} 11 ${11.7 + y} C9.4 ${12.8 + y} 6.9 ${13.5 + y} 4.3 ${13.5 + y} C3.2 ${14 + y} 2.4 ${14.7 + y} 1.8 ${15.4 + y} Z`,
        c.hair,
      ) +
      line(
        d`M10.9 ${8.7 + y} Q10.3 ${10.2 + y} 11 ${11.6 + y}`,
        c.hairShade,
        0.4,
      ) +
      shine;
  } else if (c.hairStyle === 'bun') {
    behind = '';
    cap =
      circ(8, 8.3 + y, 2.55, c.hair) +
      line(d`M6.6 ${7.6 + y} q1.4 -1 2.8 0`, c.hairShade, 0.35) +
      ell(8, 14.6 + y, 7.05, 6.4, c.hair) +
      ell(8, 10.2 + y, 1.6, 0.55, '#fff0a6', OL, 0.3);
    front =
      path(
        d`M1.9 ${15.6 + y} C1.7 ${10.1 + y} 4.8 ${8.5 + y} 8 ${8.5 + y} C11.2 ${8.5 + y} 14.3 ${10.1 + y} 14.1 ${15.6 + y} C13.5 ${13.6 + y} 12.7 ${13.2 + y} 11.6 ${13.4 + y} Q9.8 ${12.2 + y} 8 ${13.4 + y} Q6.2 ${12.2 + y} 4.4 ${13.4 + y} C3.3 ${13.2 + y} 2.5 ${13.6 + y} 1.9 ${15.6 + y} Z`,
        c.hair,
      ) + shine;
  } else if (c.hairStyle === 'beanie') {
    cap = ell(8, 14.8 + y, 6.8, 6.1, c.hair);
    front =
      path(
        d`M5.2 ${13.6 + y} Q6.2 ${15.3 + y} 7.1 ${13.7 + y} Q8 ${15.4 + y} 8.9 ${13.7 + y} Q9.8 ${15.3 + y} 10.8 ${13.6 + y} Z`,
        c.hair,
        OL,
        0.35,
      ) +
      path(
        d`M1.3 ${13.8 + y} C1.1 ${8.6 + y} 4.5 ${6.6 + y} 8 ${6.6 + y} C11.5 ${6.6 + y} 14.9 ${8.6 + y} 14.7 ${13.8 + y} Z`,
        c.hat,
      ) +
      path(
        d`M1.1 ${12.3 + y} Q8 ${10.5 + y} 14.9 ${12.3 + y} L14.9 ${14.3 + y} Q8 ${12.6 + y} 1.1 ${14.3 + y} Z`,
        c.hatShade,
      ) +
      [3.2, 5.2, 7.2, 9.2, 11.2, 13]
        .map((x) =>
          line(
            d`M${x} ${11.9 + y - (x > 4 && x < 12 ? 0.5 : 0)} l0 1.5`,
            '#8f2f2d',
            0.3,
          ),
        )
        .join('') +
      circ(8, 6.3 + y, 1.65, '#f6efe3') +
      line(d`M3.6 ${9.6 + y} Q5.2 ${8.2 + y} 7.2 ${8 + y}`, '#ef8a84', 0.55);
  }

  return {
    behind,
    head: cap + face + faceFront(c, eyeY, look) + front + glassesFront(c, eyeY),
  };
}

function glassesFront(c, y) {
  if (c.hairStyle !== 'neat') return '';
  return (
    circ(5.7, y, 1.55, '#ffffff', '#2a2228', 0.38, ' fill-opacity="0.16"') +
    circ(10.3, y, 1.55, '#ffffff', '#2a2228', 0.38, ' fill-opacity="0.16"') +
    line(d`M7.25 ${y - 0.2} Q8 ${y - 0.65} 8.75 ${y - 0.2}`, '#2a2228', 0.35)
  );
}

function headBack(c, b) {
  const y = b;
  const ears =
    circ(1.5, 16.4 + y, 0.95, c.skin) + circ(14.5, 16.4 + y, 0.95, c.skin);
  const shine = line(
    d`M4.6 ${10.6 + y} Q7.6 ${8.9 + y} 11 ${10.2 + y}`,
    c.hairLight,
    0.6,
    ' opacity="0.8"',
  );
  const nape = line(
    d`M5.6 ${19.9 + y} Q8 ${20.8 + y} 10.4 ${19.9 + y}`,
    c.hairShade,
    0.4,
  );
  switch (c.hairStyle) {
    case 'curly':
      return (
        puffs(
          8,
          14.6 + y,
          6.4,
          5.6,
          [-200, -170, -140, -110, -70, -40, -10, 20, 50, 90, 130, 160],
          1.9,
          c.hair,
        ) +
        ell(8, 14.6 + y, 6.6, 6, c.hair, null) +
        circ(5.6, 13.4 + y, 1.3, 'none', c.hairShade, 0.35) +
        circ(10.2, 12.6 + y, 1.3, 'none', c.hairShade, 0.35) +
        circ(8, 17.4 + y, 1.3, 'none', c.hairShade, 0.35) +
        shine
      );
    case 'long':
      return (
        ell(8, 14.6 + y, 7.05, 6.4, c.hair) +
        path(
          d`M1.4 ${15 + y} C1 ${19 + y} 1.4 23.4 2.8 24.6 Q8 25.4 13.2 24.6 C14.6 23.4 15 ${19 + y} 14.6 ${15 + y} Z`,
          c.hair,
        ) +
        line(d`M5.4 ${17 + y} L5 24.4`, c.hairShade, 0.35) +
        line(d`M8 ${18 + y} L8 24.8`, c.hairShade, 0.35) +
        line(d`M10.6 ${17 + y} L11 24.4`, c.hairShade, 0.35) +
        shine +
        at(
          4.2,
          11.2 + y,
          turn(
            30,
            0,
            0,
            path('M-1.4 0 Q0 -1.3 1.4 0 Q0 1.3 -1.4 0 Z', '#6fa85a', OL, 0.3),
          ),
        )
      );
    case 'short':
      return (
        ears +
        ell(8, 14.7 + y, 6.95, 6.25, c.hair) +
        path(
          d`M1.2 ${12.4 + y} Q8 ${14.8 + y} 14.8 ${12.4 + y} L14.7 ${13.6 + y} Q8 ${16.1 + y} 1.3 ${13.6 + y} Z`,
          '#4b4049',
        ) +
        path(
          d`M5 ${20.2 + y} L6 ${19 + y} L7 ${20.4 + y} L8 ${19.1 + y} L9 ${20.4 + y} L10 ${19 + y} L11 ${20.2 + y}`,
          'none',
          c.hairShade,
          0.35,
        ) +
        shine
      );
    case 'neat':
      return ears + ell(8, 14.6 + y, 7.05, 6.4, c.hair) + nape + shine;
    case 'bun':
      return (
        ell(8, 14.6 + y, 7.05, 6.4, c.hair) +
        circ(8, 9 + y, 2.6, c.hair) +
        line(d`M6.6 ${8.4 + y} q1.4 -1 2.8 0`, c.hairShade, 0.35) +
        ell(8, 11.2 + y, 1.7, 0.6, '#fff0a6', OL, 0.3) +
        nape
      );
    case 'beanie':
      return (
        ears +
        ell(8, 14.8 + y, 6.8, 6.1, c.hair) +
        path(
          d`M1.3 ${14.2 + y} C1.1 ${8.6 + y} 4.5 ${6.6 + y} 8 ${6.6 + y} C11.5 ${6.6 + y} 14.9 ${8.6 + y} 14.7 ${14.2 + y} Z`,
          c.hat,
        ) +
        path(
          d`M1.1 ${12.6 + y} Q8 ${14.4 + y} 14.9 ${12.6 + y} L14.9 ${14.6 + y} Q8 ${16.4 + y} 1.1 ${14.6 + y} Z`,
          c.hatShade,
        ) +
        circ(8, 6.3 + y, 1.65, '#f6efe3') +
        line(d`M4.6 ${9.4 + y} Q7.6 ${7.9 + y} 10.6 ${9 + y}`, '#ef8a84', 0.55)
      );
    default:
      return '';
  }
}

function headSide(c, b, look = 'open') {
  const y = b;
  let behind = '';
  let cap = ell(8, 14.6 + y, 7, 6.4, c.hair);
  const face = ell(9.9, 16.8 + y, 4.95, 4.45, c.skin);
  let hair = path(
    d`M1 ${15 + y} C0.8 ${9.8 + y} 4.6 ${8.2 + y} 8.2 ${8.2 + y} C11.8 ${8.2 + y} 14.8 ${10.2 + y} 14.9 ${14.2 + y} C13.8 ${12.8 + y} 12.2 ${12.2 + y} 10.6 ${12.6 + y} C9.4 ${13 + y} 8.6 ${14.2 + y} 8.4 ${15.6 + y} C8.2 ${17.4 + y} 7 ${19.6 + y} 5.4 ${20.8 + y} C3.2 ${20.6 + y} 1.2 ${18.6 + y} 1 ${15 + y} Z`,
    c.hair,
  );
  let extra = '';
  const ear = ell(7.7, 17.1 + y, 0.95, 1.2, c.skin);
  const eyeY = 16.5 + y;
  const eye =
    look === 'down'
      ? line(
          d`M11.3 ${eyeY + 0.4} Q12 ${eyeY + 1} 12.7 ${eyeY + 0.4}`,
          EYE,
          0.45,
        )
      : ell(12, eyeY, 0.74, 1.02, EYE, null) +
        circ(11.76, eyeY - 0.4, 0.31, '#ffffff', null) +
        circ(12.25, eyeY + 0.42, 0.13, '#ffffff', null, 0, ' opacity="0.8"');
  const faceBits =
    ell(12.9, 18.25 + y, 0.85, 0.46, BLUSH, null, 0, ' opacity="0.5"') +
    eye +
    line(
      d`M13.4 ${18.75 + y} Q13.85 ${19.15 + y} 14.25 ${18.7 + y}`,
      '#7a3a3e',
      0.33,
    );
  const shine = line(
    d`M3.4 ${11.2 + y} Q5.4 ${9.4 + y} 8.2 ${9.3 + y}`,
    c.hairLight,
    0.6,
    ' opacity="0.85"',
  );

  if (c.hairStyle === 'curly') {
    cap =
      puffs(
        8,
        14.6 + y,
        6.4,
        5.6,
        [-200, -170, -140, -110, -70, -40, -10, 120, 150, 180],
        1.9,
        c.hair,
      ) + ell(8, 14.6 + y, 6.6, 6, c.hair, null);
    hair =
      path(
        d`M1.4 ${15 + y} C1.2 ${10 + y} 4.6 ${8.6 + y} 8.2 ${8.6 + y} C11.6 ${8.6 + y} 14.2 ${10.4 + y} 14.4 ${13.6 + y} C13.4 ${12.6 + y} 12 ${12.4 + y} 10.6 ${12.8 + y} C9.4 ${13.2 + y} 8.7 ${14.3 + y} 8.5 ${15.6 + y} C8.3 ${17.4 + y} 7.1 ${19.4 + y} 5.6 ${20.4 + y} C3.4 ${20.2 + y} 1.6 ${18.4 + y} 1.4 ${15 + y} Z`,
        c.hair,
        null,
      ) +
      circ(13.4, 13 + y, 1.3, c.hair, OL, 0.35) +
      circ(11.6, 12.6 + y, 1.3, c.hair, OL, 0.35) +
      circ(9.4, 13.8 + y, 1.25, c.hair, OL, 0.35) +
      circ(8.6, 16.2 + y, 1.2, c.hair, OL, 0.35) +
      circ(4.4, 13.4 + y, 1.3, 'none', c.hairShade, 0.35) +
      shine;
  } else if (c.hairStyle === 'long') {
    behind =
      path(
        d`M1.2 ${14 + y} C0.8 ${19 + y} 1.4 23.2 2.8 24.4 L8.8 24.4 L8.4 ${18 + y} Z`,
        c.hair,
      ) + line(d`M3.4 ${19 + y} L3.8 24`, c.hairShade, 0.35);
    hair += shine;
    extra = at(
      5.4,
      11 + y,
      turn(
        -20,
        0,
        0,
        path('M-1.4 0 Q0 -1.3 1.4 0 Q0 1.3 -1.4 0 Z', '#6fa85a', OL, 0.3),
      ),
    );
  } else if (c.hairStyle === 'short') {
    cap = ell(8, 14.7 + y, 6.95, 6.25, c.hair);
    hair = path(
      d`M1.2 ${15 + y} C1 ${10 + y} 4.6 ${8.4 + y} 8.2 ${8.4 + y} C11.6 ${8.4 + y} 14.6 ${10.2 + y} 14.7 ${13.9 + y} L13.4 ${12.8 + y} L12.6 ${14 + y} L11.4 ${12.6 + y} L10.4 ${14 + y} L9.6 ${13 + y} C8.9 ${14.4 + y} 8.6 ${16.4 + y} 7.8 ${18.6 + y} C6.6 ${20.4 + y} 2.8 ${20 + y} 1.2 ${15 + y} Z`,
      c.hair,
    );
    extra =
      path(
        d`M1 ${13.2 + y} Q7 ${10 + y} 13.8 ${11.2 + y} L13.9 ${12.5 + y} Q7 ${11.4 + y} 1.1 ${14.4 + y} Z`,
        '#4b4049',
      ) +
      circ(12.2, 11.7 + y, 1.4, '#f2b84b') +
      circ(11.8, 11.25 + y, 0.45, '#fff5d2', null);
  } else if (c.hairStyle === 'neat') {
    hair += shine;
    extra =
      circ(12, eyeY, 1.5, '#ffffff', '#2a2228', 0.38, ' fill-opacity="0.16"') +
      line(d`M10.5 ${eyeY - 0.2} L8.3 ${eyeY + 0.2}`, '#2a2228', 0.38);
  } else if (c.hairStyle === 'bun') {
    cap = circ(5.2, 8.8 + y, 2.5, c.hair) + ell(8, 14.6 + y, 7, 6.4, c.hair);
    extra = shine;
  } else if (c.hairStyle === 'beanie') {
    cap = ell(8, 14.8 + y, 6.8, 6.1, c.hair);
    hair =
      path(
        d`M1.6 ${14.6 + y} C1.4 ${16.8 + y} 3 ${19.6 + y} 5.6 ${20.2 + y} C7 ${19 + y} 8 ${16.8 + y} 8.4 ${14.6 + y} Z`,
        c.hair,
      ) +
      path(
        d`M12.2 ${13.6 + y} Q13.2 ${15.2 + y} 14.2 ${13.6 + y} Z`,
        c.hair,
        OL,
        0.3,
      );
    extra =
      path(
        d`M1.1 ${14 + y} C0.9 ${8.6 + y} 4.4 ${6.6 + y} 8.2 ${6.6 + y} C11.8 ${6.6 + y} 14.9 ${8.8 + y} 14.8 ${13.6 + y} Z`,
        c.hat,
      ) +
      path(
        d`M0.9 ${12.5 + y} Q8 ${10.8 + y} 15 ${12.1 + y} L15 ${14.1 + y} Q8 ${12.8 + y} 0.9 ${14.5 + y} Z`,
        c.hatShade,
      ) +
      circ(7, 6.4 + y, 1.65, '#f6efe3') +
      line(d`M3 ${9.8 + y} Q5 ${8.2 + y} 7.6 ${8 + y}`, '#ef8a84', 0.55);
  }
  return { behind, head: cap + face + faceBits + hair + ear + extra };
}

// ------------------------------------------------------------------ frames
function standingFrame(c, view, { bob = 0, phase = null, look = 'open' } = {}) {
  const b = bob;
  if (view === 'east') {
    const swing = phase === null ? 0 : Math.sin(phase);
    const legAngle = 30 * swing;
    const armAngle = -26 * swing;
    const { behind, head } = headSide(c, b, look);
    return (
      behind +
      legSide(c, -legAngle, true) +
      arm(c, 8.4, 21.6 + b, -armAngle * 0.9, true) +
      legSide(c, legAngle, false) +
      hood(c, b, view) +
      torso(c, b, view) +
      arm(c, 8.2, 21.6 + b, armAngle) +
      head
    );
  }
  const walking = phase !== null;
  const liftL = walking ? Math.max(0, Math.sin(phase)) * 0.9 : 0;
  const liftR = walking ? Math.max(0, -Math.sin(phase)) * 0.9 : 0;
  const swingL = walking ? -Math.sin(phase) * 0.45 : 0;
  const swingR = -swingL;
  if (view === 'north') {
    const long = c.hairStyle === 'long';
    const headPart = headBack(c, b);
    return (
      legsFront(c, liftL, liftR) +
      arm(c, 3.75, 21.6 + b, 8, false, swingL) +
      arm(c, 12.25, 21.6 + b, -8, false, swingR) +
      torso(c, b, view) +
      hood(c, b, view) +
      (long ? '' : '') +
      headPart
    );
  }
  const { behind, head } = headFront(c, b, look);
  return (
    behind +
    legsFront(c, liftL, liftR) +
    arm(c, 3.75, 21.6 + b, 8, false, swingL) +
    arm(c, 12.25, 21.6 + b, -8, false, swingR) +
    torso(c, b, view) +
    head
  );
}

function seatedFrame(c, { bob = 0, typing = null } = {}) {
  // East-facing seated pose in a 32 x 32 frame. The hip sits where the source
  // sheets placed it so chair overlays keep their calibrated alignment.
  const b = bob;
  const raise = typing === null ? 0 : -6;
  const { behind, head } = headSide(c, b);
  const thighs = (shade) =>
    rect(7.2, 25.4, 5.8, 2.6, 1.2, shade ? c.pantsShade : c.pants) +
    rect(10.7, 26.4, 2.5, 3.8, 1, shade ? c.pantsShade : c.pants) +
    ell(12.7, 30.3, 1.7, 0.95, c.shoes);
  const tap = typing === null ? 0 : typing;
  const nearArm =
    typing === null
      ? arm(c, 8.2, 21.6 + b, -42)
      : arm(c, 8.2, 21.6 + b, -78, false, tap);
  const farArm =
    typing === null
      ? arm(c, 8.6, 21.6 + b, -36, true)
      : arm(c, 8.6, 21.6 + b, -74, true, -tap * 0.8);
  return at(
    5.3,
    raise,
    behind +
      at(-0.5, -0.3, thighs(true)) +
      farArm +
      hood(c, b, 'east') +
      torso(c, b, 'east') +
      thighs(false) +
      nearArm +
      head,
  );
}

function phoneFrame(c, index) {
  const b = [0, -0.1, -0.15, -0.1, 0, 0, -0.1, -0.15, -0.1][index];
  const tap = [0, 0, -0.35, 0, 0, -0.35, 0, 0, -0.35][index];
  const glow = [0.85, 0.9, 1, 0.9, 0.85, 1, 0.9, 0.85, 1][index];
  const { behind, head } = headFront(c, b + 0.25, 'down');
  return (
    behind +
    legsFront(c, 0, 0) +
    torso(c, b, 'south') +
    arm(c, 3.9, 21.6 + b, -32) +
    arm(c, 12.1, 21.6 + b, 32) +
    rect(6.5, 22.1 + b, 3, 3.7, 0.55, '#3a3442') +
    rect(
      6.9,
      22.5 + b,
      2.2,
      2.6,
      0.3,
      '#9fe3ff',
      null,
      0,
      ` opacity="${glow}"`,
    ) +
    circ(6.6, 24.9 + b, 0.85, c.skin) +
    circ(9.4, 24.9 + b + tap, 0.85, c.skin) +
    head
  );
}

// ------------------------------------------------------------------ sheets
const IDLE_BOB = [0, -0.12, -0.25, -0.32, -0.22, -0.08];
const RUN_BOB = [0, -0.45, -0.15, 0, -0.45, -0.15];
const DIRECTIONS = ['east', 'north', 'west', 'south'];

function standingSheet(c, motion) {
  const frames = [];
  DIRECTIONS.forEach((direction, dirIndex) => {
    for (let i = 0; i < 6; i += 1) {
      const options =
        motion === 'run'
          ? { bob: RUN_BOB[i], phase: (Math.PI * 2 * i) / 6 }
          : { bob: IDLE_BOB[i] };
      const view = direction === 'west' ? 'east' : direction;
      const body = standingFrame(c, view, options);
      const x = (dirIndex * 6 + i) * 16;
      frames.push(
        direction === 'west'
          ? group(`translate(${x + 16} 0) scale(-1 1)`, body)
          : at(x, 0, body),
      );
    }
  });
  return { width: 384, body: frames.join('') };
}

function seatedSheet(c, typing) {
  const frames = [];
  for (let mirror = 0; mirror < 2; mirror += 1) {
    for (let i = 0; i < 6; i += 1) {
      const body = seatedFrame(c, {
        bob: IDLE_BOB[i] * 0.7,
        typing: typing ? [0, -0.35, 0, -0.35, 0, -0.35][i] : null,
      });
      const x = (mirror * 6 + i) * 32;
      frames.push(
        mirror
          ? group(`translate(${x + 32} 0) scale(-1 1)`, body)
          : at(x, 0, body),
      );
    }
  }
  return { width: 384, body: frames.join('') };
}

function phoneSheet(c) {
  return {
    width: 144,
    body: Array.from({ length: 9 }, (_, i) =>
      at(i * 16, 0, phoneFrame(c, i)),
    ).join(''),
  };
}

function svgDocument({ width, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${32 * SCALE}" viewBox="0 0 ${width} 32">${body}</svg>`;
}

export function sheetsFor(c) {
  return {
    idle_anim: standingSheet(c, 'idle'),
    run: standingSheet(c, 'run'),
    phone: phoneSheet(c),
    sit: seatedSheet(c, false),
    sit2: seatedSheet(c, true),
  };
}

async function rasterize(sheet) {
  return sharp(Buffer.from(svgDocument(sheet)))
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function main() {
  const previewIndex = process.argv.indexOf('--preview');
  const preview =
    previewIndex > 0 ? resolve(process.argv[previewIndex + 1]) : null;
  const rows = [];
  for (const c of CAST) {
    const dir = resolve(OUT, c.id);
    await mkdir(dir, { recursive: true });
    for (const [motion, sheet] of Object.entries(sheetsFor(c))) {
      const png = await rasterize(sheet);
      await sharp(png).toFile(resolve(dir, `${motion}.png`));
      if (
        preview &&
        (motion === 'idle_anim' || motion === 'run' || motion === 'sit2')
      )
        rows.push({ png, width: sheet.width * SCALE });
    }
    console.log(`resident ${c.id}: 5 sheets`);
  }
  if (preview) {
    const height = 32 * SCALE;
    const width = Math.max(...rows.map((row) => row.width));
    const board = await sharp({
      create: {
        width,
        height: height * rows.length,
        channels: 4,
        background: '#d9cdb4',
      },
    })
      .composite(
        rows.map((row, index) => ({
          input: row.png,
          left: 0,
          top: index * height,
        })),
      )
      .png()
      .toBuffer();
    await sharp(board)
      .resize({ width: Math.round(width / 2) })
      .toFile(preview);
    console.log(`preview ${preview}`);
  }
}

if (
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1].endsWith('generate-resident-sprites.mjs')
) {
  await main();
}
