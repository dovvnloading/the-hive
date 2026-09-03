# Facility v4 authored furniture

The furniture pack was created for this facility on 2026-08-29 with OpenAI's
built-in image generator. No external image or style reference was supplied.

## Master sheets

- Original concept: `furniture/furniture-sheet-v1.png`
- Native-pixel replacement: `furniture/furniture-sheet-v2-transparent.png`
- Lights-off edit source: `furniture/furniture-sheet-v2-lights-off-source.png`
- Layout: sixteen isolated sprites in a 4 × 4 transparent grid.
- Projection: consistent three-quarter top-down orthographic view.
- Palette: walnut, chestnut, honey oak, muted sage, parchment, dark teal, and
  restrained aged brass.
- Prompt inventory: research desk, utility workstation, build bench,
  verification desk, writing desk, planning table, four chair orientations,
  reading armchair, two-seat couch, empty bookshelf, filled bookshelf,
  sideboard, and wall shelf.
- Prompt constraints excluded extra objects, room backgrounds, floor or wall
  textures, text, logos, trademarks, watermarks, sci-fi styling, photorealism,
  and inconsistent perspective.

## Processing

The v2 sheet replaces the painted microtexture of the initial concept with
deliberate hard pixel clusters and simplified silhouettes. Each equal sheet
cell is scanned for nontransparent pixels, isolated to its largest connected
alpha component, cropped to that component's bounds, and reduced with Lanczos
resampling, controlled sharpening, and a 64-colour non-dithered palette into a
transparent, bottom-aligned arena sprite. Component isolation excludes detached
generation debris such as floor-level strips and cast-shadow remnants. This
preserves readable forms at room scale without the destructive nearest-neighbor
reduction used by v1.

Run `node scripts/process-furniture-sheet.mjs` to reproduce every extracted
sprite. `furniture/manifest.json` records the stable cell order, target size,
and processing parameters.

## Lights-off variant

The lights-off source is an illumination-only edit of the native-pixel sheet.
The exact generation instruction is:

> Change illumination only to an extinguished-room state with cool navy
> ambient light, deep readable shadows, muted paper/brass, and non-emissive
> monitors and lamps. Preserve the 4x4 inventory, cell positions, transparent
> background, silhouettes, proportions, perspective, scale, orientation,
> pixel structure, spacing, and cropping. Add or remove nothing.

The model response encoded its checkerboard preview into RGB. The processor
therefore removes only bright-neutral preview pixels before geometry
inspection. Each of the sixteen dominant components is compared with the same
cell in the illuminated master. The master dimensions must match exactly.
Processing stops when either normalized center axis drifts by more than 5% of a
cell or either normalized component dimension drifts by more than 8% of a cell.

Accepted components are cropped and resized with the existing target sizes and
bottom alignment. The final files are written to `furniture/lights-off/` and
reuse the corresponding illuminated runtime sprite's alpha byte-for-byte. This
removes the baked preview background and prevents any lighting variant from
changing collision-relevant silhouettes, baselines, chair crops, or detached
pixel topology. Illuminated sources and runtime sprites are hash-protected
during the lights-off pass.

Run `npm run assets:lights-off` after the edit source is present and approved.
Ignored illuminated, lights-off, and difference contact sheets are written to
`outputs/asset-qa/lights-off-furniture/` for review.
