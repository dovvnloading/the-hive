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
- Dual prompt: a straight-on substantial wall light with a warm walnut
  backplate, aged-brass fittings, and two symmetrical frosted-amber lamps;
  handcrafted pixel art; transparent isolated object; unmistakably a light,
  never a closet, cabinet, screen, sign, or science-fiction fixture.
- Single source: `sources/wall-light-single-source-v1.png`
- Single runtime asset: `wall-light-single-v1.png` (22 x 26)
- Single edit prompt: preserve the dual fixture's walnut, brass, amber glass,
  pixel rendering, palette, and front elevation while reducing it to one
  centered lamp on an intentionally shortened symmetrical backplate.

Command and Commons use the single fixture where wall space is constrained.
Research, Utility, Synthesis, and Build use the dual fixture.

Run `node scripts/process-wall-fixtures.mjs` after replacing a source.
The processor removes the Command source's connected neutral backdrop, crops
to visible alpha, resamples with Lanczos, sharpens lightly, and writes a compact
96-colour transparent PNG.
