import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const projectRoot = process.cwd();
const facilityRoot = path.join(
  projectRoot,
  'public',
  'assets',
  'facility-v3',
);
const generatedRoot = path.join(facilityRoot, 'generated');
const lightsOffRoot = path.join(generatedRoot, 'lights-off');
const lightsOffMode = process.argv.includes('--lights-off');
const unknownArguments = process.argv.slice(2).filter(
  (argument) => argument !== '--lights-off',
);

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
}

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
  {
    source: 'sources/operator-mailbox-source-v1.png',
    output: 'operator-mailbox-v1.png',
    size: [24, 20],
    removeNeutralBackground: true,
    hardAlpha: true,
  },
  {
    source: 'sources/operator-mailbox-empty-source-v1.png',
    output: 'operator-mailbox-empty-v1.png',
    size: [24, 20],
    removeNeutralBackground: true,
    hardAlpha: true,
  },
];

const deterministicLightsOffAssets = [
  {
    source: path.join(generatedRoot, 'oak-floor-v1.png'),
    output: 'oak-floor-v1.png',
  },
  {
    source: path.join(generatedRoot, 'plaster-wall-v1.png'),
    output: 'plaster-wall-v1.png',
  },
  {
    source: path.join(generatedRoot, 'command-routing-board-v1.png'),
    output: 'command-routing-board-v1.png',
  },
  {
    source: path.join(generatedRoot, 'utility-tools-board-v1.png'),
    output: 'utility-tools-board-v1.png',
  },
  {
    source: path.join(generatedRoot, 'build-verification-chart-v1.png'),
    output: 'build-verification-chart-v1.png',
  },
  {
    source: path.join(generatedRoot, 'doorway-front-v1.png'),
    output: 'doorway-front-v1.png',
  },
  {
    source: path.join(facilityRoot, 'cozy-cabin', 'sprites', 'plant-small.png'),
    output: 'plant-small.png',
  },
  {
    source: path.join(facilityRoot, 'cozy-cabin', 'sprites', 'plant-tall.png'),
    output: 'plant-tall.png',
  },
  {
    source: path.join(facilityRoot, 'cozy-cabin', 'sprites', 'flower-pot.png'),
    output: 'flower-pot.png',
  },
  {
    source: path.join(facilityRoot, 'cozy-cabin', 'sprites', 'plant-pair.png'),
    output: 'plant-pair.png',
  },
  {
    source: path.join(facilityRoot, 'cozy-cabin', 'sprites', 'floor-lamp.png'),
    output: 'floor-lamp.png',
  },
  {
    source: path.join(generatedRoot, 'operator-mailbox-v1.png'),
    output: 'operator-mailbox-v1.png',
  },
  {
    source: path.join(generatedRoot, 'operator-mailbox-empty-v1.png'),
    output: 'operator-mailbox-empty-v1.png',
  },
];

const wallLightPairs = [
  {
    lit: path.join(generatedRoot, 'wall-light-dual-v1.png'),
    off: path.join(generatedRoot, 'wall-light-dual-off-v1.png'),
    output: 'wall-light-dual-off-v1.png',
  },
  {
    lit: path.join(generatedRoot, 'wall-light-single-v1.png'),
    off: path.join(generatedRoot, 'wall-light-single-off-v1.png'),
    output: 'wall-light-single-off-v1.png',
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

function gradePixels(data) {
  const graded = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    graded[offset] = gradeChannel(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      0,
    );
    graded[offset + 1] = gradeChannel(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      1,
    );
    graded[offset + 2] = gradeChannel(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      2,
    );
    graded[offset + 3] = data[offset + 3];
  }
  return graded;
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
  const tileWidth = 208;
  const tileHeight = 208;
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
    'lights-off-room-assets',
  );
  await fs.mkdir(qaRoot, { recursive: true });
  const litPaths = [
    ...deterministicLightsOffAssets.map(({ source }) => source),
    ...wallLightPairs.map(({ lit }) => lit),
  ];
  const offPaths = [
    ...deterministicLightsOffAssets.map(({ output }) =>
      path.join(lightsOffRoot, output),
    ),
    ...wallLightPairs.map(({ output }) => path.join(lightsOffRoot, output)),
  ];
  const differences = await Promise.all(
    litPaths.map((litPath, index) => differenceBuffer(litPath, offPaths[index])),
  );

  await Promise.all([
    writeContactSheet(litPaths, path.join(qaRoot, 'illuminated.png')),
    writeContactSheet(offPaths, path.join(qaRoot, 'lights-off.png')),
    writeContactSheet(differences, path.join(qaRoot, 'difference.png')),
  ]);
}

