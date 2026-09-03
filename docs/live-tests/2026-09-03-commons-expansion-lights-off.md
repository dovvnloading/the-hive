# Commons expansion and lights-off QA

- Date/time: 2026-09-03 20:45–22:30 EDT
- Revision: `b33a012` on `codex/hive-environment-v2`, plus the follow-up lighting correction recorded by this report
- Environment: `http://localhost:3000/?assetrev=20260903-2&render=2x`
- Objective: Exercise the widened Commons with four real residents, verify room-scoped lit and lights-off assets, and finish with every resident terminal and every room light off.
- Participants: `/root` -> `night-steward-0903` -> Steward; `/root/night_explorer_live` -> `night-explorer-0903` -> Explorer; `/root/night_maker_live` -> `night-maker-0903` -> Maker; `/root/night_critic_live` -> `night-critic-0903` -> Critic.

## Runs

| Run ID | Outcome | Reason |
| --- | --- | --- |
| `run_mtlzv49c_4c9c8f27` | passed | Four residents used both Commons lanes and shared resources, all addressed mail and the direct handoff were cleared, all residents completed, and all six room lights ended off. |

## Exercised

- Started four real identities at the two primary and two overflow Commons arrival positions.
- Admitted two residents concurrently to independent west/east landing slots, held one landing while the opposite lane cleared, then admitted an overflow resident on the vacated side.
- Drained residents through the single-file Commons doorway toward different rooms while respecting `open`, `yield`, `reserved`, and `occupied` route states.
- Used the operator mailbox and private journal concurrently. Two operator dispatch rounds were physically retrieved by all addressees; no message or private-note text is retained here.
- Cycled Research ceiling/task-only lighting, Command, Utility, Synthesis, Commons, and Build; inspected panels, plants, doorways, both mailbox states, and an occupied Build chair.
- Checked the full 2x visual matrix in the in-app browser with its cursor parked outside the viewport.

## Observations

- Authoritative: run start `evt_1305a21f-aeca-4d24-b1d1-1d2fe7719b79`; simultaneous Commons landings `evt_39ebb473-e1a2-47d2-9119-8096227956fb` and `evt_915db857-1804-424a-a7d6-b2612b1f6180`; west-lane clearance `evt_aedd6338-12c7-41db-9b8c-e31e1febc1ac`; overflow admission `evt_1e2a0329-c347-42c1-97e6-5050de2b85f0`.
- Authoritative: concurrent journal engagement `evt_464d3ea5-2890-4d08-b67c-b7064a7cbeca`; first mailbox pickup `evt_5316f7a2-f2ed-4495-bb75-9f28ee1be1fe`; final mailbox pickup `evt_3558bb28-1230-4bef-9116-b002e0e0b161`; direct handoff resolution `evt_31dc6222-4199-4121-9a16-db3c6c96cda3`.
- Authoritative: Research task-lamp-only state was established by `evt_bdadd9bf-4d56-4ce5-b2dc-9a4edfce8ade` and `evt_5f53ab8f-98bb-4029-922c-b4698ea43dda`; final Research cleanup is `evt_1b4a9ebf-7977-4572-a554-f4a0330a5683` and `evt_49384f70-b479-44fc-88e5-00496d6dc3dc`.
- Authoritative: final Commons off `evt_3f519e9d-60d2-4d85-b86a-f45a4bf418f2`; final Command off `evt_3ee02e7a-fdc6-4234-94cd-1a1cf5f89f9b`; consolidated result `night-steward-commons-lights-off-qa-20260903`; run completion `evt_c5ec1109-f6b7-4a6a-bc8e-b0f148d0b4ce`.
- Visual: no overlap, pushing, wall-riding, stalled walk cycle, teleport, light-state flash, geometry drift, wall overlap, detached asset, seating mismatch, or hotspot mismatch was observed.
- Visual correction: the Research task-lamp glow initially crossed the Research/Command partition. Its radial pass is now clipped to Research and was rechecked in task-only and room-lit states.
- Visual correction: the 18% dark-room veil was too light and its 3px inset exposed bright top/side seams. A first 30% correction remained too light in follow-up review because `drawRoom` also painted a one-pixel wall highlight while rooms were off. The final veil is 48% navy-black, uses exact room bounds, and the wall highlight is emitted only for a powered room. The final all-off 2x frame showed continuous dark coverage with crisp partitions and no illuminated cap line.
- Automated: the first full bridge run exposed a test-only stale-observation race while an arrival projection settled. The helper now follows the production protocol once with a fresh observation; a persistent or non-stale rejection still fails the test.
- Automated final: spatial tests 34/34, spatial audit zero issues, bridge tests 26/26, lint clean, and production build successful.

## Result

The widened Commons, four-resident circulation, mailbox/journal concurrency, room-scoped asset resolver, chair foregrounds, and lit/off visual states passed. The two visual defects found during the run were corrected and visually reverified. The terminal journal state has four completed residents, no unread board or mailbox receipt, and every room light off.

## Follow-up

- None for this batch.
