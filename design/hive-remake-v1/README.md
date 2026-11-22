# Hive visual remake v1

Room backgrounds, interactable props and resident characters for the facility
interiors, made on 2026-11-22. Rooms and props were made in three steps.

**Camera.** Everything shares the rooms' camera: straight-on and looking down at
about 45 degrees (top-down 3/4, "2.5D"). Floor-standing props show their tops
(desk tops, seats, table plans, pot soil) as surfaces, with front faces below.
Only wall-mounted pieces (boards, chart, sconces, switch, mailbox, doorway) are
seen front-on, because the back wall is.

1. **Mockups.** `make-mockups.mjs` draws each empty room shell at its exact
   world geometry (wall band, floor, timber frame, door openings, rugs,
   windows) and each interactable prop at its exact footprint, in the
   residents' illustrated style. Output goes to `mockups/`, and placement
   goes to `mockups/layout.json`.
2. **Generation.** Each mockup was uploaded to ChatGPT image generation,
   with thinking effort set to Extra High (never Pro). The prompt asked for a
   higher-fidelity version that keeps the mockup's camera, silhouette,
   proportions and placement. The returned images are kept as masters in
   `generated/` (WebP; rooms at q92, props at q95).
3. **Processing.** `process_art.py` writes the runtime art to
   `public/assets/hive-remake-v1/interiors/`:
   - Rooms are cropped to their frame and resized to the room rect at 6 px per
     world unit.
   - Props are keyed out of magenta and fitted to their footprint at 8 px per
     unit. `chair-west` is a mirror of `chair-east`.
   - Every file gets a lights-off twin.

   It also writes `manifest.json`.

## Prompt rules

- **Rooms.** These were generated in one chat so they share a style. Each
  prompt said:
  - "KEEP EXACTLY" the camera, framing, outline, wall band height, doors,
    windows, rugs and the flat border.
  - Use these colors.
  - "ENHANCE" materials (wood grain, wallpaper motif, panel bevels, rug weave).
  - "DO NOT ADD" furniture, lamps, switches, plants, pictures, characters, text
    or UI.
- **Even lighting.** The first Commons render baked in a sunbeam across the
  wainscot and a light patch on the floor. It was regenerated with flat, even,
  neutral ambient light, because the game draws its own lighting. Every later
  room prompt carries the same rule.
- **Props.** These were generated in a second chat, with the finished Commons
  attached as the style and camera reference. The first floor-prop pass came out
  nearly front-on, with desk tops as thin strips. Those props were redrawn as
  top-down mockups and regenerated. Each prompt said:
  - Keep the mockup's silhouette, proportions and part placement.
  - Keep the top-down 3/4 camera, describing which surfaces are seen from above.
  - A list of enhancements.
  - A solid flat #FF00FF background with no floor, shadow or glow.
  - A square canvas, no text.
  - "Do not run code, checks or post-processing."
- **State variants.** These were made as edits of the base image in the same
  chat (see `variants.json`):
  - lamp off;
  - wilted and dead plant;
  - empty mailbox;
  - sconces off;
  - switch off.

## Characters

The six residents (Maple, Fern, Juniper, Bram, Clover, Ollie) live in
`characters/`.

1. **Mockups.** `characters/mockups/` holds each character's earlier code-drawn
   sprite, laid out as three references: a turnaround (front, back, side), a
   walk sheet, and a pose sheet (seated, typing, phone).
2. **Generation.** Each character had one ChatGPT chat, with the finished
   Commons attached as the style reference. The chat produced the turnaround,
   then the walk sheet, then the poses, each prompted as "the same character".
   Masters are in `characters/generated/`. For Juniper, Bram, Clover and Ollie
   the first turnaround drew a Maple-like figure. Each was redone in that
   character's own chat, pointing at the correct walk and pose images.
3. **Sheets.** `characters/build_sheets.py` writes `public/assets/residents-v2/`
   (see its `SOURCE.md` for the frame layout).

## Lighting pairs

The lights-off files for remade art are a programmatic night grade of the lit
art (`lightingPair: "graded"` in `manifest.json`), calibrated against the
earlier model-made pairs. Assets carried over unchanged from homestead-v1 (the
corridor floor, the timber, and unused furniture) keep their model-made pairs
(`"model"`).

## Regenerate

```
node design/hive-remake-v1/make-mockups.mjs
python design/hive-remake-v1/process_art.py
python design/hive-remake-v1/characters/build_sheets.py
```

Restart the dev server after running `process_art.py`. Rewriting dozens of
watched files can leave vinext's dev server failing every request with
"Maximum call stack size exceeded".
