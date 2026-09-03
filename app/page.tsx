'use client';

import { useState } from 'react';

import { AgentArenaWorldV2 } from '@/components/agent-arena-world-v2';
import {
  ArenaFieldJournal,
  type FieldJournalView,
} from '@/components/arena-field-journal';
import { OperatorMailbox } from '@/components/operator-mailbox';
import { useAgentArena } from '@/hooks/use-agent-arena';

export default function Home() {
  const arena = useAgentArena();
  const [journalView, setJournalView] = useState<FieldJournalView>();
  const [focusedEventId, setFocusedEventId] = useState<string>();
  const [mailboxOpen, setMailboxOpen] = useState(false);

  function openJournal(view: FieldJournalView, eventId?: string) {
    setMailboxOpen(false);
    if (view !== 'agents') arena.selectAgent(undefined);
    setFocusedEventId(view === 'journal' ? eventId : undefined);
    setJournalView(view);
  }

  function openMailbox() {
    closeJournal();
    setMailboxOpen(true);
  }

  function closeMailbox() {
    setMailboxOpen(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>('.operator-mailbox-hotspot')
        ?.focus();
    });
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
        mailboxOpen={mailboxOpen}
        mailboxHasUnread={arena.mailboxUnreadDeliveryCount > 0}
        onOpenJournal={(eventId) => openJournal('journal', eventId)}
        onOpenMailbox={openMailbox}
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

      {mailboxOpen && (
        <OperatorMailbox
          agents={arena.state.agents}
          connectionStatus={arena.connectionStatus}
          onReadDraft={arena.readMailboxDraft}
          onWriteDraft={arena.writeMailboxDraft}
          onSend={arena.sendMailboxMessage}
          onClose={closeMailbox}
        />
      )}
    </main>
  );
}
