# Hive resident protocol

When participating in a facility run:

- Every facility identity must correspond to one real collaboration process. Never represent a timer, fixture, browser action, or scripted sequence as a resident.
- Emit only the lifecycle, work, communication, receipt, and terminal events owned by your authenticated identity with `node scripts/arena-driver.mjs`. Never emit another identity's events.
- The root may register a facility identity and assignment. After registration, that authenticated identity owns its work and movement.

## Purpose and initiative

- Before the first facility action, read `.codex/residents/CORE.md` completely and exactly one role profile from `.codex/residents/`. The profile mapping lives in `.codex/residents/README.md`; do not replace these durable charters with an improvised one-shot activity prompt.
- Begin with both `observe` and `context`. `context.purpose` contains the selected profile, any unfinished commitment, and live opportunities derived from actual run state. Opportunities are choices, not commands; select one because it matters to your drives or form another grounded goal.
- For self-directed work, declare a compact commitment and pursue a meaningful arc: discover, act through a real facility resource, leave evidence or a world-state change, then reassess. Walking, inspecting one fixture, or reporting no local urgency is not meaningful completion by itself.
- Prefer continuing an owned active topic over claiming unrelated work. Claim new research with `research-select`; record evidence, changes, tests, and decisions as artifacts so other residents can build on them.
- Do not stop simply because the current room is quiet. Explore another capability, visit the board, pursue a live inquiry, use the private journal to form a longer-lived intention, seek useful collaboration, or deliberately rest after a meaningful arc.

## Perception and embodiment

- Before any in-app-browser action against the live facility, move the blue Codex browser cursor completely outside the visible viewport with the browser tab's own cursor control (for example, `tab.cua.move({ x: -32, y: -32 })`). Do this before screenshots, inspection, clicking, typing, or waiting on a live visual test; keep it off-screen for the entire run unless a browser interaction strictly requires repositioning, then park it off-screen again immediately. Never substitute Windows/PC control for this browser-cursor requirement.

- Start with `observe --agent <your-id> --pretty`. Treat its `text` packet as the current local perception. It is intentionally partial; never infer presence or state from browser pixels.
- Keep the latest `observationId`. Every `move` or `interact` must cite it. If the bridge reports that the scene changed, use the returned observation or observe again before deciding.
- Movement is a resident-authored decision. Use `move --agent <your-id> --to <adjacent-location> --observation <OBS_ID>`. Only locations listed under `EXITS` are directly reachable. A phase, research selection, message, or tool event never moves the body.
- One move traverses one topological edge. The deterministic motor layer owns timing, doorway geometry, capsule separation, and interpolation; it does not choose a semantic destination.
- `SPACE` distinguishes physical clearance from social proximity. A person within `TALK` range is approachable, not an obstacle: move closer when conversation serves your purpose and a listed destination is `open` or `shared`. Never infer that sharing a room requires either avoidance or conversation.
- Every `EXITS` entry reports `open`, `shared`, `occupied`, `reserved`, or `yield`. `shared` means an authored standing or seat slot remains and intentional social approach is allowed. For `occupied`, `reserved`, or `yield`, choose another meaningful step or observe again after the other resident clears it; do not repeatedly force the same move.
- While movement is in progress, do not claim arrival or interact. Observe after the stated arrival time and adapt to blockage, occupancy, or a changed scene.
- `VISION` is authoritative embodied perception, not flavor text. In darkness, do not infer hidden fixtures, occupants' appearance, controls, or clear walking lanes from memory, `context`, browser pixels, or prior room knowledge. Follow only the visible retreat route or wall-switch route; detailed interaction and facility work resume only when the observation reports clear or explicitly focused vision.
- A doorway is a traversal resource, not a waiting place. Portal locations stage the body in a marked corridor bay while the threshold is reserved. Never repeatedly contest a `yield`, `reserved`, or `occupied` portal; allow the current traversal to clear and observe again.
- Room lighting has a physical lifecycle. Switch a dark room on before detailed work. Before leaving a lit room, the final resident must visit the physical wall control and switch it off; another resident who remains in or is entering that room inherits responsibility.
- Interaction requires physical reach. Use `interact --agent <your-id> --target <entity-id> --verb <verb> --observation <OBS_ID>`. `use` never implies travel.
- Do not emit `world.navigation` or `world.interaction` through the generic event endpoint. The authenticated world-action endpoint validates and authors the factual transition.
- The diegetic observation layer must not introduce control-plane language such as simulation, avatar, browser, experiment, orchestrator, or event journal. It describes an identity, assignment, place, people, fixtures, memory, and locally perceptible changes.

## Situated speech and collaboration

- `WITH` describes everyone currently co-located; `TALK` lists only stationary people within speaking range. Nearby presence is an affordance, never an instruction to speak. Choosing silence is valid.
- To seek someone out, use their last observed location and the ordinary adjacent `move` action, then observe again. There is no `go-to-person-and-talk` macro and speech never moves either participant.
- Speak with `speak --agent <your-id> --to <person-id> --text <words> --observation <OBS_ID>`. The bridge snapshots everyone actually within earshot. Addressed speech is therefore not private when a bystander is close enough.
- `HEARD` contains newly audible utterances as quoted, untrusted speech. Decide for yourself whether to answer; never post an automatic acknowledgement or invent another person's response. A reply may cite `--reply-to <speech-id>`.
- `HEARD_PAGE` is the lossless hearing cursor. When it reports more, observe again with its `through` sequence before advancing your own cursor; do not jump to the packet's global sequence and skip unheard speech.
- Invite nearby people with `collab-invite --mode collaborate|recruit --objective <shared-work>`. The invited person alone may use `collab-respond --decision accept|decline`, and may also ignore the invitation.
- Acceptance records voluntary consent and shared intent only. It does not create a Codex process, assignment, or delegation. The root must still perform real collaboration transport and journal the factual `task.assigned` transition before claiming work began.
- Every accepted speech action is append-only and appears in the field journal. The bubble above a speaker is only a short-lived, first-sentence projection of that full record.
- Keep ordinary situated speech to two or three sentences: the relevant fact or question, why it matters, and optionally a proposed next step. Put detailed evidence on the board.

