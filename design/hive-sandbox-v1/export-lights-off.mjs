import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(root, '../..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const outputRoot = path.join(workspace, 'public/assets/facility-v6/sandbox');
const exports = [];

for (const asset of manifest.assets) {
  const originalMaster = path.join(root, asset.source);
  const editedMaster = path.join(root, 'sources', `${asset.name}-lights-off.png`);
  const production = path.join(outputRoot, `${asset.name}.png`);
  const output = path.join(outputRoot, `${asset.name}-lights-off.png`);
  const dimensions = await sharp(originalMaster).metadata();
  // Generation can vary the canvas dimensions slightly. Normalize that canvas
  // before using the exact same authored crop and nearest-neighbor export.
  const normalized = await sharp(editedMaster)
    .resize(dimensions.width, dimensions.height, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();
  const modelPixels = await sharp(normalized)
    .extract(asset.crop)
    .resize(asset.width, asset.height, {
      fit: 'contain',
      kernel: 'nearest',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const existingPixels = await sharp(production).ensureAlpha().raw().toBuffer();
  for (let index = 3; index < modelPixels.length; index += 4) {
    // Keep the production cutout byte-for-byte so lighting cannot move an edge.
    // RGB illumination is entirely the model-generated edit, not a color filter.
    modelPixels[index] = existingPixels[index];
    if (existingPixels[index] === 0) {
      modelPixels[index - 3] = 0;
      modelPixels[index - 2] = 0;
      modelPixels[index - 1] = 0;
    }
  }
  await sharp(modelPixels, {
    raw: { width: asset.width, height: asset.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(output);
  exports.push({
    name: `${asset.name}-lights-off`,
    source: `sources/${asset.name}-lights-off.png`,
    reference: asset.source,
    width: asset.width,
    height: asset.height,
    crop: asset.crop,
    alphaSource: `public/assets/facility-v6/sandbox/${asset.name}.png`,
    output: path.relative(workspace, output).replaceAll('\\', '/'),
  });
  console.log(`${asset.name}-lights-off: ${asset.width}x${asset.height}, exact original alpha`);
}

await fs.writeFile(
  path.join(root, 'lights-off-manifest.json'),
  `${JSON.stringify({
    generator: 'built-in image_gen',
    date: '2026-09-05',
    processing: 'Model-generated illumination; nearest-neighbor canvas alignment and original crop; exact production alpha retained. No brightness or color filter.',
    limitation: 'The model returned opaque RGB masters with a painted transparency preview. Export restores the exact existing production alpha. Internal model edits may differ at isolated pixels.',
    assets: exports,
  }, null, 2)}\n`,
);
