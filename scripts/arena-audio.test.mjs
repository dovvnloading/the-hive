import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  scheduleAudioEnvelope,
  silenceAudioParameter,
} from '../lib/arena/audio-envelope.ts';

class StrictAudioParameter {
  curves = [];
  values = [];
  currentTime = 942.3386666666667;
  setValueCurveAtTime(values, start, duration) {
    start = Math.max(start, this.currentTime);
    assert.ok(
      this.curves.every(
        (curve) => start >= curve.end || start + duration <= curve.start,
      ),
      'curves cannot overlap',
    );
    this.curves.push({ start, end: start + duration, values });
  }
  setValueAtTime(value, at) {
    assert.ok(
      this.curves.every((curve) => at < curve.start || at >= curve.end),
      'setValueAtTime overlaps a curve',
    );
    this.values.push({ value, at });
  }
  cancelScheduledValues(at) {
    this.curves = this.curves.filter((curve) => curve.start < at);
  }
}

void test('ambient and music envelopes survive the reported advancing-clock boundary', () => {
  const broken = new StrictAudioParameter();
  broken.setValueCurveAtTime([0, 0.269], 942.336, 1.2);
  assert.throws(
    () => broken.setValueAtTime(0.269, 943.5360000000001),
    /overlaps/,
  );
  for (const duration of [0.05, 4.3, 31, 120]) {
    const parameter = new StrictAudioParameter();
    scheduleAudioEnvelope(parameter, 0.269, 942.336, duration, 1.2);
    assert.equal(parameter.curves.length, 2);
    assert.equal(parameter.curves[0].values[0], 0);
    assert.equal(parameter.curves[1].values.at(-1), 0);
    assert.equal(
      parameter.curves[0].values.at(-1),
      parameter.curves[1].values[0],
    );
  }
});

void test('immediate stop cancels an already-running fade before setting gain', () => {
  const parameter = new StrictAudioParameter();
  scheduleAudioEnvelope(parameter, 0.3, 942.4, 12, 1.2);
  silenceAudioParameter(parameter, 942.9);
  assert.equal(parameter.curves.length, 0);
  assert.deepEqual(parameter.values, [{ value: 0, at: 942.9 }]);
});

import {
  allHiveSoundAssets,
  audioPanForPosition,
  freshAudioEvents,
  HIVE_AUDIO_MIX,
  HIVE_SOUND_POOLS,
  oneShotPoolForEvent,
  ShuffleBag,
  workSoundForAgent,
} from '../lib/arena/audio-cues.ts';

function event(kind, payload, sequence = 1, eventId = `event-${sequence}`) {
  return {
    schemaVersion: 1,
    eventId,
    sequence,
    occurredAt: '2026-09-03T12:00:00.000Z',
    source: { type: 'agent', id: 'tester' },
    runId: 'audio-test',
    agentId: 'tester',
    kind,
    payload,
  };
}

