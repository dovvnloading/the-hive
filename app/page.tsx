'use client';

import { useState } from 'react';

import { AgentArenaWorldV2 } from '@/components/agent-arena-world-v2';
import {
  ArenaFieldJournal,
  type FieldJournalView,
} from '@/components/arena-field-journal';
import { useAgentArena } from '@/hooks/use-agent-arena';

export default function Home() {
  const arena = useAgentArena();
  const [journalView, setJournalView] = useState<FieldJournalView>();
  const [focusedEventId, setFocusedEventId] = useState<string>();

  function openJournal(view: FieldJournalView, eventId?: string) {
    if (view !== 'agents') arena.selectAgent(undefined);
    setFocusedEventId(view === 'journal' ? eventId : undefined);
    setJournalView(view);
  }

  function closeJournal() {
    setJournalView(undefined);
    setFocusedEventId(undefined);
    arena.selectAgent(undefined);
  }

  return (
    <main className="arena-app">
      <AgentArenaWorldV2
        state={arena.state}
        journalOpen={journalView !== undefined}
        onOpenJournal={(eventId) => openJournal('journal', eventId)}
        onSelectAgent={(agentId) => {
          if (!agentId) return;
          arena.selectAgent(agentId);
          setJournalView('agents');
        }}
      />

      {journalView && (
        <ArenaFieldJournal
          state={arena.state}
          view={journalView}
          focusedEventId={focusedEventId}
          selectedAgentId={arena.state.selectedAgentId}
          onViewChange={openJournal}
          onSelectAgent={arena.selectAgent}
          onClose={closeJournal}
        />
      )}
    </main>
  );
}
