import { createHash } from 'node:crypto';
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
const litSourcePath = path.join(
  furnitureRoot,
  'furniture-sheet-v2-transparent.png',
);
const lightsOffSourcePath = path.join(
  furnitureRoot,
  'furniture-sheet-v2-lights-off-source.png',
);
const lightsOffRoot = path.join(furnitureRoot, 'lights-off');
const lightsOffMode = process.argv.includes('--lights-off');
const unknownArguments = process.argv.slice(2).filter(
  (argument) => argument !== '--lights-off',
);

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
}

const sprites = [
  { name: 'research-desk', cell: [0, 0], size: [62, 40] },
  { name: 'utility-workstation', cell: [1, 0], size: [54, 40] },
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

const geometryLimits = Object.freeze({
  normalizedCenterDrift: 0.05,
  normalizedSizeDrift: 0.08,
});

function largestAlphaComponentBounds(data, width, height, channels) {
  const visited = new Uint8Array(width * height);
  let largest;

  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || data[start * channels + 3] <= 8) continue;

    const queue = [start];
    visited[start] = 1;
    let pixels = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);

      const neighbors = [
        index - 1,
        index + 1,
        index - width,
        index + width,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= visited.length || visited[neighbor]) {
          continue;
        }
        const neighborX = neighbor % width;
        if (Math.abs(neighborX - x) > 1) continue;
        if (data[neighbor * channels + 3] <= 8) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    if (!largest || pixels > largest.pixels) {
      largest = { pixels, left, top, right, bottom };
    }
  }

  if (!largest) {
    throw new Error('Sprite cell contains no visible pixels.');
  }

  return {
    pixels: largest.pixels,
    left: largest.left,
    top: largest.top,
    width: largest.right - largest.left + 1,
    height: largest.bottom - largest.top + 1,
  };
}

function clearBakedNeutralBackdrop(data) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const brightest = Math.max(red, green, blue);
    const darkest = Math.min(red, green, blue);

    if (darkest >= 220 && brightest - darkest <= 16) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
}

