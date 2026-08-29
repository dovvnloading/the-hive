#!/usr/bin/env node

import {
  chatRequest,
  localChatStatus,
  readHookInput,
  stableIngressId,
  writeHookOutput,
} from './arena-chat-common.mjs';

try {
  const input = await readHookInput();
  const ingressId = stableIngressId(input.session_id, input.turn_id);
  let status;
  try {
    status = await chatRequest(
      `/chat/status?ingress=${encodeURIComponent(ingressId)}`,
    );
  } catch {
    status = localChatStatus(ingressId);
  }

  if (!status || status.terminal || input.stop_hook_active === true) {
    writeHookOutput({ continue: true });
  } else {
    writeHookOutput({
      decision: 'block',
      reason: `Hive ingress ${ingressId} is still ${status.state}. Complete the real relay work or explicitly mark it failed before ending this turn.`,
    });
  }
} catch {
  writeHookOutput({ continue: true });
}
