# Operator mailbox browser smoke

- Date/time: 2026-09-03 12:58–13:01 EDT
- Revision: `ceecbe1` (`codex/hive-environment-v2`, mailbox changes in the working tree)
- Environment: `http://localhost:3000/?assetrev=20260903-1&render=2x`, local bridge
- Objective: Verify the operator mailbox fixture, compose dialog, and draft-file round trip in the live simulation.
- Participants: Operator only; no facility residents were active and no facility run was created.

## Runs

| Run ID              | Outcome | Reason                                                                                         |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| N/A (browser smoke) | passed  | The fixture, dialog, draft save, draft clear, and unobstructed final view behaved as expected. |

## Exercised

- Started the web app and bridge from `C:\Users\Admin\source\repos\Swarm`.
- Parked the Codex in-app-browser cursor outside the simulation viewport.
- Opened the wall-mounted mailbox in Context / Commons from the live room view.
- Entered temporary draft text and observed the `Draft saved` state.
- Cleared the draft and closed the compose dialog.

## Observations

- Authoritative: `.arena/operator-mailbox.md` was verified at zero bytes after the temporary draft was cleared. No facility events or message intents were created during this smoke test.
- Visual: the mailbox was visible on the Commons wall without overlapping the doorway, light switch, kiosk, or walking space. The compose dialog matched the facility styling, exposed recipient and message controls, showed the local draft path, and fit the viewport without clipping. The final simulation view was left open with the cursor outside the viewport.
- Automated coverage already completed for this working tree: bridge 26/26, evaluator 40/40, spatial 33/33, TypeScript, lint, and production build passed.

## Result

The live fixture, operator compose surface, and local draft persistence passed visual and functional smoke coverage. End-to-end resident pickup was not exercised in this browser session because no residents were active; authenticated physical pickup, privacy, replay, completion blocking, and closed-run rejection were covered by the bridge integration suite.

## Follow-up

- Exercise one real operator-to-resident delivery during the next staffed facility run and record its run, intent, interaction, and terminal outcome IDs.
