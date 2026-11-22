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

const worldPercent = (x, y) =>
  Object.freeze({ x: (x / 768) * 100, y: (y / 448) * 100 });

/**
 * One authoritative Commons geometry contract. Pixel coordinates describe
 * the renderer and collision plane; normalized points are shared by browser
 * projection, bridge admission, replay, and spatial tests.
 */
export const FACILITY_COMMONS_LAYOUT = Object.freeze({
  roomRect: Object.freeze({ x: 288, y: 256, w: 192, h: 160 }),
  westPartitionX: 284,
  eastPartitionX: 476,
  doorway: Object.freeze({
    centerX: 384,
    openingLeftX: 366,
    openingRightX: 402,
  }),
  exteriorLanding: Object.freeze({ x: 288, y: 366, w: 192, h: 50 }),
  liftOpening: Object.freeze({
    locationId: 'spawn-lift',
    centerX: 384,
    y: 304,
    width: 64,
  }),
  landingPosition: worldPercent(384, 332),
  landingSlots: Object.freeze([worldPercent(352, 332), worldPercent(416, 332)]),
  arrivalPosition: worldPercent(384, 378),
  arrivalSlots: Object.freeze([worldPercent(352, 378), worldPercent(416, 378)]),
  arrivalOverflowSlots: Object.freeze([
    worldPercent(320, 404),
    worldPercent(448, 404),
  ]),
  standingPosition: worldPercent(384, 404),
  standingSlots: Object.freeze([
    worldPercent(352, 404),
    worldPercent(416, 404),
  ]),
  transferJunction: worldPercent(384, 352),
});

// Compatibility export for consumers that allocate the two overflow arrival
// bays after the lift's two primary positions are occupied.
export const FACILITY_SPAWN_QUEUE_SLOTS =
  FACILITY_COMMONS_LAYOUT.arrivalOverflowSlots;

// Legacy journals without exact motor endpoints use the same authored
// Commons bays instead of maintaining private coordinate copies per runtime.
export const FACILITY_REPLAY_OVERFLOW_SLOTS = Object.freeze({
  'context-hub': FACILITY_COMMONS_LAYOUT.standingSlots,
  'context-kiosk': Object.freeze([
    worldPercent(312, 384),
    worldPercent(344, 384),
  ]),
  commons: FACILITY_COMMONS_LAYOUT.standingSlots,
});

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
    rect: { x: 32, y: 256, w: 256, h: 160 },
  },
  {
    id: 'context',
    label: 'CONTEXT / COMMONS',
    name: 'Context and Commons',
    purpose: 'Receive environment briefings, rendezvous, and await real input.',
    input: 'Roster, room, board, and blocker state',
    output: 'Compact situational awareness',
    rect: FACILITY_COMMONS_LAYOUT.roomRect,
  },
  {
    id: 'build',
    label: 'BUILD / VERIFY',
    name: 'Build and Verify',
    purpose:
      'Create changes on the west bank and test or review them on the east bank.',
    input: 'Scoped implementation and acceptance criteria',
    output: 'Change and test-result artifacts',
    rect: { x: 480, y: 256, w: 256, h: 160 },
  },
]);

