import {
  doorwayTraversalPoints,
  resourceById,
  worldEntityById,
} from './agentic-catalog.ts';
import type { RuntimeAgent, RuntimeEvent, Vec2 } from './agentic-types';

export type AudioAssetDefinition = {
  id: string;
  url: string;
  gain: number;
  offsetSeconds?: number;
};

const sound = (
  id: string,
  filename: string,
  gain: number,
  offsetSeconds?: number,
): AudioAssetDefinition => ({
  id,
  url: `/audio/hive/${filename}?v=20260904-1`,
  gain,
  ...(offsetSeconds === undefined ? {} : { offsetSeconds }),
});

/**
 * Per-file gains include the measured within-pool loudness trims. Values are
 * intentionally conservative; the buses and master stage provide additional
 * headroom when several residents work at once.
 */
export const HIVE_SOUND_POOLS = {
  ambientOffice: [
    sound('ambient-office-1', 'ambient-office-1.mp3', 0.269),
    sound('ambient-office-4', 'ambient-office-4.mp3', 0.891),
  ],
  computerWork: [
    sound('computer-keys-1', 'computer-keys-1.mp3', 0.166),
    sound('computer-keys-4', 'computer-keys-4.mp3', 0.138),
    sound('computer-typing-1', 'computer-typing-1.mp3', 0.398),
  ],
  writingWork: [
    sound('scribbling-1', 'scribbling-1.mp3', 0.569),
    sound('scribbling-2', 'scribbling-2.mp3', 0.684),
    sound('scribbling-3', 'scribbling-3.mp3', 0.841),
    sound('scribbling-4', 'scribbling-4.mp3', 0.589),
  ],
  door: [
    sound('door-3', 'door-3.mp3', 0.794),
    sound('door-4', 'door-4.mp3', 0.741),
  ],
  mailbox: [
    sound('mailbox-open-4', 'mailbox-open-4.mp3', 0.794, 0.12),
  ],
  lightSwitch: [
    // The supplied recordings contain lead-in before their physical clicks.
    sound('light-switch-2', 'light-switch-2.mp3', 0.501, 0.58),
    sound('light-switch-3', 'light-switch-3.mp3', 0.331, 0.46),
  ],
  waterPlant: [
    sound('pour-water-1', 'pour-water-1.mp3', 0.232),
    sound('pour-water-2', 'pour-water-2.mp3', 0.495),
    sound('pour-water-4', 'pour-water-4.mp3', 0.501),
  ],
  loungeMusic: [
    sound('lounge-chill-4', 'lounge-chill-4.mp3', 0.089),
  ],
} as const satisfies Record<string, readonly AudioAssetDefinition[]>;

export type SoundPoolId = keyof typeof HIVE_SOUND_POOLS;
export type WorkSoundId = 'computerWork' | 'writingWork';

export const HIVE_AUDIO_MIX = Object.freeze({
  master: 0.55,
  effects: 0.72,
  work: 0.62,
  ambience: 0.65,
  music: 0.62,
  modalDuck: 0.58,
  workMusicDuck: 0.58,
  effectMusicDuck: 0.5,
});

export const HIVE_MUSIC_TONE = Object.freeze({
  highpassHz: 160,
  presenceHz: 1_800,
  presenceDb: 1.25,
  lowpassHz: 9_000,
  saturationDrive: 1.25,
});

export const HIVE_MUSIC_TIMING = Object.freeze({
  firstGapRangeMs: [18_000, 36_000] as const,
  laterGapRangeMs: [90_000, 180_000] as const,
  fadeSeconds: 2.5,
});

export function allHiveSoundAssets() {
  return Object.values(HIVE_SOUND_POOLS).flat();
}

/** A shuffled variant pool that exhausts every item before refilling. */
export class ShuffleBag<T> {
  private remaining: T[] = [];
  private previous: T | undefined;
  private readonly items: readonly T[];
  private readonly random: () => number;

  constructor(
    items: readonly T[],
    random: () => number = Math.random,
  ) {
    if (items.length === 0) throw new Error('A shuffle bag needs an item');
    this.items = items;
    this.random = random;
  }

  next() {
    if (this.remaining.length === 0) this.refill();
    const selected = this.remaining.pop() as T;
    this.previous = selected;
    return selected;
  }

  private refill() {
    this.remaining = [...this.items];
    for (let index = this.remaining.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(
        Math.max(0, Math.min(0.999_999, this.random())) * (index + 1),
      );
      [this.remaining[index], this.remaining[randomIndex]] = [
        this.remaining[randomIndex],
        this.remaining[index],
      ];
    }
    const next = this.remaining.at(-1);
    if (
      this.remaining.length > 1 &&
      this.previous !== undefined &&
      Object.is(next, this.previous)
    ) {
      const replacementIndex = this.remaining.findIndex(
        (item) => !Object.is(item, this.previous),
      );
      const finalIndex = this.remaining.length - 1;
      [this.remaining[replacementIndex], this.remaining[finalIndex]] = [
        this.remaining[finalIndex],
        this.remaining[replacementIndex],
      ];
    }
  }
}

export function oneShotPoolForEvent(
  event: RuntimeEvent,
): Exclude<SoundPoolId, 'ambientOffice' | 'computerWork' | 'loungeMusic'> | undefined {
  if (event.kind === 'world.navigation') {
    return doorwayTraversalPoints(
      event.payload.fromLocationId,
      event.payload.toLocationId,
    ).length > 0
      ? 'door'
      : undefined;
  }
  if (event.kind === 'board.message') return 'writingWork';
  if (event.kind !== 'world.interaction') return undefined;

  const entity = worldEntityById(event.payload.entityId);
  if (
    (event.payload.verb === 'switch_on' ||
      event.payload.verb === 'switch_off') &&
    (entity?.kind === 'room-light' || entity?.kind === 'lamp')
  ) {
    return 'lightSwitch';
  }
  if (event.payload.verb === 'water' && entity?.kind === 'plant') {
    return 'waterPlant';
  }
  if (
    event.payload.entityId === 'operator-mailbox' &&
    event.payload.verb === 'read'
  ) {
    return 'mailbox';
  }
  return undefined;
}

const COMPUTER_KINDS = new Set(['computer', 'test-rig']);
const WRITING_KINDS = new Set(['writing-desk']);

export function workSoundForAgent(agent: RuntimeAgent): WorkSoundId | undefined {
  if (agent.status !== 'working') return undefined;
  const resourceId = agent.currentResourceId ?? agent.engagedResourceId;
  const resource = resourceById(resourceId ?? '');
  if (!resource) return undefined;
  if (agent.activeTool && COMPUTER_KINDS.has(resource.kind)) {
    return 'computerWork';
  }
  if (WRITING_KINDS.has(resource.kind)) return 'writingWork';
  return undefined;
}

export function freshAudioEvents(
  events: readonly RuntimeEvent[],
  afterSequence: number,
) {
  const seen = new Set<string>();
  return events
    .filter((event) => event.sequence > afterSequence)
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => {
      if (seen.has(event.eventId)) return false;
      seen.add(event.eventId);
      return true;
    });
}

export function audioPanForPosition(position?: Vec2) {
  if (!position) return 0;
  return Math.max(-0.65, Math.min(0.65, (position.x / 100) * 1.3 - 0.65));
}
