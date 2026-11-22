# Workshop commissions, maintenance and generated darkness QA

- Date/time: September 7, 2026, approximately 22:46–23:25 EDT.
- Revision: `3fe5bedebc6daa48ddd6d0ea604a94ecc8062704` plus uncommitted workshop lifecycle, renderer, generated assets, UI and test changes.
- Environment: `http://localhost:3000/`, loopback bridge on port 8787, Chromium 152; desktop 1280 × 720 and mobile 390 × 844.
- Objective: deepen the working workshop without inventing resident activity; verify commissions, evidence, maintenance, salvage, persistence and generated architectural light states.
- Participants: root process `/root` performed implementation and operator browser QA. The previous real identity `codex-workshop` / Maker was resumed only to close its completed arc. No additional live residents were spawned. Contract and bridge fixtures ran in isolated temporary worlds and are not residents.

## Runs

| Run ID                                    | Outcome            | Reason                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run_mtnuw7r5_34758e02`                   | Completed          | Resumed observation and context, moved from the Command doorway to the corridor, then emitted resident completion at sequence 3732 and run completion at 3733. The previous build/test/use arc is documented in `2026-09-05-shared-workshop.md`. |
| Same retained world, after run completion | Operator QA passed | Operator saves, restore, fork, revision, archive and reopen appended sequences 3734–3740. These events retain the existing world run ID; they did not create resident work or reopen the run.                                                    |

## Exercised

- Saved and restored the installed field guide through the browser's explicit restore confirmation. Existing history remained visible.
- Created a new edition, selected two actual documentation sources, edited purpose and high priority, and authored three checks: required document, excluded document and empty result.
- Archived and reopened that empty commission. Its ID, parent edition, specification and history were preserved.
- Searched the existing installed field guide for `room`; the browser displayed `docs/embodied-world.md`. Its resident-use count remained one because an operator search is a read-only preview.
- Saved the final state as **Field guide and maintenance commission**.
- Inspected the dossier, document shelf, chronicle, desktop world and mobile project/editor layouts. Parked the tab's cursor outside the viewport before inspections and after interactions. Reset the temporary viewport override afterward.
- Isolated automated tests exercised two distinct contributors, local claim ownership and inactive-lead succession, actual acceptance subprocesses, genuine source drift and index corruption, salvage capacity and stock conservation, archive/fork/restart, and lossless history pagination.
- The authenticated bridge test exercised claim, note, chronicle, physical build/test/diagnose, install, use, dismantle, archive, restart and checkpoint restoration in an isolated process.

## Authoritative evidence

- Original installed device: `device_ad8fd9c5-8b5d-41a8-9b58-0d7ddc02817a`; its original digest and completed build/test evidence remain unchanged. The live source check returned `current`.
- New commission: `device_d8ed59ad-0af6-46a0-9209-38a910b95c5a`, **Workshop maintenance manual**, blueprint edition 2, parent field guide edition 1, zero allocated parts, no build or validation, three pending checks.
- Operator revisions 14–20: first save 3734, restore 3735, fork 3736, revise 3737, archive 3738, reopen 3739, final save 3740.
- Final save event: `evt_6d04cd97-66a1-450d-bcb9-e537a6284c51`, September 7 at 23:21:49 EDT, snapshot revision 19 and resulting workshop revision 20.
- The chronicle contains all 20 workshop changes, including the September 5 parts/build/test/use records. Dossier contribution counts come from those actual records; new editions inherit no contribution credit.

## Visual observations

- Generated oak, wall-band and walnut-beam darkness companions were loaded into the room renderer. Dark rooms showed subdued neutral materials, while the visibly lit Synthesis room retained warm wood and plaster. Shared partitions and doorway rims aligned with adjoining material regions. This is a rendering observation, not an inference of resident perception or room occupancy.
- No broad second architectural material shade was applied over the generated companions. Existing scene illumination and lamp effects remain separate.
- At 390px, the finished modal body measured 320px client width and 320px scroll width; its project detail measured 296px for both. Only the project-card strip intentionally scrolled horizontally (398px content within 296px). The checkbox, header, page tabs and footer remained within the modal.
- Final browser error/warning inspection returned no entries after the corrected backend/frontend restart at 23:11 EDT. Earlier development errors are listed below rather than concealed.

## Validation results

| Check                                | Result                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:sandbox`               | 13/13 passed, including the final two-contributor conservation and attribution case                                                  |
| `npm run test:spatial`               | 34/34 passed                                                                                                                         |
| `npm run test:eval`                  | 40/40 passed                                                                                                                         |
| Full bridge suite                    | 26 passed; the expanded workshop case initially failed because its harness queried a dismantled, archived device before restoring it |
| Corrected bridge case, focused rerun | Passed; it verifies archived persistence, restores the saved installed checkpoint, and then queries the device                       |
| `npx tsc --noEmit`                   | Passed after the final UI layout change                                                                                              |
| `npm run lint`                       | Passed after the final UI layout change                                                                                              |
| `npm run build`                      | Passed all five production build stages after the final UI layout change                                                             |

The bridge results above are a full-suite run plus a focused rerun, not a claim of a subsequent single 27/27 full-suite execution. Audio's previously verified fix was unchanged in this pass; its actual timing reproduction and tests are recorded in the earlier shared-workshop report.

## Corrections and unsuccessful attempts

- The bridge correctly returned 409 when the test tried using a dismantled, archived device. The test order was corrected to restore the named installed checkpoint first; the isolated case then passed.
- An intermediate frontend hot update read a missing `contributions` field from the still-running older backend and raised a TypeError at 23:06 EDT. Added the absent-field guard and restarted the backend; subsequent dossier use and final diagnostics were clean.
- The first mobile project-list wrapper allowed a grid's automatic minimum width to widen the whole body. Fixed the grid track and sidebar minimum width, scoped the archive checkbox's flex rule correctly, and reset horizontal scroll when switching projects. Remeasured and visually inspected the corrected layout.
- After restoring desktop size, a browser locator still expected the compact mobile label `Workshop`; the desktop label was `Workshop B`. A fresh DOM inspection supplied the correct label before continuing.

## Result and follow-up

The existing instrument remains installed and usable. The new maintenance commission is intentionally unfinished and ready for a real resident to claim; its pending checks are not portrayed as completed work. The final named checkpoint preserves both projects. No live multi-resident lifecycle run was performed in this pass: cooperative accounting was verified with isolated fixtures. A future resident may undertake the maintenance commission through ordinary perception, movement and authenticated resource use.

The original full-folder backup remains outside this workspace and was untouched. Generated artwork provenance and export geometry are recorded in `design/hive-architecture-v1/README.md`; the operator and resident workflows are documented in `docs/shared-workshop.md`.
