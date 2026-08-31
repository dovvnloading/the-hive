'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import {
  agentArenaReducer,
  createAgentArenaState,
} from '@/lib/arena/agentic-reducer';
import { CodexAgentRuntime } from '@/lib/arena/codex-agent-runtime';
import type {
  ArenaRuntime,
  CommandReceipt,
  OperatorIntent,
  RuntimeConnectionStatus,
} from '@/lib/arena/agentic-types';

export const DEFAULT_AGENT_OBJECTIVE =
  'Waiting for real Codex subagent events from the local bridge.';

/**
 * Adapts an agent runtime event stream into the arena's local visual projection.
 * Runtime events own semantic state; the animation frame only samples
 * bridge-authored routes at an absolute wall-clock time.
 */
export function useAgentArena() {
  const [state, dispatch] = useReducer(
    agentArenaReducer,
    undefined,
    createAgentArenaState,
  );
  const [runtime] = useState<ArenaRuntime>(() => new CodexAgentRuntime());
  const [connectionStatus, setConnectionStatus] =
    useState<RuntimeConnectionStatus>('connecting');

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      dispatch({ type: 'runtime.event', event });
    });
    const unsubscribeConnection =
      runtime.subscribeConnection(setConnectionStatus);

    runtime.start(DEFAULT_AGENT_OBJECTIVE);

    let frameId = 0;

    const advanceProjection = (time: number) => {
      // Runtime navigation timestamps are epoch-based. requestAnimationFrame's
      // timestamp is monotonic relative to timeOrigin, so this remains absolute
      // across dropped/background frames without accumulating delta-time drift.
      dispatch({ type: 'projection.tick', now: performance.timeOrigin + time });
      frameId = window.requestAnimationFrame(advanceProjection);
    };

    frameId = window.requestAnimationFrame(advanceProjection);

    return () => {
      window.cancelAnimationFrame(frameId);
      unsubscribe();
      unsubscribeConnection();
      runtime.destroy();
    };
  }, [runtime]);

  const command = useCallback(
    (intent: OperatorIntent): Promise<CommandReceipt> =>
      runtime.command(intent),
    [runtime],
  );

  const submitObjective = useCallback(
    (objective: string) => command({ type: 'SubmitObjective', objective }),
    [command],
  );

  const replyToPrompt = useCallback(
    (promptId: string, content: string) =>
      command({ type: 'ReplyToPrompt', promptId, content }),
    [command],
  );

  const approvePrompt = useCallback(
    (promptId: string, approved = true) =>
      command({ type: 'ApprovePrompt', promptId, approved }),
    [command],
  );

  const sendFollowUp = useCallback(
    (agentId: string, content: string) =>
      command({ type: 'SendFollowUp', agentId, content }),
    [command],
  );

  const interruptAgent = useCallback(
    (agentId: string) => command({ type: 'InterruptAgent', agentId }),
    [command],
  );

  const cancelRun = useCallback(
    (reason?: string) => command({ type: 'CancelRun', reason }),
    [command],
  );

  const retryRun = useCallback(() => command({ type: 'RetryRun' }), [command]);

  const selectAgent = useCallback(
    (agentId?: string) => dispatch({ type: 'selection.changed', agentId }),
    [],
  );

  const followAgent = useCallback(
    (agentId?: string) => dispatch({ type: 'follow.changed', agentId }),
    [],
  );

  const selectedAgent = useMemo(
    () => state.agents.find((agent) => agent.id === state.selectedAgentId),
    [state.agents, state.selectedAgentId],
  );

  const followedAgent = useMemo(
    () => state.agents.find((agent) => agent.id === state.followedAgentId),
    [state.agents, state.followedAgentId],
  );

  const activePrompt = useMemo(
    () => state.agents.find((agent) => agent.blocker)?.blocker,
    [state.agents],
  );

  return {
    state,
    connectionStatus,
    selectedAgent,
    followedAgent,
    activePrompt,
    selectAgent,
    followAgent,
    submitObjective,
    replyToPrompt,
    approvePrompt,
    sendFollowUp,
    interruptAgent,
    cancelRun,
    retryRun,
  };
}
