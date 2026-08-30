/**
 * Runtime-neutral facility contract shared by the browser projection and the
 * loopback bridge. Keep this file free of DOM and Node-only dependencies.
 */

export const AUTONOMY_DIRECTIVE =
  'Advance the assignment independently. Observe the local surroundings and the residents sharing them, choose each meaningful movement and interaction, approach people when conversation would help, yield only to occupied destinations or in-use paths, use only physically engaged facility resources for real work, record durable findings, coordinate at the comms board, refresh perception after each transition, and stop only when the assignment is complete or genuinely blocked.';

export const SELF_DIRECTED_DIRECTIVE =
  'No task has been imposed. Live from your own situated perspective: observe what is present and who shares the space, decide what matters to you, form a goal, and pursue or revise it through grounded movement, interaction, conversation, and real facility tools. You may intentionally approach someone into speaking range when a clear place remains, explore, maintain the space, investigate an unknown, collaborate, decline an invitation, rest, or leave something alone. Yield to occupied destinations and in-use paths without treating nearby people as barriers. Do not act merely because an affordance exists; act only when you have a reason grounded in what you perceive.';

export const RESIDENT_PURPOSE_PROFILES = Object.freeze({
  explorer: Object.freeze({
    id: 'explorer',
    label: 'Explorer',
    charterPath: '.codex/residents/EXPLORER.md',
    drives: Object.freeze([
      'reduce consequential uncertainty',
      'find primary-source evidence',
      'leave reusable source notes',
    ]),
    preferredTracks: Object.freeze([
      'external-evidence',
      'technical-sources',
      'prior-art',
      'project-context',
    ]),
  }),
  maker: Object.freeze({
    id: 'maker',
    label: 'Maker',
    charterPath: '.codex/residents/MAKER.md',
    drives: Object.freeze([
      'turn grounded needs into working changes',
      'inspect real system state',
      'carry changes through verification',
    ]),
    preferredTracks: Object.freeze([
      'project-context',
      'technical-sources',
      'user-workflow',
      'validation',
    ]),
  }),
  critic: Object.freeze({
    id: 'critic',
    label: 'Critic',
    charterPath: '.codex/residents/CRITIC.md',
    drives: Object.freeze([
      'challenge risky claims with evidence',
      'reproduce before judging',
      'leave actionable validation results',
    ]),
    preferredTracks: Object.freeze([
      'validation',
      'prior-art',
      'technical-sources',
      'user-workflow',
    ]),
  }),
  steward: Object.freeze({
    id: 'steward',
    label: 'Steward',
    charterPath: '.codex/residents/STEWARD.md',
    drives: Object.freeze([
      'maintain shared continuity',
      'notice unmet living and social needs',
      'connect people, evidence, and follow-through',
    ]),
    preferredTracks: Object.freeze([
      'user-workflow',
      'project-context',
      'validation',
      'external-evidence',
    ]),
  }),
  generalist: Object.freeze({
    id: 'generalist',
    label: 'Generalist',
    charterPath: '.codex/residents/GENERALIST.md',
    drives: Object.freeze([
      'find the current bottleneck',
      'complete one coherent work arc',
      'adapt when evidence changes',
    ]),
    preferredTracks: Object.freeze([
      'project-context',
      'technical-sources',
      'external-evidence',
      'prior-art',
      'user-workflow',
      'validation',
    ]),
  }),
});

export function residentPurposeProfile(role) {
  const normalized = String(role || '').toLowerCase();
  if (/test|verify|review|audit|critic|quality/.test(normalized))
    return RESIDENT_PURPOSE_PROFILES.critic;
  if (
    /orchestrat|coordinat|steward|care|operation|facilit|social/.test(
      normalized,
    )
  )
    return RESIDENT_PURPOSE_PROFILES.steward;
  if (/build|engineer|implement|developer|maker|fabricat/.test(normalized))
    return RESIDENT_PURPOSE_PROFILES.maker;
  if (/research|source|analyst|evidence|explor|observ/.test(normalized))
    return RESIDENT_PURPOSE_PROFILES.explorer;
  return RESIDENT_PURPOSE_PROFILES.generalist;
}

// Physical and social proximity are deliberately different concepts. The
// The rendered resident is 24px wide and 48px tall. A 32px center clearance
// leaves visible shoulder room instead of allowing two sprites to touch or
// appear to pass through one another while their feet remain technically
// disjoint. Conversation range remains a separate social affordance.
export const RESIDENT_BODY_CLEARANCE_PX = 32;
export const RESIDENT_CONVERSATION_RANGE_PX = 80;

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

