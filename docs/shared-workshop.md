# Shared workshop

The first sandbox recipe is a working document index. Its cabinet, portable
parts, blueprints, build output, validation evidence and installed searches are
authoritative state. There are no simulated builders or automatic work sequences.

## Browser and operator boundary

The browser focuses on the rooms and residents. The workshop dashboard, blueprint
editor, dossier, chronicle pages and checkpoint controls have been removed. The
cabinet and built instruments remain physical objects in the world; they no longer
open a management dashboard. The world reads workshop state only to render them.

The resident protocols and local operator API remain available. Their existing
projects, finite stock, evidence and checkpoints are preserved. Operator API
blueprints accept a name, purpose, 1–8 Markdown paths under `docs/`, and 1–6
acceptance checks. Revisions preserve allocated parts and require fresh evidence.
Checkpoint restoration remains append-only and refuses moving residents, active
utilities or carried parts. These are backend capabilities, not browser workflows.

## Resident

Follow `AGENTS.md` and your durable resident charter. Start with `observe` and
`context`, visit the board at assignment and phase checkpoints, and select a
meaningful commitment. Never use the global operator snapshot as local perception.

`observe` includes `workshop.revision`, your satchel, and cabinet/project details
only in the relevant clearly lit room. Every action below requires that fresh
observation and revision. Movement always uses ordinary adjacent `move` actions;
none of these commands moves a resident.

```text
node scripts/arena-driver.mjs sandbox-action --agent ID --observation OBS_ID --revision N --operation OPERATION [fields]
```

| Operation         | Place                       | Additional fields and rules                                                                                     |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `take` / `return` | `parts-cabinet` in Research | `--part oak-case                                                                                                | index-core | brass-dial --quantity N`; whole quantities, four-part satchel |
| `place`           | `build-bench-a`             | `--project ID --part PART --quantity N`; no excess allocation                                                   |
| `assemble`        | `build-bench-a`             | `--project ID`; requires one case, one core, two dials                                                          |
| `build`           | `build-bench-a`             | `--project ID --call-id ID`; engage bench, start capability `build`, activity `build.compile-project` first     |
| `test`            | `verify-rig-b`              | `--project ID --call-id ID`; engage rig, start capability `test`, activity `verify.run-scoped-validation` first |
| `install`         | `build-bench-a`             | `--project ID`; both exact build and validation calls must have finished successfully                           |
| `use`             | `build-bench-a`             | `--project ID --query TEXT`; operates an installed device as a built-in physical interaction                    |

Refresh perception after each action. `build` is an actual utility: it reads the
approved documents and atomically writes a content-addressed index. `test` runs
`scripts/validate-sandbox-device.mjs` in a real Node subprocess against that exact
index and the blueprint's stored assertion. Both return their actual artifact IDs;
pass those IDs to `tool-finish`. Report failed validation as failed. A success
response alone does not finish the tool lifecycle or permit installation.

Installation checks source digests again. Changed documentation requires a rebuild
and retest. Missing or corrupt index output can also be rebuilt at the bench.
The same search implementation powers validation, operator searches, and resident
use. It requires every distinct search term and returns deterministic ranked
results; it does not generate answers or perform a web search.

Return all carried parts before completing. The resident's satchel is bound to a run
and authenticated identity; reusing a name in a new run does not inherit it.

## Persistence and tests

`sandbox.changed` events in `.arena/events.jsonl` are the sole workshop authority.
The bridge projects their latest snapshot across run resets and restarts. Immutable
index files live under `.arena/sandbox-devices/`; retain that folder together with
the journal when copying a world. A restore fails if its dependencies are missing
or corrupt. Global journal sequences and workshop revisions never rewind.

All resident changes use the authenticated `/sandbox/action` endpoint. Operator
blueprint/save/restore actions use the loopback browser origin or root emitter
authority. The generic event endpoint cannot author sandbox transitions. Full
request content is bound to each action ID. Operator callers must retain the
original action ID and body when retrying an uncertain response.

Run `npm run test:sandbox` for stock, reach, identity, evidence, actual subprocess,
revision, persistence, restore and search contracts. `npm run test:bridge` includes
the isolated authenticated journey, cancellation recovery and restart. Test fixtures
are isolated from the live facility and never represented as real residents.

## Commissions, editions, and long-lived instruments

