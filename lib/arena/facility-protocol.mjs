/**
 * Runtime-neutral facility contract shared by the browser projection and the
 * loopback bridge. Keep this file free of DOM and Node-only dependencies.
 */

export const AUTONOMY_DIRECTIVE =
  'Advance the assignment independently. Observe the local surroundings, choose each meaningful movement and interaction, use only physically engaged facility resources for real work, record durable findings, coordinate at the comms board, refresh perception after each transition, and stop only when the assignment is complete or genuinely blocked.';

export const RESEARCH_TRACKS = Object.freeze([
  {
    id: 'project-context',
    title: 'Project context',
    purpose:
      'Inspect the existing system, constraints, history, and available evidence.',
    subtopics: [
      'architecture',
      'requirements',
      'prior decisions',
      'local data',
    ],
  },
  {
    id: 'technical-sources',
    title: 'Technical sources',
    purpose:
      'Retrieve authoritative documentation, specifications, and implementation guidance.',
    subtopics: ['official docs', 'standards', 'APIs', 'compatibility'],
  },
  {
    id: 'external-evidence',
    title: 'External evidence',
    purpose:
      'Find current facts, primary sources, datasets, and relevant real-world examples.',
    subtopics: ['web research', 'papers', 'datasets', 'market evidence'],
  },
  {
    id: 'prior-art',
    title: 'Prior art',
    purpose:
      'Compare established patterns and identify reusable approaches or failure modes.',
    subtopics: [
      'reference products',
      'design patterns',
      'case studies',
      'anti-patterns',
    ],
  },
  {
    id: 'user-workflow',
    title: 'User and workflow',
    purpose:
      'Clarify the human objective, operating context, and measures of useful completion.',
    subtopics: ['jobs to be done', 'operators', 'handoffs', 'success criteria'],
  },
  {
    id: 'validation',
    title: 'Validation',
    purpose:
      'Collect evidence that the proposed result is correct, safe, and complete.',
    subtopics: ['tests', 'risk review', 'edge cases', 'acceptance evidence'],
  },
]);

export const FACILITY_ROOMS = Object.freeze([
  {
    id: 'research',
    label: 'RESEARCH / SOURCES',
    name: 'Research and Sources',
    purpose:
      'Select research questions, retrieve sources, and record evidence.',
    input: 'Objective, unknown, or research question',
    output: 'Source notes and evidence handoffs',
    rect: { x: 32, y: 32, w: 224, h: 160 },
  },
  {
    id: 'command',
    label: 'COMMAND / ROUTING',
    name: 'Command and Routing',
    purpose:
      'Decompose objectives, inspect the roster, and coordinate assignments.',
    input: 'Operator objective and current run context',
    output: 'Assignments, decisions, and board traffic',
    rect: { x: 256, y: 32, w: 192, h: 160 },
  },
  {
    id: 'tools',
    label: 'UTILITY / TOOLS',
    name: 'Utility and Tools',
    purpose: 'Run shell, filesystem, connector, and transformation utilities.',
    input: 'A scoped operation from an active task',
    output: 'Tool results and reusable artifacts',
    rect: { x: 448, y: 32, w: 288, h: 160 },
  },
  {
    id: 'synthesis',
    label: 'SYNTHESIS / DECISIONS',
    name: 'Synthesis and Decisions',
    purpose:
      'Reconcile findings, review handoffs, and publish the final decision.',
    input: 'Research, build, and verification artifacts',
    output: 'Decision artifacts and final handoffs',
    rect: { x: 32, y: 256, w: 288, h: 160 },
  },
  {
    id: 'context',
    label: 'CONTEXT / COMMONS',
    name: 'Context and Commons',
    purpose: 'Receive environment briefings, rendezvous, and await real input.',
    input: 'Roster, room, board, and blocker state',
    output: 'Compact situational awareness',
    rect: { x: 320, y: 256, w: 128, h: 160 },
  },
  {
    id: 'build',
    label: 'BUILD / VERIFY',
    name: 'Build and Verify',
    purpose:
      'Create changes on the west bank and test or review them on the east bank.',
    input: 'Scoped implementation and acceptance criteria',
    output: 'Change and test-result artifacts',
    rect: { x: 448, y: 256, w: 288, h: 160 },
  },
]);

