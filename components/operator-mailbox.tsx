'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import type {
  CommandReceipt,
  OperatorMailboxDraft,
  RuntimeAgent,
  RuntimeConnectionStatus,
} from '@/lib/arena/agentic-types';

const MAX_MESSAGE_LENGTH = 2_000;
const TERMINAL_AGENT_STATES = new Set(['completed', 'failed', 'canceled']);

type OperatorMailboxProps = {
  agents: RuntimeAgent[];
  connectionStatus: RuntimeConnectionStatus;
  onReadDraft: () => Promise<OperatorMailboxDraft>;
  onWriteDraft: (content: string) => Promise<OperatorMailboxDraft>;
  onSend: (
    recipientAgentIds: string[],
    content: string,
  ) => Promise<CommandReceipt>;
  onClose: () => void;
};

export function OperatorMailbox({
  agents,
  connectionStatus,
  onReadDraft,
  onWriteDraft,
  onSend,
  onClose,
}: OperatorMailboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const loadedRef = useRef(false);
  const editVersionRef = useRef(0);
  const draftWriteTailRef = useRef<Promise<void>>(Promise.resolve());
  const [content, setContent] = useState('');
  const [recipient, setRecipient] = useState('all');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftStatus, setDraftStatus] = useState('Opening draft…');
  const [sendStatus, setSendStatus] = useState('');
  const [sending, setSending] = useState(false);

  const activeAgents = useMemo(
    () =>
      agents
        .filter((agent) => !TERMINAL_AGENT_STATES.has(agent.status))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  );

  const queueDraftWrite = useCallback(
    (nextContent: string) => {
      const write = draftWriteTailRef.current.then(() =>
        onWriteDraft(nextContent),
      );
      draftWriteTailRef.current = write.then(
        () => undefined,
        () => undefined,
      );
      return write;
    },
    [onWriteDraft],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    textareaRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    void onReadDraft()
      .then((draft) => {
        if (canceled) return;
        setContent(draft.content);
        loadedRef.current = true;
        setDraftLoaded(true);
        setDraftStatus('Draft ready');
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      })
      .catch(() => {
        if (canceled) return;
        setDraftLoaded(true);
        setDraftStatus('Draft could not be opened');
      });
    return () => {
      canceled = true;
    };
  }, [onReadDraft]);

  const recipientIsAvailable =
    recipient === 'all' || activeAgents.some((agent) => agent.id === recipient)
      ? true
      : false;
  const selectedRecipient = recipientIsAvailable ? recipient : '';

  useEffect(() => {
    if (!draftLoaded || !loadedRef.current || sending) return;
    const version = editVersionRef.current;
    const timer = window.setTimeout(() => {
      setDraftStatus('Saving draft…');
      void queueDraftWrite(content)
        .then(() => {
          if (editVersionRef.current === version) {
            setDraftStatus('Draft saved');
          }
        })
        .catch(() => {
          if (editVersionRef.current === version) {
            setDraftStatus('Draft could not be saved');
          }
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [content, draftLoaded, queueDraftWrite, sending]);

  async function saveDraft() {
    loadedRef.current = true;
    const version = editVersionRef.current;
    setDraftStatus('Saving draft…');
    try {
      await queueDraftWrite(content);
      if (editVersionRef.current === version) setDraftStatus('Draft saved');
    } catch {
      if (editVersionRef.current === version) {
        setDraftStatus('Draft could not be saved');
      }
    }
  }

  function closeMailbox() {
    if (sending) return;
    if (loadedRef.current) void queueDraftWrite(content).catch(() => undefined);
    onClose();
  }

  async function sendMessage(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = content.trim();
    const recipientAgentIds = !recipientIsAvailable
      ? []
      : selectedRecipient === 'all'
        ? activeAgents.map((agent) => agent.id)
        : [selectedRecipient];
    if (
      sending ||
      !draftLoaded ||
      !message ||
      message.length > MAX_MESSAGE_LENGTH ||
      recipientAgentIds.length === 0
    ) {
      return;
    }

    setSending(true);
    setSendStatus('Queueing dispatch…');
    void queueDraftWrite(message).catch(() => {
      setDraftStatus('Draft could not be saved');
    });
    try {
      const receipt = await onSend(recipientAgentIds, message);
      if (!receipt.accepted) {
        setSendStatus(receipt.reason ?? 'The dispatch was not queued');
        return;
      }
      editVersionRef.current += 1;
      setContent('');
      setSendStatus(
        `Queued for ${recipientAgentIds.length} resident${recipientAgentIds.length === 1 ? '' : 's'}. They still need to collect it.`,
      );
      setDraftStatus('Clearing draft…');
      try {
        await queueDraftWrite('');
        setDraftStatus('Draft cleared');
      } catch {
        setDraftStatus('Dispatch queued; draft could not be cleared');
      }
    } catch (error) {
      setSendStatus(
        error instanceof Error ? error.message : 'The dispatch was not queued',
      );
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const tooLong = content.length > MAX_MESSAGE_LENGTH;
  const hasRecipients = activeAgents.length > 0;
  const sendDisabled =
    sending ||
    !draftLoaded ||
    connectionStatus !== 'connected' ||
    !hasRecipients ||
    !recipientIsAvailable ||
    !content.trim() ||
    tooLong;

  return (
    <dialog
      ref={dialogRef}
      className="operator-mailbox"
      aria-labelledby="operator-mailbox-title"
      onCancel={(event) => {
        event.preventDefault();
        closeMailbox();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outside) closeMailbox();
      }}
    >
      <header>
        <div>
          <p>Commons dispatch box</p>
          <h2 id="operator-mailbox-title">Operator dispatch</h2>
        </div>
        <button
          type="button"
          className="operator-mailbox-close"
          aria-label="Close operator dispatch"
          onClick={closeMailbox}
          disabled={sending}
        >
          ×
        </button>
      </header>

      <form onSubmit={sendMessage}>
        <label htmlFor="operator-mailbox-recipient">To</label>
        <select
          id="operator-mailbox-recipient"
          value={selectedRecipient}
          disabled={!hasRecipients || !draftLoaded || sending}
          onChange={(event) => {
            setRecipient(event.target.value);
            setSendStatus('');
          }}
        >
          {!recipientIsAvailable && (
            <option value="" disabled>
              Selected resident is no longer active
            </option>
          )}
          <option value="all">All active residents</option>
          {activeAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} — {agent.role}
            </option>
          ))}
        </select>

        <div className="operator-mailbox-message-label">
          <label htmlFor="operator-mailbox-message">Message</label>
          <span className={tooLong ? 'over-limit' : undefined}>
            {content.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          id="operator-mailbox-message"
          value={content}
          rows={7}
          maxLength={MAX_MESSAGE_LENGTH + 1}
          placeholder="Write a note for the residents…"
          disabled={!draftLoaded || sending}
          onChange={(event) => {
            loadedRef.current = true;
            editVersionRef.current += 1;
            setContent(event.target.value);
            setSendStatus('');
          }}
          onKeyDown={handleComposerKeyDown}
        />

        <div className="operator-mailbox-meta" aria-live="polite">
          <span>{draftStatus}</span>
          <span>
            {recipientIsAvailable
              ? sendStatus
              : 'Choose another active resident.'}
          </span>
        </div>

        <footer>
          <small>Draft document: .arena/operator-mailbox.md</small>
          <div>
            <button
              type="button"
              disabled={!draftLoaded || sending}
              onClick={() => void saveDraft()}
            >
              Save draft
            </button>
            <button type="submit" disabled={sendDisabled}>
              {sending ? 'Queueing…' : 'Send dispatch'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
