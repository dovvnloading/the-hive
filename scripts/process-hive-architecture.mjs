import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourceRoot = path.resolve('design/hive-architecture-v1/sources');
const outputRoot = path.resolve('public/assets/facility-v6');
await fs.mkdir(outputRoot, { recursive: true });
const manifest = { generator: 'built-in image_gen', assets: [] };

async function exportAsset(name, source, width, height, crop) {
  const input = path.join(sourceRoot, `${source}.png`);
  let pipeline = sharp(input);
  if (crop) pipeline = pipeline.extract(crop);
  const output = path.join(outputRoot, `${name}.png`);
  await pipeline
    .resize(width, height, { fit: 'fill', kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toFile(output);
  manifest.assets.push({ name, source: `${source}.png`, width, height, crop });
}

// Crop and sample the generated pixels only. Lighting is handled at runtime.
await exportAsset('wall-band', 'wall-band', 256, 128);
await exportAsset('parquet', 'parquet', 320, 320);
await exportAsset('oak-planks-v2', 'oak-planks-v2', 320, 320);
await exportAsset('slate', 'slate', 192, 192);
await exportAsset('walnut-beam', 'walnut-beam', 384, 38, {
  left: 45,
  top: 346,
  width: 1683,
  height: 162,
});
// Both states use equal source crop boxes and equal output geometry.
await exportAsset('switch-on', 'switch-states', 24, 40, {
  left: 190,
  top: 98,
  width: 448,
  height: 788,
});
await exportAsset('switch-off', 'switch-states', 24, 40, {
  left: 899,
  top: 98,
  width: 448,
  height: 788,
});
await fs.writeFile(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Exported ${manifest.assets.length} generated architecture assets.`,
);