// Every cloned north-facing workstation chair uses the same authored seat
// center: ten pixels right and fourteen pixels down from the chair sprite's
// top-left corner. Keeping the authoritative interaction anchor derived from
// the chair placement prevents visually identical workstations from drifting.
const northWorkstationSeat = (chairX, chairY) =>
  worldPercent(chairX + 10, chairY + 14);

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
    fixtureX: 240,
    fixtureY: 288,
    switchX: 202,
    switchY: 286,
    variant: 'dual',
    standPosition: worldPercent(182, 322),
    controlPosition: worldPercent(202, 286),
  }),
  context: Object.freeze({
    fixtureX: 448,
    fixtureY: 288,
    switchX: 424,
    switchY: 286,
    variant: 'single',
    standPosition: worldPercent(448, 332),
    controlPosition: worldPercent(424, 286),
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
 * Authored doorway centerlines. A resident first leaves the corridor staging
 * bay, aligns with the opening, crosses the wall throat, and only then enters
 * the room aisle. Lower rooms expose a full back-wall throat; upper rooms use
 * a short south-wall threshold. Bridge timing follows these same points so a
 * factual arrival cannot precede the visible body.
 */
export const FACILITY_DOOR_TRAVERSALS = Object.freeze({
  'door-research': Object.freeze({
    hubId: 'research-hub',
    points: Object.freeze([
      Object.freeze([144, 224]),
      Object.freeze([144, 204]),
      Object.freeze([144, 188]),
      Object.freeze([144, 176]),
    ]),
  }),
  'door-command': Object.freeze({
    hubId: 'command-hub',
    points: Object.freeze([
      Object.freeze([352, 224]),
      Object.freeze([352, 204]),
      Object.freeze([352, 188]),
      Object.freeze([352, 176]),
    ]),
  }),
  'door-tools': Object.freeze({
    hubId: 'tools-hub',
    points: Object.freeze([
      Object.freeze([592, 224]),
      Object.freeze([592, 204]),
      Object.freeze([592, 188]),
      Object.freeze([592, 176]),
    ]),
  }),
  'door-synthesis': Object.freeze({
    hubId: 'synthesis-hub',
    points: Object.freeze([
      Object.freeze([176, 224]),
      Object.freeze([176, 244]),
      Object.freeze([176, 288]),
      Object.freeze([176, 328]),
    ]),
  }),
  'door-context': Object.freeze({
    hubId: 'context-hub',
    points: Object.freeze([
      Object.freeze([384, 224]),
      Object.freeze([384, 244]),
      Object.freeze([384, 288]),
      Object.freeze([384, 332]),
    ]),
  }),
  'door-build': Object.freeze({
    hubId: 'build-hub',
    points: Object.freeze([
      Object.freeze([592, 224]),
      Object.freeze([592, 244]),
      Object.freeze([592, 288]),
      Object.freeze([592, 328]),
    ]),
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
  exteriorLanding: FACILITY_COMMONS_LAYOUT.exteriorLanding,
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
      centerX: FACILITY_COMMONS_LAYOUT.doorway.centerX,
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
  liftOpening: FACILITY_COMMONS_LAYOUT.liftOpening,
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
      w: 94,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-context-west',
      x: 288,
      y: 256,
      w: 78,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-context-east',
      x: 402,
      y: 256,
      w: 78,
      h: 64,
    }),
    Object.freeze({
      id: 'back-wall-build-west',
      x: 480,
      y: 256,
      w: 94,
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
      x: FACILITY_COMMONS_LAYOUT.westPartitionX,
      y: 256,
      w: 8,
      h: 160,
    }),
    Object.freeze({
      id: 'partition-context-build',
      x: FACILITY_COMMONS_LAYOUT.eastPartitionX,
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
    Object.freeze({ id: 'synthesis-sofa-body', x: 48, y: 338, w: 52, h: 38 }),
    Object.freeze({ id: 'publish-console-body', x: 203, y: 320, w: 50, h: 18 }),
    Object.freeze({ id: 'context-kiosk-body', x: 304, y: 350, w: 32, h: 18 }),
    Object.freeze({ id: 'build-bench-a-body', x: 487, y: 338, w: 50, h: 18 }),
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
      x: 376,
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
    Object.freeze({ id: 'chair-publish-body', x: 223, y: 355, w: 16, h: 18 }),
    Object.freeze({ id: 'chair-build-a-body', x: 507, y: 375, w: 16, h: 16 }),
    Object.freeze({ id: 'chair-verify-b-body', x: 680, y: 375, w: 16, h: 16 }),

    // Living floor props occupy a small pot footprint. Their interaction
    // locations sit immediately in front of the pot and remain legal.
    Object.freeze({ id: 'archive-lamp-body', x: 226, y: 88, w: 16, h: 30 }),
    Object.freeze({ id: 'research-plant-body', x: 42, y: 158, w: 16, h: 22 }),
    Object.freeze({ id: 'command-plant-body', x: 420, y: 92, w: 16, h: 8 }),
    Object.freeze({ id: 'tools-plant-body', x: 584, y: 92, w: 16, h: 8 }),
    Object.freeze({ id: 'synthesis-plant-body', x: 42, y: 386, w: 16, h: 22 }),
    Object.freeze({ id: 'context-plant-body', x: 456, y: 342, w: 16, h: 22 }),
    Object.freeze({ id: 'build-plant-body', x: 554, y: 320, w: 16, h: 8 }),
  ]),
});

function facilityActivity({
  id,
  label,
  capability,
  phase,
  description,
  proofPolicy = { requiredOnSuccess: false, artifactKinds: [] },
}) {
  return Object.freeze({
    id,
    label,
    capability,
    phase,
    description,
    proofPolicy: Object.freeze({
      requiredOnSuccess: Boolean(proofPolicy.requiredOnSuccess),
      artifactKinds: Object.freeze([...(proofPolicy.artifactKinds ?? [])]),
      ...(proofPolicy.requiresHttpSource ? { requiresHttpSource: true } : {}),
    }),
  });
}

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
    activities: [
      facilityActivity({
        id: 'archive.review-local-evidence',
        label: 'Review local evidence',
        capability: 'read',
        phase: 'researching',
        description:
          'Inspect project evidence, prior decisions, and recorded references before choosing further work.',
        proofPolicy: {
          requiredOnSuccess: false,
          artifactKinds: ['source-note', 'decision'],
        },
      }),
    ],
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
    seatedPositions: [northWorkstationSeat(214, 130)],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['search', 'browse'],
    activities: [
      facilityActivity({
        id: 'research.search-primary-sources',
        label: 'Search primary sources',
        capability: 'search',
        phase: 'researching',
        description:
          'Search the live web for authoritative evidence tied to an active question.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['source-note'],
          requiresHttpSource: true,
        },
      }),
      facilityActivity({
        id: 'research.browse-authoritative-source',
        label: 'Browse an authoritative source',
        capability: 'browse',
        phase: 'researching',
        description:
          'Open and inspect a specific primary source, preserving any useful finding as linked evidence.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['source-note'],
          requiresHttpSource: true,
        },
      }),
    ],
  },
  {
    id: 'command-table',
    roomId: 'command',
    label: 'Directive table',
    kind: 'table',
    description:
      'A shared planning table for reviewing current evidence, comparing routes, and deciding the next coordinated action.',
    position: { x: 45.703, y: 35.714 },
    slots: [
      { x: 50.651, y: 37.946 },
      { x: 40.755, y: 37.946 },
    ],
    seatedPositions: [
      // The east-side chair moved nine authored pixels west; its visual seat
      // projection must move with it rather than leaving the resident at the
      // old chair position.
      { x: 49.219, y: 33.929 },
      // Mirror the approved east-side projection around the planning table's
      // x=351 centerline: 378px on the east becomes 324px on the west.
      { x: 42.188, y: 33.929 },
    ],
    seatedDirections: ['west', 'east'],
    capacity: 2,
    capabilities: ['review'],
    activities: [
      facilityActivity({
        id: 'command.reconcile-evidence',
        label: 'Reconcile evidence',
        capability: 'review',
        phase: 'planning',
        description:
          'Compare linked evidence and frame a concrete next decision or handoff.',
        proofPolicy: {
          requiredOnSuccess: false,
          artifactKinds: ['decision'],
        },
      }),
    ],
  },
  {
    id: 'comms-board',
    roomId: 'command',
    label: 'Authenticated comms',
    kind: 'board',
    position: { x: 53.125, y: 25 },
    slots: [
      { x: 51.041, y: 25 },
      { x: 55.209, y: 25 },
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
    seatedPositions: [northWorkstationSeat(470, 130)],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['shell', 'filesystem'],
    activities: [
      facilityActivity({
        id: 'shell.inspect-project-state',
        label: 'Inspect project state',
        capability: 'filesystem',
        phase: 'tooling',
        description:
          'Read relevant project files and local state to ground a technical decision.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['source-note', 'decision'],
        },
      }),
      facilityActivity({
        id: 'shell.run-scoped-command',
        label: 'Run a scoped command',
        capability: 'shell',
        phase: 'tooling',
        description:
          'Execute a bounded project command for diagnosis, measurement, or verification.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['test-result'],
        },
      }),
    ],
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
    seatedPositions: [northWorkstationSeat(686, 130)],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['connector'],
    activities: [
      facilityActivity({
        id: 'connector.query-configured-service',
        label: 'Query a configured service',
        capability: 'connector',
        phase: 'tooling',
        description:
          'Use an actually available connector or API for a grounded objective; never simulate a connection.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['source-note', 'change', 'decision'],
        },
      }),
    ],
  },
  {
    id: 'synthesis-lounge',
    roomId: 'synthesis',
    label: 'Decision lounge',
    kind: 'sofa',
    description:
      'A quiet lounge seat for reading existing evidence and reflecting before a decision is published.',
    position: { x: 9.635, y: 83.036 },
    slots: [{ x: 9.635, y: 87.054 }],
    seatedPositions: [{ x: 9.635, y: 83.036 }],
    seatedDirections: ['south'],
    capacity: 1,
    capabilities: ['read'],
    activities: [
      facilityActivity({
        id: 'lounge.review-linked-evidence',
        label: 'Review linked evidence',
        capability: 'read',
        phase: 'synthesizing',
        description:
          'Read existing evidence and unresolved decisions before publishing a conclusion.',
        proofPolicy: {
          requiredOnSuccess: false,
          artifactKinds: ['decision'],
        },
      }),
    ],
  },
  {
    id: 'publish-console',
    roomId: 'synthesis',
    label: 'Decision console',
    kind: 'computer',
    description:
      'A review and publication station for reconciling artifacts into explicit decisions and durable handoffs.',
    position: worldPercent(192, 366),
    slots: [worldPercent(224, 394)],
    // This chair is authored at (221, 349), so its actual seat center is
    // (231, 363). It is not interchangeable with the Research desk anchor.
    seatedPositions: [worldPercent(231, 363)],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['review', 'publish'],
    activities: [
      facilityActivity({
        id: 'publish.review-evidence-chain',
        label: 'Review an evidence chain',
        capability: 'review',
        phase: 'synthesizing',
        description:
          'Reconcile linked evidence, changes, and validation into a factual conclusion.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['decision'],
        },
      }),
      facilityActivity({
        id: 'publish.record-decision',
        label: 'Record a durable decision',
        capability: 'publish',
        phase: 'synthesizing',
        description:
          'Publish an explicit decision artifact that downstream residents can acknowledge and act on.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['decision'],
        },
      }),
    ],
  },
  {
    id: 'context-kiosk',
    roomId: 'context',
    label: 'Context desk and resident journal',
    kind: 'writing-desk',
    description:
      'A compact writing desk holding the local context ledger and a bound resident journal. The journal opens a separate private volume for each resident; other residents cannot read those pages.',
    position: worldPercent(320, 384),
    slots: [worldPercent(312, 384), worldPercent(344, 384)],
    capacity: 2,
    capabilities: ['context', 'private-journal'],
  },
  {
    id: 'commons',
    roomId: 'context',
    label: 'Commons',
    kind: 'waiting',
    position: FACILITY_COMMONS_LAYOUT.standingPosition,
    slots: FACILITY_COMMONS_LAYOUT.standingSlots,
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'spawn-lift',
    roomId: 'context',
    label: 'Commons arrival point',
    kind: 'arrival',
    position: FACILITY_COMMONS_LAYOUT.arrivalPosition,
    slots: FACILITY_COMMONS_LAYOUT.arrivalSlots,
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
    position: worldPercent(512, 384),
    slots: [worldPercent(512, 403.5)],
    seatedPositions: [northWorkstationSeat(505, 367)],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['edit', 'build'],
    activities: [
      facilityActivity({
        id: 'build.implement-linked-change',
        label: 'Implement a linked change',
        capability: 'edit',
        phase: 'implementing',
        description:
          'Edit the project for an evidence-backed topic and preserve the resulting change.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['change'],
        },
      }),
      facilityActivity({
        id: 'build.compile-project',
        label: 'Build the project',
        capability: 'build',
        phase: 'implementing',
        description:
          'Run the real project build and record its factual result.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['test-result'],
        },
      }),
    ],
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
    seatedPositions: [northWorkstationSeat(678, 367)],
    seatedDirections: ['north'],
    capacity: 1,
    capabilities: ['test', 'review'],
    activities: [
      facilityActivity({
        id: 'verify.run-scoped-validation',
        label: 'Run scoped validation',
        capability: 'test',
        phase: 'verifying',
        description:
          'Execute a real test or audit against the linked change and preserve the result.',
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['test-result'],
        },
      }),
      facilityActivity({
        id: 'verify.independent-review',
        label: 'Perform independent review',
        capability: 'review',
        phase: 'verifying',
        description:
          "Review another resident's linked change and record an independent validation result.",
        proofPolicy: {
          requiredOnSuccess: true,
          artifactKinds: ['test-result'],
        },
      }),
    ],
  },
]);

