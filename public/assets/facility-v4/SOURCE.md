# Facility v4 authored furniture

The furniture pack was created for this facility on 2026-08-29 with OpenAI's
built-in image generator. No external image or style reference was supplied.

## Master sheet

- File: `furniture/furniture-sheet-v1.png`
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

Each equal sheet cell was scanned for nontransparent pixels, cropped to its
alpha bounds, and reduced with nearest-neighbor resampling into a transparent,
bottom-aligned arena sprite. `furniture/manifest.json` records the stable cell
order and normalized canvas size of every extracted PNG.
