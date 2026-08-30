import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FACILITY_COLLISION_GEOMETRY,
  STATIONS,
  WORLD_EDGES,
  buildArenaPath,
  isFacilityPortalTransfer,
  slotForAgent,
  stationById,
} from '../lib/arena/agentic-catalog.ts';
import {
  ARENA_WORLD_HEIGHT,
  ARENA_WORLD_WIDTH,
  capsuleIsWorldLegal,
  capsulesOverlap,
  resolveAvatarCollisions,
  worldCollisionIds,
} from '../lib/arena/agentic-spatial.ts';

const DEFAULT_GRID_STEP_PX = 2;
const DEFAULT_MOTION_SWEEPS = 1024;

function pixelPosition(x, y) {
  return {
    x: (x / ARENA_WORLD_WIDTH) * 100,
    y: (y / ARENA_WORLD_HEIGHT) * 100,
  };
}

function worldPixels(position) {
  return {
    x: (position.x / 100) * ARENA_WORLD_WIDTH,
    y: (position.y / 100) * ARENA_WORLD_HEIGHT,
  };
}

function coverageGrid(stepPx) {
  const columns = Math.ceil(ARENA_WORLD_WIDTH / stepPx);
  const rows = Math.ceil(ARENA_WORLD_HEIGHT / stepPx);
  const legal = new Uint8Array(columns * rows);
  const componentIds = new Int32Array(columns * rows);
  componentIds.fill(-1);
  const legalIndices = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const x = Math.min(
        ARENA_WORLD_WIDTH - 0.001,
        column * stepPx + stepPx / 2,
      );
      const y = Math.min(ARENA_WORLD_HEIGHT - 0.001, row * stepPx + stepPx / 2);
      if (!capsuleIsWorldLegal(pixelPosition(x, y))) continue;
      legal[index] = 1;
      legalIndices.push(index);
    }
  }

  const queue = new Int32Array(legal.length);
  const components = [];
  for (const start of legalIndices) {
    if (componentIds[start] >= 0) continue;
    const id = components.length;
    let head = 0;
    let tail = 0;
    let count = 0;
    let minColumn = columns;
    let minRow = rows;
    let maxColumn = 0;
    let maxRow = 0;
    componentIds[start] = id;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const column = index % columns;
      const row = Math.floor(index / columns);
      count += 1;
      minColumn = Math.min(minColumn, column);
      maxColumn = Math.max(maxColumn, column);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);

      const neighbors = [
        [column - 1, row],
        [column + 1, row],
        [column, row - 1],
        [column, row + 1],
      ];
      for (const [nextColumn, nextRow] of neighbors) {
        if (
          nextColumn < 0 ||
          nextColumn >= columns ||
          nextRow < 0 ||
          nextRow >= rows
        ) {
          continue;
        }
        const next = nextRow * columns + nextColumn;
        if (!legal[next] || componentIds[next] >= 0) continue;
        componentIds[next] = id;
        queue[tail] = next;
        tail += 1;
      }
    }

    components.push({
      id,
      sampleCount: count,
      boundsPx: {
        left: minColumn * stepPx,
        top: minRow * stepPx,
        right: Math.min(ARENA_WORLD_WIDTH, (maxColumn + 1) * stepPx),
        bottom: Math.min(ARENA_WORLD_HEIGHT, (maxRow + 1) * stepPx),
      },
      stationIds: [],
    });
  }

  function componentAt(position) {
    const point = worldPixels(position);
    const centerColumn = Math.max(
      0,
      Math.min(columns - 1, Math.floor(point.x / stepPx)),
    );
    const centerRow = Math.max(
      0,
      Math.min(rows - 1, Math.floor(point.y / stepPx)),
    );
    for (let radius = 0; radius <= 2; radius += 1) {
      for (let row = centerRow - radius; row <= centerRow + radius; row += 1) {
        for (
          let column = centerColumn - radius;
          column <= centerColumn + radius;
          column += 1
        ) {
          if (column < 0 || column >= columns || row < 0 || row >= rows) {
            continue;
          }
          const id = componentIds[row * columns + column];
          if (id >= 0) return id;
        }
      }
    }
    return -1;
  }

  for (const station of STATIONS) {
    const componentId = componentAt(station.slots[0]);
    if (componentId >= 0) components[componentId].stationIds.push(station.id);
  }

  return {
    stepPx,
    columns,
    rows,
    legal,
    legalIndices,
    componentIds,
    components,
    componentAt,
  };
}