const FACILITY_ACTIVITY_BY_ID = new Map();
for (const resource of FACILITY_RESOURCES) {
  for (const activity of resource.activities ?? []) {
    if (FACILITY_ACTIVITY_BY_ID.has(activity.id)) {
      throw new Error(`Duplicate facility activity id: ${activity.id}`);
    }
    if (!resource.capabilities.includes(activity.capability)) {
      throw new Error(
        `${activity.id} requires unsupported ${activity.capability} capability at ${resource.id}`,
      );
    }
    FACILITY_ACTIVITY_BY_ID.set(
      activity.id,
      Object.freeze({ resourceId: resource.id, activity }),
    );
  }
}

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
    position: FACILITY_COMMONS_LAYOUT.landingPosition,
    slots: FACILITY_COMMONS_LAYOUT.landingSlots,
    capacity: 2,
    capabilities: [],
  },
  {
    id: 'door-context',
    roomId: 'corridor',
    label: 'Commons doorway',
    kind: 'portal',
    position: { x: 50, y: 52 },
    // Stage on the physical doorway centerline at the corridor mouth so the
    // room leg proceeds directly through the jamb.
    slots: [{ x: 50, y: 50 }],
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
    ['research', 18.75, 48, 37.5],
    ['command', 45.833, 48, 37.5],
    ['tools', 77.083, 48, 37.5],
    ['synthesis', 22.917, 52, 88],
    ['build', 77.083, 52, 88],
  ].flatMap(([roomId, x, doorY, hubY]) => [
    {
      id: `door-${roomId}`,
      roomId: 'corridor',
      label: `${roomId} doorway`,
      kind: 'portal',
      position: { x, y: doorY },
      // Residents stage at the corridor mouth on the physical doorway
      // centerline. The following room leg can therefore proceed monotonically
      // through the throat instead of recrossing occupied corridor slots.
      slots: [{ x, y: 50 }],
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
          : roomId === 'research'
            ? [
                // One body waits on the upper archive lane, leaving a full
                // capsule-height bypass for the south-aisle resident.
                { x: 14.6, y: 27 },
                { x: 27.1, y: hubY },
              ]
            : [
                { x: x - 4.25, y: hubY },
                { x: x + 4.25, y: hubY },
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
  {
    id: 'parts-cabinet',
    roomId: 'research',
    label: 'Parts cabinet',
    kind: 'parts-cabinet',
    description:
      'Oak cases, index cores, and brass dials for shared workshop blueprints. A satchel holds four parts. Take and return parts here; place and assemble them at build-bench-a.',
    position: worldPercent(120, 116),
    // The east standing position clears the occupied upper archive hub.
    slots: [worldPercent(152, 116)],
    capacity: 1,
    capabilities: [],
    initialState: {},
    interactions: [
      {
        verb: 'inspect',
        result:
          'The cabinet supplies document-index projects. Take or return a named part and quantity; carry four parts at most, and place them at the fabrication bench.',
      },
    ],
  },
  {
    id: 'utility-tools-board',
    roomId: 'tools',
    label: 'Utility workflow board',
    kind: 'workflow-board',
    description:
      'A mounted guide to the shell and connector stations, their real capabilities, and the evidence expected from useful work.',
    position: { x: 77.083, y: 31.25 },
    slots: [{ x: 77.083, y: 31.25 }],
    capacity: 1,
    capabilities: [],
    initialState: {},
    interactions: [
      {
        verb: 'inspect',
        result:
          'Workflow read: use the shell console for project-local commands and files; use the connector console only for an actually configured external service; wrap real work in a truthful tool lifecycle and preserve useful evidence.',
      },
    ],
  },
  {
    id: 'build-verification-chart',
    roomId: 'build',
    label: 'Build verification chart',
    kind: 'verification-chart',
    description:
      'A mounted change-to-validation workflow showing how implementation evidence reaches independent review.',
    position: { x: 84, y: 76 },
    slots: [{ x: 84, y: 76 }],
    capacity: 1,
    capabilities: [],
    initialState: {},
    interactions: [
      {
        verb: 'inspect',
        result:
          'Chart read: link the active topic to a change at the fabrication bench, preserve its own build result, then use the diagnostic rig for an independent test-result before publication.',
      },
    ],
  },
  {
    id: 'operator-mailbox',
    roomId: 'context',
    label: 'Operator dispatch box',
    kind: 'mailbox',
    description:
      'A wall-mounted dispatch box for sealed notes from the human operator. Its raised flag means the box may contain addressed mail.',
    // The 24 x 20 sprite is mounted at (308, 300). Its resident stands below
    // the west wall segment without occupying either Commons landing lane.
    position: worldPercent(320, 334),
    slots: [worldPercent(320, 334)],
    capacity: 1,
    capabilities: [],
    initialState: {},
    interactions: [
      {
        verb: 'inspect',
        result:
          'The walnut dispatch box has a narrow letter slot, a raised brass flag, and a private addressed-mail latch.',
      },
      {
        verb: 'read',
        result:
          'The addressed-mail latch opens only for a resident with unread operator mail.',
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
    // Preserve the authored interaction offset (-12,+12) from the plant
    // sprite's new top-left corner at (456,342).
    worldPercent(444, 354),
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

const ROOM_ROUTES = Object.freeze({
  research: Object.freeze({
    hubId: 'research-hub',
    doorId: 'door-research',
    centerX: 18.75,
    aisleY: 37.5,
  }),
  command: Object.freeze({
    hubId: 'command-hub',
    doorId: 'door-command',
    centerX: 45.833,
    aisleY: 37.5,
  }),
  tools: Object.freeze({
    hubId: 'tools-hub',
    doorId: 'door-tools',
    centerX: 77.083,
    aisleY: 37.5,
  }),
  synthesis: Object.freeze({
    hubId: 'synthesis-hub',
    doorId: 'door-synthesis',
    centerX: 22.917,
    aisleY: 88,
  }),
  context: Object.freeze({
    hubId: 'context-hub',
    doorId: 'door-context',
    centerX: 50,
    aisleY: FACILITY_COMMONS_LAYOUT.standingPosition.y,
  }),
  build: Object.freeze({
    hubId: 'build-hub',
    doorId: 'door-build',
    centerX: 77.083,
    aisleY: 90.067,
  }),
});

const ENTITY_HUB_APPROACH_PATHS = Object.freeze({
  'room-light-research': Object.freeze([
    Object.freeze({
      x: FACILITY_LIGHT_LAYOUT.research.standPosition.x,
      y: 37.5,
    }),
    FACILITY_LIGHT_LAYOUT.research.standPosition,
  ]),
  'archive-lamp': Object.freeze([Object.freeze({ x: 22.917, y: 37.5 })]),
  'comms-board': Object.freeze([
    Object.freeze({ x: 54.688, y: 37.5 }),
    Object.freeze({ x: 54.688, y: 25 }),
  ]),
  'plant-tools': Object.freeze([Object.freeze({ x: 77.083, y: 25 })]),
  'plant-context': Object.freeze([FACILITY_COMMONS_LAYOUT.landingSlots[1]]),
  'context-kiosk': Object.freeze([
    // Clear the east edge of the shifted desk before traversing its south
    // interaction row.
    worldPercent(352, 380),
  ]),
  'operator-mailbox': Object.freeze([FACILITY_COMMONS_LAYOUT.landingSlots[0]]),
  'room-light-context': Object.freeze([
    FACILITY_COMMONS_LAYOUT.landingSlots[1],
  ]),
  'room-light-build': Object.freeze([
    Object.freeze({ x: 77.083, y: 90.067 }),
    Object.freeze({ x: 77.083, y: 71.875 }),
    Object.freeze({ x: 78.125, y: 71.875 }),
  ]),
});

const PORTAL_TRANSFER_KEYS = new Set([
  ['spawn-lift', 'context-hub'].sort().join('|'),
]);

const WORLD_CAPSULE_RADIUS_PX = 10;
const WORLD_CAPSULE_SEGMENT_HALF_PX = 2;
const WORLD_CAPSULE_HALF_HEIGHT_PX =
  WORLD_CAPSULE_RADIUS_PX + WORLD_CAPSULE_SEGMENT_HALF_PX;

function compactArenaPath(points) {
  return points
    .filter(
      (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y),
    )
    .filter((point, index, values) => {
      if (index === 0) return true;
      const previous = values[index - 1];
      return previous.x !== point.x || previous.y !== point.y;
    })
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

export function isFacilityPortalTransfer(fromLocationId, toLocationId) {
  if (!fromLocationId || !toLocationId) return false;
  return PORTAL_TRANSFER_KEYS.has(
    [fromLocationId, toLocationId]
      .sort((left, right) => left.localeCompare(right))
      .join('|'),
  );
}

function routeBetweenRoomEntityAndHub(
  from,
  to,
  fromLocationId,
  toLocationId,
  route,
) {
  if (fromLocationId === route.hubId) {
    return [
      { x: route.centerX, y: from.y },
      { x: route.centerX, y: route.aisleY },
      { x: to.x, y: route.aisleY },
      to,
    ];
  }
  if (toLocationId === route.hubId) {
    return [
      { x: from.x, y: route.aisleY },
      { x: route.centerX, y: route.aisleY },
      { x: route.centerX, y: to.y },
      to,
    ];
  }
  return [to];
}

const AUTHORED_SLOT_ROUTE_CHAINS = Object.freeze([
  Object.freeze({
    fromLocationId: 'door-research',
    fromSlotIndex: 0,
    toLocationId: 'research-hub',
    toSlotIndex: 1,
    via: Object.freeze([
      Object.freeze({ x: 18.75, y: 50 }),
      Object.freeze({ x: 18.75, y: 45.535714285714285 }),
      Object.freeze({ x: 18.75, y: 41.964285714285715 }),
      Object.freeze({ x: 18.75, y: 39.285714285714285 }),
      // Align inside the opening before turning east. A diagonal turn cuts
      // the threshold's east wall by less than one body radius.
      Object.freeze({ x: 18.75, y: 37.5 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'facility-plan',
    fromSlotIndex: 0,
    toLocationId: 'command-hub',
    toSlotIndex: 0,
    via: Object.freeze([
      Object.freeze({ x: 54.167, y: 31.696 }),
      Object.freeze({ x: 53.907, y: 30.803 }),
      Object.freeze({ x: 52.084, y: 27.678 }),
      Object.freeze({ x: 49.48, y: 25.446 }),
      Object.freeze({ x: 41.667, y: 25.446 }),
      Object.freeze({ x: 39.063, y: 29.017 }),
      Object.freeze({ x: 38.803, y: 34.821 }),
      Object.freeze({ x: 39.063, y: 36.16 }),
      Object.freeze({ x: 39.844, y: 37.5 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'room-light-command',
    fromSlotIndex: 0,
    toLocationId: 'command-hub',
    toSlotIndex: 1,
    via: Object.freeze([
      Object.freeze({ x: 49.479, y: 25.446 }),
      Object.freeze({ x: 52.083, y: 28.125 }),
      Object.freeze({ x: 52.344, y: 29.018 }),
      Object.freeze({ x: 52.344, y: 36.161 }),
      Object.freeze({ x: 51.563, y: 37.5 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'room-light-tools',
    fromSlotIndex: 0,
    toLocationId: 'tools-hub',
    toSlotIndex: 1,
    via: Object.freeze([Object.freeze({ x: 75, y: 27.232 })]),
  }),
  Object.freeze({
    fromLocationId: 'plant-command',
    fromSlotIndex: 0,
    toLocationId: 'command-hub',
    toSlotIndex: 0,
    via: Object.freeze([
      Object.freeze({ x: 41.927, y: 25.446 }),
      Object.freeze({ x: 39.844, y: 27.679 }),
      Object.freeze({ x: 39.062, y: 29.018 }),
      Object.freeze({ x: 39.062, y: 36.161 }),
      Object.freeze({ x: 39.844, y: 37.5 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'comms-board',
    fromSlotIndex: 0,
    toLocationId: 'command-hub',
    toSlotIndex: 0,
    via: Object.freeze([
      Object.freeze({ x: 41.926, y: 25.446 }),
      Object.freeze({ x: 39.843, y: 27.679 }),
      Object.freeze({ x: 39.062, y: 29.018 }),
      Object.freeze({ x: 39.062, y: 36.161 }),
      Object.freeze({ x: 39.843, y: 37.5 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'comms-board',
    fromSlotIndex: 1,
    toLocationId: 'command-hub',
    toSlotIndex: 1,
    via: Object.freeze([
      Object.freeze({ x: 55.209, y: 30.357 }),
      Object.freeze({ x: 54.688, y: 32.143 }),
      Object.freeze({ x: 51.563, y: 37.5 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'shell-console-a',
    fromSlotIndex: 0,
    toLocationId: 'tools-hub',
    toSlotIndex: 1,
    via: Object.freeze([
      Object.freeze({ x: 65.365, y: 37.053 }),
      Object.freeze({ x: 70.833, y: 27.678 }),
      Object.freeze({ x: 71.615, y: 27.232 }),
      Object.freeze({ x: 74.219, y: 27.232 }),
      Object.freeze({ x: 75.26, y: 28.125 }),
    ]),
  }),
  Object.freeze({
    fromLocationId: 'connector-console-b',
    fromSlotIndex: 0,
    toLocationId: 'tools-hub',
    toSlotIndex: 0,
    via: Object.freeze([
      Object.freeze({ x: 89.063, y: 37.946 }),
      Object.freeze({ x: 85.156, y: 30.803 }),
      Object.freeze({ x: 83.333, y: 27.678 }),
      Object.freeze({ x: 82.552, y: 27.232 }),
      Object.freeze({ x: 79.948, y: 27.232 }),
      Object.freeze({ x: 78.906, y: 28.125 }),
    ]),
  }),
]);

function authoredSlotRouteKey(
  fromLocationId,
  fromSlotIndex,
  toLocationId,
  toSlotIndex,
) {
  return `${fromLocationId}:${fromSlotIndex}>${toLocationId}:${toSlotIndex}`;
}

const AUTHORED_SLOT_ROUTE_CATALOG = new Map();
for (const definition of AUTHORED_SLOT_ROUTE_CHAINS) {
  const fromLocation = worldLocationById(definition.fromLocationId);
  const toLocation = worldLocationById(definition.toLocationId);
  const from = fromLocation?.slots?.[definition.fromSlotIndex];
  const to = toLocation?.slots?.[definition.toSlotIndex];
  if (!from || !to) {
    throw new Error(
      `Invalid authored slot route ${definition.fromLocationId} -> ${definition.toLocationId}`,
    );
  }
  const chain = [{ ...from }, ...definition.via, { ...to }];
  AUTHORED_SLOT_ROUTE_CATALOG.set(
    authoredSlotRouteKey(
      definition.fromLocationId,
      definition.fromSlotIndex,
      definition.toLocationId,
      definition.toSlotIndex,
    ),
    chain.slice(1),
  );
  AUTHORED_SLOT_ROUTE_CATALOG.set(
    authoredSlotRouteKey(
      definition.toLocationId,
      definition.toSlotIndex,
      definition.fromLocationId,
      definition.fromSlotIndex,
    ),
    chain.slice(0, -1).reverse(),
  );
}

function authoredSlotIndex(location, position) {
  return (location.slots ?? []).findIndex(
    (slot) =>
      Math.abs(slot.x - position.x) < 0.01 &&
      Math.abs(slot.y - position.y) < 0.01,
  );
}

function authoredSlotArenaPath(
  from,
  to,
  fromLocation,
  toLocation,
  fallbackPath,
) {
  const fromSlotIndex = authoredSlotIndex(fromLocation, from);
  const toSlotIndex = authoredSlotIndex(toLocation, to);
  const catalogPath =
    fromSlotIndex >= 0 && toSlotIndex >= 0
      ? AUTHORED_SLOT_ROUTE_CATALOG.get(
          authoredSlotRouteKey(
            fromLocation.id,
            fromSlotIndex,
            toLocation.id,
            toSlotIndex,
          ),
        )
      : undefined;
  return compactArenaPath(catalogPath ?? fallbackPath);
}
/**
 * Builds the one authoritative polyline for an accepted semantic edge.
 * Callers own the concrete authored endpoint slots; this function owns only
 * obstacle-avoiding motor waypoints between those exact coordinates.
 */
export function buildArenaPath(from, to, fromLocationId, toLocationId) {
  if (!fromLocationId || !toLocationId) return compactArenaPath([{ ...to }]);
  if (fromLocationId === toLocationId) return compactArenaPath([{ ...to }]);

  const fromLocation = worldLocationById(fromLocationId);
  const toLocation = worldLocationById(toLocationId);
  if (!fromLocation || !toLocation) return [];
  const finish = (points) =>
    authoredSlotArenaPath(from, to, fromLocation, toLocation, points);

  const doorwayPoints = doorwayTraversalPoints(fromLocationId, toLocationId);
  if (doorwayPoints.length > 0) {
    return finish([...doorwayPoints, { ...to }]);
  }

  if (isFacilityPortalTransfer(fromLocationId, toLocationId)) {
    // Both sides share one visible transfer junction, but each resident keeps
    // the nearest same-side landing whenever it remains available.
    return finish([FACILITY_COMMONS_LAYOUT.transferJunction, { ...to }]);
  }

  if (fromLocation.roomId === toLocation.roomId) {
    const route = ROOM_ROUTES[String(fromLocation.roomId)];
    if (!route) return finish([{ ...to }]);

    if (
      new Set([fromLocationId, toLocationId]).has(route.hubId) &&
      new Set([fromLocationId, toLocationId]).has(route.doorId)
    ) {
      return finish(
        fromLocationId === route.hubId
          ? [{ x: route.centerX, y: from.y }, to]
          : [{ x: route.centerX, y: to.y }, to],
      );
    }

    if (fromLocationId === route.hubId || toLocationId === route.hubId) {
      const entityId =
        fromLocationId === route.hubId ? toLocationId : fromLocationId;
      if (entityId === 'commons') {
        const commonsSlot = fromLocationId === route.hubId ? to : from;
        const approach = [{ x: commonsSlot.x, y: commonsSlot.y }];
        return finish(
          fromLocationId === route.hubId
            ? [...approach, to]
            : [...approach].reverse().concat(to),
        );
      }
      const approach = ENTITY_HUB_APPROACH_PATHS[entityId];
      if (approach) {
        return finish(
          fromLocationId === route.hubId
            ? [...approach, to]
            : [...approach].reverse().concat(to),
        );
      }
      return finish(
        routeBetweenRoomEntityAndHub(
          from,
          to,
          fromLocationId,
          toLocationId,
          route,
        ),
      );
    }
  }

  const fromIsDoor = fromLocation.kind === 'portal';
  const toIsDoor = toLocation.kind === 'portal';
  const fromIsHall = fromLocation.roomId === 'corridor';
  const toIsHall = toLocation.roomId === 'corridor';
  if ((fromIsDoor && toIsHall) || (toIsDoor && fromIsHall)) {
    // Portal bays and corridor rows share the same clear centerline. Enter or
    // leave through the adjacent outer slot; routing back through the visual
    // door center would cross the residents still draining behind it.
    return finish([{ ...to }]);
  }

  return finish([{ ...to }]);
}

export function facilityMetricDistancePx(left, right) {
  const dx = ((right.x - left.x) / 100) * FACILITY_COLLISION_GEOMETRY.width;
  const dy = ((right.y - left.y) / 100) * FACILITY_COLLISION_GEOMETRY.height;
  return Math.hypot(dx, dy);
}

export function facilityPathLengthPx(fromPosition, path) {
  let distance = 0;
  let previous = fromPosition;
  for (const point of path) {
    distance += facilityMetricDistancePx(previous, point);
    previous = point;
  }
  return distance;
}

export function facilityPathTimingIsConsistent(
  fromPosition,
  path,
  speedPxPerSecond,
  durationMs,
) {
  if (
    !Number.isFinite(speedPxPerSecond) ||
    speedPxPerSecond <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return false;
  }
  const pathLengthPx = facilityPathLengthPx(fromPosition, path);
  if (!Number.isFinite(pathLengthPx) || pathLengthPx <= 0) return false;
  const scheduledDistancePx = speedPxPerSecond * (durationMs / 1_000);
  const tolerancePx = Math.max(0.25, pathLengthPx * 0.001);
  return Math.abs(scheduledDistancePx - pathLengthPx) <= tolerancePx;
}

export function facilityPositionAlongPath(fromPosition, path, distancePx) {
  if (!path.length || distancePx <= 0) return { ...fromPosition };
  let remaining = distancePx;
  let previous = fromPosition;
  for (const point of path) {
    const segmentDistance = facilityMetricDistancePx(previous, point);
    if (remaining <= segmentDistance) {
      const progress = segmentDistance > 0 ? remaining / segmentDistance : 1;
      return {
        x: previous.x + (point.x - previous.x) * progress,
        y: previous.y + (point.y - previous.y) * progress,
      };
    }
    remaining -= segmentDistance;
    previous = point;
  }
  return { ...path[path.length - 1] };
}

function facilityCapsuleIntersectsRect(position, rect) {
  const point = {
    x: (position.x / 100) * FACILITY_COLLISION_GEOMETRY.width,
    y: (position.y / 100) * FACILITY_COLLISION_GEOMETRY.height,
  };
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

export function facilityPositionIsWorldLegal(position) {
  const geometry = FACILITY_COLLISION_GEOMETRY;
  const point = {
    x: (position.x / 100) * geometry.width,
    y: (position.y / 100) * geometry.height,
  };
  if (
    point.x - WORLD_CAPSULE_RADIUS_PX < geometry.shell.left ||
    point.x + WORLD_CAPSULE_RADIUS_PX > geometry.shell.right ||
    point.y - WORLD_CAPSULE_HALF_HEIGHT_PX < geometry.shell.top ||
    point.y + WORLD_CAPSULE_HALF_HEIGHT_PX > geometry.shell.bottom
  ) {
    return false;
  }
  return !geometry.solids.some((rect) =>
    facilityCapsuleIntersectsRect(position, rect),
  );
}

export function facilityPathIsSweptLegal(fromPosition, path, sampleStepPx = 2) {
  if (!facilityPositionIsWorldLegal(fromPosition) || path.length === 0) {
    return false;
  }
  let previous = fromPosition;
  for (const point of path) {
    const distance = facilityMetricDistancePx(previous, point);
    const samples = Math.max(1, Math.ceil(distance / sampleStepPx));
    for (let sample = 1; sample <= samples; sample += 1) {
      const progress = sample / samples;
      if (
        !facilityPositionIsWorldLegal({
          x: previous.x + (point.x - previous.x) * progress,
          y: previous.y + (point.y - previous.y) * progress,
        })
      ) {
        return false;
      }
    }
    previous = point;
  }
  return true;
}

export function doorwayTraversalPoints(fromLocationId, toLocationId) {
  const traversal = Object.entries(FACILITY_DOOR_TRAVERSALS).find(
    ([doorId, definition]) =>
      (fromLocationId === doorId && toLocationId === definition.hubId) ||
      (fromLocationId === definition.hubId && toLocationId === doorId),
  );
  if (!traversal) return [];
  const [doorId, definition] = traversal;
  const entering = fromLocationId === doorId;
  const points = entering
    ? definition.points
    : [...definition.points].reverse();
  return points.map(([x, y]) => worldPercent(x, y));
}

export function doorwayTraversalDistancePx(fromLocationId, toLocationId) {
  const points = doorwayTraversalPoints(fromLocationId, toLocationId);
  if (points.length === 0) return undefined;
  const from = worldLocationById(fromLocationId);
  const to = worldLocationById(toLocationId);
  if (!from || !to) return undefined;
  const route = [
    from.slots[0] ?? from.position,
    ...points,
    to.slots[0] ?? to.position,
  ];
  let distance = 0;
  for (let index = 1; index < route.length; index += 1) {
    const left = route[index - 1];
    const right = route[index];
    distance += Math.hypot(
      ((right.x - left.x) / 100) * 768,
      ((right.y - left.y) / 100) * 448,
    );
  }
  return distance;
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

export function activitiesForResource(resourceId) {
  return resourceById(resourceId)?.activities ?? [];
}

export function activityById(activityId) {
  return FACILITY_ACTIVITY_BY_ID.get(activityId)?.activity;
}

export function activityForResource(resourceId, activityId) {
  const entry = FACILITY_ACTIVITY_BY_ID.get(activityId);
  return entry?.resourceId === resourceId ? entry.activity : undefined;
}

export function activitiesForCapability(resourceId, capability) {
  return activitiesForResource(resourceId).filter(
    (activity) => activity.capability === capability,
  );
}

export function activityForCapability(resourceId, capability) {
  const matches = activitiesForCapability(resourceId, capability);
  return matches.length === 1 ? matches[0] : undefined;
}

export function selectFacilityActivity(
  resourceId,
  { activityId, capability } = {},
) {
  if (activityId) {
    const activity = activityForResource(resourceId, activityId);
    if (!activity || (capability && activity.capability !== capability)) {
      return undefined;
    }
    return activity;
  }
  return capability ? activityForCapability(resourceId, capability) : undefined;
}

export function inferToolCapability(tool) {
  const normalized = String(tool || '').toLowerCase();
  if (/search|research|web\b|browser|fetch|http|docs?/.test(normalized))
    return 'search';
  if (/\breview\b|critique|assess/.test(normalized)) return 'review';
  if (/test|lint|typecheck|verify|audit/.test(normalized)) return 'test';
  if (/read|open|view|inspect|list|find|rg\b/.test(normalized)) return 'read';
  if (/apply.patch|edit|write|patch/.test(normalized)) return 'edit';
  if (/build|compile|bundle/.test(normalized)) return 'build';
  if (/connector|mcp|api|plugin/.test(normalized)) return 'connector';
  if (/publish|synth|final/.test(normalized)) return 'publish';
  if (/shell|terminal|exec|command|powershell|bash|cmd/.test(normalized))
    return 'shell';
  return 'filesystem';
}