/**
 * Authoritative physical geometry used by both route projection and collision
 * resolution. Coordinates are world pixels in the 768 x 448 simulation plane.
 * Wall art that hangs above the floor is intentionally omitted; every listed
 * rectangle occupies floor space and must reject an avatar capsule.
 */
export const FACILITY_COLLISION_GEOMETRY = Object.freeze({
  width: 768,
  height: 448,
  shell: Object.freeze({ left: 32, top: 32, right: 736, bottom: 416 }),
  exteriorLanding: Object.freeze({ x: 340, y: 416, w: 88, h: 32 }),
  northDoors: Object.freeze([
    Object.freeze({ locationId: 'door-research', centerX: 144, y: 192, width: 32 }),
    Object.freeze({ locationId: 'door-command', centerX: 352, y: 192, width: 32 }),
    Object.freeze({ locationId: 'door-tools', centerX: 592, y: 192, width: 32 }),
  ]),
  southDoors: Object.freeze([
    Object.freeze({ locationId: 'door-synthesis', centerX: 176, y: 256, width: 32 }),
    Object.freeze({ locationId: 'door-context', centerX: 384, y: 256, width: 32 }),
    Object.freeze({ locationId: 'door-build', centerX: 592, y: 256, width: 32 }),
  ]),
  liftOpening: Object.freeze({
    locationId: 'spawn-lift',
    centerX: 384,
    y: 416,
    width: 84,
  }),
  solids: Object.freeze([
    // Outer shell.
    Object.freeze({ id: 'wall-north', x: 27, y: 27, w: 714, h: 10 }),
    Object.freeze({ id: 'wall-west', x: 27, y: 32, w: 10, h: 384 }),
    Object.freeze({ id: 'wall-east', x: 731, y: 32, w: 10, h: 384 }),
    Object.freeze({ id: 'wall-south-west', x: 32, y: 411, w: 310, h: 10 }),
    Object.freeze({ id: 'wall-south-east', x: 426, y: 411, w: 310, h: 10 }),

    // North room wall, split at three 32px doors.
    Object.freeze({ id: 'wall-north-row-a', x: 32, y: 187, w: 96, h: 10 }),
    Object.freeze({ id: 'wall-north-row-b', x: 160, y: 187, w: 176, h: 10 }),
    Object.freeze({ id: 'wall-north-row-c', x: 368, y: 187, w: 208, h: 10 }),
    Object.freeze({ id: 'wall-north-row-d', x: 608, y: 187, w: 128, h: 10 }),

    // The room-builder atlas paints a 64px architectural wall face across the
    // north side of every south room. It is not floor. These four solids match
    // the visible face exactly and leave only the three 32px door apertures.
    Object.freeze({ id: 'wall-south-face-a', x: 32, y: 251, w: 128, h: 69 }),
    Object.freeze({ id: 'wall-south-face-b', x: 192, y: 251, w: 176, h: 69 }),
    Object.freeze({ id: 'wall-south-face-c', x: 400, y: 251, w: 176, h: 69 }),
    Object.freeze({ id: 'wall-south-face-d', x: 608, y: 251, w: 128, h: 69 }),

    // The top 64px of the north rooms is likewise an architectural wall face,
    // not navigable floor. Props mounted there remain scenery/resources whose
    // interaction anchors sit on the clear floor below.
    Object.freeze({ id: 'wall-research-face', x: 32, y: 32, w: 224, h: 64 }),
    Object.freeze({ id: 'wall-command-face', x: 256, y: 32, w: 192, h: 64 }),
    Object.freeze({ id: 'wall-tools-face', x: 448, y: 32, w: 288, h: 64 }),

    // Full-height partitions.
    Object.freeze({ id: 'partition-research-command', x: 251, y: 32, w: 10, h: 160 }),
    Object.freeze({ id: 'partition-command-tools', x: 443, y: 32, w: 10, h: 160 }),
    Object.freeze({ id: 'partition-synthesis-context', x: 315, y: 256, w: 10, h: 160 }),
    Object.freeze({ id: 'partition-context-build', x: 443, y: 256, w: 10, h: 160 }),

    // Passage jambs extend into the deep south wall. The header is overhead,
    // so it occludes sprites but does not block their foot capsules.
    ...[176, 384, 592].flatMap((centerX, index) => [
      Object.freeze({
        id: `south-jamb-${index}-west`,
        x: centerX - 20,
        y: 251,
        w: 6,
        h: 69,
      }),
      Object.freeze({
        id: `south-jamb-${index}-east`,
        x: centerX + 14,
        y: 251,
        w: 6,
        h: 69,
      }),
    ]),

    // The lift is visibly closed. Its complete façade and the two flanking wall
    // returns are a single no-walk surface; arrivals stage on the clear landing
    // immediately above it instead of standing on the door artwork.
    Object.freeze({ id: 'closed-lift-face', x: 320, y: 351, w: 128, h: 65 }),

    // Floor furniture. The front interaction edge stops above each station's
    // foot position so a seated/engaged agent remains legal while routes cannot
    // cut through the fixture body.
    Object.freeze({ id: 'archive-desk-body', x: 48, y: 96, w: 64, h: 48 }),
    Object.freeze({ id: 'research-console-bank', x: 144, y: 96, w: 112, h: 48 }),
    Object.freeze({ id: 'command-desk-body', x: 288, y: 96, w: 128, h: 48 }),
    Object.freeze({ id: 'utility-shell-a-body', x: 448, y: 96, w: 64, h: 48 }),
    Object.freeze({ id: 'utility-shell-b-body', x: 512, y: 96, w: 64, h: 48 }),
    Object.freeze({ id: 'utility-connector-a-body', x: 608, y: 96, w: 64, h: 48 }),
    Object.freeze({ id: 'utility-connector-b-body', x: 672, y: 96, w: 56, h: 48 }),
    Object.freeze({ id: 'synthesis-bench-west', x: 96, y: 320, w: 64, h: 48 }),
    Object.freeze({ id: 'synthesis-bench-east', x: 192, y: 320, w: 64, h: 48 }),
    Object.freeze({ id: 'build-bench-a-body', x: 456, y: 319, w: 54, h: 49 }),
    Object.freeze({ id: 'build-bench-b-body', x: 514, y: 319, w: 54, h: 49 }),
    Object.freeze({ id: 'verify-rig-a-body', x: 618, y: 319, w: 54, h: 49 }),
    Object.freeze({ id: 'verify-rig-b-body', x: 674, y: 319, w: 54, h: 49 }),
  ]),
});

