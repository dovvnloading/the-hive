import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(root, '../..');
const outputRoot = path.join(workspace, 'public/assets/facility-v6');
const originalManifest = JSON.parse(await fs.readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
const names = new Set(['oak-planks-v2', 'wall-band', 'walnut-beam']);
const exports = [];

for (const asset of originalManifest.assets.filter((item) => names.has(item.name))) {
  const originalMaster = path.join(root, 'sources', asset.source);
  const editedMaster = path.join(root, 'sources', `${asset.name}-lights-off.png`);
  const production = path.join(outputRoot, `${asset.name}.png`);
  const output = path.join(outputRoot, `${asset.name}-lights-off.png`);
  const originalDimensions = await sharp(originalMaster).metadata();
  const productionMetadata = await sharp(production).metadata();
  const normalized = await sharp(editedMaster)
    .resize(originalDimensions.width, originalDimensions.height, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();
  let pipeline = sharp(normalized);
  if (asset.crop) pipeline = pipeline.extract(asset.crop);
  const pixels = await pipeline
    .resize(asset.width, asset.height, { fit: 'fill', kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const originalPixels = await sharp(production).ensureAlpha().raw().toBuffer();
  for (let index = 3; index < pixels.length; index += 4) {
    // Exact original alpha preserves the beam silhouette and all tile opacity.
    // Every visible RGB value comes from the model edit; no lighting filter.
    pixels[index] = originalPixels[index];
    if (originalPixels[index] === 0) {
      pixels[index - 3] = 0;
      pixels[index - 2] = 0;
      pixels[index - 1] = 0;
    }
  }
  let encoded = sharp(pixels, {
    raw: { width: asset.width, height: asset.height, channels: 4 },
  });
  if (!productionMetadata.hasAlpha) encoded = encoded.removeAlpha();
  await encoded.png({ compressionLevel: 9 }).toFile(output);
  exports.push({
    name: `${asset.name}-lights-off`,
    reference: `sources/${asset.source}`,
    source: `sources/${asset.name}-lights-off.png`,
    width: asset.width,
    height: asset.height,
    crop: asset.crop,
    originalAlphaRetained: true,
    output: path.relative(workspace, output).replaceAll('\\', '/'),
  });
  console.log(`${asset.name}-lights-off: ${asset.width}x${asset.height}`);
}

await fs.writeFile(path.join(root, 'lights-off-manifest.json'), `${JSON.stringify({
  generator: 'built-in image_gen',
  date: '2026-09-05',
  processing: 'Model-generated lighting edit, original canvas registration and crop, nearest-neighbor export, exact original alpha. No color or brightness filter.',
  limitation: 'Model-rendered RGB texture details may differ at isolated pixels. Original alpha and export geometry remain exact. Raw beam edit has an opaque preview; the production alpha is restored during export.',
  assets: exports,
}, null, 2)}\n`);