function scanLegalRun(centerX, y, radiusPx) {
  const samples = [];
  for (let x = centerX - radiusPx; x <= centerX + radiusPx; x += 1) {
    samples.push({ x, legal: capsuleIsWorldLegal(pixelPosition(x, y)) });
  }
  const centerIndex = samples.findIndex((sample) => sample.x === centerX);
  if (centerIndex < 0 || !samples[centerIndex].legal) return undefined;
  let left = centerIndex;
  let right = centerIndex;
  while (left > 0 && samples[left - 1].legal) left -= 1;
  while (right + 1 < samples.length && samples[right + 1].legal) right += 1;
  return {
    leftPx: samples[left].x,
    rightPx: samples[right].x,
    widthPx: samples[right].x - samples[left].x,
  };
}

function doorwayAudit() {
  const definitions = [
    ...FACILITY_COLLISION_GEOMETRY.northDoors.map((door) => ({
      ...door,
      orientation: 'north',
      wallTop: 184,
      wallBottom: 192,
    })),
    ...FACILITY_COLLISION_GEOMETRY.southDoors.map((door) => ({
      ...door,
      orientation: 'south',
      wallTop: 256,
      wallBottom: 320,
    })),
  ];

  return definitions.map((door) => {
    const runs = [];
    for (let y = door.wallTop; y <= door.wallBottom; y += 2) {
      const run = scanLegalRun(door.centerX, y, door.width);
      runs.push({ y, run });
    }
    const validRuns = runs
      .filter((sample) => sample.run)
      .map((sample) => sample.run);
    return {
      locationId: door.locationId,
      orientation: door.orientation,
      centerX: door.centerX,
      authoredWidthPx: door.width,
      centerlineLegal: validRuns.length === runs.length,
      minimumCapsuleLaneWidthPx:
        validRuns.length > 0
          ? Math.min(...validRuns.map((run) => run.widthPx))
          : 0,
      narrowestRun: validRuns.sort(
        (left, right) => left.widthPx - right.widthPx,
      )[0],
    };
  });
}

function routeAudit() {
  const failures = [];
  let directedEdges = 0;
  let variants = 0;
  let sampledPoints = 0;

  for (const edge of WORLD_EDGES) {
    for (const [fromId, toId] of [edge, [edge[1], edge[0]]]) {
      directedEdges += 1;
      const fromStation = stationById(fromId);
      const toStation = stationById(toId);
      for (
        let fromSlot = 0;
        fromSlot < fromStation.slots.length;
        fromSlot += 1
      ) {
        for (let toSlot = 0; toSlot < toStation.slots.length; toSlot += 1) {
          variants += 1;
          let previous = fromStation.slots[fromSlot];
          const targets = isFacilityPortalTransfer(fromId, toId)
            ? [toStation.slots[toSlot]]
            : buildArenaPath(previous, toStation.slots[toSlot], fromId, toId);
          for (const target of targets) {
            const fromPixels = worldPixels(previous);
            const toPixels = worldPixels(target);
            const distance = Math.hypot(
              toPixels.x - fromPixels.x,
              toPixels.y - fromPixels.y,
            );
            const samples = isFacilityPortalTransfer(fromId, toId)
              ? 1
              : Math.max(1, Math.ceil(distance / 0.5));
            for (let sample = 0; sample <= samples; sample += 1) {
              sampledPoints += 1;
              const progress = sample / samples;
              const point = {
                x: previous.x + (target.x - previous.x) * progress,
                y: previous.y + (target.y - previous.y) * progress,
              };
              const collisions = worldCollisionIds(point);
              if (collisions.length === 0) continue;
              failures.push({
                fromId,
                toId,
                fromSlot,
                toSlot,
                point,
                collisions,
              });
              break;
            }
            previous = target;
          }
        }
      }
    }
  }

  return { directedEdges, variants, sampledPoints, failures };
}

function reservationAudit(residentsPerStation) {
  const failures = [];
  let placements = 0;
  for (const station of STATIONS) {
    const reserved = [];
    for (let index = 0; index < residentsPerStation; index += 1) {
      const position = slotForAgent(
        station.id,
        `${station.id}-stress-${index}`,
        reserved,
      );
      placements += 1;
      const overlapIndex = reserved.findIndex((candidate) =>
        capsulesOverlap(position, candidate),
      );
      const collisions = worldCollisionIds(position);
      if (collisions.length > 0 || overlapIndex >= 0) {
        failures.push({
          stationId: station.id,
          residentIndex: index,
          position,
          collisions,
          overlapIndex,
        });
      }
      reserved.push(position);
    }
  }
  return { residentsPerStation, placements, failures };
}