export const FACILITY_RESOURCES = Object.freeze([
  {
    id: 'archive-desk',
    roomId: 'research',
    label: 'Source archive',
    kind: 'archive',
    position: { x: 10.417, y: 35.714 },
    slots: [{ x: 10.417, y: 35.714 }],
    capacity: 1,
    capabilities: ['read'],
  },
  {
    id: 'research-computer-a',
    roomId: 'research',
    label: 'Research computer A',
    kind: 'computer',
    position: { x: 22.917, y: 35.714 },
    slots: [{ x: 22.917, y: 35.714 }],
    capacity: 1,
    capabilities: ['search', 'browse'],
  },
  {
    id: 'research-computer-b',
    roomId: 'research',
    label: 'Research computer B',
    kind: 'computer',
    position: { x: 29.167, y: 35.714 },
    slots: [{ x: 29.167, y: 35.714 }],
    capacity: 1,
    capabilities: ['search', 'browse'],
  },
  {
    id: 'command-table',
    roomId: 'command',
    label: 'Directive table',
    kind: 'table',
    position: { x: 41.667, y: 35.714 },
    slots: [
      { x: 39.583, y: 35.714 },
      { x: 43.75, y: 35.714 },
    ],
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'comms-board',
    roomId: 'command',
    label: 'Authenticated comms',
    kind: 'board',
    position: { x: 50, y: 35.714 },
    slots: [
      { x: 47.917, y: 35.714 },
      { x: 52.083, y: 35.714 },
    ],
    capacity: 2,
    capabilities: ['communicate'],
  },
  {
    id: 'shell-console-a',
    roomId: 'tools',
    label: 'Shell console A',
    kind: 'computer',
    position: { x: 62.5, y: 35.714 },
    slots: [{ x: 62.5, y: 35.714 }],
    capacity: 1,
    capabilities: ['shell', 'filesystem'],
  },
  {
    id: 'shell-console-b',
    roomId: 'tools',
    label: 'Shell console B',
    kind: 'computer',
    position: { x: 70.833, y: 35.714 },
    slots: [{ x: 70.833, y: 35.714 }],
    capacity: 1,
    capabilities: ['shell', 'filesystem'],
  },
  {
    id: 'connector-console-a',
    roomId: 'tools',
    label: 'Connector console A',
    kind: 'computer',
    position: { x: 83.333, y: 35.714 },
    slots: [{ x: 83.333, y: 35.714 }],
    capacity: 1,
    capabilities: ['connector'],
  },
  {
    id: 'connector-console-b',
    roomId: 'tools',
    label: 'Connector console B',
    kind: 'computer',
    position: { x: 91.667, y: 35.714 },
    slots: [{ x: 91.667, y: 35.714 }],
    capacity: 1,
    capabilities: ['connector'],
  },
  {
    id: 'evidence-table',
    roomId: 'synthesis',
    label: 'Evidence table',
    kind: 'table',
    position: { x: 18.75, y: 85.714 },
    slots: [
      { x: 14.583, y: 85.714 },
      { x: 18.75, y: 85.714 },
    ],
    capacity: 2,
    capabilities: ['review'],
  },
  {
    id: 'publish-console',
    roomId: 'synthesis',
    label: 'Decision console',
    kind: 'computer',
    position: { x: 27.083, y: 85.714 },
    slots: [
      { x: 27.083, y: 85.714 },
      { x: 31.25, y: 85.714 },
    ],
    capacity: 2,
    capabilities: ['publish'],
  },
  {
    id: 'context-kiosk',
    roomId: 'context',
    label: 'Context kiosk',
    kind: 'kiosk',
    position: { x: 50, y: 75 },
    slots: [
      { x: 44.01, y: 75 },
      { x: 55.99, y: 75 },
    ],
    capacity: 2,
    capabilities: ['context'],
  },
  {
    id: 'commons',
    roomId: 'context',
    label: 'Commons',
    kind: 'waiting',
    position: { x: 50, y: 75 },
    slots: [
      { x: 44.01, y: 75 },
      { x: 55.99, y: 75 },
    ],
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'spawn-lift',
    roomId: 'context',
    label: 'Entry lift',
    kind: 'lift',
    position: { x: 50, y: 96.65 },
    slots: [
      { x: 47.75, y: 96.65 },
      { x: 52.25, y: 96.65 },
    ],
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'build-bench-a',
    roomId: 'build',
    label: 'Fabrication bench A',
    kind: 'workbench',
    position: { x: 62.5, y: 85.714 },
    slots: [{ x: 62.5, y: 85.714 }],
    capacity: 1,
    capabilities: ['edit', 'build'],
  },
  {
    id: 'build-bench-b',
    roomId: 'build',
    label: 'Fabrication bench B',
    kind: 'workbench',
    position: { x: 70.833, y: 85.714 },
    slots: [{ x: 70.833, y: 85.714 }],
    capacity: 1,
    capabilities: ['edit', 'build'],
  },
  {
    id: 'verify-rig-a',
    roomId: 'build',
    label: 'Diagnostic rig A',
    kind: 'test-rig',
    position: { x: 83.333, y: 85.714 },
    slots: [{ x: 83.333, y: 85.714 }],
    capacity: 1,
    capabilities: ['test', 'review'],
  },
  {
    id: 'verify-rig-b',
    roomId: 'build',
    label: 'Diagnostic rig B',
    kind: 'test-rig',
    position: { x: 91.667, y: 85.714 },
    slots: [{ x: 91.667, y: 85.714 }],
    capacity: 1,
    capabilities: ['test', 'review'],
  },
]);

