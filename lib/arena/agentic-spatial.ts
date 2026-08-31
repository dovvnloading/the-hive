import type { AvatarProjection, Vec2 } from './agentic-types';
import {
  FACILITY_COLLISION_GEOMETRY,
  RESIDENT_BODY_CLEARANCE_PX,
} from './facility-protocol.mjs';

export const ARENA_WORLD_WIDTH = 768;
export const ARENA_WORLD_HEIGHT = 448;

// Agent-agent avoidance uses a taller body capsule than the ground-contact
// capsule used against architecture. Residents render at 24 x 48px; a
// shadow-only circle would still let bodies merge.
const CAPSULE_SEGMENT_HALF_PX = 7;
const MIN_CENTER_DISTANCE_PX = RESIDENT_BODY_CLEARANCE_PX;
const NEARBY_DISTANCE_PX = 72;
const WORLD_CAPSULE_RADIUS_PX = 10;
const WORLD_CAPSULE_SEGMENT_HALF_PX = 2;
const WORLD_CAPSULE_HALF_HEIGHT_PX =
  WORLD_CAPSULE_SEGMENT_HALF_PX + WORLD_CAPSULE_RADIUS_PX;

type SolidRect = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

function pixelPoint(position: Vec2) {
  return {
    x: (position.x / 100) * ARENA_WORLD_WIDTH,
    y: (position.y / 100) * ARENA_WORLD_HEIGHT,
  };
}

function footprintDistance(left: Vec2, right: Vec2) {
  const a = pixelPoint(left);
  const b = pixelPoint(right);
  const dx = a.x - b.x;
  const rawDy = Math.abs(a.y - b.y);
  const dy = Math.max(0, rawDy - CAPSULE_SEGMENT_HALF_PX * 2);
  return Math.hypot(dx, dy);
}

export function capsulesOverlap(left: Vec2, right: Vec2) {
  return footprintDistance(left, right) < MIN_CENTER_DISTANCE_PX;
}

function capsuleIntersectsRect(position: Vec2, rect: SolidRect) {
  const point = pixelPoint(position);
  const segmentTop = point.y - WORLD_CAPSULE_SEGMENT_HALF_PX;
  const segmentBottom = point.y + WORLD_CAPSULE_SEGMENT_HALF_PX;
  const rectRight = rect.x + rect.w;
  const rectBottom = rect.y + rect.h;
  const dx =
    point.x < rect.x
      ? rect.x - point.x
      : point.x > rectRight
        ? point.x - rectRight
        : 0;
  const dy =
    segmentBottom < rect.y
      ? rect.y - segmentBottom
      : segmentTop > rectBottom
        ? segmentTop - rectBottom
        : 0;
  return Math.hypot(dx, dy) < WORLD_CAPSULE_RADIUS_PX;
}

function capsuleInsideNavigableBounds(position: Vec2) {
  const point = pixelPoint(position);
  const geometry = FACILITY_COLLISION_GEOMETRY;
  const shell = geometry.shell;
  const left = point.x - WORLD_CAPSULE_RADIUS_PX;
  const right = point.x + WORLD_CAPSULE_RADIUS_PX;
  const top = point.y - WORLD_CAPSULE_HALF_HEIGHT_PX;
  const bottom = point.y + WORLD_CAPSULE_HALF_HEIGHT_PX;
  return (
    left >= shell.left &&
    right <= shell.right &&
    top >= shell.top &&
    bottom <= shell.bottom
  );
}

export function worldCollisionIds(position: Vec2) {
  const collisions = (FACILITY_COLLISION_GEOMETRY.solids as SolidRect[])
    .filter((rect) => capsuleIntersectsRect(position, rect))
    .map((rect) => rect.id);
  if (!capsuleInsideNavigableBounds(position))
    collisions.unshift('world-bounds');
  return collisions;
}

export function capsuleIsWorldLegal(position: Vec2) {
  return worldCollisionIds(position).length === 0;
}

function resolveWorldMotion(previous: Vec2, proposed: Vec2) {
  if (
    Math.abs(previous.x - proposed.x) < 0.0001 &&
    Math.abs(previous.y - proposed.y) < 0.0001
  ) {
    return proposed;
  }

  const previousPixels = pixelPoint(previous);
  const proposedPixels = pixelPoint(proposed);
  const distancePixels = Math.hypot(
    proposedPixels.x - previousPixels.x,
    proposedPixels.y - previousPixels.y,
  );
  const steps = Math.max(1, Math.ceil(distancePixels / 2));
  let lastLegal = capsuleIsWorldLegal(previous) ? previous : undefined;

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const candidate = {
      x: previous.x + (proposed.x - previous.x) * progress,
      y: previous.y + (proposed.y - previous.y) * progress,
    };
    if (!capsuleIsWorldLegal(candidate)) break;
    lastLegal = candidate;
  }

  if (lastLegal) return lastLegal;

  // An illegal prior position is corrupted input, not permission to repair by
  // teleporting to an unrelated legal point. Preserve it so the authoritative
  // motor layer can surface/reconcile the invariant without crossing a wall.
  return previous;
}

