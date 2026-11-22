# README media capture

- Date/time: November 21, 2026, 19:38 through 19:58 EST.
- Revision: `3fe5bedebc6daa48ddd6d0ea604a94ecc8062704` plus the existing
  uncommitted working tree, before the publication commit.
- Environment: development server at `http://localhost:3000/`, loopback bridge
  at `127.0.0.1:8787`, desktop Chrome viewport of 1920 × 855.
- Objective: capture real screenshots of the running village for the README
  GIFs and stills. This was an observer pass, not an embodied test.
- Participants: one Claude Code process acting as operator and observer. No
  facility identity was registered, assigned or reactivated.

## Runs

| Run ID                  | Outcome                              | Reason                                                                                                                            |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| No new facility run     | Passed observer capture              | Rendering and observer controls were exercised against the existing journal. No resident, world-action or tool event was emitted. |
| `run_mtnuw7r5_34758e02` | Previously completed; read only here | Bridge `/health` reported this run with `latestSequence` 3740 and `latestIntentSequence` 11 both before and after the pass.       |

## Exercised

- Village map hover cards for the Study, Workshop and Library, and entry into the
  Study, Workshop, Library, Meeting hall and Commons. Escape returned to the map.
- Wheel zoom in the Study from 100% through 116, 135, 157, 182, 212, 246 and 286%
  to the 300% limit, anchored on the desk; `0` fitted the room again. A
  double-click on the desk also focused the view.
- Field journal: Journal, Research and Present tabs, and scrolling on both pages.
- Operator dispatch composer opened with `M` and closed with Escape. Nothing was
  typed, saved or sent. The residents panel opened with `R`.
- The sound toggle was enabled and then muted.

## Observations

- Authoritative: `/health` reported `eventCount` 106, `intentCount` 0 and
  `mailboxUnreadDeliveryCount` 0 before and after the pass; `.arena/events.jsonl`
  and `.arena/intents.jsonl` modification times did not change. Opening the
  composer rewrote the ignored draft file `.arena/operator-mailbox.md` as 0 bytes;
  the composer had displayed an empty draft (0/2000) when it opened.
- Visual: zero residents and "A quiet moment" status. The Study rendered lit; the
  Commons, Library, Workshop and Meeting hall rendered in their lights-off state.
  The journal showed the completed run's Codex events and the "Working field
  guide" research topic with its build, change and validation evidence. The
  Present tab showed no agents present.

## Result

Observer controls, room entry, wheel zoom to 300%, the field journal and the
dispatch composer worked during this pass. The README media in `docs/media/` are
crops of these real screenshots. The GIFs add only short cross-fades between
consecutive captures.

## Follow-up

- The development server exited when started with a closed stdin, and a later
  start crashed with a V8 "Zone Allocation failed" out-of-memory error while
  system commit memory was nearly exhausted. A start with stdin held open
  succeeded. Neither failure was investigated further.
- The Chrome extension's built-in GIF export failed twice with browser
  out-of-memory errors, so frames were assembled offline instead.
- A `shift+slash` key dispatch did not visibly open the keyboard guide. The
  shortcut was not investigated further.
- Populated movement, speech and lighting transitions were not exercised.