/**
 * Non-semantic motor waypoints. These are deliberately coarse: a resident
 * chooses meaningful local steps while the renderer handles sub-token foot
 * placement and capsule avoidance between them.
 */
export const FACILITY_WAYPOINTS = Object.freeze([
  {
    id: 'context-hub',
    roomId: 'context',
    label: 'Commons landing',
    kind: 'waypoint',
    position: { x: 50, y: 75 },
    slots: [{ x: 50, y: 75 }],
    capacity: 1,
    capabilities: [],
  },
  {
    id: 'door-context',
    roomId: 'context',
    label: 'Commons doorway',
    kind: 'portal',
    position: { x: 50, y: 57.143 },
    slots: [{ x: 50, y: 57.143 }],
    capacity: 1,
    capabilities: [],
  },
  {
    id: 'hall-west',
    roomId: 'corridor',
    label: 'West corridor',
    kind: 'waypoint',
    position: { x: 22.917, y: 50 },
    slots: [
      { x: 16.167, y: 50 },
      { x: 20.667, y: 50 },
      { x: 25.167, y: 50 },
      { x: 29.667, y: 50 },
    ],
    capacity: 4,
    capabilities: [],
  },
  {
    id: 'hall-center',
    roomId: 'corridor',
    label: 'Central corridor',
    kind: 'waypoint',
    position: { x: 50, y: 50 },
    slots: [
      { x: 43.25, y: 50 },
      { x: 47.75, y: 50 },
      { x: 52.25, y: 50 },
      { x: 56.75, y: 50 },
    ],
    capacity: 4,
    capabilities: [],
  },
  {
    id: 'hall-east',
    roomId: 'corridor',
    label: 'East corridor',
    kind: 'waypoint',
    position: { x: 77.083, y: 50 },
    slots: [
      { x: 70.333, y: 50 },
      { x: 74.833, y: 50 },
      { x: 79.333, y: 50 },
      { x: 83.833, y: 50 },
    ],
    capacity: 4,
    capabilities: [],
  },
  ...[
    ['research', 18.75, 42.857, 37.5],
    ['command', 45.833, 42.857, 37.5],
    ['tools', 77.083, 42.857, 37.5],
    ['synthesis', 22.917, 57.143, 75],
    ['build', 77.083, 57.143, 75],
  ].flatMap(([roomId, x, doorY, hubY]) => [
    {
      id: `door-${roomId}`,
      roomId,
      label: `${roomId} doorway`,
      kind: 'portal',
      position: { x, y: doorY },
      slots: [{ x, y: doorY }],
      capacity: 1,
      capabilities: [],
    },
    {
      id: `${roomId}-hub`,
      roomId,
      label: `${roomId} room aisle`,
      kind: 'waypoint',
      position: { x, y: hubY },
      slots:
        roomId === 'synthesis' || roomId === 'build'
          ? [{ x, y: hubY }]
          : [
              { x: x - 2.25, y: hubY },
              { x: x + 2.25, y: hubY },
            ],
      capacity: roomId === 'synthesis' || roomId === 'build' ? 1 : 2,
      capabilities: [],
    },
  ]),
]);

