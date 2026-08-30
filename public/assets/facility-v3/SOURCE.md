# Facility v3 asset sources

The v3 arena uses warm, orthogonal top-down interior art. It intentionally does
not use the earlier sci-fi/side-wall kit.

## Cosy Cabin

- Artist: Marie Pepo
- Source: https://marie-pepo.itch.io/cosy-cabin
- License: personal and commercial use with credit to Marie Pepo; modification
  is permitted; the asset itself (including edited variants) may not be resold.
- Imported files: `cozy-cabin/objects.png`, `cozy-cabin/tilemap.png`,
  `cozy-cabin/palette.gpl`, and the transparent PNGs in
  `cozy-cabin/sprites/`.
- The live renderer uses complete original-resolution objects extracted by
  alpha bounds from the supplied object sheet. It never samples guessed atlas
  coordinates. The retained 1x sheets are audit/reference files and are not
  used for live floor or furniture rendering. No generative modification was
  applied.

## Basic Village Tileset

- Artist: Forchild
- Source: https://forchild.itch.io/village-tileset
- License: CC0.
- Imported files: `basic-village/furniture.png`, `basic-village/house.png`, and
  `basic-village/plants.png`.

The Zedpxl interior pack linked during art direction was used only as a visual
reference. Its published license excludes AI-related uses, so none of its files
are included in this project.

## Generated architecture surfaces

- Created for this project on 2026-08-29 with OpenAI's built-in image generator.
- No external image was supplied as an input or style reference.
- Project files: `generated/oak-floor-v1.png`,
  `generated/plaster-wall-v1.png`, and
  `generated/slate-corridor-v1.png`.
- The generated masters were reduced to 192 × 192 with nearest-neighbor
  resampling so the renderer receives compact, deliberately pixelated tiles.
- Prompt summaries:
  - A seamless, flat top-down honey-oak plank floor with muted natural grain.
  - A horizontally seamless front-elevation wall with a walnut cap, calm cream
    plaster field, and substantial walnut baseboard.
  - A seamless, flat top-down warm slate corridor in a staggered running bond.
- All prompts excluded objects, text, logos, trademarks, watermarks,
  perspective, and sci-fi or laboratory styling.
