'use client';

import { useEffect, useRef, useState } from 'react';

type WorkshopSnapshot = {
  schemaVersion: 1;
  revision: number;
  projects: {
    id: string;
    title: string;
    stage: string;
    archived?: boolean;
  }[];
};

// The world only needs a read-only projection to draw objects on the bench.
export function useSandbox() {
  const [snapshot, setSnapshot] = useState<WorkshopSnapshot>();
  const snapshotRef = useRef<WorkshopSnapshot | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;

    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('http://127.0.0.1:8787/sandbox', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Workshop state unavailable');
        const value: WorkshopSnapshot = await response.json();
        if (
          value.schemaVersion !== 1 ||
          !Number.isSafeInteger(value.revision) ||
          !Array.isArray(value.projects) ||
          !value.projects.every(
            (project) =>
              project &&
              typeof project.id === 'string' &&
              typeof project.title === 'string' &&
              typeof project.stage === 'string',
          )
        )
          throw new Error('Invalid workshop state');
        if (
          !stopped &&
          (!snapshotRef.current ||
            value.revision > snapshotRef.current.revision)
        ) {
          snapshotRef.current = value;
          setSnapshot(value);
        }
      } catch {
        // Keep the last verified object state while the bridge reconnects.
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 1500);
      }
    }

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  return { snapshot };
}
