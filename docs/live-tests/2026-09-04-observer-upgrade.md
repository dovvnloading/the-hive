# Observer controls and rendering upgrade

- Date/time: 2026-09-04, approximately 20:12–20:40 America/New_York.
- Revision: `3fe5bedebc6daa48ddd6d0ea604a94ecc8062704`, with the pre-existing uncommitted audio/environment work and this observer upgrade.
- Environment: local development preview at `http://localhost:3000`; authenticated loopback bridge at `http://127.0.0.1:8787`.
- Objective: improve observation controls and rendering without changing resident authority, routes, resource engagement, or event ownership.
- Participants: `/root` implemented and checked the changes; `/root/experience_review` performed independent source reviews; `/root/rug_asset` generated art. These were development processes, not registered facility residents.

## Backup

Before the first application edit, the entire folder was copied to the sibling
`Swarm-backup-2026-09-04-201347`: 80,995 files, 1.193 GiB, zero failed files or
mismatches. A read-only Robocopy comparison found only four subsequently
updated development-server heartbeat files under `.wrangler/registry`.

## Runs

| Run ID / attempt | Outcome | Reason |
| --- | --- | --- |
| `run_mtn7tti8_129f3e06` — empty bridge allocation | HTTP smoke passed; no facility run started | Health returned `ok: true`, sequence 3632, zero current-run events. No residents were registered or moved, and no lifecycle or work events were authored. There was no started run to complete or cancel. |
| Camera unit checks, first attempt | Failed | 4/5 passed; the Fit reset produced negative zero. The camera now normalizes Fit to zero offsets. |
| Camera/projection unit checks, final | Passed | 6/6, including reference stability over 100 idle ticks and proximity refresh on spawn/departure. |
| Existing automated suites | Passed | Spatial 34/34; environment 4/4; audio 8/8; bridge 26/26; evaluator 40/40. All 118 final checks passed. Test fixtures ran through the existing test harness, not as live collaboration residents. |
| Development hot reload | Recovered | Adding hooks triggered a cached hook-order error in the open preview. A full reload cleared it; subsequent captured browser error logs were empty. |

## Exercised

- Camera bounds, cursor-anchor invariance, Fit reset, follow-position zoom math.
- Stationary projection reference stability and factual proximity changes.
- Existing movement, lighting, audio, authentication, mailbox, private-journal, and evaluator tests.
- TypeScript check, lint, and production build.
- Local page and new rug asset HTTP requests, both 200; rug response 1,859,360 bytes.
- Browser error diagnostics and clean reload recovery. The browser cursor was parked at `(-32, -32)` using the tab's CDP input control before diagnostic inspection and reload.

## Observations

- Authoritative: the read-only health packet reported no current-run events. No live resident activity is claimed.
- Browser: the accessibility tree exposed the title, connection status, room selector, camera buttons, labels control, Residents/Journal/Research/Dispatch dock, sound control, guide, and immersive toggle. Fresh-load error logs were empty after recovery.
- Visual: the generated rug was inspected as a standalone asset. No live screenshot, resident-follow demonstration, or viewport-resizing pass was performed.
- Source review caught and corrected follow zoom using a stale camera, proximity becoming stale on stationary mutations, dialog opener unmounting, and cached sprites surviving a presentation change.

## Result

The upgraded source builds and passes 118 automated checks. Local HTTP and
browser error recovery checks passed. The loopback boundary, authenticated
world actions, append-only journals, existing furniture, and supplied audio
remain intact. The full pre-edit folder copy is retained separately.

## Follow-up

- A future real-resident run can exercise following a moving resident, physical dispatch pickup, and subjective sound balance together.
- Dedicated touch and compact-viewport visual testing remains separate from this diagnostic pass.
