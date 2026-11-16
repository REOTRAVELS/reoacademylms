import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';

const timeOf = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const nameOf = (message) => `${message.sender?.firstName || 'Participant'} ${message.sender?.lastName || ''}`.trim();

// Consecutive messages from one person within 3 minutes share a header.
const group = (messages) => messages.reduce((groups, message) => {
  const last = groups[groups.length - 1];
  const gap = last ? new Date(message.createdAt) - new Date(last.items[last.items.length - 1].createdAt) : 0;
  if (last && last.senderId === message.senderId && gap < 180_000) last.items.push(message);
  else groups.push({ senderId: message.senderId, items: [message] });
  return groups;
}, []);

export default function ChatPanel({
  messages, userId, connected, onSend, onClose, onError,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const feedRef = useRef(null);
  const inputRef = useRef(null);
  const groups = useMemo(() => group(messages), [messages]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (window.matchMedia('(hover: hover)').matches) inputRef.current?.focus();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft('');
    } catch (error) {
      onError(error.message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <section className="rt-panel-body" aria-label="Meeting chat">
      <header className="rt-panel-head">
        <h2>Meeting chat</h2>
        <button type="button" className="rt-icon-btn" onClick={onClose} aria-label="Close chat"><X size={18} /></button>
      </header>

      <div className="rt-chat-feed" ref={feedRef} role="log" aria-live="polite">
        {groups.length === 0 ? (
          <div className="rt-empty">
            <MessageSquare size={26} strokeWidth={1.6} />
            <p>No messages yet</p>
            <small>Messages are visible to everyone in this class.</small>
          </div>
        ) : groups.map((g) => {
          const mine = g.senderId === userId;
          const first = g.items[0];
          return (
            <div className={`rt-msg-group${mine ? ' is-mine' : ''}`} key={first.id || first.createdAt}>
              <div className="rt-msg-meta">
                <strong>{mine ? 'You' : nameOf(first)}</strong>
                <time dateTime={first.createdAt}>{timeOf(first.createdAt)}</time>
              </div>
              {g.items.map((m) => <p className="rt-bubble" key={m.id || m.createdAt}>{m.payload.text}</p>)}
            </div>
          );
        })}
      </div>

      <form className="rt-chat-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? 'Send a message to everyone' : 'Reconnecting…'}
          maxLength={500}
          aria-label="Message"
          enterKeyHint="send"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim() || sending || !connected} aria-label="Send message">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
