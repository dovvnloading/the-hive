# Generated wall fixtures

The Command and Utility back-wall panels are project-authored assets generated
with the built-in image-generation workflow on 2026-08-30. The current arena
and self-authored furniture sheet were supplied as style and scale references.

## Command routing board

- Source: `sources/command-routing-board-source-v1.png`
- Runtime asset: `command-routing-board-v1.png` (132 x 52)
- Prompt: a straight-on rustic walnut route-planning cabinet with brass
  fasteners, a parchment map, colored route pins, and three integrated paper
  slots; warm handcrafted pixel art; transparent isolated object; no text,
  room, character, logo, watermark, modern plastic, or science-fiction styling.

## Utility tools board

- Source: `sources/utility-tools-board-source-v1.png`
- Runtime asset: `utility-tools-board-v1.png` (140 x 36)
- Prompt: a straight-on rustic walnut and brass workshop capability board with
  five populated bays for a hammer, cord, notebook, hand lens, and key tag;
  warm handcrafted pixel art; transparent isolated object; no text, room,
  character, logo, watermark, monitor, neon, or science-fiction styling.

## Wall lights

- Dual source: `sources/wall-light-dual-source-v1.png`
- Dual runtime asset: `wall-light-dual-v1.png` (48 x 28)
- Dual unlit source: `sources/wall-light-dual-off-source-v1.png`
- Dual unlit runtime asset: `wall-light-dual-off-v1.png` (48 x 28)
- Dual prompt: a straight-on substantial wall light with a warm walnut
  backplate, aged-brass fittings, and two symmetrical frosted-amber lamps;
  handcrafted pixel art; transparent isolated object; unmistakably a light,
  never a closet, cabinet, screen, sign, or science-fiction fixture.
- Single source: `sources/wall-light-single-source-v1.png`
- Single runtime asset: `wall-light-single-v1.png` (22 x 26)
- Single unlit source: `sources/wall-light-single-off-source-v1.png`
- Single unlit runtime asset: `wall-light-single-off-v1.png` (22 x 26)
- Single edit prompt: preserve the dual fixture's walnut, brass, amber glass,
  pixel rendering, palette, and front elevation while reducing it to one
  centered lamp on an intentionally shortened symmetrical backplate.
- Unlit edit prompt: preserve each fixture's silhouette, geometry, walnut,
  brass, glass, front elevation, and tight framing while extinguishing every
  luminous core, glow, bloom, and halo; render the shades as muted smoky glass
  with non-emissive reflections on an isolated background.

Synthesis and Build use the dual fixture across broad, uninterrupted wall
spans. Research, Command, Utility, and Commons use the single fixture where
wall space is constrained by shelving, a large panel, or a doorway.
Each room swaps directly between its lit and unlit sprite when power changes;
the unlit state is authored artwork rather than opacity-faded lit artwork.

## Doorways

- Front-wall source: `sources/doorway-front-source-v1.png`
- Front-wall runtime asset: `doorway-front-v1.png` (44 x 64)
- Front prompt: an isolated straight-on open walnut doorway with an
  unobstructed transparent aperture, substantial header and jambs, a narrow
  fully-open door edge, and restrained brass hardware.
- The generated asset is intentionally limited to lower rooms, which expose a
  full back-wall doorway. Upper rooms expose only their south-wall cutaway;
  those openings use a shallow code-rendered U-frame embedded directly in the
  eight-pixel wall seam, with no door leaf or perspective projection.

## Build and Verify diagnostics chart

- Source: `sources/build-verification-chart-source-v1.png`
- Runtime asset: `build-verification-chart-v1.png` (68 x 34)
- Prompt: a substantial walnut-and-brass wall frame holding parchment, a
  technical grid, three colored performance traces, pinned verification
  markers, and inspection tags; no text, monitor, or science-fiction styling.
- This replaces the former code-drawn plain line chart on the Build/Verify
  east wall.

## Operator dispatch box

- Sources: `sources/operator-mailbox-source-v1.png` and
  `sources/operator-mailbox-empty-source-v1.png`
- Runtime assets: `operator-mailbox-v1.png` and
  `operator-mailbox-empty-v1.png` (both 24 x 20)
- Generated: 2026-09-03 with the built-in image-generation workflow.
- Full prompt: a compact wall-mounted walnut dispatch mailbox with aged-brass
  trim, a visible parchment envelope slot, and a raised brass flag; crisp warm
  16-bit three-quarter RPG pixel art; isolated transparent object; no text,
  wall, floor, room scene, logo, watermark, glow, or cast shadow.
- Empty edit prompt: use the full mailbox as the sole edit target; remove only
  the protruding parchment and reconstruct the recessed dark slot and wooden
  panel beneath it; preserve the mailbox, brass trim, flag, perspective,
  pixel-block texture, palette, silhouette, scale, and true transparency.
- Placement: wall-mounted in Commons, clear of the doorway, light switch,
  ceiling fixture, journal desk, and resident route.
- Purpose: a visible, clickable operator input surface. The letter-visible
  asset appears while the bridge reports unread deliveries; the empty asset
  appears at zero. Delivery and read state remain bridge-authored.
- Processing: connected near-transparent backdrop pixels are removed and the
  final 24 x 20 alpha channel is hardened to transparent/opaque values so the
  tiny wall sprite keeps a clean pixel silhouette.

Run `node scripts/process-wall-fixtures.mjs` after replacing a source.

The processor removes connected neutral backdrops from generated sources that
need extraction, crops to visible alpha, resamples with Lanczos, sharpens
lightly, and writes a compact 96-colour transparent PNG.

## Room lights-off siblings

`node scripts/process-wall-fixtures.mjs --lights-off` deterministically writes
dark siblings to `lights-off/` for the oak floor, plaster wall, Command routing
board, Utility tools board, Build verification chart, lower-room doorway,
small, tall, potted, and paired plants, floor lamp, and both full and empty
mailbox states. The plants and floor lamp are sourced from
`../cozy-cabin/sprites/`; all other inputs are the illuminated runtime assets
in this directory.

The recorded grade multiplies brightness by 55%, retains 75% saturation around
relative luminance, then blends each RGB channel 18% toward `#101827`. It never
changes dimensions or alpha. The authored single and dual off-light artwork is
copied into the same directory with alpha normalized byte-for-byte against its
illuminated counterpart; missing off-art pixels fall back to the same grade.
The processor decodes every result to verify dimensions and alpha and confirms
that none of its illuminated or authored inputs changed. It also resolves every
dark path declared by the renderer and fails if any mapped file is absent or
empty.

The complete furniture and room-asset pass is `npm run assets:lights-off`.
Ignored illuminated, lights-off, and difference contact sheets are written to
`outputs/asset-qa/lights-off-room-assets/` for review.
