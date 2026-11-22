# Homestead navigation and cohesive interior art

- Date/time: September 7, 2026, 23:52 through September 8, 2026, 01:17 EDT.
- Revision: `3fe5bedebc6daa48ddd6d0ea604a94ecc8062704` plus existing working-tree
  changes and this homestead/art pass. No commit was created.
- Environment: local web app at `http://localhost:3000/`, loopback bridge at
  port 8787, development server. Separate static asset review page on port 3000.
- Objective: replace the enlarged, inconsistent interior textures with one
  native-resolution art family; verify genuine chroma-key extraction, generated
  dark variants, room navigation, camera behavior and observer controls.
- Participants: one real root Codex process acting as implementation/operator
  QA. No facility identity was registered or reactivated for these visual checks.

## Runs

| Run ID                  | Outcome                              | Reason                                                                                                                                                                                     |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No new facility run     | Passed observer QA                   | Exercised rendering and observer controls against the existing completed run. No resident movement, work, speech or world-action events were emitted by this pass.                         |
| `run_mtnuw7r5_34758e02` | Previously completed; read only here | `run.completed` is sequence 3733. The existing journal ends with prior `sandbox.changed` events through 3740, dated before this pass. This is not a new completion or a new embodied test. |

## Exercised

- All six generated cottage hotspots opened their corresponding existing room:
  Library, Meeting hall, Tool shed, Study, Commons and Workshop. Outside returned
  to the map and restored focus to the originating cottage.
- Desktop review at 1325 × 909: all six room compositions, physical journal and
  mailbox hotspots, the map noticeboard, native furniture footprints, calm floor
  and rug, lighting selection and installed document-index artwork.
- Commons at 200%; Study desk at the actual 300% limit, using double-click focus
  and zoom controls; Fit returned to 100%. Wheel zoom reached 281%. A drag that
  began over a cottage changed pan and did not open the cottage.
- Keyboard navigation across clipped map cottages at 200%; Enter opened the
  focused cottage. Journal Research remained reachable. Escape closed the
  journal and returned focus to its physical room hotspot without page scrolling.
- Mailbox opened with sending disabled for zero active residents. No note was
  typed, saved or sent. Empty resident roster displayed its actual empty state.
- A separate QA tab used actual 390 × 844 and 844 × 390 viewport overrides.
  Checked map and room navigation, journal readability, resident panel and
  hide/show controls. Document width equaled viewport width. Overrides were
  reset. The first viewport attempt targeted the selected review tab rather than
  the main tab; subsequent checks used that tab and verified `innerWidth`.
- Standalone art board: all 55 base images loaded; switching lighting loaded all
  39 dark partners. Reviewed furniture, architecture, chairs, fixtures, plants,
  switches and icons on linen and slate. Native-size inspection opened correctly.
- Final clean reload followed by map drag, wheel zoom, noticeboard and room
  entry produced no captured browser warnings or errors.

## Observations

- Authoritative: existing `run.completed` at sequence 3733; no newly created run.
  The browser showed zero residents. Browser pixels were used only for visual
  review, not as embodied perception or evidence of resident action.
- Asset evidence: `design/homestead-v1/interiors/manifest.json` reports 55 base
  sprites, 39 lighting pairs, no pending sheets. Exporter verifies key coverage,
  crop boundaries and silhouette drift. Tests verify opaque RGB magenta master
  corners, real alpha export corners, lighting registration, common plant pot
  canvases and retained native image dimensions.
- Source generation used the built-in ImageGen tool. Accepted source sheets have
  a real opaque magenta background; normalized masters contain exact `#FF00FF`.
  Exported PNGs have actual alpha. Two initial checkerboard drafts were rejected
  and are not consumed by the exporter or renderer.
- Visual: warm Study artwork and dark artwork in the other inspected rooms
  shared the same shapes and material family. Unlit lamps and switches did not
  retain their former bright gold appearance. No magenta/checkerboard background
  was visible on the reviewed exported sprites. Broad floorboards and a quiet
  rug field replaced the dense earlier patterns.
- Visual: the 300% Study close-up retained readable notebook, monitor, desk and
  chair shapes. World-sized texture reduction was removed; the room canvas uses
  eight render pixels per world unit while physical object dimensions stay fixed.

## Corrections during QA

- Initial enlarged interiors exposed insufficient source detail. Replaced the
  full interior family and separated native texture pixels from physical sizes.
- Initial architecture/table generation returned baked checkerboards. Generated
  actual magenta replacements, then used deterministic key extraction.
- Focus could scroll the main surface during dialog/cottage navigation. Clipped
  scene containers and `preventScroll` focus restoration keep `main.scrollTop=0`.
- A keyboard-focused cottage at 200% originally had its top at -313px. After the
  focus correction it was fully visible at y=61–602 within the y=10–759 frame.
  Applied the same focus reveal behavior to room objects.
- Early checks caught an unoptimized image lint issue, missing awaits in the new
  Node tests and an exact floating-point center assertion. Those were corrected;
  the final checks below passed.
- Browser keyboard discovery initially attempted unsupported CDP/CUA methods.
  No key was dispatched by those attempts. The documented browser `pressKey`
  interface was then used for the actual Escape, Tab and Enter checks.

## Result

- `node design/homestead-v1/interiors/export.mjs`: 55 sprites exported, none pending.
- `node --experimental-strip-types --test scripts/arena-homestead.test.mjs scripts/arena-camera.test.mjs scripts/arena-spatial.test.mjs`:
  **45/45 passed**. The spatial test fixtures were automated test data, not
  represented as residents in the live facility.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed after the final camera-focus change. Vinext emitted its
  existing static route-classification notice; build exited successfully.
- Browser checks passed at the dimensions and zoom levels listed above.

## Follow-up

- Live populated movement, seating occlusion and lighting transitions were not
  exercised in a new resident run. Existing spatial/camera tests passed, and
  source lighting pairs were inspected; these do not constitute embodied runtime
  coverage. Existing resident animation sheets remain in use.
- Audio scheduling was not changed or revalidated by this art pass; its earlier
  dedicated audio test report remains the relevant coverage.
