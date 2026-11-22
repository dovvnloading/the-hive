# Audio system QA — 2026-09-04

## Scope

- Runtime source: the 18 original MP3 recordings supplied in `Swarm-Sounds`.
- Runtime copies: URL-safe, lossless copies in `public/audio/hive`.
- Implemented cues: office ambience, occasional lounge music, computer work, journal writing, doorway traversal, light switches, plant watering, and mailbox opening/reading.
- This record verifies wiring and runtime behavior only. Codex cannot hear speaker output, so subjective loudness and tonal balance remain a human listening check.

## Automated result

- `npm run test:audio`: 8/8 passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.

The checks cover asset presence and URL safety, conservative gain staging, variant shuffle/no immediate repetition, cue-to-event mapping, room-threshold-only door selection, embodied work-loop selection, event watermarking, spatial pan bounds, and full source-pool coverage.

## Live runtime observations

- Run: `run_mtms2qh2_ca8a2a18`.
- Resident: `audio-steward-0904` (`Sonora`).
- Plant hydration was inspected while thirsty and restored to healthy through the physical watering interaction (`seq 3512–3513`).
- The Commons journal desk was physically inspected and engaged before a private journal write (`seq 3516–3517`).
- The audio control unlocked, muted, and resumed without changing the simulation layout.
- QA exposed and corrected lifecycle races involving rapid mute/resume, loading readiness, inactive mailbox playback, and stale loop/effect revival after suspension.
- The live choreography was stopped at the user's direction and recorded factually as `agent.stopped` (`seq 3518`) and `run.canceled` (`seq 3519`); no unperformed interactions are claimed.

## Human listening check

Use the `AUDIO ON` control in the live simulation, then trigger a switch, water a plant, open the mailbox, use a computer, and write at the journal. Confirm that the background bed is subtle and that the lightly radio-colored music remains barely audible beneath activity sounds.
