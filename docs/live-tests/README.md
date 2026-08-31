# Live facility test records

Every runtime or live facility test gets a small tracked Markdown report in this
directory. The record is evidence, not a narrative: keep it concise, factual,
and useful to the next person investigating the system.

Name reports `YYYY-MM-DD-short-purpose.md`. A single report may cover multiple
attempts when each run ID and outcome is clear.

## Minimum report

```markdown
# <test title>

- Date/time: <local time and timezone>
- Revision: <git commit>
- Environment: <local URL and relevant mode; no credentials>
- Objective: <what the test was meant to establish>
- Participants: <real process/task -> facility identity -> role>

## Runs

| Run ID | Outcome | Reason |
| --- | --- | --- |
| `<run-id>` | passed / failed / canceled / inconclusive | <factual summary> |

## Exercised

- <behavior, interaction, utility, or contention actually exercised>

## Observations

- Authoritative: <event, artifact, message, receipt, evaluator, or test IDs>
- Visual: <what was actually visible in the live browser>

## Result

<What passed or failed, without interpretation beyond the evidence.>

## Follow-up

- <required correction, coverage gap, or `None`>
```

Never include resident credentials, authentication tokens, private-journal
text, hidden prompts, or reasoning traces.
