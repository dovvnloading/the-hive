# Environmental effects visual QA

- Date/time: 2026-09-03 20:30–20:53 EDT
- Revision: `3fe5bed` on `codex/hive-environment-v2`, plus the environmental-effects changes recorded by this report
- Environment: `http://localhost:3000/?assetrev=20260903-2&render=2x`
- Objective: Give room lighting a restrained game-like presentation with eased state changes, contained bloom, subtle fixture shimmer, and occasional tiny ambient flies without changing authoritative world state.
- Participants: `/root` -> `fx-steward-0903` -> Steward.

## Runs

| Run ID | Outcome | Reason |
| --- | --- | --- |
| `run_mtm82g5p_44cb85b1` | passed | A real resident cycled the Commons switch through seven accepted state changes, the browser was visually inspected at 2x with its cursor parked outside the scene, all automated gates passed, and the tested light ended off. |

## Exercised

- Switched the real Commons room light off/on repeatedly through the authenticated world-action path, then captured settled and consecutive live frames.
- Checked dark-to-lit asset crossfades, the room veil, fixture artwork, broad room bloom, local fixture bloom, and the switch indicator.
- Reloaded the in-app browser from scratch and inspected the complete six-room scene in mixed light states.
- Exercised the deterministic ambient-particle schedule in lit rooms and verified that dark rooms and reduced-motion mode suppress it.
- Verified `prefers-reduced-motion`: transitions settle immediately and shimmer/flies are disabled.

## Observations

- Authoritative: first off/on pair `evt_ce2c4629-5044-4423-858e-352c656a6aef` and `evt_ed641f78-2fa9-499b-b17b-85c566b0ba58`; final on/off pair `evt_20d6707b-c61b-4841-9fd0-1a4623ca8d5c` and `evt_1dabe522-7599-4e15-b881-abcc2d2b6f00`.
- Authoritative: resident completion `evt_dbd1c29e-13c8-4175-8d87-0c57545d6d5e`; run completion `evt_d77fd882-cc8e-4f5e-83f2-1ed7e99c7209`.
- Visual: bloom stayed inside each room's timber uprights; the Commons transition introduced no top-edge seam, divider spill, geometry shift, detached pixel cluster, or light-state flash. The dark endpoint remained readable and the lit endpoint retained the warm material palette.
- Visual: the sparse fly pass remained at sprite scale near room plants and did not read as interface decoration or obscure residents and fixtures.
- Console: a retained `roomLightLevel` reference error was timestamped before the corrected hot-reload. A clean page reload produced the current scene with no new runtime error.
- Automated: effects tests 4/4, spatial tests 34/34, spatial audit zero issues, bridge tests 26/26, TypeScript check clean, lint clean, and production build successful.

## Result

Passed. Lighting changes now ease over 420 ms off and 560 ms on, room and fixture bloom remain spatially clipped, steady lights use only restrained deterministic variation, and at most two occasional room-bound flies appear near a plant. These effects are renderer-only and do not alter collision, perception, action validation, journals, or saved world state.

## Follow-up

- None for this bounded pass. Add another effect only in response to a specific visual or gameplay need.
