'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ArenaAudioDirector } from '@/lib/arena/arena-audio-director';
import {
  audioPanForPosition,
  freshAudioEvents,
  oneShotPoolForEvent,
} from '@/lib/arena/audio-cues';
import type {
  AgentArenaState,
  RuntimeConnectionStatus,
} from '@/lib/arena/agentic-types';

export type ArenaAudioStatus =
  | 'locked'
  | 'loading'
  | 'on'
  | 'muted'
  | 'unavailable';

const AUDIO_PREFERENCE_KEY = 'hive.audio.enabled';

type LatestProjection = {
  state: AgentArenaState;
  connectionStatus: RuntimeConnectionStatus;
  pageVisible: boolean;
};

export function useArenaAudio(
  state: AgentArenaState,
  connectionStatus: RuntimeConnectionStatus,
  interfaceOpen: boolean,
) {
  const directorRef = useRef<ArenaAudioDirector | undefined>(undefined);
  const directorPromiseRef = useRef<
    Promise<ArenaAudioDirector | undefined> | undefined
  >(undefined);
  const directorReadyRef = useRef(false);
  const inactiveCueTimerRef = useRef<number | undefined>(undefined);
  const inactiveCueUntilRef = useRef(0);
  const enabledRef = useRef(true);
  const statusRef = useRef<ArenaAudioStatus>('locked');
  const watermarkRef = useRef(0);
  const runIdRef = useRef<string | undefined>(undefined);
  const rebaseRef = useRef(true);
  const latestRef = useRef<LatestProjection>({
    state,
    connectionStatus,
    pageVisible: true,
  });
  const [enabled, setEnabled] = useState(true);
  const [status, setStatusState] = useState<ArenaAudioStatus>('locked');
  const [directorVersion, setDirectorVersion] = useState(0);
  const [pageVisible, setPageVisible] = useState(true);

  const setStatus = useCallback((next: ArenaAudioStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const ensureDirector = useCallback(async () => {
    if (!enabledRef.current) return undefined;
    // A director is assigned before decoding so cleanup can always find it.
    // Await that in-flight preparation before exposing the instance to cues.
    if (directorPromiseRef.current) return directorPromiseRef.current;
    if (directorRef.current) {
      await directorRef.current.resume();
      if (!enabledRef.current) {
        await directorRef.current.suspend();
        setStatus('muted');
        return undefined;
      }
      setStatus('on');
      return directorRef.current;
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      setStatus('unavailable');
      return undefined;
    }

    setStatus('loading');
    const director = new ArenaAudioDirector(new AudioContextConstructor());
    directorRef.current = director;
    directorReadyRef.current = false;
    const preparation = (async () => {
      try {
        // resume() is invoked synchronously from the user gesture before asset
        // decoding awaits, satisfying browser autoplay rules.
        await Promise.all([director.resume(), director.load()]);
        directorReadyRef.current = true;
        setDirectorVersion((version) => version + 1);
        if (!enabledRef.current) {
          await director.suspend();
          setStatus('muted');
          return director;
        }
        setStatus('on');
        rebaseRef.current = true;
        return director;
      } catch {
        directorRef.current = undefined;
        directorReadyRef.current = false;
        await director.destroy();
        setStatus('unavailable');
        return undefined;
      } finally {
        directorPromiseRef.current = undefined;
      }
    })();
    directorPromiseRef.current = preparation;
    return preparation;
  }, [setStatus]);

  useEffect(() => {
    const stored = window.localStorage.getItem(AUDIO_PREFERENCE_KEY);
    if (stored !== 'false') return;
    enabledRef.current = false;
    const timer = window.setTimeout(() => {
      setEnabled(false);
      setStatus('muted');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [setStatus]);

  useEffect(() => {
    latestRef.current = { state, connectionStatus, pageVisible };
  }, [connectionStatus, pageVisible, state]);

  useEffect(() => {
    const unlock = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.arena-audio-toggle')
      ) {
        return;
      }
      if (enabledRef.current && statusRef.current === 'locked') {
        void ensureDirector();
      }
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('touchstart', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('touchstart', unlock, { capture: true });
    };
  }, [ensureDirector]);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden);
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const director = directorRef.current;
    if (!director || !directorReadyRef.current) return;
    director.setInterfaceDucked(interfaceOpen);
  }, [directorVersion, interfaceOpen]);

  useEffect(() => {
    const director = directorRef.current;
    if (!director || !directorReadyRef.current) return;
    const operational =
      enabled &&
      pageVisible &&
      connectionStatus === 'connected';

    if (operational && inactiveCueTimerRef.current !== undefined) {
      window.clearTimeout(inactiveCueTimerRef.current);
      inactiveCueTimerRef.current = undefined;
    }

    if (!operational) {
      rebaseRef.current = true;
      if (
        !pageVisible ||
        !enabled ||
        connectionStatus !== 'connected'
      ) {
        const canFinishInactiveCue =
          enabled && pageVisible && connectionStatus === 'connected';
        const delay = canFinishInactiveCue
          ? Math.max(0, inactiveCueUntilRef.current - Date.now())
          : 0;
        if (inactiveCueTimerRef.current !== undefined) {
          window.clearTimeout(inactiveCueTimerRef.current);
        }
        if (delay === 0) {
          director.setOperational(false);
          void director.suspend();
        } else {
          inactiveCueTimerRef.current = window.setTimeout(() => {
            inactiveCueTimerRef.current = undefined;
            const current = latestRef.current;
            if (
              enabledRef.current &&
              current.pageVisible &&
              current.connectionStatus === 'connected'
            ) {
              return;
            }
            director.setOperational(false);
            void director.suspend();
          }, delay);
        }
      }
      return;
    }

    let canceled = false;
    const synchronize = async () => {
      await director.resume();
      if (canceled) return;
      const latest = latestRef.current;
      const latestState = latest.state;
      const runChanged = runIdRef.current !== latestState.runId;
      if (rebaseRef.current || runChanged) {
        // The initial and reconnect snapshots are projection, not fresh sonic
        // history. Resume held work but never replay their old one-shots.
        watermarkRef.current = latestState.lastSequence;
        runIdRef.current = latestState.runId;
        rebaseRef.current = false;
        director.setOperational(true);
        director.syncWorkLoops(latestState.agents);
        setStatus('on');
        return;
      }

      director.setOperational(true);
      const fresh = freshAudioEvents(
        latestState.events,
        watermarkRef.current,
      );
      for (const event of fresh) {
        const pool = oneShotPoolForEvent(event);
        if (!pool) continue;
        const resident = latestState.agents.find(
          (agent) => agent.id === event.agentId,
        );
        director.playOneShot(
          pool,
          audioPanForPosition(resident?.currentPosition),
        );
      }
      watermarkRef.current = Math.max(
        watermarkRef.current,
        latestState.lastSequence,
      );
      director.syncWorkLoops(latestState.agents);
      setStatus('on');
    };

    // Runtime marks the connection live before dispatching the first batch.
    // A zero-delay boundary lets that synchronous batch finish before rebasing.
    const timer = window.setTimeout(() => void synchronize(), 0);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [
    connectionStatus,
    directorVersion,
    enabled,
    pageVisible,
    setStatus,
    state.lastSequence,
    state.runId,
    state.runStatus,
  ]);

  useEffect(
    () => () => {
      if (inactiveCueTimerRef.current !== undefined) {
        window.clearTimeout(inactiveCueTimerRef.current);
      }
      void directorRef.current?.destroy();
      directorRef.current = undefined;
      directorReadyRef.current = false;
    },
    [],
  );

  const toggle = useCallback(() => {
    if (
      enabledRef.current &&
      statusRef.current === 'locked'
    ) {
      void ensureDirector();
      return;
    }
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      inactiveCueUntilRef.current = 0;
      if (inactiveCueTimerRef.current !== undefined) {
        window.clearTimeout(inactiveCueTimerRef.current);
        inactiveCueTimerRef.current = undefined;
      }
      window.localStorage.setItem(AUDIO_PREFERENCE_KEY, 'false');
      directorRef.current?.setOperational(false);
      void directorRef.current?.suspend();
      setStatus('muted');
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    window.localStorage.setItem(AUDIO_PREFERENCE_KEY, 'true');
    rebaseRef.current = true;
    void ensureDirector();
  }, [ensureDirector, setStatus]);

  const playMailboxCue = useCallback(async () => {
    if (!enabledRef.current) return;
    if (inactiveCueTimerRef.current !== undefined) {
      window.clearTimeout(inactiveCueTimerRef.current);
      inactiveCueTimerRef.current = undefined;
    }
    const initial = latestRef.current;
    const initiallyOperational =
      initial.pageVisible &&
      initial.connectionStatus === 'connected';
    inactiveCueUntilRef.current = initiallyOperational
      ? 0
      : Date.now() + 2_500;
    const director = await ensureDirector();
    if (!director) return;
    director.playOneShot('mailbox', 0, true);

    if (initiallyOperational) return;

    const delay = Math.max(0, inactiveCueUntilRef.current - Date.now());
    inactiveCueTimerRef.current = window.setTimeout(() => {
      inactiveCueTimerRef.current = undefined;
      const current = latestRef.current;
      if (
        current.pageVisible &&
        current.connectionStatus === 'connected'
      ) {
        return;
      }
      director.setOperational(false);
      void director.suspend();
    }, delay);
  }, [ensureDirector]);

  return {
    status,
    toggle,
    playMailboxCue,
  };
}