/** Stateful objects whose consequences are owned by the environment. */
export const FACILITY_PROPS = Object.freeze([
  {
    id: 'archive-lamp',
    roomId: 'research',
    label: 'Archive reading lamp',
    kind: 'lamp',
    description:
      'A task lamp aimed at the source archive. Its switch is reachable from the reading desk.',
    position: { x: 11.9, y: 35.714 },
    slots: [{ x: 11.9, y: 35.714 }],
    capacity: 1,
    capabilities: [],
    initialState: { power: 'off' },
    interactions: [
      {
        verb: 'inspect',
        result: 'The lamp has a physical rocker switch and a focused shade.',
      },
      {
        verb: 'switch_on',
        requires: { power: 'off' },
        set: { power: 'on' },
        result:
          'The archive desk is now lit and its labels are easier to read.',
      },
      {
        verb: 'switch_off',
        requires: { power: 'on' },
        set: { power: 'off' },
        result:
          'The task light clicks off and the archive returns to low light.',
      },
    ],
  },
  {
    id: 'facility-plan',
    roomId: 'command',
    label: 'Mounted facility plan',
    kind: 'plan',
    description:
      'A fixed plan of the connected rooms, corridor, doors, and facility resources.',
    position: { x: 52.083, y: 35.714 },
    slots: [{ x: 52.083, y: 35.714 }],
    capacity: 1,
    capabilities: [],
    initialState: {},
    interactions: [
      {
        verb: 'inspect',
        result:
          'Plan read: Research and Synthesis join the west corridor; Command and Commons join the center; Tools and Build join the east; the entry lift is below Commons.',
      },
    ],
  },
]);

