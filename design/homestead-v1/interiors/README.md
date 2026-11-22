# The Hive: oak, linen and sage

An original cozy village collection made with the built-in ImageGen tool. The
interior family uses honey oak, cream plaster, sage paint, muted teal equipment
and small brass details. Broad shapes and quiet surfaces leave room for people
and objects to read. The floor uses long boards; the rug has a mostly empty
center. No herringbone or dense Persian pattern remains in the active rooms.

## Sources and extraction

- `prompts.json` records the generation and lighting-edit prompts.
  Early alpha requests remain there only as a record of rejected drafts. Apply
  `keyRule` to every future addition; all accepted sheets use an opaque key.
- `sources/*-key.png` are opaque magenta source sheets. `*-dark.png` are model-made
  lighting edits of those same sheets, with their original layout retained.
- `chroma-masters/` preserves the keyed sheets with the background normalized to
  exact opaque RGB `255, 0, 255`. These are real color-key masters, not images of
  transparency. Early `sources/architecture.png` and `sources/tables.png` drafts
  were rejected for baked checkerboards and are never read by the exporter.
- `export.mjs` removes the magenta key and trims each lit/dark pair to their shared
  bounds. It does not resize the source sprites. Transparent pixels are RGBA
  `0, 0, 0, 0`; object colors remain those of the generated source.
- `manifest.json` records each crop, its native dimensions, physical footprint,
  lighting pair and measured alignment. The build rejects missing pairs,
  clipped crops, invalid key borders and excessive silhouette drift.

From the project root:

```sh
node design/homestead-v1/interiors/export.mjs
node --experimental-strip-types --test scripts/arena-homestead.test.mjs
```

The export contains 55 base sprites and 39 matching lights-off sprites: 94 PNGs
in `public/assets/homestead-v1/interiors/`. The exporter also produces a standalone
`asset-board.html` there, with lighting, backdrop and native-size inspection.
The 16 interface icons retain the same palette in both lighting modes.

## Rendering contract

`lib/arena/interior-art.ts` separates image pixels from world dimensions.
Furniture is drawn at its authored physical footprint, retaining its much larger
source image. The cropped room canvas has eight render pixels per world unit;
only the visible room is allocated. Nearest-neighbor rendering preserves edges.

Lights-off artwork is selected from factual room/fixture power state. The dark
room veil is deliberately slight: the generated variants already contain the
unlit materials. Healthy, wilted and dead plant sprites share a registered pot
and canvas. Chairs keep their existing authored seat and foreground geometry.

The village is an observer overview of the existing six rooms. It does not add
a second navigation graph or fabricate outdoor activity. Building occupancy and
lane projections derive from authoritative positions. Room resource geometry,
authentication, agent actions and journals remain authoritative in the bridge.
The existing resident character sheets and their animation remain in use.