const worldPercent = (x, y) =>
  Object.freeze({ x: (x / 768) * 100, y: (y / 448) * 100 });

export const LIGHT_SWITCH_REACH_PX = 56;

/**
 * One authoritative light layout shared by rendering, navigation, and the
 * interaction validator. `standPosition` is a legal floor capsule location;
 * `controlPosition` is the visible wall switch that the resident must reach.
 */
export const FACILITY_LIGHT_LAYOUT = Object.freeze({
  research: Object.freeze({
    fixtureX: 224,
    fixtureY: 58,
    switchX: 196,
    switchY: 60,
    variant: 'single',
    // Stand west of the workstation instead of walking vertically through its
    // left monitor bank. This point remains within the physical switch reach.
    standPosition: worldPercent(176, 108),
    controlPosition: worldPercent(196, 60),
  }),
  command: Object.freeze({
    fixtureX: 430,
    fixtureY: 58,
    switchX: 272,
    switchY: 60,
    variant: 'single',
    standPosition: worldPercent(272, 108),
    controlPosition: worldPercent(272, 60),
  }),
  tools: Object.freeze({
    fixtureX: 700,
    fixtureY: 58,
    // Keep the switch on the plaster wall, in the clear strip west of the
    // mounted tools board. The former y=94 position sat on the floor seam and
    // visually collided with the fern below it.
    switchX: 512,
    switchY: 60,
    variant: 'single',
    standPosition: worldPercent(520, 108),
    controlPosition: worldPercent(512, 60),
  }),
  synthesis: Object.freeze({
    fixtureX: 256,
    fixtureY: 288,
    switchX: 202,
    switchY: 286,
    variant: 'dual',
    standPosition: worldPercent(182, 322),
    controlPosition: worldPercent(202, 286),
  }),
  context: Object.freeze({
    fixtureX: 408,
    fixtureY: 288,
    switchX: 368,
    switchY: 286,
    variant: 'single',
    standPosition: worldPercent(352, 322),
    controlPosition: worldPercent(368, 286),
  }),
  build: Object.freeze({
    fixtureX: 520,
    fixtureY: 288,
    switchX: 614,
    switchY: 286,
    variant: 'dual',
    standPosition: worldPercent(600, 322),
    controlPosition: worldPercent(614, 286),
  }),
});

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
  // Retained as a named region for protocol compatibility. In v2 the arrival
  // landing is inside Commons; no navigable floor protrudes beyond the shell.
  exteriorLanding: Object.freeze({ x: 320, y: 366, w: 128, h: 50 }),
  northDoors: Object.freeze([
    Object.freeze({
      locationId: 'door-research',
      centerX: 144,
      y: 215,
      width: 36,
    }),
    Object.freeze({
      locationId: 'door-command',
      centerX: 352,
      y: 215,
      width: 36,
    }),
    Object.freeze({
      locationId: 'door-tools',
      centerX: 592,
      y: 215,
      width: 36,
    }),
  ]),
  southDoors: Object.freeze([
    Object.freeze({
      locationId: 'door-synthesis',
      centerX: 176,
      y: 233,
      width: 36,
    }),
    Object.freeze({
      locationId: 'door-context',
      centerX: 344,
      y: 233,
      width: 36,
    }),
    Object.freeze({
      locationId: 'door-build',
      centerX: 592,
      y: 233,
      width: 36,
    }),
  ]),
  liftOpening: Object.freeze({
    locationId: 'spawn-lift',
    centerX: 408,
    y: 304,
    width: 64,
  }),
  solids: Object.freeze([
    // The visible plaster strips are walls. South-room back walls are split
    // around their 36px door openings so the rendered passages and collision
    // mesh describe the same space.
    Object.freeze({ id: 'back-wall-research', x: 32, y: 32, w: 224, h: 64 }),
    Object.freeze({ id: 'back-wall-command', x: 256, y: 32, w: 192, h: 64 }),
    Object.freeze({ id: 'back-wall-tools', x: 448, y: 32, w: 288, h: 64 }),
    Object.freeze({
      id: 'back-wall-synthesis-west',
      x: 32,
      y: 256,
      w: 126,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-synthesis-east',
      x: 194,
      y: 256,
      w: 126,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-context-west',
      x: 320,
      y: 256,
      w: 6,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-context-east',
      x: 362,
      y: 256,
      w: 86,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-build-west',
      x: 448,
      y: 256,
      w: 126,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-build-east',
      x: 610,
      y: 256,
      w: 126,
      h: 64,
    }),

    // North-room bottom walls are also split around their thresholds.
    Object.freeze({
      id: 'threshold-research-west',
      x: 32,
      y: 184,
      w: 94,
      h: 8,
    }),
    Object.freeze({
      id: 'threshold-research-east',
      x: 162,
      y: 184,
      w: 94,
      h: 8,
    }),
    Object.freeze({
      id: 'threshold-command-west',
      x: 256,
      y: 184,
      w: 78,
      h: 8,
    }),
    Object.freeze({
      id: 'threshold-command-east',
      x: 370,
      y: 184,
      w: 78,
      h: 8,
    }),
    Object.freeze({ id: 'threshold-tools-west', x: 448, y: 184, w: 126, h: 8 }),
    Object.freeze({ id: 'threshold-tools-east', x: 610, y: 184, w: 126, h: 8 }),

    // Full-height room partitions match the renderer exactly.
    Object.freeze({
      id: 'partition-research-command',
      x: 252,
      y: 32,
      w: 8,
      h: 160,
    }),
    Object.freeze({
      id: 'partition-command-tools',
      x: 444,
      y: 32,
      w: 8,
      h: 160,
    }),
    Object.freeze({
      id: 'partition-synthesis-context',
      x: 316,
      y: 256,
      w: 8,
      h: 160,
    }),
    Object.freeze({
      id: 'partition-context-build',
      x: 444,
      y: 256,
      w: 8,
      h: 160,
    }),

    // Floor-standing fixtures match the opaque bodies of the extracted
    // top-down sprites. Chairs are physical while a resident is walking; a
    // seated resident is projected onto the chair only after `use` engages the
    // resource. The corresponding navigation slots sit in the clear aisle.
    // The generated workstation is 54 x 40 at (190, 108). The old collision
    // rectangle covered only its center, letting a resident traverse the left
    // monitor bank on the way to the Research light switch.
    Object.freeze({ id: 'research-desk-b-body', x: 190, y: 108, w: 54, h: 40 }),
    Object.freeze({ id: 'command-table-body', x: 326, y: 126, w: 50, h: 18 }),
    Object.freeze({ id: 'utility-shell-a-body', x: 455, y: 110, w: 50, h: 18 }),
    Object.freeze({
      id: 'utility-connector-b-body',
      x: 670,
      y: 110,
      w: 46,
      h: 18,
    }),
    Object.freeze({ id: 'synthesis-sofa-body', x: 48, y: 346, w: 40, h: 22 }),
    Object.freeze({ id: 'publish-console-body', x: 219, y: 320, w: 50, h: 18 }),
    Object.freeze({ id: 'context-kiosk-body', x: 354, y: 350, w: 32, h: 18 }),
    Object.freeze({ id: 'build-bench-a-body', x: 455, y: 338, w: 50, h: 18 }),
    Object.freeze({ id: 'verify-rig-b-body', x: 662, y: 338, w: 46, h: 18 }),

    // Seat footprints. Interaction targets deliberately stop ten pixels clear
    // of these bodies and only the renderer performs the final seated snap.
    Object.freeze({ id: 'chair-archive-body', x: 67, y: 140, w: 18, h: 16 }),
    Object.freeze({
      id: 'chair-research-b-body',
      x: 216,
      y: 138,
      w: 16,
      h: 18,
    }),
    Object.freeze({
      id: 'chair-command-west-body',
      x: 310,
      y: 137,
      w: 16,
      h: 18,
    }),
    Object.freeze({
      id: 'chair-command-east-body',
      x: 385,
      y: 136,
      w: 16,
      h: 19,
    }),
    Object.freeze({ id: 'chair-shell-a-body', x: 472, y: 138, w: 16, h: 18 }),
    Object.freeze({
      id: 'chair-connector-b-body',
      x: 688,
      y: 138,
      w: 16,
      h: 18,
    }),
    Object.freeze({ id: 'chair-publish-body', x: 239, y: 355, w: 16, h: 18 }),
    Object.freeze({ id: 'chair-build-a-body', x: 475, y: 375, w: 16, h: 16 }),
    Object.freeze({ id: 'chair-verify-b-body', x: 680, y: 375, w: 16, h: 16 }),

    // Living floor props occupy a small pot footprint. Their interaction
    // locations sit immediately in front of the pot and remain legal.
    Object.freeze({ id: 'archive-lamp-body', x: 226, y: 88, w: 16, h: 30 }),
    Object.freeze({ id: 'research-plant-body', x: 42, y: 158, w: 16, h: 22 }),
    Object.freeze({ id: 'command-plant-body', x: 420, y: 92, w: 16, h: 8 }),
    Object.freeze({ id: 'tools-plant-body', x: 584, y: 92, w: 16, h: 8 }),
    Object.freeze({ id: 'synthesis-plant-body', x: 42, y: 386, w: 16, h: 22 }),
    Object.freeze({ id: 'context-plant-body', x: 421, y: 386, w: 16, h: 22 }),
    Object.freeze({ id: 'build-plant-body', x: 554, y: 320, w: 16, h: 8 }),
  ]),
});

