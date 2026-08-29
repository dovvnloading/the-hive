# Hive agent protocol

When a Codex agent participates in an arena run:

- Use real collaboration subagents. Never represent a timer, fixture, or browser action as an agent.
- Emit only your own lifecycle and tool events with `node scripts/arena-driver.mjs`; never emit another agent's events.
- Keep event summaries factual and aligned with work that actually happened.
- The orchestrator owns `run.started`, delegation, intent consumption, synthesis, and `run.completed`.
- Poll `arena-driver.mjs intents --after <sequence>` while operating the control plane. Forward an intent through collaboration tools before reporting it as handled.
- `accepted` operator receipts mean queued, not executed. Do not claim execution until the target agent produces a correlated event.
- Do not add a mock runtime, scripted demo sequence, click-to-play agent control, hosted authentication, or fabricated browser activity.
- Preserve the loopback-only bridge, emitter authentication, monotonic event sequence, and append-only journals.
