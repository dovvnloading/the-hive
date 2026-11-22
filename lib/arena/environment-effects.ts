export type LightPower = 'on' | 'off';

export type AmbientBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AmbientFly = {
  x: number;
  y: number;
  wing: 0 | 1;
};

const LIGHT_ON_TRANSITION_MS = 560;
const LIGHT_OFF_TRANSITION_MS = 420;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Derive presentation-only light intensity from the authoritative switch state.
 * Missing or old timestamps settle immediately so loading an existing run never
 * replays a transition.
 */
export function lightTransitionLevel(
  power: LightPower,
  lastChangedAt: string | undefined,
  now: number,
  reducedMotion = false,
) {
  if (reducedMotion || !lastChangedAt) return power === 'on' ? 1 : 0;
  const changedAt = Date.parse(lastChangedAt);
  if (!Number.isFinite(changedAt)) return power === 'on' ? 1 : 0;
  const duration =
    power === 'on' ? LIGHT_ON_TRANSITION_MS : LIGHT_OFF_TRANSITION_MS;
  const elapsed = now - changedAt;
  if (elapsed <= 0) return power === 'on' ? 0 : 1;
  if (elapsed >= duration) return power === 'on' ? 1 : 0;
  const progress = smoothstep(elapsed / duration);
  return power === 'on' ? progress : 1 - progress;
}

/** A restrained, deterministic lamp shimmer with one rare shallow dip. */
export function lightFlickerMultiplier(
  roomId: string,
  now: number,
  reducedMotion = false,
) {
  if (reducedMotion) return 1;
  const seed = stableHash(roomId);
  const seconds = now / 1_000;
  const micro =
    Math.sin(seconds * 4.7 + (seed % 31)) * 0.006 +
    Math.sin(seconds * 7.9 + (seed % 47) * 0.31) * 0.004;
  const cycleMs = 17_000 + (seed % 4_000);
  const rarePhase = (now + (seed % cycleMs)) % cycleMs;
  const rareDip =
    rarePhase < 180 ? -Math.sin((rarePhase / 180) * Math.PI) * 0.026 : 0;
  return clamp(1 + micro + rareDip, 0.965, 1.015);
}

/**
 * Return at most two tiny, room-bound flies near a plant. Their deterministic
 * schedule makes visual QA repeatable while still feeling occasional in play.
 */
export function ambientFlies(
  roomId: string,
  bounds: AmbientBounds,
  anchor: { x: number; y: number },
  now: number,
  lightLevel: number,
  reducedMotion = false,
): AmbientFly[] {
  if (reducedMotion || lightLevel < 0.45) return [];
  const seed = stableHash(`fly:${roomId}`);
  const cycleMs = 15_000 + (seed % 6_000);
  const activeMs = 2_600 + (seed % 900);
  const phaseMs = (now + (seed % cycleMs)) % cycleMs;
  if (phaseMs >= activeMs) return [];

  const seconds = phaseMs / 1_000;
  const count = seed % 5 === 0 ? 2 : 1;
  const minimumX = bounds.x + 10;
  const maximumX = bounds.x + bounds.w - 10;
  const minimumY = bounds.y + 16;
  const maximumY = bounds.y + bounds.h - 14;

  return Array.from({ length: count }, (_, index) => {
    const offset = index * 1.83 + (seed % 19) * 0.17;
    const x = clamp(
      anchor.x + Math.sin(seconds * 3.1 + offset) * (13 + index * 4),
      minimumX,
      maximumX,
    );
    const y = clamp(
      anchor.y - 13 + Math.cos(seconds * 4.3 + offset * 1.7) * 8,
      minimumY,
      maximumY,
    );
    return {
      x: Math.round(x),
      y: Math.round(y),
      wing: Math.floor((phaseMs + index * 70) / 90) % 2 === 0 ? 0 : 1,
    };
  });
}
