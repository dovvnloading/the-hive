import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { writeReviewBoard } from './review-board.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(
  root,
  '../../../public/assets/homestead-v1/interiors',
);
const availableOnly = process.argv.includes('--available');
const sheets = [
  {
    name: 'architecture',
    columns: 2,
    rows: 2,
    items: [
      ['oak-floor', 320, 192],
      ['plaster-wall', 128, 64],
      ['oak-beam', 320, 32],
      ['woven-rug', 112, 63],
    ],
  },
  {
    name: 'tables',
    columns: 3,
    rows: 2,
    items: [
      ['utility-workstation', 54, 40],
      ['build-workbench', 70, 40],
      ['verification-desk', 62, 40],
      ['writing-desk', 50, 38],
      ['planning-table', 54, 40],
      ['research-desk', 62, 40],
    ],
  },
  {
    name: 'storage',
    columns: 3,
    rows: 2,
    regions: [
      [0, 0, 512, 512],
      [512, 0, 426, 512],
      [938, 0, 598, 512],
      [0, 512, 512, 512],
      [512, 512, 440, 512],
      [952, 512, 584, 512],
    ],
    items: [
      ['bookshelf-empty', 50, 64],
      ['bookshelf-filled', 50, 64],
      ['lounge-couch', 52, 38],
      ['reading-armchair', 30, 38],
      ['parts-cabinet', 48, 64],
      ['sideboard', 46, 34],
    ],
  },
  {
    name: 'chairs',
    columns: 2,
    rows: 2,
    items: [
      ['chair-south', 20, 30],
      ['chair-north', 20, 32],
      ['chair-east', 22, 32],
      ['chair-west', 22, 32],
    ],
  },
  {
    name: 'fixtures',
    columns: 2,
    rows: 3,
    regions: [
      [0, 0, 627, 430],
      [627, 0, 627, 430],
      [0, 430, 627, 430],
      [627, 430, 627, 430],
      [0, 860, 627, 394],
      [627, 860, 627, 394],
    ],
    items: [
      ['command-board', 132, 52],
      ['tool-board', 140, 36],
      ['verification-chart', 68, 34],
      ['doorway', 44, 64],
      ['mailbox-full', 24, 20],
      ['mailbox-empty', 24, 20],
    ],
  },
  {
    name: 'details',
    columns: 4,
    rows: 3,
    regions: [
      [0, 0, 314, 360],
      [314, 0, 286, 360],
      [600, 0, 330, 360],
      [930, 0, 324, 360],
      [0, 360, 300, 460],
      [300, 360, 280, 460],
      [580, 360, 360, 460],
      [940, 360, 314, 460],
      [0, 820, 314, 434],
      [314, 820, 251, 434],
      [565, 820, 245, 434],
      [810, 820, 444, 434],
    ],
    items: [
      ['wall-lamp-single-on', 22, 26],
      ['wall-lamp-single-off', 22, 26],
      ['wall-lamp-dual-on', 48, 28],
      ['wall-lamp-dual-off', 48, 28],
      ['floor-lamp-on', 13, 30],
      ['floor-lamp-off', 13, 30],
      ['plant-healthy', 14, 24],
      ['plant-wilted', 14, 24],
      ['plant-dead', 14, 24],
      ['switch-on', 6, 10],
      ['switch-off', 6, 10],
      ['document-index', 40, 40],
    ],
  },
  {
    name: 'icons',
    columns: 4,
    rows: 4,
    single: true,
    regions: [
      [0, 0, 360, 343],
      [360, 0, 260, 343],
      [620, 0, 320, 343],
      [940, 0, 314, 343],
      [0, 343, 314, 284],
      [314, 343, 306, 284],
      [620, 343, 320, 284],
      [940, 343, 314, 284],
      [0, 627, 314, 313],
      [314, 627, 306, 313],
      [620, 627, 320, 313],
      [940, 627, 314, 313],
      [0, 940, 314, 314],
      [314, 940, 306, 314],
      [620, 940, 320, 314],
      [940, 940, 314, 314],
    ],
    items: [
      ['icon-residents', 48, 48],
      ['icon-journal', 48, 48],
      ['icon-research', 48, 48],
      ['icon-dispatch', 48, 48],
      ['icon-plus', 28, 28],
      ['icon-minus', 28, 28],
      ['icon-home', 48, 48],
      ['icon-follow', 28, 28],
      ['icon-sound-on', 28, 28],
      ['icon-sound-off', 28, 28],
      ['icon-labels', 28, 28],
      ['icon-keyboard', 28, 28],
      ['icon-eye-open', 28, 28],
      ['icon-eye-closed', 28, 28],
      ['icon-close', 28, 28],
      ['icon-next', 28, 28],
    ],
  },
];