export const WORLD_LOCATIONS = Object.freeze([
  ...FACILITY_RESOURCES,
  ...FACILITY_WAYPOINTS,
  ...FACILITY_PROPS,
]);

const RESOURCE_EDGES = Object.freeze(
  FACILITY_RESOURCES.filter(
    (resource) => !new Set(['spawn-lift', 'commons']).has(resource.id),
  ).map((resource) => [resource.id, `${resource.roomId}-hub`]),
);

export const WORLD_EDGES = Object.freeze([
  ['spawn-lift', 'context-hub'],
  ['commons', 'context-hub'],
  ['context-hub', 'door-context'],
  ['door-context', 'hall-center'],
  ['hall-west', 'hall-center'],
  ['hall-center', 'hall-east'],
  ['hall-west', 'door-research'],
  ['hall-west', 'door-synthesis'],
  ['hall-center', 'door-command'],
  ['hall-east', 'door-tools'],
  ['hall-east', 'door-build'],
  ['door-research', 'research-hub'],
  ['door-command', 'command-hub'],
  ['door-tools', 'tools-hub'],
  ['door-synthesis', 'synthesis-hub'],
  ['door-build', 'build-hub'],
  ['archive-lamp', 'research-hub'],
  ['facility-plan', 'command-hub'],
  ...RESOURCE_EDGES,
]);

export const PHASE_RESOURCE = Object.freeze({
  spawning: 'spawn-lift',
  planning: 'command-table',
  delegating: 'comms-board',
  researching: 'archive-desk',
  implementing: 'build-bench-a',
  tooling: 'shell-console-a',
  verifying: 'verify-rig-a',
  synthesizing: 'evidence-table',
  waiting: 'commons',
  completed: 'publish-console',
  failed: 'commons',
  canceled: 'commons',
});

export function roomById(roomId) {
  return FACILITY_ROOMS.find((room) => room.id === roomId);
}

export function resourceById(resourceId) {
  return FACILITY_RESOURCES.find((resource) => resource.id === resourceId);
}

export function roomForResource(resourceId) {
  const resource = resourceById(resourceId);
  return resource ? roomById(resource.roomId) : undefined;
}

export function worldLocationById(locationId) {
  return WORLD_LOCATIONS.find((location) => location.id === locationId);
}

export function roomForLocation(locationId) {
  const location = worldLocationById(locationId);
  if (!location || location.roomId === 'corridor') return undefined;
  return roomById(location.roomId);
}

export function worldEntityById(entityId) {
  return (
    FACILITY_PROPS.find((entity) => entity.id === entityId) ??
    FACILITY_RESOURCES.find((entity) => entity.id === entityId)
  );
}

export function neighborsForLocation(locationId) {
  return WORLD_EDGES.flatMap(([left, right]) => {
    if (left === locationId) return [right];
    if (right === locationId) return [left];
    return [];
  });
}

export function resourcesForCapability(capability) {
  return FACILITY_RESOURCES.filter((resource) =>
    resource.capabilities.includes(capability),
  );
}

export function inferToolCapability(tool) {
  const normalized = String(tool || '').toLowerCase();
  if (/search|research|web\b|browser|fetch|http|docs?/.test(normalized))
    return 'search';
  if (/read|open|view|inspect|list|find|rg\b/.test(normalized)) return 'read';
  if (/test|lint|typecheck|verify|audit|review/.test(normalized)) return 'test';
  if (/apply.patch|edit|write|patch/.test(normalized)) return 'edit';
  if (/build|compile|bundle/.test(normalized)) return 'build';
  if (/connector|mcp|api|plugin/.test(normalized)) return 'connector';
  if (/publish|synth|final/.test(normalized)) return 'publish';
  if (/shell|terminal|exec|command|powershell|bash|cmd/.test(normalized))
    return 'shell';
  return 'filesystem';
}
