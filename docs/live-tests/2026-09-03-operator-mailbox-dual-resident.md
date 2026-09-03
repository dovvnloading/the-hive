# Operator mailbox dual-resident live test

- Date/time: 2026-09-03 13:08-13:28 EDT
- Revision: `ceecbe1` on `codex/hive-environment-v2` with the mailbox working tree
- Environment: `http://localhost:3000/?assetrev=20260903-1&render=2x`
- Objective: Verify operator mailbox delivery while two real residents pursue simultaneous embodied work and coordinate in person.
- Participants: `/root` -> `steward-mailbox-0903` -> Steward (Rowan); `/root/mailbox_runner` -> `resident-mailbox-0903` -> Generalist (Mira)

## Runs

| Run ID                  | Outcome | Reason                                                                                                                                                                                                                           |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_mtls4nu9_722833af` | passed  | Targeted and broadcast dispatches were physically collected by their intended recipients; the requested spoken confirmation occurred; both residents completed factual work; the board, mailbox, lights, and run closed cleanly. |

## Exercised

- Sent operator dispatches through the live mailbox UI to one resident and to both residents.
- Preserved per-recipient delivery and required each resident to walk to `operator-mailbox` and use `read` before receiving private content.
- Ran autonomous plant care in parallel with mailbox pickup, followed by resident-to-resident search, proximity speech, and confirmation.
- Exercised shared arrival contention, doorway traversal, darkness-limited perception, physical light switches, and comms-board acknowledgement.
- Kept the Codex browser cursor outside the simulation viewport throughout observation.

## Observations

- Authoritative run boundaries: `evt_1a18e310-d5a0-481d-8bab-70567190c240` and `evt_7015d910-d097-492f-bc95-ee9347a1e0da`.
- Authoritative mailbox reads: Mira `evt_bd1bb905-b84e-4956-897c-189143a274e5` and `evt_647d6eea-9031-4f66-8b12-35835e03bd71`; Rowan `evt_13b1342c-9026-4cb1-8cb8-ece7f006fbfb` and `evt_3c6dab82-7e40-4e33-9f14-ef4ae5f94a33`.
- Authoritative situated handoff: Mira speech `evt_6a35d7d7-95ed-454b-af43-f8abe7b50f79`, Rowan confirmation `evt_3fb6e4a3-7bd4-43d5-8962-baae09d7fef3`.
- Authoritative concurrent care: Commons verification `evt_8820d764-828e-40c2-9e1a-d7427654bd77`; Command verification `evt_cbc4722d-e555-48a4-b349-f65658318af3`.
- Authoritative closeout: board message `msg_4cf32094-2d36-4235-8d10-4290dac4a311`, acknowledgement `evt_0ad96c4e-4eee-45d3-bd45-0b4b0c2dc1b7`, Mira completion `evt_8ab0ef4a-c8a7-4f1e-a363-16e0de4fbc07`, Rowan completion `evt_171ee728-1668-4314-80ee-bf6961841f4a`.
- Visual: both resident sprites were distinct and separated. Movement remained continuous through the visible paths; no wall crossing, body overlap, pushing, or teleport was observed. Room lighting visibly tracked the physical switch state.
- Contention: while both residents occupied `spawn-lift`, Mira yielded and reported the blocked route once. Rowan moving only to `context-hub` did not clear the single-exit funnel; after Rowan traversed through `door-context`, Mira refreshed perception and continued without repeated forcing.

## Result

The live mailbox path passed. Private message bodies stayed out of shared events, targeted delivery stayed recipient-specific, broadcast delivery created independent recipient pickups, and the autonomous resident finished her prior care commitment before retrieving mail and seeking Rowan. The mailbox ended empty, the board ended acknowledged, all active room lights ended off, and both real resident processes reached factual terminal states.

## Follow-up

- Improve the shared arrival landing so one resident at `context-hub` does not continue to block a second resident at `spawn-lift`; the present yield and recovery logic is safe, but the funnel requires the leader to clear an additional doorway edge.
