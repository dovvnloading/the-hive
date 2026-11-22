import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ambientFlies,
  lightFlickerMultiplier,
  lightTransitionLevel,
} from '../lib/arena/environment-effects.ts';

void test('light transitions settle at exact off and on endpoints', () => {
  const changedAt = '2026-09-03T12:00:00.000Z';
  const changedMs = Date.parse(changedAt);
  assert.equal(lightTransitionLevel('on', changedAt, changedMs), 0);
  assert.equal(lightTransitionLevel('on', changedAt, changedMs + 1_000), 1);
  assert.equal(lightTransitionLevel('off', changedAt, changedMs), 1);
  assert.equal(lightTransitionLevel('off', changedAt, changedMs + 1_000), 0);
});

void test('light transitions are monotonic and reduced motion is immediate', () => {
  const changedAt = '2026-09-03T12:00:00.000Z';
  const changedMs = Date.parse(changedAt);
  const rising = [0, 140, 280, 420, 560].map((offset) =>
    lightTransitionLevel('on', changedAt, changedMs + offset),
  );
  assert.deepEqual(
    rising,
    [...rising].sort((left, right) => left - right),
  );
  assert.equal(lightTransitionLevel('on', changedAt, changedMs, true), 1);
  assert.equal(lightTransitionLevel('off', changedAt, changedMs, true), 0);
});

void test('fixture shimmer remains subtle and deterministic', () => {
  const first = lightFlickerMultiplier('research', 12_345);
  assert.equal(first, lightFlickerMultiplier('research', 12_345));
  for (let now = 0; now <= 60_000; now += 37) {
    const value = lightFlickerMultiplier('research', now);
    assert.ok(value >= 0.965 && value <= 1.015);
  }
  assert.equal(lightFlickerMultiplier('research', 12_345, true), 1);
});

void test('occasional flies are deterministic, sparse, and room-bound', () => {
  const bounds = { x: 32, y: 32, w: 220, h: 160 };
  const anchor = { x: 190, y: 150 };
  let activeAt;
  for (let now = 0; now < 30_000; now += 100) {
    if (ambientFlies('research', bounds, anchor, now, 1).length > 0) {
      activeAt = now;
      break;
    }
  }
  assert.notEqual(activeAt, undefined);
  const flies = ambientFlies('research', bounds, anchor, activeAt, 1);
  assert.deepEqual(
    flies,
    ambientFlies('research', bounds, anchor, activeAt, 1),
  );
  assert.ok(flies.length >= 1 && flies.length <= 2);
  for (const fly of flies) {
    assert.ok(fly.x >= bounds.x + 10 && fly.x <= bounds.x + bounds.w - 10);
    assert.ok(fly.y >= bounds.y + 16 && fly.y <= bounds.y + bounds.h - 14);
  }
  assert.deepEqual(ambientFlies('research', bounds, anchor, activeAt, 0), []);
  assert.deepEqual(
    ambientFlies('research', bounds, anchor, activeAt, 1, true),
    [],
  );
});
