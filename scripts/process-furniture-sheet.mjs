import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const projectRoot = process.cwd();
const furnitureRoot = path.join(
  projectRoot,
  'public',
  'assets',
  'facility-v4',
  'furniture',
);
const sourcePath = path.join(
  furnitureRoot,
  'furniture-sheet-v2-transparent.png',
);

const sprites = [
  { name: 'research-desk', cell: [0, 0], size: [62, 40] },
  { name: 'utility-workstation', cell: [1, 0], size: [62, 40] },
  { name: 'build-workbench', cell: [2, 0], size: [70, 40] },
  { name: 'verification-desk', cell: [3, 0], size: [62, 40] },
  { name: 'writing-desk', cell: [0, 1], size: [50, 38] },
  { name: 'planning-table', cell: [1, 1], size: [54, 40] },
  { name: 'chair-south', cell: [2, 1], size: [20, 30] },
  { name: 'chair-north', cell: [3, 1], size: [20, 32] },
  { name: 'chair-east', cell: [0, 2], size: [22, 32] },
  { name: 'chair-west', cell: [1, 2], size: [22, 32] },
  { name: 'reading-armchair', cell: [2, 2], size: [30, 38] },
  { name: 'lounge-couch', cell: [3, 2], size: [52, 38] },
  { name: 'bookshelf-empty', cell: [0, 3], size: [50, 64] },
  { name: 'bookshelf-filled', cell: [1, 3], size: [50, 64] },
  { name: 'sideboard', cell: [2, 3], size: [46, 34] },
  { name: 'wall-shelf', cell: [3, 3], size: [48, 28] },
];

function alphaBounds(data, width, height, channels) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error('Sprite cell contains no visible pixels.');
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

const source = sharp(sourcePath, { failOn: 'error' }).ensureAlpha();
const metadata = await source.metadata();
if (!metadata.width || !metadata.height) {
  throw new Error('Furniture sheet dimensions are unavailable.');
}

for (const sprite of sprites) {
  const [column, row] = sprite.cell;
  const cellLeft = Math.round((column * metadata.width) / 4);
  const cellTop = Math.round((row * metadata.height) / 4);
  const cellRight = Math.round(((column + 1) * metadata.width) / 4);
  const cellBottom = Math.round(((row + 1) * metadata.height) / 4);
  const cellWidth = cellRight - cellLeft;
  const cellHeight = cellBottom - cellTop;

  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .extract({
      left: cellLeft,
      top: cellTop,
      width: cellWidth,
      height: cellHeight,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(data, info.width, info.height, info.channels);
  const [targetWidth, targetHeight] = sprite.size;

  const cropped = await sharp(sourcePath)
    .ensureAlpha()
    .extract({
      left: cellLeft + bounds.left,
      top: cellTop + bounds.top,
      width: bounds.width,
      height: bounds.height,
    })
    .resize(targetWidth, targetHeight, {
      fit: 'contain',
      position: 'bottom',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .sharpen({ sigma: 0.6, m1: 0.7, m2: 1.4 })
    .png({
      palette: true,
      colours: 64,
      dither: 0,
      effort: 10,
    })
    .toBuffer();

  await fs.writeFile(path.join(furnitureRoot, `${sprite.name}.png`), cropped);
}

await fs.writeFile(
  path.join(furnitureRoot, 'manifest.json'),
  `${JSON.stringify(
    {
      sheet: 'furniture-sheet-v2-transparent.png',
      grid: { columns: 4, rows: 4 },
      processing: {
        resampling: 'lanczos3',
        paletteColours: 64,
        dither: 0,
        bottomAligned: true,
      },
      sprites,
    },
    null,
    2,
  )}\n`,
);

console.log(`Processed ${sprites.length} furniture sprites from ${sourcePath}.`);
