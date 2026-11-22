# README footage with staged residents

- Date/time: November 22, 2026, 09:10 through 10:42 EST (14:10–15:42 UTC).
- Revision: `a40867d` plus the uncommitted second remake pass (top-down floor
  props, ChatGPT-illustrated residents in `residents-v2`), committed after this
  report.
- Environment:
  - Development server at `http://localhost:3000/`.
  - Loopback bridge at `127.0.0.1:8787`, started with `ARENA_DATA_DIR` pointing
    at a throwaway folder outside the repository. The real `.arena/` journal was
    not used, read or changed.
  - For the walking shots, the bridge was restarted with
    `ARENA_TRAVEL_SPEED_PX_PER_SECOND=30` and `ARENA_MIN_TRAVEL_MS=1500`, so
    walks last long enough to film.
  - Desktop Chrome.
- Objective: record README GIFs and stills of the remade village with residents
  in it.
- Participants: **none real.** At the user's explicit request, one Claude Code
  process spawned six scripted residents (Maple, Fern, Juniper, Bram, Clover,
  Ollie) and drove their moves, speech, tool calls and artifacts from a scratch
  script that was not committed. Every action went through the bridge's
  authenticated endpoints and was validated like a real resident's, but none of
  the tool calls ran a real tool. This departs from the AGENTS.md rule against
  scripted residents, and is recorded here so the runs are never read as
  embodied tests.

## Runs

| Run ID                  | Outcome                     | Reason                                                                                                    |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `run_mwrwzot9_06442767` | Abandoned staging run       | Commons chat and lane footage recorded, then replaced after the user asked to remake props and residents. |
| `run_mwrzsl3n_7245a9c5` | Used for the README footage | 91 events: 49 moves, 6 speech lines, 8 interactions, 4 tool starts, 3 tool finishes, 5 artifacts.         |

Neither run was completed or canceled; both stay open only in the throwaway
journal.

## Exercised

- **Arrival and departure.** Six residents spawned into the Commons. The arrival
  point holds four, so later spawns waited for earlier residents to step off. The
  residents then left one at a time along the lane to the Meeting hall, Workshop,
  Tool shed and Library.
- **Lighting.** Fern walked into the dark Library and switched the wall light on.
  The room changed from the lights-off art to the lit art. She then sat at the
  research computer.
- **Work.**
  - Juniper used the build bench, Bram the test rig, Maple the planning table and
    Ollie the shell console (after switching on the Tool shed light). Clover
    watered the Commons plant.
  - Seated and typing poses rendered at the bench, the rig and the table chairs.
- **Speech range.** Two attempts by Bram to address Juniper from across the
  Workshop were refused: `409 Juniper is outside speaking range; move closer
first`. The exchange worked once Bram walked to the plant spot and Juniper to
  the aisle.
- **Proof rules.** The bridge refused three tool finishes until the right
  evidence was linked:
  - The build finish was refused while it linked a `change` artifact; it needs a
    `test-result`.
  - The search finish was refused until its source note carried an HTTP(S) URL.
    It links the PostgreSQL `pg_trgm` documentation.
- **Field journal.**
  - The Journal tab showed the run's events.
  - The Research tab showed the "Field guide search" topic, complete, with its
    evidence.
  - The Present tab listed all six residents.

## Observations

- Authoritative: the throwaway bridge reported `run_mwrzsl3n_7245a9c5` at
  `latestSequence` 227 with 91 run events and no intents. The throwaway journal's
  `action-rejections.jsonl` held 394 rejections across all staging attempts, most
  of them retries while waiting for a landing or doorway to clear.
- Visual:
  - All six residents rendered in the illustrated style in every view: front,
    back, side, walking, seated, typing.
  - Floor props showed their tops from above. Lit and lights-off art switched
    with the room state.

## Result

The new GIFs (`village-tour`, `room-closeup`, `field-journal`) and stills
(`village`, `lit-and-dark`, `residents`) in `docs/media/` are crops of these
captures, with only short cross-fades added. The README labels the footage as
staged.

## Follow-up

- `dispatch-box.jpg` was not recaptured; it still shows the composer from the
  earlier capture.
- The staged runs were left open in the throwaway journal.
