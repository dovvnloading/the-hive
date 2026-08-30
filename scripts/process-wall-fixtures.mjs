import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const projectRoot = process.cwd();
const generatedRoot = path.join(
  projectRoot,
  'public',
  'assets',
  'facility-v3',
  'generated',
);

const fixtures = [
  {
    source: 'sources/command-routing-board-source-v1.png',
    output: 'command-routing-board-v1.png',
    size: [132, 52],
    removeNeutralBackground: true,
  },
  {
    source: 'sources/utility-tools-board-source-v1.png',
    output: 'utility-tools-board-v1.png',
    size: [140, 36],
    removeNeutralBackground: false,
  },
  {
    source: 'sources/wall-light-dual-source-v1.png',
    output: 'wall-light-dual-v1.png',
    size: [48, 28],
    removeNeutralBackground: false,
  },
  {
    source: 'sources/wall-light-dual-off-source-v1.png',
    output: 'wall-light-dual-off-v1.png',
    size: [48, 28],
    removeNeutralBackground: true,
  },
  {
    source: 'sources/wall-light-single-source-v1.png',
    output: 'wall-light-single-v1.png',
    size: [22, 26],
    removeNeutralBackground: false,
  },
  {
    source: 'sources/wall-light-single-off-source-v1.png',
    output: 'wall-light-single-off-v1.png',
    size: [22, 26],
    removeNeutralBackground: true,
  },
  {
    source: 'sources/doorway-front-source-v1.png',
    output: 'doorway-front-v1.png',
    size: [44, 64],
    removeNeutralBackground: false,
  },
  {
    source: 'sources/build-verification-chart-source-v1.png',
    output: 'build-verification-chart-v1.png',
    size: [68, 34],
    removeNeutralBackground: false,
  },
];

function neutralBackdropPixel(data, index) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  const brightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);
  return alpha <= 8 || (darkest >= 174 && brightest - darkest <= 24);
}

function clearConnectedBackdrop(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enqueue = (index) => {
    if (visited[index] || !neutralBackdropPixel(data, index)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) data[index * 4 + 3] = 0;
  }
}

function alphaBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error('Generated fixture contains no visible pixels.');
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

for (const fixture of fixtures) {
  const sourcePath = path.join(generatedRoot, fixture.source);
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (fixture.removeNeutralBackground) {
    clearConnectedBackdrop(data, info.width, info.height);
  }

  const bounds = alphaBounds(data, info.width, info.height);
  const [width, height] = fixture.size;
  const processed = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .extract(bounds)
    .resize(width, height, {
      fit: 'contain',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .sharpen({ sigma: 0.55, m1: 0.7, m2: 1.25 })
    .png({ palette: true, colours: 96, dither: 0, effort: 10 })
    .toBuffer();

  await fs.writeFile(path.join(generatedRoot, fixture.output), processed);
}

console.log(`Processed ${fixtures.length} generated wall fixtures.`);
