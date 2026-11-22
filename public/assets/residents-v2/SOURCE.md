# Residents v2 character sheets

Six original residents (Maple, Fern, Juniper, Bram, Clover and Ollie), illustrated
with ChatGPT image generation on 2026-11-22 to match the remade interiors. They
replace residents-v1, which was drawn in code and didn't match the painted style.

- Process, prompts and masters: `design/hive-remake-v1/characters/`.
- Rebuild: `python design/hive-remake-v1/characters/build_sheets.py`.
- Each character came from three generated images, made in one chat so the design
  stays consistent:
  - a turnaround (front, back, side);
  - a walk sheet (two steps per direction);
  - a pose sheet (seated, seated typing, phone).
- The build script cuts each figure out of the magenta background, gives all
  figures in one image the same scale, and places them on the renderer's existing
  frame grid at 8 px per sprite unit, so seat offsets and hit areas are unchanged:
  - `idle_anim.png` and `run.png`: 24 frames of 16 × 32 units (east, north,
    west, south; six frames each). West is the mirrored side view.
  - `phone.png`: 9 frames of 16 × 32 units facing south.
  - `sit.png` and `sit2.png`: 12 frames of 32 × 32 units (east, then mirrored
    west). `sit2` is the typing pose and keeps the earlier sheets' six-unit lift.
- The walk cycle in `run.png` is: step, step lifted, stand, other step, other step
  lifted, stand. Idle frames add a small vertical bob.