async function maskedLightsOffSource() {
  const { data, info } = await sharp(lightsOffSourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  clearBakedNeutralBackdrop(data);
  return sharp(data, { raw: info }).png({ palette: false }).toBuffer();
}

function cellRect(metadata, column, row) {
  const left = Math.round((column * metadata.width) / 4);
  const top = Math.round((row * metadata.height) / 4);
  const right = Math.round(((column + 1) * metadata.width) / 4);
  const bottom = Math.round(((row + 1) * metadata.height) / 4);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

async function readComponent(sourcePath, cell) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .extract(cell)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return largestAlphaComponentBounds(
    data,
    info.width,
    info.height,
    info.channels,
  );
}

function normalizedGeometry(bounds, cell) {
  return {
    centerX: (bounds.left + bounds.width / 2) / cell.width,
    centerY: (bounds.top + bounds.height / 2) / cell.height,
    width: bounds.width / cell.width,
    height: bounds.height / cell.height,
  };
}

function assertGeometry(sprite, litGeometry, candidateGeometry) {
  const drift = {
    centerX: Math.abs(candidateGeometry.centerX - litGeometry.centerX),
    centerY: Math.abs(candidateGeometry.centerY - litGeometry.centerY),
    width: Math.abs(candidateGeometry.width - litGeometry.width),
    height: Math.abs(candidateGeometry.height - litGeometry.height),
  };

  if (
    drift.centerX > geometryLimits.normalizedCenterDrift ||
    drift.centerY > geometryLimits.normalizedCenterDrift ||
    drift.width > geometryLimits.normalizedSizeDrift ||
    drift.height > geometryLimits.normalizedSizeDrift
  ) {
    throw new Error(
      `${sprite.name} geometry drift exceeds limits: ` +
        `center=(${drift.centerX.toFixed(4)}, ${drift.centerY.toFixed(4)}) ` +
        `size=(${drift.width.toFixed(4)}, ${drift.height.toFixed(4)}); ` +
        `limits are center ${geometryLimits.normalizedCenterDrift} and ` +
        `size ${geometryLimits.normalizedSizeDrift}.`,
    );
  }
}

function gradeChannel(red, green, blue, channel) {
  const brightness = [red, green, blue].map((value) => value * 0.55);
  const luminance =
    brightness[0] * 0.2126 +
    brightness[1] * 0.7152 +
    brightness[2] * 0.0722;
  const saturated = luminance + (brightness[channel] - luminance) * 0.75;
  return Math.max(
    0,
    Math.min(
      255,
      Math.round(saturated * 0.82 + [16, 24, 39][channel] * 0.18),
    ),
  );
}

async function processCell(sourcePath, cell, bounds, size) {
  const [targetWidth, targetHeight] = size;
  return sharp(sourcePath)
    .ensureAlpha()
    .extract({
      left: cell.left + bounds.left,
      top: cell.top + bounds.top,
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
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function fileHash(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function assertAlphaMatches(referencePath, outputPath) {
  const [reference, output] = await Promise.all([
    sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  if (
    reference.info.width !== output.info.width ||
    reference.info.height !== output.info.height
  ) {
    throw new Error(`Dimension mismatch for ${path.basename(outputPath)}.`);
  }

  for (let offset = 3; offset < reference.data.length; offset += 4) {
    if (reference.data[offset] !== output.data[offset]) {
      throw new Error(
        `Alpha mismatch for ${path.basename(outputPath)} at pixel ${Math.floor(offset / 4)}.`,
      );
    }
  }
}

async function differenceBuffer(litPath, offPath) {
  const [lit, off] = await Promise.all([
    sharp(litPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(offPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const difference = Buffer.alloc(lit.data.length);

  for (let offset = 0; offset < difference.length; offset += 4) {
    difference[offset] = Math.abs(lit.data[offset] - off.data[offset]);
    difference[offset + 1] = Math.abs(
      lit.data[offset + 1] - off.data[offset + 1],
    );
    difference[offset + 2] = Math.abs(
      lit.data[offset + 2] - off.data[offset + 2],
    );
    difference[offset + 3] = lit.data[offset + 3];
  }

  return sharp(difference, { raw: lit.info }).png().toBuffer();
}

async function writeContactSheet(inputs, outputPath) {
  const tileWidth = 80;
  const tileHeight = 72;
  const gap = 8;
  const columns = 4;
  const rows = Math.ceil(inputs.length / columns);
  const composites = [];

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const metadata = await sharp(input).metadata();
    composites.push({
      input,
      left:
        gap +
        (index % columns) * (tileWidth + gap) +
        Math.floor((tileWidth - metadata.width) / 2),
      top:
        gap +
        Math.floor(index / columns) * (tileHeight + gap) +
        tileHeight -
        metadata.height,
    });
  }

  await sharp({
    create: {
      width: gap + columns * (tileWidth + gap),
      height: gap + rows * (tileHeight + gap),
      channels: 4,
      background: { r: 31, g: 36, b: 48, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function writeLightsOffQa() {
  const qaRoot = path.join(
    projectRoot,
    'outputs',
    'asset-qa',
    'lights-off-furniture',
  );
  await fs.mkdir(qaRoot, { recursive: true });
  const litPaths = sprites.map((sprite) =>
    path.join(furnitureRoot, `${sprite.name}.png`),
  );
  const offPaths = sprites.map((sprite) =>
    path.join(lightsOffRoot, `${sprite.name}.png`),
  );
  const differences = await Promise.all(
    litPaths.map((litPath, index) => differenceBuffer(litPath, offPaths[index])),
  );

  await Promise.all([
    writeContactSheet(litPaths, path.join(qaRoot, 'illuminated.png')),
    writeContactSheet(offPaths, path.join(qaRoot, 'lights-off.png')),
    writeContactSheet(differences, path.join(qaRoot, 'difference.png')),
  ]);
}

async function processLitSprites(metadata) {
  for (const sprite of sprites) {
    const [column, row] = sprite.cell;
    const cell = cellRect(metadata, column, row);
    const bounds = await readComponent(litSourcePath, cell);
    const processed = await processCell(litSourcePath, cell, bounds, sprite.size);
    const encoded = await sharp(processed.data, { raw: processed.info })
      .png({ palette: true, colours: 64, dither: 0, effort: 10 })
      .toBuffer();
    await fs.writeFile(path.join(furnitureRoot, `${sprite.name}.png`), encoded);
  }
}

async function processLightsOffSprites(litMetadata, candidateMetadata) {
  const protectedPaths = [
    litSourcePath,
    ...sprites.map((sprite) => path.join(furnitureRoot, `${sprite.name}.png`)),
  ];
  const protectedHashes = new Map(
    await Promise.all(
      protectedPaths.map(async (filePath) => [filePath, await fileHash(filePath)]),
    ),
  );

  const candidateSource = await maskedLightsOffSource();
  const validatedSprites = [];

  for (const sprite of sprites) {
    const [column, row] = sprite.cell;
    const litCell = cellRect(litMetadata, column, row);
    const candidateCell = cellRect(candidateMetadata, column, row);
    const [litBounds, candidateBounds] = await Promise.all([
      readComponent(litSourcePath, litCell),
      readComponent(candidateSource, candidateCell),
    ]);

    assertGeometry(
      sprite,
      normalizedGeometry(litBounds, litCell),
      normalizedGeometry(candidateBounds, candidateCell),
    );

    validatedSprites.push({
      sprite,
      candidateCell,
      candidateBounds,
    });
  }

  await fs.mkdir(lightsOffRoot, { recursive: true });

  for (const validated of validatedSprites) {
    const { sprite, candidateCell, candidateBounds } = validated;
    const [candidate, litRuntime] = await Promise.all([
      processCell(
        candidateSource,
        candidateCell,
        candidateBounds,
        sprite.size,
      ),
      sharp(path.join(furnitureRoot, `${sprite.name}.png`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);
    const [targetWidth, targetHeight] = sprite.size;

    if (
      candidate.info.width !== targetWidth ||
      candidate.info.height !== targetHeight ||
      litRuntime.info.width !== targetWidth ||
      litRuntime.info.height !== targetHeight
    ) {
      throw new Error(`${sprite.name} runtime dimensions do not match its manifest size.`);
    }

    const outputData = Buffer.alloc(targetWidth * targetHeight * 4);
    for (let offset = 0; offset < outputData.length; offset += 4) {
      const candidateVisible = candidate.data[offset + 3] > 8;
      const litRed = litRuntime.data[offset];
      const litGreen = litRuntime.data[offset + 1];
      const litBlue = litRuntime.data[offset + 2];

      outputData[offset] = candidateVisible
        ? candidate.data[offset]
        : gradeChannel(litRed, litGreen, litBlue, 0);
      outputData[offset + 1] = candidateVisible
        ? candidate.data[offset + 1]
        : gradeChannel(litRed, litGreen, litBlue, 1);
      outputData[offset + 2] = candidateVisible
        ? candidate.data[offset + 2]
        : gradeChannel(litRed, litGreen, litBlue, 2);
      outputData[offset + 3] = litRuntime.data[offset + 3];
    }

    const outputPath = path.join(lightsOffRoot, `${sprite.name}.png`);
    await sharp(outputData, {
      raw: { width: targetWidth, height: targetHeight, channels: 4 },
    })
      .png({ palette: false, compressionLevel: 9, effort: 10 })
      .toFile(outputPath);
    await assertAlphaMatches(
      path.join(furnitureRoot, `${sprite.name}.png`),
      outputPath,
    );
  }

  for (const [filePath, expectedHash] of protectedHashes) {
    if ((await fileHash(filePath)) !== expectedHash) {
      throw new Error(`Illuminated asset was modified: ${filePath}`);
    }
  }

  await writeLightsOffQa();
}

async function writeManifest() {
  await fs.writeFile(
    path.join(furnitureRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        sheet: 'furniture-sheet-v2-transparent.png',
        lightsOffSheet: 'furniture-sheet-v2-lights-off-source.png',
        grid: { columns: 4, rows: 4 },
        processing: {
          componentIsolation: 'largest-alpha-component',
          resampling: 'lanczos3',
          paletteColours: 64,
          dither: 0,
          bottomAligned: true,
          lightsOff: {
            outputDirectory: 'lights-off',
            geometryReference: 'furniture-sheet-v2-transparent.png',
            maximumNormalizedCenterDrift: 0.05,
            maximumNormalizedSizeDrift: 0.08,
            alphaReference: 'illuminated-runtime-sprite',
          },
        },
        sprites,
      },
      null,
      2,
    )}\n`,
  );
}

let litMetadata;
try {
  litMetadata = await sharp(litSourcePath, { failOn: 'error' }).metadata();
} catch (error) {
  throw new Error(`Cannot read illuminated furniture source: ${litSourcePath}`, {
    cause: error,
  });
}
if (!litMetadata.width || !litMetadata.height) {
  throw new Error('Illuminated furniture sheet dimensions are unavailable.');
}

if (lightsOffMode) {
  let candidateMetadata;
  try {
    candidateMetadata = await sharp(lightsOffSourcePath, {
      failOn: 'error',
    }).metadata();
  } catch (error) {
    throw new Error(
      `Lights-off furniture source is required at ${lightsOffSourcePath}. ` +
        'Generate and approve that sheet before running this processor.',
      { cause: error },
    );
  }
  if (!candidateMetadata.width || !candidateMetadata.height) {
    throw new Error('Lights-off furniture sheet dimensions are unavailable.');
  }
  if (
    candidateMetadata.width !== litMetadata.width ||
    candidateMetadata.height !== litMetadata.height
  ) {
    throw new Error(
      `Lights-off master must exactly match the illuminated master dimensions ` +
        `(${litMetadata.width}x${litMetadata.height}); received ` +
        `${candidateMetadata.width}x${candidateMetadata.height}.`,
    );
  }

  await processLightsOffSprites(litMetadata, candidateMetadata);
  await writeManifest();
  console.log(
    `Processed and geometry-validated ${sprites.length} lights-off furniture sprites from ${lightsOffSourcePath}.`,
  );
} else {
  await processLitSprites(litMetadata);
  await writeManifest();
  console.log(`Processed ${sprites.length} illuminated furniture sprites from ${litSourcePath}.`);
}
