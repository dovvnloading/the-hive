import type { AvatarProjection, Vec2 } from './agentic-types';
import { FACILITY_COLLISION_GEOMETRY } from './facility-protocol.mjs';

export const ARENA_WORLD_WIDTH = 768;
export const ARENA_WORLD_HEIGHT = 448;

// Agent-agent avoidance uses a taller body capsule than the ground-contact
// capsule used against architecture. Residents render at 24 x 48px; a
// shadow-only circle would still let bodies merge.
const CAPSULE_RADIUS_PX = 10;
const CAPSULE_SEGMENT_HALF_PX = 7;
const CAPSULE_CLEARANCE_PX = 2;
const MIN_CENTER_DISTANCE_PX = (CAPSULE_RADIUS_PX + CAPSULE_CLEARANCE_PX) * 2;
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
  if (!capsuleInsideNavigableBounds(position)) collisions.unshift('world-bounds');
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
  return capsuleIsWorldLegal(proposed) ? proposed : previous;
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

function separateFrom(position: Vec2, blocker: Vec2, salt: number): Vec2 {
  const point = pixelPoint(position);
  const obstacle = pixelPoint(blocker);
  let dx = point.x - obstacle.x;
  let dy = point.y - obstacle.y;
  let distance = Math.hypot(dx, dy);
  if (distance < 0.01) {
    dx = salt % 2 === 0 ? 1 : -1;
    dy = salt % 3 === 0 ? 0.35 : -0.35;
    distance = Math.hypot(dx, dy);
  }
  const scale =
    (MIN_CENTER_DISTANCE_PX + CAPSULE_SEGMENT_HALF_PX * 2 + 0.5) / distance;
  return {
    x: Math.max(
      4,
      Math.min(96, ((obstacle.x + dx * scale) / ARENA_WORLD_WIDTH) * 100),
    ),
    y: Math.max(
      6,
      Math.min(97, ((obstacle.y + dy * scale) / ARENA_WORLD_HEIGHT) * 100),
    ),
  };
}

function separateFromWithinWorld(position: Vec2, blocker: Vec2, salt: number) {
  const direct = separateFrom(position, blocker, salt);
  if (capsuleIsWorldLegal(direct) && !capsulesOverlap(direct, blocker)) {
    return direct;
  }

  const origin = pixelPoint(position);
  const obstacle = pixelPoint(blocker);
  const separationPx =
    MIN_CENTER_DISTANCE_PX + CAPSULE_SEGMENT_HALF_PX * 2 + 0.5;
  const candidates = Array.from({ length: 16 }, (_, index) => {
    const angle = ((index + salt) / 16) * Math.PI * 2;
    return {
      x:
        ((obstacle.x + Math.cos(angle) * separationPx) /
          ARENA_WORLD_WIDTH) *
        100,
      y:
        ((obstacle.y + Math.sin(angle) * separationPx) /
          ARENA_WORLD_HEIGHT) *
        100,
    };
  })
    .filter(
      (candidate) =>
        capsuleIsWorldLegal(candidate) &&
        !capsulesOverlap(candidate, blocker),
    )
    .sort((left, right) => {
      const leftPoint = pixelPoint(left);
      const rightPoint = pixelPoint(right);
      return (
        Math.hypot(leftPoint.x - origin.x, leftPoint.y - origin.y) -
        Math.hypot(rightPoint.x - origin.x, rightPoint.y - origin.y)
      );
    });
  return candidates[0] ?? position;
}

/**
 * Resolves one small movement slice as a group. Movement remains deterministic:
 * an advancing avatar wins over staged traffic, then route order and agent id.
 */
export function resolveAvatarCollisions(
  previous: AvatarProjection[],
  proposals: AvatarProjection[],
  deltaMs: number,
) {
  const prior = new Map(previous.map((avatar) => [avatar.agentId, avatar]));
  const resolved: AvatarProjection[] = proposals.map((avatar) => {
    const priorAvatar = prior.get(avatar.agentId) ?? avatar;
    const completedPortalTransfer =
      priorAvatar.portalTransfer === true && avatar.portalTransfer !== true;
    return {
      ...avatar,
      position:
        completedPortalTransfer && capsuleIsWorldLegal(avatar.position)
          ? avatar.position
          : resolveWorldMotion(priorAvatar.position, avatar.position),
      isYielding: false,
      yieldingToAgentId: undefined,
    };
  });

  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (let leftIndex = 0; leftIndex < resolved.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < resolved.length;
        rightIndex += 1
      ) {
        const left = resolved[leftIndex];
        const right = resolved[rightIndex];
        if (!capsulesOverlap(left.position, right.position)) continue;

        const winner = winsPriority(left, right) ? left : right;
        const loserIndex = winner === left ? rightIndex : leftIndex;
        const loser = resolved[loserIndex];
        const loserPrior = prior.get(loser.agentId) ?? loser;
        let fallbackPosition = loserPrior.position;
        if (capsulesOverlap(fallbackPosition, winner.position)) {
          fallbackPosition = separateFromWithinWorld(
            fallbackPosition,
            winner.position,
            loserIndex + pass,
          );
        }
        fallbackPosition = resolveWorldMotion(
          loserPrior.position,
          fallbackPosition,
        );
        resolved[loserIndex] = {
          ...loserPrior,
          position: fallbackPosition,
          direction: loser.direction,
          isYielding: true,
          yieldingToAgentId: winner.agentId,
          yieldMs: (loserPrior.yieldMs ?? 0) + deltaMs,
        };
        changed = true;
      }
    }
    if (!changed) break;
  }

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