export const FACILITY_RESOURCES = Object.freeze([
  {
    id: 'archive-desk',
    roomId: 'research',
    label: 'Source archive',
    kind: 'archive',
    description:
      'A local source archive for inspecting project evidence, prior decisions, and recorded references before or after external research.',
    position: { x: 10.417, y: 35.714 },
    slots: [{ x: 10.417, y: 37.946 }],
    // The authored armchair is 30 px wide at x=61. Its visual center is x=76,
    // not the old navigation slot at x=80; keep the seated projection centered
    // on the furniture while the standing slot remains collision-safe.
    seatedPositions: [{ x: 9.896, y: 35.714 }],
    seatedDirections: ['south'],
    capacity: 1,
    capabilities: ['read'],
  },
  {
    id: 'research-computer-b',
    roomId: 'research',
    label: 'Connected research computer',
    kind: 'computer',
    description:
      'A connected workstation for real web search and browsing. Live external calls happen here and useful findings should become URL-backed source notes.',
    position: { x: 29.167, y: 35.714 },
    // Approach from the workstation's clear west side. `use` performs the
    // deliberate visual snap onto the chair only after physical engagement.
    slots: [{ x: 22.917, y: 35.714 }],
    seatedPositions: [{ x: 29.167, y: 32.143 }],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['search', 'browse'],
  },
  {
    id: 'command-table',
    roomId: 'command',
    label: 'Directive table',
    kind: 'table',
    position: { x: 45.703, y: 35.714 },
    slots: [
      { x: 40.755, y: 37.946 },
      { x: 50.651, y: 37.946 },
    ],
    seatedPositions: [
      { x: 40.755, y: 35.714 },
      { x: 50.651, y: 35.714 },
    ],
    seatedDirections: ['east', 'west'],
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'comms-board',
    roomId: 'command',
    label: 'Authenticated comms',
    kind: 'board',
    position: { x: 53.125, y: 25 },
    slots: [
      { x: 51.042, y: 25 },
      { x: 55.208, y: 25 },
    ],
    capacity: 2,
    capabilities: ['communicate'],
  },
  {
    id: 'shell-console-a',
    roomId: 'tools',
    label: 'Shell console',
    kind: 'computer',
    description:
      'A project-local terminal for real shell commands and filesystem inspection. Its screen reflects actual command work, not decorative activity.',
    position: { x: 62.5, y: 35.714 },
    slots: [{ x: 62.5, y: 37.946 }],
    seatedPositions: [{ x: 62.5, y: 32.143 }],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['shell', 'filesystem'],
  },
  {
    id: 'connector-console-b',
    roomId: 'tools',
    label: 'Connector console',
    kind: 'computer',
    description:
      'A workstation for actual configured connectors, APIs, and external services available to the resident process.',
    position: { x: 90.625, y: 35.714 },
    slots: [{ x: 90.625, y: 37.946 }],
    seatedPositions: [{ x: 90.625, y: 32.143 }],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['connector'],
  },
  {
    id: 'publish-console',
    roomId: 'synthesis',
    label: 'Decision console',
    kind: 'computer',
    description:
      'A review and publication station for reconciling artifacts into explicit decisions and durable handoffs.',
    position: { x: 27.083, y: 81.696 },
    slots: [{ x: 31.25, y: 87.946 }],
    // This chair is authored at (237, 349), so its actual seat center is
    // (247, 363). It is not interchangeable with the Research desk anchor.
    seatedPositions: [{ x: 32.161, y: 81.027 }],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['review', 'publish'],
  },
  {
    id: 'context-kiosk',
    roomId: 'context',
    label: 'Context desk and resident journal',
    kind: 'writing-desk',
    description:
      'A compact writing desk holding the local context ledger and a bound resident journal. The journal opens a separate private volume for each resident; other residents cannot read those pages.',
    position: { x: 48.177, y: 85.714 },
    slots: [
      { x: 47.135, y: 85.714 },
      { x: 51.302, y: 85.714 },
    ],
    capacity: 2,
    capabilities: ['context', 'private-journal'],
  },
  {
    id: 'commons',
    roomId: 'context',
    label: 'Commons',
    kind: 'waiting',
    position: { x: 45.833, y: 89.286 },
    slots: [
      { x: 43.75, y: 89.286 },
      { x: 47.917, y: 89.286 },
    ],
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'spawn-lift',
    roomId: 'context',
    label: 'Commons arrival point',
    kind: 'arrival',
    position: { x: 54.688, y: 75.893 },
    slots: [
      { x: 53.125, y: 75.893 },
      { x: 56.25, y: 75.893 },
    ],
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'build-bench-a',
    roomId: 'build',
    label: 'Fabrication bench',
    kind: 'workbench',
    description:
      'A fabrication station for real file edits and builds. Successful work should leave an inspectable change artifact.',
    position: { x: 62.5, y: 85.714 },
    slots: [{ x: 62.5, y: 90.067 }],
    seatedPositions: [{ x: 62.5, y: 85.714 }],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['edit', 'build'],
  },
  {
    id: 'verify-rig-b',
    roomId: 'build',
    label: 'Diagnostic rig',
    kind: 'test-rig',
    description:
      'A diagnostic station for real tests, audits, builds, and reviews. Results should name what actually ran and what remains uncertain.',
    position: { x: 89.583, y: 85.714 },
    slots: [{ x: 89.583, y: 90.067 }],
    seatedPositions: [{ x: 89.583, y: 85.714 }],
    seatedDirections: ['north'],
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
    position: { x: 44.792, y: 74.107 },
    slots: [{ x: 44.792, y: 74.107 }],
    capacity: 1,
    capabilities: [],
  },
  {
    id: 'door-context',
    roomId: 'corridor',
    label: 'Commons doorway',
    kind: 'portal',
    position: { x: 44.792, y: 52 },
    // A portal is a threshold, never a place to stand in the opening. The
    // resident waits in a clear corridor bay before crossing the jamb.
    slots: [{ x: 40.625, y: 50 }],
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
    ['research', 18.75, 48, 37.5, 14.583],
    ['command', 45.833, 48, 37.5, 50],
    ['tools', 77.083, 48, 37.5, 72.917],
    ['synthesis', 22.917, 52, 88, 27.083],
    ['build', 77.083, 52, 88, 81.25],
  ].flatMap(([roomId, x, doorY, hubY, stagingX]) => [
    {
      id: `door-${roomId}`,
      roomId: 'corridor',
      label: `${roomId} doorway`,
      kind: 'portal',
      position: { x, y: doorY },
      // Residents queue beside the threshold in an authored corridor bay;
      // the opening itself remains clear for the motor transfer.
      slots: [{ x: stagingX, y: 50 }],
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

const LIGHT_INTERACTIONS = Object.freeze([
  Object.freeze({
    verb: 'inspect',
    result:
      'The room light has a physical switch and a warm ceiling fixture tied to this room only.',
  }),
  Object.freeze({
    verb: 'switch_on',
    requires: { power: 'off' },
    set: { power: 'on' },
    result:
      'The room light comes on and the local floor is evenly illuminated.',
  }),
  Object.freeze({
    verb: 'switch_off',
    requires: { power: 'on' },
    set: { power: 'off' },
    result: 'The room light clicks off; only spill and task lighting remain.',
  }),
]);

const PLANT_INTERACTIONS = Object.freeze([
  Object.freeze({
    verb: 'inspect',
    result:
      'The pot has visible soil and leaves whose posture reflects its hydration.',
  }),
  Object.freeze({
    verb: 'water',
    effect: 'water_plant',
    result:
      'Water settles into the soil and the plant begins recovering its posture.',
  }),
  Object.freeze({
    verb: 'replace',
    effect: 'replace_plant',
    result:
      'The dead plant is removed and a new seedling is established in fresh soil.',
  }),
]);

function roomLight(id, roomId, label, layout, power = 'on') {
  return Object.freeze({
    id,
    roomId,
    label,
    kind: 'room-light',
    description:
      'A switched warm light that changes visibility and atmosphere only in this room.',
    position: layout.standPosition,
    slots: [layout.standPosition],
    controlPosition: layout.controlPosition,
    capacity: 1,
    capabilities: [],
    initialState: { power },
    interactions: LIGHT_INTERACTIONS,
  });
}

function livingPlant(id, roomId, label, position, hydration) {
  return Object.freeze({
    id,
    roomId,
    label,
    kind: 'plant',
    description:
      'A living potted plant. Hydration falls continuously; neglect progresses from thirsty to wilted to dead.',
    position,
    slots: [position],
    capacity: 1,
    capabilities: [],
    dynamics: Object.freeze({ kind: 'plant', decayPerMinute: 0.65 }),
    initialState: {
      _hydrationBase: hydration,
      _hydrationBaseAt: 'run-start',
      hydration,
      condition:
        hydration >= 55 ? 'healthy' : hydration >= 25 ? 'thirsty' : 'wilted',
      lastWateredAt: 'never',
    },
    interactions: PLANT_INTERACTIONS,
  });
}

/** Stateful objects whose consequences are owned by the environment. */
export const FACILITY_PROPS = Object.freeze([
  {
    id: 'archive-lamp',
    roomId: 'research',
    label: 'Archive reading lamp',
    kind: 'lamp',
    description:
      'A task lamp aimed at the source archive. Its switch is reachable from the reading desk.',
    position: { x: 31.51, y: 35.714 },
    // Operate it from the clear service lane west of the workstation; the old
    // point sat inside the workstation's right edge once its full body was
    // represented in collision geometry.
    slots: [{ x: 22.917, y: 35.714 }],
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
    slots: [{ x: 54.688, y: 37.946 }],
    capacity: 1,
    capabilities: [],
    initialState: {},
    interactions: [
      {
        verb: 'inspect',
        result:
          'Plan read: Research and Synthesis join the west corridor; Command and Commons join the center; Tools and Build join the east; residents arrive inside Commons.',
      },
    ],
  },
  roomLight(
    'room-light-research',
    'research',
    'Research ceiling light',
    FACILITY_LIGHT_LAYOUT.research,
    'off',
  ),
  roomLight(
    'room-light-command',
    'command',
    'Command ceiling light',
    FACILITY_LIGHT_LAYOUT.command,
    'on',
  ),
  roomLight(
    'room-light-tools',
    'tools',
    'Utility ceiling light',
    FACILITY_LIGHT_LAYOUT.tools,
    'off',
  ),
  roomLight(
    'room-light-synthesis',
    'synthesis',
    'Synthesis ceiling light',
    FACILITY_LIGHT_LAYOUT.synthesis,
    'on',
  ),
  roomLight(
    'room-light-context',
    'context',
    'Commons ceiling light',
    FACILITY_LIGHT_LAYOUT.context,
    'on',
  ),
  roomLight(
    'room-light-build',
    'build',
    'Build ceiling light',
    FACILITY_LIGHT_LAYOUT.build,
    'on',
  ),
  livingPlant(
    'plant-research',
    'research',
    'Archive fern',
    { x: 9.115, y: 37.5 },
    72,
  ),
  livingPlant(
    'plant-command',
    'command',
    'Routing ivy',
    { x: 55.729, y: 25 },
    38,
  ),
  livingPlant('plant-tools', 'tools', 'Utility fern', { x: 77.083, y: 25 }, 58),
  livingPlant(
    'plant-synthesis',
    'synthesis',
    'Salon fern',
    { x: 9.115, y: 88.839 },
    22,
  ),
  livingPlant(
    'plant-context',
    'context',
    'Commons sprout',
    { x: 53.255, y: 88.839 },
    44,
  ),
  livingPlant(
    'plant-build',
    'build',
    'Workshop fern',
    { x: 75.521, y: 74.107 },
    64,
  ),
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

const PROP_EDGES = Object.freeze(
  FACILITY_PROPS.map((prop) => [prop.id, `${prop.roomId}-hub`]),
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
  ...PROP_EDGES,
  ...RESOURCE_EDGES,
]);

export const PHASE_RESOURCE = Object.freeze({
  spawning: 'spawn-lift',
  planning: 'command-table',
  delegating: 'comms-board',
  researching: 'archive-desk',
  implementing: 'build-bench-a',
  tooling: 'shell-console-a',
  verifying: 'verify-rig-b',
  synthesizing: 'publish-console',
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
