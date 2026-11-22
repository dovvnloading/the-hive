# Visual remake check with staged residents

- Date/time: November 22, 2026, about 06:30 through 08:20 EST.
- Revision: `150e61d` plus the uncommitted remake (room backgrounds,
  interactable props, renderer changes) committed after this pass.
- Environment: development server at `http://localhost:3000/` and a loopback
  bridge at `127.0.0.1:8787`, started with `ARENA_DATA_DIR` pointing at a
  throwaway folder outside the repository. The real `.arena/` journal was not
  used, read or changed. Desktop Chrome.
- Objective: see the new resident characters and the remade rooms and props in
  the running village, and stage scenes for README footage.
- Participants: **none real.** At the user's explicit request, one Claude Code
  process spawned six scripted residents (Maple, Fern, Juniper, Bram, Clover,
  Ollie) on the throwaway journal and drove their moves and speech from a
  scratch script that was not committed. This departs from the AGENTS.md rule
  against scripted residents. It is recorded here so that nobody mistakes
  these runs for embodied tests.

## Runs

| Run ID                  | Outcome                    | Reason                                                                                    |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `run_mwrrixgk_ce4ced11` | Abandoned staging run      | Four scripted residents and one speech line; replaced to match names to the new sprites.  |
| `run_mwrsdkw9_45ed82af` | Abandoned staging run      | The fifth spawn failed: "Commons arrival point has no collision-safe spawn slot".         |
| `run_mwrse2r9_5278d87c` | Abandoned staging run      | Bram's move to the Commons hub was refused: route conflict with Juniper.                  |
| `run_mwrselwm_4d44ce41` | Abandoned staging run      | Bram's move to the plant spot was refused: route conflict with Juniper.                   |
| `run_mwrsf8up_f36f5570` | Used for the visual checks | Six scripted residents, four speech lines; reached sequence 72 with 24 events in the run. |

Each staging attempt reset the throwaway journal. None of these runs reached
completion, and no README footage was published.

## Exercised

- Spawn queue capacity: four residents fill the Commons arrival point; later
  spawns need earlier residents to step off first.
- Route conflicts: moves into the Commons hub and plant spot were refused with
  `409 ... route conflicts with <resident>; yield, then observe again` while
  another resident held the landing.
- Rendering of the new character sheets in the room view and the Residents
  panel portraits.
- Rendering of the new room backgrounds and props in all six rooms. Lit rooms
  used the lit art; rooms nobody had switched on used the lights-off art.
- Prop state art followed run state: the Commons plant was shown wilted, then
  dead after time passed; the mailbox showed its full variant.

## Observations

- Authoritative: the throwaway bridge reported `run_mwrsf8up_f36f5570` at
  `latestSequence` 72. No intents were created.
- Visual: the Commons, Meeting hall, Study and Workshop rendered lit. The
  Library and Tool shed rendered in their lights-off grade. Furniture,
  boards, lamps, switches, the mailbox and doorway frames sat on the painted
  rooms at their existing world positions.

## Result

The new residents and the remade interiors render in every room, with lit and
lights-off art and state variants working. No embodied behavior was tested.

## Follow-up

- The vinext dev server failed every request with "Maximum call stack size
  exceeded" after many watched files were rewritten, and needed a restart. A
  stopped `npx` wrapper also left its `node` child running on port 3000.
- Machine memory ran out twice during the pass (ChatGPT tab freezes and a tab
  crash). Low commit memory remains a risk for long sessions.
- README GIFs still show the previous art and an empty village.
