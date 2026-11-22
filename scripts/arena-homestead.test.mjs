import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { FACILITY_ROOMS } from '../lib/arena/facility-protocol.mjs';
import {
  HOMESTEAD_BUILDINGS,
  positionInRoom,
  positionOnLane,
  roomAtPosition,
  roomViewport,
} from '../lib/arena/homestead.ts';
import { INTERIOR_ART } from '../lib/arena/interior-art.ts';

await test('every cottage opens exactly one existing room; its crop exposes no neighboring room', () => {
  assert.deepEqual(
    HOMESTEAD_BUILDINGS.map((b) => b.id).sort(),
    FACILITY_ROOMS.map((r) => r.id).sort(),
  );
  for (const room of FACILITY_ROOMS) {
    assert.deepEqual(roomViewport(room.id), room.rect);
    const center = {
      x: ((room.rect.x + room.rect.w / 2) / 768) * 100,
      y: ((room.rect.y + room.rect.h / 2) / 448) * 100,
    };
    assert.equal(roomAtPosition(center), room.id);
    const projected = positionInRoom(center, room.id);
    assert.ok(Math.abs(projected.x - 50) < 1e-10);
    assert.ok(Math.abs(projected.y - 50) < 1e-10);
    assert.equal(positionOnLane(center), undefined);
  }
});

await test('corridor projection follows position, stays monotonic, and never invents an indoor presence', () => {
  let previous = -Infinity;
  for (let worldX = 32; worldX <= 736; worldX++) {
    const position = { x: (worldX / 768) * 100, y: (224 / 448) * 100 };
    assert.equal(roomAtPosition(position), undefined);
    const point = positionOnLane(position);
    assert.ok(point.x > previous && point.x >= 0 && point.x <= 100);
    assert.ok(point.y > 47 && point.y < 55);
    previous = point.x;
  }
  assert.equal(positionOnLane({ x: 50, y: 0 }), undefined);
  assert.equal(positionOnLane({ x: 50, y: 100 }), undefined);
});

await test('room camera coordinates remain correct at the edges, independent of texture resolution', () => {
  for (const room of FACILITY_ROOMS) {
    for (const fraction of [0, 0.1, 0.5, 0.9, 1]) {
      const projected = positionInRoom(
        {
          x: ((room.rect.x + room.rect.w * fraction) / 768) * 100,
          y: ((room.rect.y + room.rect.h * fraction) / 448) * 100,
        },
        room.id,
      );
      assert.ok(Math.abs(projected.x - fraction * 100) < 1e-10);
      assert.ok(Math.abs(projected.y - fraction * 100) < 1e-10);
    }
  }
});

const localPath = (relative) =>
  new URL(relative, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

await test('all consumed interior art has registered full-resolution lit and lights-off exports', async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      new URL('../design/hive-remake-v1/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  const consumed = new Map(
    Object.values(INTERIOR_ART).map((asset) => [asset.file, asset]),
  );
  for (const [file, art] of consumed) {
    const record = manifest.assets.find((asset) => asset.name === file);
    assert.ok(record, `${file} is not registered in the remake manifest`);
    assert.ok(['graded', 'model'].includes(record.lightingPair), file);
    const [lit, dark] = await Promise.all(
      ['', 'lights-off/'].map((variant) =>
        sharp(
          localPath(
            `../public/assets/hive-remake-v1/interiors/${variant}${file}.webp`,
          ),
        ).metadata(),
      ),
    );
    assert.equal(lit.width, dark.width, file);
    assert.equal(lit.height, dark.height, file);
    assert.ok(
      lit.width > record.logicalWidth * 2,
      `${file} was reduced to world pixels`,
    );
    if (record.lightingPair === 'graded') {
      const ratio = art.width / art.height;
      assert.ok(
        Math.abs(lit.width / lit.height - ratio) < ratio * 0.03,
        `${file} does not match its ${art.width} x ${art.height} footprint`,
      );
    }
    if (file.startsWith('room-')) {
      assert.equal(lit.hasAlpha, false, `${file} must be an opaque room`);
    } else if (record.lightingPair === 'graded') {
      const { data, info } = await sharp(
        localPath(`../public/assets/hive-remake-v1/interiors/${file}.webp`),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(data[3], 0, `${file} keeps a transparent corner`);
      assert.equal(
        data[(info.width * info.height - 1) * 4 + 3],
        0,
        `${file} keeps a transparent corner`,
      );
    }
  }
});

await test('homestead-v1 interior art keeps full-resolution lit and lights-off exports', async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      new URL(
        '../design/homestead-v1/interiors/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(manifest.pending, []);
  assert.equal(manifest.assets.length, 55);
  // The earlier set stays on disk as the source for carried-over assets. UI
  // icons share its manifest but are not interior art and have no dark pair.
  const interiorFiles = manifest.assets
    .map((asset) => asset.name)
    .filter((name) => !name.startsWith('icon-'));
  for (const file of interiorFiles) {
    const record = manifest.assets.find((asset) => asset.name === file);
    assert.ok(
      record?.lightingPair,
      `${file} is missing a model-generated lights-off partner`,
    );
    const [lit, dark] = await Promise.all(
      ['', 'lights-off/'].map((variant) =>
        sharp(
          new URL(
            `../public/assets/homestead-v1/interiors/${variant}${file}.png`,
            import.meta.url,
          ).pathname.replace(/^\/([A-Z]:)/, '$1'),
        ).metadata(),
      ),
    );
    assert.equal(lit.width, dark.width, file);
    assert.equal(lit.height, dark.height, file);
    assert.equal(lit.channels, 4, file);
    assert.ok(
      lit.width > record.logicalWidth * 2,
      `${file} was reduced to world pixels`,
    );
    if (record.pairDrift) {
      assert.ok(record.pairDrift.center <= 0.05, file);
      assert.ok(record.pairDrift.size <= 0.08, file);
    }
  }
  for (const name of ['plant-healthy', 'plant-wilted', 'plant-dead']) {
    const record = manifest.assets.find((asset) => asset.name === name);
    assert.deepEqual(
      [record.width, record.height],
      [300, 384],
      'plant condition must not resize its pot',
    );
  }
});

await test('chroma masters use solid magenta; extracted corners contain genuine alpha', async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      new URL(
        '../design/homestead-v1/interiors/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  for (const source of manifest.sources) {
    const file = new URL(
      `../design/homestead-v1/interiors/chroma-masters/${source.name}`,
      import.meta.url,
    ).pathname.replace(/^\/([A-Z]:)/, '$1');
    const { data } = await sharp(file)
      .extract({ left: 0, top: 0, width: 8, height: 8 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 3)
      assert.deepEqual(
        [...data.subarray(i, i + 3)],
        [255, 0, 255],
        source.name,
      );
  }
  const { data, info } = await sharp(
    new URL(
      '../public/assets/homestead-v1/interiors/writing-desk.png',
      import.meta.url,
    ).pathname.replace(/^\/([A-Z]:)/, '$1'),
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0);
  assert.equal(data[(info.width * info.height - 1) * 4 + 3], 0);
  assert.ok(data.some((value, index) => index % 4 === 3 && value === 255));
});
