import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourceRoot = path.resolve('design/hive-ui-v1/sources');
const outputRoot = path.resolve('public/assets/ui/hive-v1');
await fs.mkdir(path.join(outputRoot, 'icons'), { recursive: true });

// Export generated production art; no painted pixels or backgrounds are added.
// Low-alpha generation residue is excluded from the crop measurement only.
function visibleBounds(data, width, height, channels) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + channels - 1] < 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('Generated asset has no visible content');
  left = Math.max(0, left - 3);
  top = Math.max(0, top - 3);
  right = Math.min(width - 1, right + 3);
  bottom = Math.min(height - 1, bottom + 3);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const manifest = { source: 'built-in image_gen', assets: [] };
for (const [name, width] of [
  ['title-sign', 768],
  ['tool-tray', 768],
  ['resident-ledger', 480],
  ['button-face', 192],
]) {
  const input = path.join(sourceRoot, `${name}.png`);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = visibleBounds(data, info.width, info.height, info.channels);
  const output = path.join(outputRoot, `${name}.png`);
  await sharp(input)
    .extract(bounds)
    .resize({ width, kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toFile(output);
  const metadata = await sharp(output).metadata();
  manifest.assets.push({
    name,
    source: `${name}.png`,
    sourceWidth: info.width,
    sourceHeight: info.height,
    crop: bounds,
    width: metadata.width,
    height: metadata.height,
  });
}

const names = [
  'residents',
  'journal',
  'research',
  'dispatch',
  'plus',
  'minus',
  'home',
  'follow',
  'sound-on',
  'sound-off',
  'labels',
  'keyboard',
  'eye-open',
  'eye-closed',
  'close',
  'next',
];
const atlas = path.join(sourceRoot, 'icon-atlas.png');
const metadata = await sharp(atlas).metadata();
for (let index = 0; index < names.length; index += 1) {
  const col = index % 4,
    row = Math.floor(index / 4);
  // These two rows cross the nominal first grid line by a few pixels. Cut
  // through their measured transparent gutter to preserve complete silhouettes.
  const columns = [
    0,
    row === 0 || row === 2 ? 326 : Math.round(metadata.width / 4),
    Math.round(metadata.width / 2),
    Math.round((metadata.width * 3) / 4),
    metadata.width,
  ];
  const left = columns[col],
    top = Math.round((row * metadata.height) / 4);
  const width = columns[col + 1] - left;
  const height = Math.round(((row + 1) * metadata.height) / 4) - top;
  const cell = await sharp(atlas)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  const { data, info } = await sharp(cell)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = visibleBounds(data, width, height, info.channels);
  const output = path.join(outputRoot, 'icons', `${names[index]}.png`);
  await sharp(cell)
    .extract(bounds)
    .resize(112, 112, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'nearest',
    })
    .extend({
      top: 8,
      right: 8,
      bottom: 8,
      left: 8,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(output);
  manifest.assets.push({
    name: names[index],
    source: 'icon-atlas.png',
    cell: { left, top, width, height },
    crop: bounds,
    width: 128,
    height: 128,
  });
}
await fs.writeFile(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Exported ${manifest.assets.length} transparent UI assets to ${outputRoot}`,
);