async function assertRendererDarkAssetsExist() {
  const rendererPath = path.join(
    projectRoot,
    'components',
    'agent-arena-world-v2.tsx',
  );
  const renderer = await fs.readFile(rendererPath, 'utf8');
  const generatedSet = renderer.match(
    /const LIGHTS_OFF_GENERATED_ASSETS[\s\S]*?\(\[([\s\S]*?)\]\);/,
  );
  if (!generatedSet) {
    throw new Error('Cannot locate renderer lights-off asset declaration.');
  }

  const expectedPaths = new Set();
  for (const match of generatedSet[1].matchAll(/'([^']+)'/g)) {
    const key = match[1];
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asset = renderer.match(
      new RegExp(`\\b${escapedKey}:\\s*['"]([^'"]+)`),
    );
    if (!asset) {
      throw new Error(`Cannot resolve renderer asset key ${key}.`);
    }
    const pathname = asset[1].split('?', 1)[0];
    expectedPaths.add(
      path.join(lightsOffRoot, pathname.slice(pathname.lastIndexOf('/') + 1)),
    );
  }

  const furnitureRoot = path.join(
    projectRoot,
    'public',
    'assets',
    'facility-v4',
    'furniture',
    'lights-off',
  );
  for (const match of renderer.matchAll(/furnitureAsset\('([^']+)'\)/g)) {
    expectedPaths.add(path.join(furnitureRoot, match[1]));
  }

  const missing = [];
  for (const expectedPath of expectedPaths) {
    try {
      const stat = await fs.stat(expectedPath);
      if (!stat.isFile() || stat.size === 0) missing.push(expectedPath);
    } catch {
      missing.push(expectedPath);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Renderer declares missing lights-off assets:\n${missing.join('\n')}`,
    );
  }

  return expectedPaths.size;
}

async function processGeneratedFixtures() {
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
    const pipeline = sharp(data, {
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
      .sharpen({ sigma: 0.55, m1: 0.7, m2: 1.25 });

    let processed;
    if (fixture.hardAlpha) {
      const resized = await pipeline.raw().toBuffer({ resolveWithObject: true });
      for (let offset = 0; offset < resized.data.length; offset += 4) {
        const visible = resized.data[offset + 3] >= 96;
        resized.data[offset + 3] = visible ? 255 : 0;
        if (!visible) {
          resized.data[offset] = 0;
          resized.data[offset + 1] = 0;
          resized.data[offset + 2] = 0;
        }
      }
      processed = await sharp(resized.data, { raw: resized.info })
        .png({ palette: true, colours: 96, dither: 0, effort: 10 })
        .toBuffer();
    } else {
      processed = await pipeline
        .png({ palette: true, colours: 96, dither: 0, effort: 10 })
        .toBuffer();
    }

    await fs.writeFile(path.join(generatedRoot, fixture.output), processed);
  }
}

async function processLightsOffAssets() {
  const protectedPaths = [
    ...deterministicLightsOffAssets.map(({ source }) => source),
    ...wallLightPairs.flatMap(({ lit, off }) => [lit, off]),
  ];
  const protectedHashes = new Map(
    await Promise.all(
      protectedPaths.map(async (filePath) => [filePath, await fileHash(filePath)]),
    ),
  );

  await fs.mkdir(lightsOffRoot, { recursive: true });

  for (const asset of deterministicLightsOffAssets) {
    const { data, info } = await sharp(asset.source)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const outputPath = path.join(lightsOffRoot, asset.output);
    await sharp(gradePixels(data), { raw: info })
      .png({ palette: false, compressionLevel: 9, effort: 10 })
      .toFile(outputPath);
    await assertAlphaMatches(asset.source, outputPath);
  }

  for (const fixture of wallLightPairs) {
    const [lit, off] = await Promise.all([
      sharp(fixture.lit).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(fixture.off).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    if (
      lit.info.width !== off.info.width ||
      lit.info.height !== off.info.height
    ) {
      throw new Error(`${fixture.output} lit/off dimensions do not match.`);
    }

    const outputData = Buffer.alloc(lit.data.length);
    for (let offset = 0; offset < outputData.length; offset += 4) {
      const offVisible = off.data[offset + 3] > 8;
      outputData[offset] = offVisible
        ? off.data[offset]
        : gradeChannel(lit.data[offset], lit.data[offset + 1], lit.data[offset + 2], 0);
      outputData[offset + 1] = offVisible
        ? off.data[offset + 1]
        : gradeChannel(lit.data[offset], lit.data[offset + 1], lit.data[offset + 2], 1);
      outputData[offset + 2] = offVisible
        ? off.data[offset + 2]
        : gradeChannel(lit.data[offset], lit.data[offset + 1], lit.data[offset + 2], 2);
      outputData[offset + 3] = lit.data[offset + 3];
    }

    const outputPath = path.join(lightsOffRoot, fixture.output);
    await sharp(outputData, { raw: lit.info })
      .png({ palette: false, compressionLevel: 9, effort: 10 })
      .toFile(outputPath);
    await assertAlphaMatches(fixture.lit, outputPath);
  }

  for (const [filePath, expectedHash] of protectedHashes) {
    if ((await fileHash(filePath)) !== expectedHash) {
      throw new Error(`Illuminated or authored source asset was modified: ${filePath}`);
    }
  }

  await writeLightsOffQa();
  return assertRendererDarkAssetsExist();
}

if (lightsOffMode) {
  const rendererAssetCount = await processLightsOffAssets();
  console.log(
    `Processed ${deterministicLightsOffAssets.length} graded assets and ` +
      `${wallLightPairs.length} alpha-normalized wall lights into ${lightsOffRoot}; ` +
      `verified ${rendererAssetCount} renderer-declared dark paths.`,
  );
} else {
  await processGeneratedFixtures();
  console.log(`Processed ${fixtures.length} generated wall fixtures.`);
}
