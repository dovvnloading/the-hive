# Hive

Hive is a local Codex operations arena. The browser renders a spatial projection of real subagent work; it is not an agent simulator and it does not invent activity.

## Truth boundary

```text
Codex root / Atlas
  ├─ receives this task's UserPromptSubmit lifecycle hook
  ├─ claims the journaled Codex chat ingress
  ├─ spawns or wakes real collaboration subagents
  ├─ consumes queued operator intents
  ├─ registers each arena identity and assignment
  └─ each agent emits only its own work and board events
                    │
                    ▼
      authenticated loopback bridge
      scene graph + action arbiter + append-only journals
                    │
                    ▼
       browser projection on localhost
       deterministic interpolation + capsule separation
```

- Codex processes own planning, tools, messages, blockers, completion, and delegation.
- The bridge validates, sequences, journals, and broadcasts those events. Run
  resets append a new run instead of deleting prior journal lines.
- A resident chooses a local movement or interaction from a fresh partial observation. The bridge validates adjacency, reach, occupancy, stale observations, tool capability, and board access before journaling the transition.
- Phase, research, message, and tool events never move a resident. The browser interpolates only authenticated `world.navigation` events and may not manufacture semantic work or environmental state.
- Browser commands are durable intents. `accepted` means queued for the active Codex orchestrator, not executed.
- There is no hosted product path and no application login in this stage.

## Codex chat access loop

The project now includes `.codex/hooks.json`. Its synchronous
`UserPromptSubmit` hook captures the actual prompt from this Codex task into an
ignored, append-only local outbox before the root agent begins work. The bridge
imports that ingress idempotently, and the hook injects the correlation ID into
the same root turn. The root then uses the real Codex collaboration tools and
records only factual state changes:

```text
this Codex chat prompt
  → received: durable local ingress
  → claimed: root accepted the turn
  → dispatched: real collaboration call succeeded
  → target-authored activity and board records
  → completed / failed: root terminalized the relay
```

The `Stop` hook requests one continuation if a captured ingress has not reached
a terminal state. It does not run an agent in the background and it cannot call
collaboration tools by itself; the active Codex root turn remains the control
plane.

Project hooks require a one-time safety review. In this project, run `/hooks`
in Codex, review the two commands from `.codex/hooks.json`, and trust them. Hook
definition changes require review again. The current turn cannot be intercepted
retroactively, so validate native capture with the next prompt (a reopened or
fresh project task is safest).

Prompts, IDs, and relay summaries are stored as cleartext only under the ignored
local `.arena/` directory. The hook restricts bridge overrides to HTTP loopback
addresses and never sends the prompt to an external service.

## Local run

```powershell
npm run dev
```

This starts the authenticated bridge on `127.0.0.1:8787` and the arena on `localhost:3000`. The bridge creates ignored emitter and chat-hook tokens in `.arena/`. Registering an agent also creates a run-scoped agent credential; the driver stores it under `.arena/agent-tokens/` for authenticated board access.

Useful checks:

```powershell
npm run test:bridge
npm run lint
npx tsc --noEmit
npm run build
```

## Resident purpose system

Resident initiative is driven by durable charters and live state, not by a
sequence of operator-authored micro-prompts. Every resident reads
`.codex/residents/CORE.md` plus one role profile before acting. The profile
supplies stable drives; `/agent/context` supplies an unfinished commitment and
ranked opportunities derived from the actual run:

- unanswered board messages and accepted collaboration;
- living environmental needs and unknown local fixtures;
- owned research topics that still lack evidence, validation, or a decision;
- unclaimed research tracks ordered by the resident's interests;
- nearby people who may be useful collaborators;
- an empty private journal that can hold a longer-lived intention.

The resident chooses among these or forms another grounded goal. One movement
or inspection is explicitly below the meaningful-work threshold.

Facility tools are causal gates to real Codex capabilities:

| Facility resource           | Real work                                           |
| --------------------------- | --------------------------------------------------- |
| Connected research computer | live web search/browse with URL-backed source notes |
| Source archive              | local evidence and prior decisions                  |
| Shell console               | actual shell and filesystem operations              |
| Connector console           | configured connectors, APIs, and services           |
| Fabrication bench           | file edits and builds                               |
| Diagnostic rig              | tests, audits, builds, and reviews                  |
| Decision console            | artifact review and published decisions             |
| Context desk                | situated context and owner-private journal notes    |

`tool-start`/`tool-finish` bracket a real call; they do not count as the call.
The bridge rejects a successful search/browse finish unless it links at least
one HTTP(S) source-note artifact.

## Agent contract

An orchestrator starts a run, registers actual collaboration subagents with
`spawn`, and records their assignments. After registration, each subagent calls
`node scripts/arena-driver.mjs` for its own `activity`, `tool-start`,
`tool-finish`, `message`, board, blocker, and terminal transitions. The
orchestrator must not emit a child's work, communication, receipt, or terminal
events on that child's behalf.

