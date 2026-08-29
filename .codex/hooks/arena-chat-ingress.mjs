#!/usr/bin/env node

import {
  captureIngress,
  chatRequest,
  readHookInput,
  writeHookOutput,
} from './arena-chat-common.mjs';

function contextFor(ingressId, delivery) {
  return [
    `HIVE ACCESS LOOP — ingress ${ingressId} is ${delivery}.`,
    `Before substantive work, claim it: node scripts/arena-driver.mjs chat-relay --ingress ${ingressId} --state claimed --summary "Root accepted this Codex chat turn".`,
    'If the request is delegated, use real collaboration subagents, register/assign those actual agents with this ingress as --correlation, then mark dispatched only after the collaboration call succeeds and include their arena IDs in --targets.',
    `Use the authenticated arena board for agent communication with --correlation ${ingressId}. Do not manufacture agent activity or receipt.`,
    `Before the final response, terminalize this ingress with chat-relay state completed or failed and a factual summary. For a conversational/no-delegation turn, claim then complete it with no targets.`,
  ].join(' ');
}

try {
  const input = await readHookInput();
  const record = captureIngress(input);
  let delivery =
    'durably captured in the local outbox; bridge replay is pending';
  try {
    const result = await chatRequest('/chat/ingress', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    delivery = result.created
      ? 'journaled by the arena bridge'
      : 'already journaled by the arena bridge';
  } catch {
    // The append-only outbox is authoritative until the bridge imports it.
  }
  writeHookOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: contextFor(record.ingressId, delivery),
    },
  });
} catch {
  writeHookOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        'HIVE ACCESS LOOP WARNING — this Codex chat turn could not be captured. Do not claim that it entered the arena; report the hook failure explicitly.',
    },
  });
}
