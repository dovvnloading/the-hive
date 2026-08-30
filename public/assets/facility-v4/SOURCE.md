# Facility v4 authored furniture

The furniture pack was created for this facility on 2026-08-29 with OpenAI's
built-in image generator. No external image or style reference was supplied.

## Master sheets

- Original concept: `furniture/furniture-sheet-v1.png`
- Native-pixel replacement: `furniture/furniture-sheet-v2-transparent.png`
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