export function isChromaKey(r, g, b) {
  // None of this collection's oak, cream, sage, teal or rust materials use magenta.
  // The generated key is near #ff00ff; accept its compression/edge variations.
  return r - g > 18 && b - g > 18 && Math.min(r, b) > 25;
}

async function keyedSource(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let keyed = 0;
  let borderKeyed = 0;
  let borderSamples = 0;
  const normalized = Buffer.from(data);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const key = isChromaKey(data[i], data[i + 1], data[i + 2]);
      if (x < 8 || y < 8 || x >= info.width - 8 || y >= info.height - 8) {
        borderSamples++;
        if (key) borderKeyed++;
      }
      if (key) {
        keyed++;
        data.fill(0, i, i + 4);
        normalized[i] = 255;
        normalized[i + 1] = 0;
        normalized[i + 2] = 255;
        normalized[i + 3] = 255;
      }
    }
  if (
    borderKeyed / borderSamples < 0.99 ||
    keyed / (info.width * info.height) < 0.2
  ) {
    throw new Error(
      `${path.basename(file)} does not have a real magenta key background.`,
    );
  }
  await fs.mkdir(path.join(root, 'chroma-masters'), { recursive: true });
  await sharp(normalized, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .removeAlpha()
    .png()
    .toFile(path.join(root, 'chroma-masters', path.basename(file)));
  return {
    data,
    width: info.width,
    height: info.height,
    keyed,
    borderKeyRatio: borderKeyed / borderSamples,
  };
}

