'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { agentArenaReducer, createAgentArenaState } from '@/lib/arena/agentic-reducer';
import { MockAgentRuntime } from '@/lib/arena/mock-agent-runtime';
import type {
  ArenaRuntime,
  CommandReceipt,
  OperatorIntent,
} from '@/lib/arena/agentic-types';

export const DEFAULT_AGENT_OBJECTIVE =
  'Build the first autonomous arena: a spatial projection of subagents planning, delegating, using tools, handing off work, and completing one shared objective.';

/**
 * Adapts an agent runtime event stream into the arena's local visual projection.
 * Runtime events own semantic state; the animation frame only advances avatars
 * along routes chosen by the projection reducer.
 */
export function useAgentArena() {
  const [state, dispatch] = useReducer(agentArenaReducer, undefined, createAgentArenaState);
  const [runtime] = useState<ArenaRuntime>(() => new MockAgentRuntime());

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      dispatch({ type: 'runtime.event', event });
    });

    runtime.start(DEFAULT_AGENT_OBJECTIVE);

    let frameId = 0;
    let previousTime = performance.now();

    const advanceProjection = (time: number) => {
      // A backgrounded tab can resume with a very large delta. Clamping keeps
      // that browser concern from teleporting avatars through the projection.
      const deltaMs = Math.min(Math.max(time - previousTime, 0), 120);
      previousTime = time;
      if (deltaMs > 0) dispatch({ type: 'projection.tick', deltaMs });
      frameId = window.requestAnimationFrame(advanceProjection);
    };

    frameId = window.requestAnimationFrame(advanceProjection);

    return () => {
      window.cancelAnimationFrame(frameId);
      unsubscribe();
      runtime.destroy();
    };
  }, [runtime]);

  const command = useCallback(
    (intent: OperatorIntent): Promise<CommandReceipt> => runtime.command(intent),
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