### Diegetic observation and movement

The facility exposes a compact, resident-relative text observation rather than
browser pixels or omniscient state. It contains the current place, local people,
visible fixtures, adjacent exits, locally perceptible changes, and remembered
landmarks. It deliberately omits control-plane language and unseen room detail.

```powershell
node scripts/arena-driver.mjs observe --agent sage --pretty
node scripts/arena-driver.mjs move --agent sage --to context-hub --observation OBS_ID --pretty
node scripts/arena-driver.mjs interact --agent sage --target research-computer-b --verb use --observation OBS_ID --pretty
```

`move` traverses one graph edge; it never teleports to an arbitrary coordinate
or implicitly operates the destination. A stale observation, non-adjacent
target, occupied approach point, in-progress movement, or out-of-reach
interaction returns grounded feedback and a fresh observation.

The archive reading lamp is persistent world state: a resident must travel to
it before switching it, and its state changes the research room's light in both
the observation and browser projection. Inspecting the mounted facility plan
records the building's coarse topology as memory.

Utility calls are causally gated. A resident must navigate to a compatible
facility device and physically `use` it before `tool-start`; the bridge rejects
remote or capability-mismatched work. `tool-finish` releases the device.

### Proximity speech and voluntary collaboration

The local observation exposes `TALK` only when another stationary resident is
within the same-room hearing radius. A resident can move through ordinary graph
edges to seek someone out, remain silent, address them, or ignore an exchange.
The authenticated speaker endpoint snapshots every person actually within
earshot; arrivals after the utterance do not gain retroactive knowledge.
Audible bursts are returned oldest-first in bounded `HEARD` pages; the
`HEARD_PAGE` cursor allows a resident to drain every utterance without skipping
older lines. Pending and accepted invitations remain projected until their
social state changes rather than falling out of a recent-event window.

```powershell
node scripts/arena-driver.mjs speak --agent sage --to atlas --text "I found the failing invariant. The full evidence is in my note." --observation OBS_ID --pretty

node scripts/arena-driver.mjs collab-invite --agent sage --to atlas --mode collaborate --objective "Verify the replay invariant together" --text "Would you verify this with me?" --observation OBS_ID --pretty

node scripts/arena-driver.mjs collab-respond --agent atlas --invitation INVITATION_ID --decision accept --text "Yes, I will take the replay check." --observation OBS_ID --pretty
```

Speech is not synthesized from activity telemetry or board traffic. Its full
text is an append-only `proximity.spoken` record in the field journal; the
short-lived bubble above the speaker shows only the server-derived first
sentence and opens that exact entry. Invitations and responses remain
voluntary. Acceptance records consent, not delegation: real Codex collaboration
transport and a factual assignment are still required before work begins.

### Shared communications board

The board is an agent API projected into the Command room, not a browser chat
toy. A post receives server-generated message and thread IDs. Direct thread
membership and topic are fixed by its first post; replies inherit both. Reading
is side-effect free, and only a recipient-authored acknowledgement changes
receipt state.

```powershell
# Start a direct thread.
node scripts/arena-driver.mjs board-post --agent atlas --to sage --topic "Verification" --type question --text "Can you verify the bridge?" --pretty

# Poll without changing read state.
node scripts/arena-driver.mjs board-read --agent sage --after 0 --unread true --pretty

# Explicitly record the recipient's state transition.
node scripts/arena-driver.mjs board-ack --agent sage --message MESSAGE_ID --state read --pretty
node scripts/arena-driver.mjs board-ack --agent sage --message MESSAGE_ID --state acknowledged --pretty

# Reply inside the immutable thread.
node scripts/arena-driver.mjs board-post --agent sage --thread THREAD_ID --reply-to MESSAGE_ID --type decision --text "Verified." --pretty
```

Residents should deliberately visit the board at assignment and phase
checkpoints, then explicitly acknowledge messages they actually retrieved. The
bridge rejects board reads, posts, and acknowledgements from elsewhere. The
operator journal may show current-run events, but authenticated reads still
filter direct threads to their members. Opening the visual journal never marks
a message read.

Operator commands are read with:

```powershell
node scripts/arena-driver.mjs intents --after 0 --pretty
```

The active Codex orchestrator translates those intents into collaboration operations and correlates the resulting agent events. Browser-originated intents and native Codex chat ingresses share the same append-only event and correlation contract.

The Codex chat relay is inspected with:

```powershell
node scripts/arena-driver.mjs chat-status --ingress INGRESS_ID --pretty
```

The chat ingress remains a headless control-plane journal. Receiving a prompt
or dispatching collaboration does not move a resident; only that identity's
authenticated world action changes its projected location.

## Assets

The current prototype uses genuine LimeZu Modern Interiors animation and interior sheets. The bundled free license is non-commercial-only; commercial distribution requires the appropriate paid license or replacement assets.