function winsPriority(left: AvatarProjection, right: AvatarProjection) {
  const leftAdvancing =
    left.isMoving && left.path.length > 0 && (left.routeDelayMs ?? 0) <= 0;
  const rightAdvancing =
    right.isMoving && right.path.length > 0 && (right.routeDelayMs ?? 0) <= 0;
  if (leftAdvancing !== rightAdvancing) return leftAdvancing;

  // Route order is stable for the full traversal. Giving the waiting avatar
  // priority on the next animation frame caused two agents to swap precedence
  // forever at narrow doors; the earlier route now clears before the next one.
  const leftOrder = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.routeOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder < rightOrder;

  const leftWait = left.yieldMs ?? 0;
  const rightWait = right.yieldMs ?? 0;
  if (leftWait !== rightWait) return leftWait > rightWait;
  return left.agentId.localeCompare(right.agentId) < 0;
}

function positionChanged(left: Vec2, right: Vec2) {
  const from = pixelPoint(left);
  const to = pixelPoint(right);
  return Math.hypot(to.x - from.x, to.y - from.y) >= 0.01;
}

/**
 * Resolves one small movement slice as a group. Stationary residents are
 * immutable; conflicting movers yield in stable route/agent priority order.
 */
export function resolveAvatarCollisions(
  previous: AvatarProjection[],
  proposals: AvatarProjection[],
  deltaMs: number,
) {
  const prior = new Map(previous.map((avatar) => [avatar.agentId, avatar]));
  const worldResolved: AvatarProjection[] = proposals.map((avatar) => {
    const priorAvatar = prior.get(avatar.agentId) ?? avatar;
    return {
      ...avatar,
      position: resolveWorldMotion(priorAvatar.position, avatar.position),
      isYielding: false,
      yieldingToAgentId: undefined,
    };
  });

  const moving = worldResolved
    .filter((avatar) => {
      const priorAvatar = prior.get(avatar.agentId) ?? avatar;
      return (
        avatar.isMoving &&
        positionChanged(priorAvatar.position, avatar.position)
      );
    })
    .sort((left, right) => (winsPriority(left, right) ? -1 : 1));
  const movingIds = new Set(moving.map((avatar) => avatar.agentId));
  const accepted = new Map<string, AvatarProjection>();

  // A resident without a moving proposal is an immovable obstacle. Dynamic
  // avoidance may pause a mover, but it must never author movement for someone
  // whose own projection did not move.
  for (const avatar of worldResolved) {
    if (movingIds.has(avatar.agentId)) continue;
    const priorAvatar = prior.get(avatar.agentId) ?? avatar;
    accepted.set(avatar.agentId, {
      ...avatar,
      position: { ...priorAvatar.position },
      isYielding: false,
      yieldingToAgentId: undefined,
      yieldMs: 0,
    });
  }

  for (const avatar of moving) {
    const priorAvatar = prior.get(avatar.agentId) ?? avatar;
    const priorBlocker = previous.find(
      (candidate) =>
        candidate.agentId !== avatar.agentId &&
        capsulesOverlap(avatar.position, candidate.position),
    );
    const acceptedBlocker = [...accepted.values()].find(
      (candidate) =>
        candidate.agentId !== avatar.agentId &&
        capsulesOverlap(avatar.position, candidate.position),
    );
    const blocker = priorBlocker ?? acceptedBlocker;
    accepted.set(
      avatar.agentId,
      blocker
        ? {
            ...priorAvatar,
            position: { ...priorAvatar.position },
            direction: avatar.direction,
            isYielding: true,
            yieldingToAgentId: blocker.agentId,
            yieldMs: (priorAvatar.yieldMs ?? 0) + deltaMs,
          }
        : {
            ...avatar,
            isYielding: false,
            yieldingToAgentId: undefined,
            yieldMs: 0,
          },
    );
  }

  const resolved = worldResolved.map(
    (avatar) => accepted.get(avatar.agentId) ?? avatar,
  );

  return resolved.map((avatar) => ({
    ...avatar,
    yieldMs: avatar.isYielding ? avatar.yieldMs : 0,
    nearbyAgentIds: resolved
      .filter(
        (candidate) =>
          candidate.agentId !== avatar.agentId &&
          footprintDistance(candidate.position, avatar.position) <=
            NEARBY_DISTANCE_PX,
      )
      .map((candidate) => candidate.agentId)
      .sort(),
  }));
}