function auditAvatar(agentId, position) {
  return {
    agentId,
    position,
    path: [],
    direction: 'south',
    isMoving: false,
    routeOrder: 0,
    stationId: 'hall-center',
    lastStationId: 'hall-center',
  };
}

function motionSweepAudit(coverage, sweepCount) {
  let seed = 0x6d2b79f5;
  const randomIndex = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) | 0;
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) % coverage.legalIndices.length;
  };
  const failures = [];
  let blockedChords = 0;
  let clearChords = 0;

  for (let sweep = 0; sweep < sweepCount; sweep += 1) {
    const fromIndex = coverage.legalIndices[randomIndex()];
    const toIndex = coverage.legalIndices[randomIndex()];
    const fromColumn = fromIndex % coverage.columns;
    const fromRow = Math.floor(fromIndex / coverage.columns);
    const toColumn = toIndex % coverage.columns;
    const toRow = Math.floor(toIndex / coverage.columns);
    const from = pixelPosition(
      fromColumn * coverage.stepPx + coverage.stepPx / 2,
      fromRow * coverage.stepPx + coverage.stepPx / 2,
    );
    const to = pixelPosition(
      toColumn * coverage.stepPx + coverage.stepPx / 2,
      toRow * coverage.stepPx + coverage.stepPx / 2,
    );
    const fromPixels = worldPixels(from);
    const toPixels = worldPixels(to);
    const samples = Math.max(
      1,
      Math.ceil(
        Math.hypot(toPixels.x - fromPixels.x, toPixels.y - fromPixels.y),
      ),
    );
    let blocked = false;
    for (let sample = 1; sample < samples; sample += 1) {
      const progress = sample / samples;
      if (
        !capsuleIsWorldLegal({
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        })
      ) {
        blocked = true;
        break;
      }
    }
    if (blocked) blockedChords += 1;
    else clearChords += 1;

    const previous = auditAvatar(`sweep-${sweep}`, from);
    const proposed = { ...previous, position: to, isMoving: true };
    const [resolved] = resolveAvatarCollisions([previous], [proposed], 16);
    const reachedTarget =
      Math.abs(resolved.position.x - to.x) < 0.0001 &&
      Math.abs(resolved.position.y - to.y) < 0.0001;
    if (
      !capsuleIsWorldLegal(resolved.position) ||
      (blocked && reachedTarget) ||
      (!blocked && !reachedTarget)
    ) {
      failures.push({
        sweep,
        from,
        to,
        blocked,
        reachedTarget,
        resolved: resolved.position,
        resolvedCollisions: worldCollisionIds(resolved.position),
      });
    }
  }

  return { sweeps: sweepCount, blockedChords, clearChords, failures };
}

export function runArenaSpatialAudit({
  gridStepPx = DEFAULT_GRID_STEP_PX,
  motionSweeps = DEFAULT_MOTION_SWEEPS,
  residentsPerStation = 4,
} = {}) {
  const coverage = coverageGrid(gridStepPx);
  const illegalStationSlots = STATIONS.flatMap((station) =>
    station.slots.flatMap((slot, slotIndex) => {
      const collisions = worldCollisionIds(slot);
      return collisions.length > 0
        ? [{ stationId: station.id, slotIndex, slot, collisions }]
        : [];
    }),
  );
  const doors = doorwayAudit();
  const routes = routeAudit();
  const reservations = reservationAudit(residentsPerStation);
  const motion = motionSweepAudit(coverage, motionSweeps);
  const unseededComponents = coverage.components.filter(
    (component) => component.stationIds.length === 0,
  );
  const issues = [];
  if (coverage.components.length !== 1) {
    issues.push(`walkable plane has ${coverage.components.length} components`);
  }
  if (unseededComponents.length > 0) {
    issues.push(
      `${unseededComponents.length} walkable components have no station`,
    );
  }
  if (illegalStationSlots.length > 0) {
    issues.push(
      `${illegalStationSlots.length} station slots collide with geometry`,
    );
  }
  const badDoors = doors.filter(
    // A 36px opening around the 20px ground capsule leaves a continuous 16px
    // center lane. Integer probes observe 15px on odd raster alignments.
    (door) => !door.centerlineLegal || door.minimumCapsuleLaneWidthPx < 15,
  );
  if (badDoors.length > 0)
    issues.push(`${badDoors.length} doorways are too narrow`);
  if (routes.failures.length > 0) {
    issues.push(`${routes.failures.length} authored route variants collide`);
  }
  if (reservations.failures.length > 0) {
    issues.push(
      `${reservations.failures.length} overflow placements are unsafe`,
    );
  }
  if (motion.failures.length > 0) {
    issues.push(
      `${motion.failures.length} swept motions violate collision rules`,
    );
  }

  return {
    report: {
      ok: issues.length === 0,
      generatedAt: new Date().toISOString(),
      world: {
        widthPx: ARENA_WORLD_WIDTH,
        heightPx: ARENA_WORLD_HEIGHT,
        capsuleGridStepPx: gridStepPx,
      },
      coverage: {
        legalSamples: coverage.legalIndices.length,
        blockedSamples: coverage.legal.length - coverage.legalIndices.length,
        components: coverage.components,
        unseededComponents: unseededComponents.map((component) => component.id),
      },
      stationSlots: {
        stations: STATIONS.length,
        slots: STATIONS.reduce(
          (total, station) => total + station.slots.length,
          0,
        ),
        illegal: illegalStationSlots,
      },
      doors,
      routes,
      reservations,
      motion,
      issues,
    },
    coverage,
  };
}

function svgEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderArenaSpatialAuditSvg({ report, coverage }) {
  const legalRuns = [];
  for (let row = 0; row < coverage.rows; row += 1) {
    let start = -1;
    for (let column = 0; column <= coverage.columns; column += 1) {
      const legal =
        column < coverage.columns &&
        coverage.legal[row * coverage.columns + column];
      if (legal && start < 0) start = column;
      if (legal || start < 0) continue;
      legalRuns.push(
        `<rect x="${start * coverage.stepPx}" y="${row * coverage.stepPx}" width="${(column - start) * coverage.stepPx}" height="${coverage.stepPx}"/>`,
      );
      start = -1;
    }
  }
  const solids = FACILITY_COLLISION_GEOMETRY.solids.map(
    (solid) =>
      `<rect x="${solid.x}" y="${solid.y}" width="${solid.w}" height="${solid.h}"><title>${svgEscape(solid.id)}</title></rect>`,
  );
  const slots = STATIONS.flatMap((station) =>
    station.slots.map((slot) => {
      const point = worldPixels(slot);
      return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="2"><title>${svgEscape(station.id)}</title></circle>`;
    }),
  );
  const doors = report.doors.map((door) => {
    const y = door.orientation === 'north' ? 188 : 288;
    const run = door.narrowestRun;
    return run
      ? `<line x1="${run.leftPx}" y1="${y}" x2="${run.rightPx}" y2="${y}"><title>${svgEscape(door.locationId)}: ${run.widthPx}px capsule lane</title></line>`
      : '';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ARENA_WORLD_WIDTH}" height="${ARENA_WORLD_HEIGHT}" viewBox="0 0 ${ARENA_WORLD_WIDTH} ${ARENA_WORLD_HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">Arena spatial coverage audit</title>
  <desc id="desc">Green is capsule-reachable space, red is authored collision geometry, cyan marks station slots, and yellow marks the minimum usable doorway lane.</desc>
  <rect width="100%" height="100%" fill="#110f0d"/>
  <g fill="#58b67a" fill-opacity="0.32">${legalRuns.join('')}</g>
  <g fill="#d85f52" fill-opacity="0.48" stroke="#f08a78" stroke-width="0.5">${solids.join('')}</g>
  <g fill="#5dc7d7">${slots.join('')}</g>
  <g stroke="#f0c85a" stroke-width="2">${doors.join('')}</g>
  <g font-family="monospace" font-size="10" fill="#f2e9da">
    <text x="38" y="24">capsule grid ${coverage.stepPx}px · ${report.coverage.legalSamples} legal samples · ${report.coverage.components.length} component · ${report.routes.variants} route variants</text>
  </g>
</svg>`;
}

async function main() {
  const audit = runArenaSpatialAudit();
  const outputRoot = path.resolve(process.cwd(), 'outputs', 'spatial-audit');
  await fs.mkdir(outputRoot, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(outputRoot, 'arena-spatial-audit.json'),
      `${JSON.stringify(audit.report, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(outputRoot, 'arena-spatial-audit.svg'),
      renderArenaSpatialAuditSvg(audit),
    ),
  ]);
  console.log(JSON.stringify(audit.report, null, 2));
  if (!audit.report.ok) process.exitCode = 1;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) await main();
