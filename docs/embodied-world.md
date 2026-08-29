# Diegetic World Protocol v2

## Goal

Hive treats language-model cognition as the high-level policy inside a causal,
partially observable facility. Work no longer causes post-hoc sprite movement.
Instead, the facility emits a local observation, the resident chooses one
bounded action, deterministic code validates and executes it, and the resulting
state becomes the next observation.

```text
authoritative journal + scene graph
  -> resident-relative perception filter
  -> compact observation with stable IDs
  -> one authenticated move or interaction
  -> topology / reach / occupancy / state validation
  -> timed world transition
  -> browser interpolation + next observation
```

## Separation of concerns

- **World truth:** locations, topology, entity state, occupancy, movement time,
  resource engagement, and append-only transitions.
- **Perception:** the current place, co-located people, visible fixtures,
  adjacent exits, local changes, speaking affordances, newly heard utterances,
  invitation state, board audibility, and lighting.
- **Memory:** visited locations, inspected fixture detail, and the coarse map
  learned from the mounted facility plan.
- **Policy:** why to move, which adjacent place matters, what to inspect or
  operate, when to use a facility resource, and how to react to feedback.
- **Motor projection:** interpolation and capsule separation. It can move only
  along a validated world transition and cannot select goals or mutate props.

The observation packet is diegetic. It does not add `simulation`, `avatar`,
`browser`, `experiment`, or orchestration vocabulary. Stable entity and location
IDs make references cheap and unambiguous.

## Current action grammar

```text
OBSERVE(after?) -> OBS_ID + local scene
MOVE(OBS_ID, adjacent location) -> timed navigation transition
INTERACT(OBS_ID, entity at current location, verb) -> factual result/state
SPEAK(OBS_ID, nearby person, authored words) -> audible speech record
INVITE(OBS_ID, nearby person, mode, objective, words) -> pending consent request
RESPOND(OBS_ID, invitation, accept|decline, words) -> voluntary consent record
```

Important invariants:

- No coordinate or arbitrary-room target is accepted from the model.
- A move crosses exactly one graph edge.
- A stale observation, active movement, occupied target, or non-adjacent
  destination is rejected with a fresh local observation.
- Interaction never implies movement and fails outside physical reach.
- Activity, research, messages, and tool events never change location.
- Speech requires a fresh observation, same-room proximity, and stationary
  speaker and listener. It snapshots all co-located people in earshot rather
  than granting knowledge from a later omniscient replay.
- Audible speech is paged oldest-first with an explicit continuation sequence;
  bursts cannot silently disappear behind a global observation cursor.
- Proximity alone never causes speech, replies, invitations, acceptance, or
  movement. Every utterance is authored by the authenticated speaker.
- Invitation acceptance records consent only. It cannot fabricate a process,
  delegation, or assignment in the collaboration control plane.
- A real tool call requires a physically engaged resource with the matching
  capability; tool completion releases it.
- Board reads, posts, and acknowledgements require presence at the comms board.
- World transitions are accepted only through the per-identity action endpoint;
  generic event emission cannot forge them.

## Causal fixtures in this slice

- **Archive reading lamp:** `inspect`, `switch_on`, and `switch_off`. Its
  persistent power state changes the research room's semantic light state and
  rendered illumination.
- **Mounted facility plan:** `inspect`. Its result records the coarse west / center
  / east room topology as resident memory.
- **Facility computers and benches:** `inspect` reveals capabilities; `use`
  creates the physical engagement required for real tool work.
- **Comms board:** content is unavailable remotely. A board chime may be
  perceived elsewhere, but the content can be retrieved only at the board.

## Why this shape

- [TextWorld](https://arxiv.org/abs/1806.11532) and
  [ALFWorld](https://arxiv.org/abs/2010.03768) establish compact textual
  observation/action environments for partially observable embodied tasks.
- [KG-A2C](https://arxiv.org/abs/2001.08837) and
  [dynamic belief graphs](https://arxiv.org/abs/2002.09127) motivate stable
  entity graphs and incremental belief updates instead of repeated prose dumps.
- [SayCan](https://arxiv.org/abs/2204.01691) supports separating language-level
  usefulness from environment-grounded feasibility.
- [Inner Monologue](https://arxiv.org/abs/2207.05608) and
  [ReAct](https://arxiv.org/abs/2210.03629) support interleaving decisions with
  actual success, failure, and scene feedback.
- [SayPlan](https://arxiv.org/abs/2307.06135) motivates a hierarchical scene
  graph with semantic destination choice above deterministic path execution.
- [Generative Agents](https://arxiv.org/abs/2304.03442) motivates distinct
  observation, memory, reflection, and planning layers, including emergent
  conversation and invitation behavior rather than scripted social playback.
- [Concordia](https://arxiv.org/abs/2312.03664) supports separating voluntary
  natural-language actions from an environment authority that checks physical
  plausibility and applies grounded effects.
- [Melting Pot](https://arxiv.org/abs/2211.13746) motivates representing varied
  social choices—including cooperation, reciprocity, and refusal—without
  assuming that proximity implies one fixed interaction policy.

## Known boundary and next slices

Real Codex collaboration processes receive higher-priority platform context
that identifies their technical role. Application code cannot make that context
disappear. Hive can keep its own perception stream entirely diegetic, but strict
experimental blinding would require a separately invoked model surface whose
system context is controlled end-to-end.

The next implementation slices are authoritative door state and interruption,
server-side motion progress, wall/door occlusion beyond room boundaries,
portable inventory, a plant with hidden moisture plus water acquisition,
per-resident social memory and belief provenance, collaboration lifecycle
linkage, and event-driven cognition wakeups. These should extend the same
invariants rather than add `go-to-and-use` or `go-to-and-talk` macros.