void test('every registered first-party sound has a unique URL-safe runtime asset', () => {
  const assets = allHiveSoundAssets();
  assert.equal(assets.length, 18);
  assert.equal(new Set(assets.map((asset) => asset.id)).size, assets.length);
  assert.equal(new Set(assets.map((asset) => asset.url)).size, assets.length);

  for (const asset of assets) {
    assert.match(asset.url, /^\/audio\/hive\/[a-z0-9-]+\.mp3\?v=\d{8}-\d+$/);
    assert.ok(asset.gain > 0 && asset.gain <= 1);
    const pathname = asset.url.split('?')[0];
    assert.ok(
      existsSync(resolve('public', pathname.replace(/^\//, ''))),
      `missing ${asset.url}`,
    );
  }
  for (const value of Object.values(HIVE_AUDIO_MIX)) {
    assert.ok(value > 0 && value < 1, 'every mix stage preserves headroom');
  }
});

void test('shuffle bags exhaust variants and avoid boundary repeats', () => {
  const bag = new ShuffleBag(['a', 'b', 'c'], () => 0);
  const firstCycle = [bag.next(), bag.next(), bag.next()];
  const firstAfterRefill = bag.next();
  assert.deepEqual(new Set(firstCycle), new Set(['a', 'b', 'c']));
  assert.notEqual(firstAfterRefill, firstCycle.at(-1));
});

void test('physical events map only to their intended sound families', () => {
  assert.equal(
    oneShotPoolForEvent(
      event('world.interaction', {
        entityId: 'room-light-research',
        verb: 'switch_on',
      }),
    ),
    'lightSwitch',
  );
  assert.equal(
    oneShotPoolForEvent(
      event('world.interaction', {
        entityId: 'plant-context',
        verb: 'water',
      }),
    ),
    'waterPlant',
  );
  assert.equal(
    oneShotPoolForEvent(
      event('world.interaction', {
        entityId: 'operator-mailbox',
        verb: 'read',
      }),
    ),
    'mailbox',
  );
  assert.equal(oneShotPoolForEvent(event('board.message', {})), 'writingWork');
  assert.equal(
    oneShotPoolForEvent(
      event('world.interaction', {
        entityId: 'plant-context',
        verb: 'inspect',
      }),
    ),
    undefined,
  );
});

void test('door sounds follow real room threshold traversal, not ordinary movement', () => {
  assert.equal(
    oneShotPoolForEvent(
      event('world.navigation', {
        fromLocationId: 'research-hub',
        toLocationId: 'door-research',
      }),
    ),
    'door',
  );
  assert.equal(
    oneShotPoolForEvent(
      event('world.navigation', {
        fromLocationId: 'door-research',
        toLocationId: 'hall-west',
      }),
    ),
    undefined,
  );
});

void test('work loops depend on embodied resource engagement', () => {
  const base = {
    id: 'tester',
    status: 'working',
    currentPosition: { x: 50, y: 50 },
  };
  assert.equal(
    workSoundForAgent({
      ...base,
      activeTool: 'web',
      currentResourceId: 'research-computer-b',
    }),
    'computerWork',
  );
  assert.equal(
    workSoundForAgent({
      ...base,
      currentResourceId: 'context-kiosk',
    }),
    'writingWork',
  );
  assert.equal(
    workSoundForAgent({
      ...base,
      currentResourceId: 'source-archive',
    }),
    undefined,
  );
  assert.equal(
    workSoundForAgent({
      ...base,
      status: 'idle',
      activeTool: 'web',
      currentResourceId: 'research-computer-b',
    }),
    undefined,
  );
});

void test('event watermarking sorts, de-duplicates, and ignores history', () => {
  const events = [
    event('board.message', {}, 3, 'three'),
    event('board.message', {}, 2, 'two'),
    event('board.message', {}, 2, 'two'),
    event('board.message', {}, 1, 'one'),
  ];
  assert.deepEqual(
    freshAudioEvents(events, 1).map((candidate) => candidate.eventId),
    ['two', 'three'],
  );
});

void test('world panning is bounded and centered', () => {
  assert.equal(audioPanForPosition({ x: 50, y: 10 }), 0);
  assert.equal(audioPanForPosition({ x: -100, y: 10 }), -0.65);
  assert.equal(audioPanForPosition({ x: 200, y: 10 }), 0.65);
});

void test('variant coverage matches the authored source drop', () => {
  assert.equal(HIVE_SOUND_POOLS.ambientOffice.length, 2);
  assert.equal(HIVE_SOUND_POOLS.computerWork.length, 3);
  assert.equal(HIVE_SOUND_POOLS.writingWork.length, 4);
  assert.equal(HIVE_SOUND_POOLS.door.length, 2);
  assert.equal(HIVE_SOUND_POOLS.mailbox.length, 1);
  assert.equal(HIVE_SOUND_POOLS.lightSwitch.length, 2);
  assert.equal(HIVE_SOUND_POOLS.waterPlant.length, 3);
  assert.equal(HIVE_SOUND_POOLS.loungeMusic.length, 1);
});
