# The Hive: architectural artwork

Six source masters were generated with the built-in `image_gen` tool for the
existing workshop. Exact prompts are in `prompts/`; untouched masters are in
`sources/`. Production exports are in `public/assets/facility-v6/`.

| Source              | Production use                                                                  |
| ------------------- | ------------------------------------------------------------------------------- |
| `wall-band.png`     | Warm plaster, walnut crown and honeycomb green wainscoting                      |
| `walnut-beam.png`   | Exterior frame, room beams, partitions, corridor rails and shallow doorway rims |
| `oak-planks-v2.png` | Quiet horizontal oak flooring with faint grain and shallow seams                |
| `parquet.png`       | Superseded room flooring, retained as an earlier version                        |
| `slate.png`         | Corridor paving                                                                 |
| `switch-states.png` | Physical wall controls in their on and off states                               |

## Export

Run from the project root with its installed dependencies:

```powershell
node scripts/process-hive-architecture.mjs
```

The script crops and resizes generated artwork with nearest-neighbor sampling.
It does not repaint, recolor or synthesize pixels. Original alpha is retained
for the beam and switch sprites. `manifest.json` records all seven production
exports and their crop geometry, including the retained parquet version.

## Integration

- Wall and slate patches alternate by reflection at draw time, sharing the
  same edge pixels across joins. The raw generator outputs are not certified
  as seamless tiles.
- Each room uses a single 320-pixel oak plank patch, cropped by the authored room
  bounds; no repeating join crosses the visible room floor.
- The quieter oak revision replaces the large chevrons and dense grain in
  response to user feedback. It uses long parallel boards, nearly uniform
  warm muted color and sparse end joints to let furniture and rugs stand out.
- Timber endcaps are preserved when fitting different spans. Fitted strips are
  cached instead of reconstructed on every frame.
- Floor, wall band and timber blend between generated lit and lights-off
  artwork with the room's actual light level, followed by the existing scene
  veil and lamp bloom. Shared partitions are clipped into adjoining room halves
  so each side follows its own light state without a second material shade.
- Upper doorway foregrounds blend only their shallow U-shaped rims. Lower door
  frames keep their existing generated artwork and remain behind residents.
- The two generated switch plates have slight texture/indicator differences.
  Their exported footprints match, and blending follows the actual room light
  transition. A generated alignment-edit attempt produced an opaque checkerboard
  and was rejected; the original transparent pair is the retained source.
- Existing room rectangles, door apertures, collision geometry, fixture anchors,
  navigation and authenticated state remain the source of spatial behavior.

The observer now uses a three-row grid for header, measured stage and console.
Camera controls and the view toggle share the console with the workshop tools.
The dispatch panel reuses the earlier `hive-ui-v1` frames and icons. The original
full-folder backup remains outside the project and was not modified.

## Generated lights-off materials

On September 5, 2026, the built-in `image_gen` model edited the original oak,
wall-band, and walnut-beam masters into dim neutral/cool illumination variants.
The exact final prompts are in `prompts/lights-off.json`, and the unchanged model
outputs are in `sources/*-lights-off.png`. The corridor slate was left unchanged.

| Production companion           | Dimensions | Visible brightness relative to lit asset |
| ------------------------------ | ---------- | ---------------------------------------- |
| `oak-planks-v2-lights-off.png` | 320 × 320  | 52.7%                                    |
| `wall-band-lights-off.png`     | 256 × 128  | 36.8%                                    |
| `walnut-beam-lights-off.png`   | 384 × 38   | 37.9%                                    |

Run `node design/hive-architecture-v1/export-lights-off.mjs` from the project root
to reproduce these three exports. It aligns the model canvas to the original
master, reuses the exact original crop and nearest-neighbor export, and preserves
the production alpha byte for byte. Every visible RGB lighting value comes from
the model edit; no color filter, brightness filter, or procedural relighting is
used. Opaque wall and floor tiles remain opaque, and the beam keeps its exact
original transparent cutout and endcaps.

The original masters, model edits, and final production images were visually
inspected. `lights-off-validation.json` records matching dimensions, zero alpha
differences, measured brightness, and matching dominant horizontal seam rows:
14 oak rows, six wall-band boundaries, and five beam-rail boundaries. No browser
or live facility actions were performed for this asset work.

The image model may vary isolated internal texture pixels, so this is not a
claim that every RGB detail is identical except for brightness. The important
authored pattern layout, crop geometry and alpha remain aligned. The raw beam
edit contains an opaque black preview; its original production alpha is restored
during export, as recorded in `lights-off-manifest.json`.
