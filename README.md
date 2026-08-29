# Hive

Hive is a local Codex operations arena. The browser renders a spatial projection of real subagent work; it is not an agent simulator and it does not invent activity.

## Truth boundary

```text
Codex root / Atlas
  ├─ spawns real collaboration subagents
  ├─ consumes queued operator intents
  └─ each agent emits only its own lifecycle events
                    │
                    ▼
      authenticated loopback bridge
      events.jsonl      intents.jsonl
                    │
                    ▼
       browser projection on localhost
       semantic reducer + avatar motion
```

- Codex processes own planning, tools, messages, blockers, completion, and delegation.
- The bridge validates, sequences, journals, and broadcasts those events.
- The browser may interpolate an avatar between stations, but it may not manufacture semantic work.
- Browser commands are durable intents. `accepted` means queued for the active Codex orchestrator, not executed.
- There is no hosted product path and no application login in this stage.

## Local run

```powershell
npm run dev
```

This starts the authenticated bridge on `127.0.0.1:8787` and the arena on `localhost:3000`. The bridge creates an ignored emitter token in `.arena/`; `arena-driver.mjs` reads it automatically.

Useful checks:

```powershell
npm run test:bridge
npm run lint
npx tsc --noEmit
npm run build
```

## Agent contract

An orchestrator starts a run, then spawns actual collaboration subagents. Each agent calls `node scripts/arena-driver.mjs` for its own `spawn`, `assign`, `activity`, `tool-start`, `tool-finish`, `message`, blocker, and terminal transitions. An orchestrator must not emit child events on a child's behalf.

Operator commands are read with:

```powershell
node scripts/arena-driver.mjs intents --after 0 --pretty
```

The active Codex orchestrator translates those intents into collaboration operations and correlates the resulting agent events. A future native Codex lifecycle adapter can replace this explicit instrumentation without changing the browser event contract.

## Assets

The current prototype uses genuine LimeZu Modern Interiors animation and interior sheets. The bundled free license is non-commercial-only; commercial distribution requires the appropriate paid license or replacement assets.
