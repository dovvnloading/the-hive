import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../../public/assets/homestead-v1');
await fs.mkdir(output, { recursive: true });
const crops = [
  ['title-sign', 0, 124, 580, 276, 580],
  ['paper-frame', 596, 32, 440, 434, 220],
  ['wood-button', 1142, 92, 330, 330, 165],
  ['journal', 58, 544, 432, 410, 96],
  ['mail', 580, 580, 425, 378, 96],
  ['map', 1058, 534, 462, 432, 96],
];
const manifest = { generator: 'built-in image_gen', assets: [] };
for (const [name, left, top, width, height, exportWidth] of crops) {
  const file = path.join(output, `${name}.png`);
  await sharp(path.join(root, 'sources/ui-atlas.png'))
    .extract({ left, top, width, height })
    .resize({ width: exportWidth, kernel: 'nearest' })
    .png().toFile(file);
  const metadata = await sharp(file).metadata();
  manifest.assets.push({ name, crop: { left, top, width, height }, width: metadata.width, height: metadata.height, alphaPreserved: true });
}
await fs.copyFile(path.join(root, 'sources/homestead-map.png'), path.join(output, 'homestead-map.png'));
manifest.assets.push({ name: 'homestead-map', width: 1536, height: 1024, unchangedMaster: true });
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Exported ${manifest.assets.length} generated assets.`);