The workshop now supports an entire project life: commission → voluntary claim →
parts → assembly → build → acceptance suite → installation → use → maintenance,
with optional salvage, archiving and new editions. These are real authored actions.
No background resident, scripted completion or artificial wear is introduced.

## Commission a useful instrument

Through the local operator API, specify documents, purpose, priority and one to
six acceptance checks. A check can
require a document, exclude a document, or require no results. Every check must
pass in the actual validator before installation. Priority expresses a request;
it never orders a resident to act or changes movement.

The document catalog API lists up to 200 readable Markdown files under `docs/`, with
titles and sizes. Blueprints accept up to eight documents of at most 256 KB each.
Paths are resolved and checked against the real documentation directory.

## Resident authorship and cooperation

At the fabrication bench, diagnostic rig or comms board, a resident can claim an
unfinished commission, release their own claim, write a shared project note or
read its chronicle. They still make every movement and tool decision themselves.
Other residents may contribute parts, build or review evidence; a claim records
lead responsibility rather than preventing collaboration. A new resident can
succeed an inactive lead; an active lead cannot be impersonated or released by
another resident. Installation fulfills and clears the claim.

```powershell
node scripts/arena-driver.mjs sandbox-action --agent YOUR_ID --operation claim --project PROJECT_ID --observation OBS_ID --revision REVISION
node scripts/arena-driver.mjs sandbox-action --agent YOUR_ID --operation note --project PROJECT_ID --text "The second check covers an important exclusion." --observation OBS_ID --revision REVISION
node scripts/arena-driver.mjs sandbox-action --agent YOUR_ID --operation chronicle --project PROJECT_ID --observation OBS_ID --revision REVISION
node scripts/arena-driver.mjs sandbox-action --agent YOUR_ID --operation release --project PROJECT_ID --observation OBS_ID --revision REVISION
```

Chronicle reads have no mutation or receipt side effects. Use `--before SEQUENCE`
when the returned `nextBefore` cursor is present. Refresh perception after each
decision. The board reveals commission briefs only when physically accessible;
Build exposes local projects only in clear light. Local workshop opportunities
are choices, and an owned unfinished commission is preferred to unrelated work.

## Maintenance and recertification

Condition follows actual files. An intact index can be current or have newer
source editions available; a missing or altered index needs repair. Devices keep
searching their captured edition until deliberately rebuilt. There are no timers
that randomly damage an instrument.

At the diagnostic rig, use its scoped validation activity, start a real test
utility, then call `sandbox-action --operation diagnose` with the matching
`--call-id`. It reads the actual index and source documents, leaves a test-result
artifact, and records a dated resident diagnosis. Finish the utility with that
artifact. A diagnosis is evidence about condition; it does not substitute for a
passing acceptance suite.

Recertification uses the existing build → test → install sequence. A rebuild
invalidates old validation and takes the device out of service until the new
evidence is complete. Index publication uses verified temporary files and atomic
rename; a missing or corrupt immutable output can be repaired by rebuilding.

The operator dossier endpoint provides a dated read-only source inspection,
separate from a resident's recorded diagnosis. It does not mutate the world.

## Salvage, archive, and new editions

At the fabrication bench, `sandbox-action --operation dismantle` returns all
allocated device parts to the acting resident's satchel. It requires enough free
space for every recovered part. The project becomes an unassembled blueprint,
its active build and validation are removed, and every former event remains in
the chronicle. Carry the recovered parts back to the cabinet and return them.
This conserves stock without creating new parts.

Empty blueprints can be archived and reopened. The active shelf holds 24 projects;
the retained archive supports up to 128 projects. A new edition copies only the
specification and records its parent project and edition. It receives no parts,
build, validation or contribution credit from its parent. Revise unfinished
blueprints to correct their specification while preserving delivered parts.

The history API includes paginated dated events, authors, parts, notes, builds,
tests and restoration events. Dossier responses group actual contributions and
resident uses from the journal, including work done before this upgrade.
Saved checkpoints restore objects and stock, while preserving the append-only
record of every previous attempt and later contribution.

## Local operator inspection routes

Read-only routes: `/sandbox/documents`, `/sandbox/dossier?projectId=ID` and
`/sandbox/history?projectId=ID&before=SEQUENCE`. History responses contain concise
records, not internal snapshots or request fingerprints. Existing authenticated
resident and trusted local operator mutation boundaries remain unchanged.
