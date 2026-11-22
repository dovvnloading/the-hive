# Hive sandbox sprites

Generated with the built-in `image_gen` tool on September 4, 2026, for the shared-project sandbox. Each asset used a separate generation call. The full final prompts are in `prompts.json`; original generated RGBA masters are retained unchanged in `sources/`.

| Export | Dimensions | Purpose |
| --- | --- | --- |
| `public/assets/facility-v6/sandbox/parts-cabinet.png` | 48 × 64 | Walnut and forest-green parts storage |
| `public/assets/facility-v6/sandbox/document-index-blueprint.png` | 48 × 32 | Open sage-green project drawing |
| `public/assets/facility-v6/sandbox/document-index-device.png` | 40 × 40 | Brass document index with green glass and an ivory card slot |

The palette follows the existing Hive workshop: honey walnut, deep green, aged brass, ivory, and umber outlines. Each export contains one isolated object with no room, floor, cast shadow, or text. Each final PNG was visually inspected at its actual export size.

`manifest.json` records each source crop and output size. Export processing only crops the generated pixels and fits them to the target canvas using Sharp's nearest-neighbor resize and a transparent contain background. It does not repaint, recolor, or synthesize artwork.

The generated alpha channel is preserved in both masters and exports. All files have genuinely transparent exterior pixels, but the generator also produced some partial-alpha edge pixels and near-opaque interior pixels. Therefore these are crisp pixel-style RGBA sprites, not strictly binary-alpha sprites. The blueprint's exported maximum alpha is 253, the device's is 254, and the cabinet's is 255. No alpha threshold was applied.

No source code, browser actions, or live facility state were changed for this asset task.

## Generated lights-off variants

On September 5, 2026, the built-in image model edited each original full-resolution generated master to create a dim, cool ambient-light state. The final edit prompts are in `lights-off-prompts.json`; the selected model outputs are retained unchanged as `sources/*-lights-off.png`.

| Export | Dimensions | Visible brightness relative to lit asset |
| --- | --- | --- |
| `public/assets/facility-v6/sandbox/parts-cabinet-lights-off.png` | 48 × 64 | 42.5% |
| `public/assets/facility-v6/sandbox/document-index-blueprint-lights-off.png` | 48 × 32 | 20.2% |
| `public/assets/facility-v6/sandbox/document-index-device-lights-off.png` | 40 × 40 | 29.8% |

The cabinet has subdued cold bronze fittings, the blueprint has dim gray paper and diagram lines, and the inactive device has unlit glass and dim paper cards. All three final exports were visually inspected at their production size. No browser or live facility test was performed by the asset author.

Reproduce the exports from the workspace root with `node design/hive-sandbox-v1/export-lights-off.mjs`. All visible RGB lighting comes from the image-model edits; there is no brightness filter, color filter, or procedural relighting. The export normalizes any model canvas-size variation, uses the original crop and nearest-neighbor scale, and copies the lit production sprite's alpha byte for byte. This keeps every silhouette pixel and transparent margin exactly identical between lighting states.

Limitation: the model returned opaque RGB masters with a painted transparency preview despite explicit alpha requests. The export therefore restores the existing production alpha, rather than trusting the edited master's background. This is recorded in `lights-off-manifest.json`. Internal model-rendered details can differ at isolated pixels even though the production silhouette and placement are exact. The full-resolution references were selected after small-sprite reference attempts altered details; a device draft with bright edge contamination was also replaced with a new model edit.

`lights-off-validation.json` records dimensions, zero alpha-byte differences against the originals, relative luminance measurements over visible pixels, and the absence of exported visible pixels above RGB 200. These measurements describe the generated result; they were not used to synthesize its lighting.