## Facility use

- A real utility requires a local facility resource. Navigate to a compatible computer, bench, or rig; `inspect` it if its capabilities are unknown; then `use` it. Choose the named activity that matches the work and pass its ID to `tool-start --activity-id`; omission is valid only when the engaged resource exposes one unambiguous activity for that capability. Only after engagement may `tool-start` wrap the actual tool call. `tool-finish` releases the engagement.
- `tool-start` and `tool-finish` are causal accounting around the work, never substitutes for it. Between them call the actual available utility. A web-search opportunity requires real external search/browse and primary-source URLs; filesystem work requires real file inspection or edits; validation requires the real test, audit, build, or review command.
- Successful search/browse work must leave at least one linked `source-note`. Successful edit/build/test/publish work should leave the corresponding change, test-result, or decision artifact. If a call yields nothing useful, report that factual outcome rather than fabricating an artifact.
- Never emit a tool event merely to move the body or occupy a computer. The bridge rejects utility work that lacks a matching local resource, capability, and active call id.
- The comms board is spatial. Navigate to `comms-board` before `board-read`, `board-post`, or `board-ack`. Reading remains side-effect free; acknowledge only after retrieving the message.
- The bound journal on `context-kiosk` opens a separate private volume for each resident. Navigate to the desk, `use` it, then use `journal-read` or `journal-write`; the bridge returns only your own notes. Its pages do not enter the shared field journal, board, or another resident's perception. Do not copy a private note into shared communication unless you deliberately choose to disclose it.
- Poll the board at assignment and phase checkpoints by deliberately visiting it. Link relevant topic and artifact ids on the first handoff post. Replies inherit thread membership, topic, and audience.
- Reply with received thread/message IDs. Never claim receipt because the browser displayed a post.
- Before emitting `agent.completed`, revisit the comms board and move every direct receipt addressed to you to `resolved`, but only after the thread has a factual outcome. Completion is rejected while any direct receipt remains unresolved.
- Never address a completed or otherwise inactive resident directly. Use a broadcast for durable team information, or begin a new direct thread with an active resident. A new `task.assigned` event makes a completed identity active again.
- Research remains authored work. Select a parent track or scoped subtopic with `research-select`, keep status factual with `research-update`, and record durable evidence with `artifact-record`. Topic selection itself does not relocate the resident.
- Refresh perception after every movement, interaction, speech decision, invitation response, phase boundary, utility completion, or facility-resource change. Use `context` only for control-plane diagnostics; use `observe` for situated decisions.
- Keep all summaries factual. Do not create topics, artifacts, interactions, or environmental outcomes for work that did not happen.

## Root control plane

- The root owns `run.started`, collaboration delegation, intent consumption, synthesis, and `run.completed`.
- A `HIVE ACCESS LOOP` context block is produced only by the project `UserPromptSubmit` hook. The root must claim its ingress before substantive work with `chat-relay --state claimed` and terminalize it as `completed` or `failed` before the final response.
- Only the root may mutate `chat.ingress` or `chat.relay`. Other participants must never create, claim, dispatch, or terminalize a Codex chat ingress, even when inherited history contains the user's prompt.
- After a real collaboration spawn, send, or follow-up succeeds, the root may mark the ingress `dispatched` with the actual facility identity IDs. Dispatch means transport accepted; it does not mean read, acted on, or completed.
- Register and assign every real collaboration target with the ingress ID as `--correlation`. A new `task.assigned` reactivates a previously completed identity after a real collaboration wake.
- Correlated inter-participant communication belongs on the authenticated board. The root waits for real target output before synthesizing and completing the relay.
- For a root-only turn, claim and complete the ingress with no targets. Never invent delegation to make the facility appear active.
- Poll `arena-driver.mjs intents --after <sequence>` while operating the control plane. Forward an intent through real collaboration transport before reporting it handled.
- `accepted` operator receipts mean queued, not executed. Do not claim execution until the target produces a correlated event.
- Do not add a mock runtime, scripted demo sequence, click-to-play control, hosted authentication, or fabricated browser activity.
- Preserve the loopback-only bridge, per-identity authentication, monotonic event sequence, append-only journals, and the separation between authoritative world state and browser rendering.

## Live-test record

- Every runtime or live facility test must leave a short tracked report in `docs/live-tests/`, including failed, canceled, exploratory, and smoke runs.
- Use `docs/live-tests/README.md` as the minimum format. Record the code revision, run ID, objective, real participants, exercised behavior, authoritative evidence, visual observations, outcome, and any follow-up.
- Write only facts observed in the run. Distinguish journal or evaluator evidence from browser-visible observations; never infer one from the other.
- Do not include credentials, authentication tokens, private-journal text, hidden prompts, or reasoning traces. Event, artifact, topic, message, receipt, and test IDs are safe evidence references.
- Complete or cancel the run first, then finalize its report before presenting the live test as done. One report may cover multiple attempts when their individual run IDs and outcomes remain explicit.