function boundsIn(source, region) {
  const [left, top, width, height] = region;
  let x0 = left + width,
    y0 = top + height,
    x1 = -1,
    y1 = -1;
  for (let y = top; y < top + height; y++)
    for (let x = left; x < left + width; x++) {
      if (source.data[(y * source.width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  if (x1 < x0 || y1 < y0)
    throw new Error(`Empty sprite in ${region.join(',')}`);
  if (
    x0 <= left ||
    y0 <= top ||
    x1 >= left + width - 1 ||
    y1 >= top + height - 1
  ) {
    throw new Error(
      `Sprite touches crop boundary: ${region.join(',')} (visible ${[x0, y0, x1, y1].join(',')})`,
    );
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(output, 'lights-off'), { recursive: true });
const manifest = {
  tool: 'built-in image_gen',
  extraction: 'solid magenta chroma key; no source downsampling',
  assets: [],
  sources: [],
  pending: [],
};
for (const sheet of sheets) {
  const files = [path.join(root, 'sources', `${sheet.name}-key.png`)];
  if (!sheet.single)
    files.push(path.join(root, 'sources', `${sheet.name}-dark.png`));
  if (
    (
      await Promise.all(
        files.map((file) =>
          fs.access(file).then(
            () => true,
            () => false,
          ),
        ),
      )
    ).some((exists) => !exists)
  ) {
    if (!availableOnly) throw new Error(`Missing ${sheet.name} source pair.`);
    manifest.pending.push(sheet.name);
    continue;
  }
  const sources = await Promise.all(files.map(keyedSource));
  const [lit, dark] = sources;
  if (dark && (lit.width !== dark.width || lit.height !== dark.height))
    throw new Error(`${sheet.name} lighting dimensions differ.`);
  manifest.sources.push(
    ...sources.map((source, index) => ({
      name: path.basename(files[index]),
      width: source.width,
      height: source.height,
      borderKeyRatio: source.borderKeyRatio,
    })),
  );
  for (let index = 0; index < sheet.items.length; index++) {
    const [name, logicalWidth, logicalHeight] = sheet.items[index];
    const col = index % sheet.columns,
      row = Math.floor(index / sheet.columns);
    const x0 = Math.round((col / sheet.columns) * lit.width),
      y0 = Math.round((row / sheet.rows) * lit.height);
    const region = sheet.regions?.[index] ?? [
      x0,
      y0,
      Math.round(((col + 1) / sheet.columns) * lit.width) - x0,
      Math.round(((row + 1) / sheet.rows) * lit.height) - y0,
    ];
    const bounds = sources.map((source) => boundsIn(source, region));
    const left = Math.min(...bounds.map((b) => b.left)) - 1;
    const top = Math.min(...bounds.map((b) => b.top)) - 1;
    const width = Math.max(...bounds.map((b) => b.left + b.width)) - left + 1;
    const height = Math.max(...bounds.map((b) => b.top + b.height)) - top + 1;
    const plantCrop = {
      'plant-healthy': { left: 596, top: 414, width: 300, height: 384 },
      'plant-wilted': { left: 930, top: 414, width: 300, height: 384 },
      'plant-dead': { left: 8, top: 800, width: 300, height: 384 },
    }[name];
    const crop = plantCrop ?? { left, top, width, height };
    const pairDrift = dark
      ? {
          center: Math.max(
            Math.abs(
              bounds[0].left +
                bounds[0].width / 2 -
                bounds[1].left -
                bounds[1].width / 2,
            ) / width,
            Math.abs(
              bounds[0].top +
                bounds[0].height / 2 -
                bounds[1].top -
                bounds[1].height / 2,
            ) / height,
          ),
          size: Math.max(
            Math.abs(bounds[0].width - bounds[1].width) / width,
            Math.abs(bounds[0].height - bounds[1].height) / height,
          ),
        }
      : undefined;
    if (pairDrift && (pairDrift.center > 0.05 || pairDrift.size > 0.08))
      throw new Error(
        `${name} lighting geometry drift: ${JSON.stringify(pairDrift)}`,
      );
    for (let variant = 0; variant < sources.length; variant++) {
      const source = sources[variant];
      await sharp(source.data, {
        raw: { width: source.width, height: source.height, channels: 4 },
      })
        .extract(crop)
        .png()
        .toFile(path.join(output, variant ? 'lights-off' : '', `${name}.png`));
    }
    manifest.assets.push({
      name,
      sheet: sheet.name,
      crop,
      width: crop.width,
      height: crop.height,
      logicalWidth,
      logicalHeight,
      lightingPair: Boolean(dark),
      pairDrift,
    });
  }
  if (sheet.name === 'tables') {
    // Reuse the actual generated plan on the maker's desk, retaining its native pixels.
    const crop = { left: 697, top: 190, width: 146, height: 105 };
    for (let variant = 0; variant < sources.length; variant++) {
      const source = sources[variant];
      await sharp(source.data, {
        raw: { width: source.width, height: source.height, channels: 4 },
      })
        .extract(crop)
        .png()
        .toFile(
          path.join(
            output,
            variant ? 'lights-off' : '',
            'project-blueprint.png',
          ),
        );
    }
    manifest.assets.push({
      name: 'project-blueprint',
      sheet: sheet.name,
      crop,
      width: 146,
      height: 105,
      logicalWidth: 48,
      logicalHeight: 32,
      lightingPair: true,
    });
  }
}
await fs.writeFile(
  path.join(root, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeReviewBoard(output, manifest);
console.log(
  `Exported ${manifest.assets.length} full-resolution sprites. Pending: ${manifest.pending.join(', ') || 'none'}.`,
);
