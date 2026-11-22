# The Hive: illustrated observer interface

Five original image-generation masters produce four interface surfaces and
sixteen transparent icons. The direction is a small workshop's walnut, aged
brass, green felt, enamel and worn paper, carried through the observer controls
and room nameplates.

## Original artwork and exact prompts

- `sources/title-sign.png`: engraved Hive sign with a bee seal.
- `sources/tool-tray.png`: blank walnut and green felt tray.
- `sources/resident-ledger.png`: tall walnut ledger with brass fittings.
- `sources/button-face.png`: blank brass and green enamel button.
- `sources/icon-atlas.png`: sixteen workshop objects in a four-by-four atlas.
- `frame-prompts.json`: exact built-in image_gen prompts for the four surfaces.
- `icon-prompt.txt`: exact built-in image_gen prompt for the atlas.

The masters retain the generator's original RGBA pixels. Their exterior alpha
is transparent. Export processing crops transparent margins and resizes with
nearest-neighbor sampling; it does not repaint the artwork or replace colors.
The first gutter in atlas rows one and three is offset slightly from the nominal
grid to avoid cutting silhouettes or including a neighboring icon's pixels.

## Production exports

Run from the project root with the existing installed dependencies:

```powershell
node scripts/process-hive-ui.mjs
```

Exports live in `public/assets/ui/hive-v1/`. `manifest.json` records each master,
source crop, atlas cell and exported dimensions. Each icon is 128 by 128 pixels
with transparent padding. Four larger surfaces preserve detail on dense displays.

`components/hive-ui-art.tsx` exposes decorative icons behind accessible text and
button names. `app/observer-art.css` fits the frames with nine-slice borders.
The world renderer caches fitted room nameplates; labels and activity counts
remain live text drawn from the existing state. No resident activity is generated
by these assets or controls.

The retained original folder backup is outside this project and was not modified.
