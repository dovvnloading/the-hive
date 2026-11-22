# Residents v1 character sheets

Six original illustrated residents created for the Hive on 2026-11-22: Maple,
Fern, Juniper, Bram, Clover and Ollie. They replace the LimeZu sample
characters in the live renderer.

- Source: `scripts/generate-resident-sprites.mjs`. Every frame is authored there
  as SVG shapes, then rasterized with sharp. No third-party or generated
  images were used.
- Regenerate with `node scripts/generate-resident-sprites.mjs`. Add
  `--preview <file.png>` to write a contact sheet for review.
- Resolution: 8 pixels per sprite unit. The frame grid matches the earlier
  sheets, so the renderer's slicing, seat offsets and hit areas are unchanged:
  - `idle_anim.png` and `run.png`: 24 frames of 16 × 32 units (east, north,
    west, south; six frames each).
  - `phone.png`: 9 frames of 16 × 32 units facing south.
  - `sit.png` and `sit2.png`: 12 frames of 32 × 32 units (east, then west).
    `sit2` is the typing pose and keeps the earlier sheets' six-unit lift.
- The canvas renderer detects the sheet scale from the image height and
  downsamples with smoothing. CSS sprites use percentage sizes and
  `image-rendering: auto`.
