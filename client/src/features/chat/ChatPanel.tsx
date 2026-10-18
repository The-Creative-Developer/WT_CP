import { MAX_MESSAGE_LENGTH, type ChatMessage } from '@devverse/shared';
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { markdownToText, renderMarkdown } from '../../lib/markdown';
import type { useChat } from './useChat';

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface ChatPanelProps {
  chat: ReturnType<typeof useChat>;
  myId: string | undefined;
}

export function ChatPanel({ chat, myId }: ChatPanelProps) {
  const { messages, status, hasOlder, loadingOlder, loadOlder, typing, lastIncoming } = chat;
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Follow new messages only if the reader is already at the bottom (or the message is theirs).
  const atBottom = useRef(true);
  const previous = useRef({ firstId: '', lastId: '', height: 0 });

  // [CONCEPT: IntersectionObserver] Loads older messages when the top of the list scrolls into view, without a
  // scroll listener doing layout work on every frame.
  useEffect(() => {
    const scroller = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!scroller || !sentinel || !hasOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !loadingOlder) void loadOlder();
      },
      { root: scroller, rootMargin: '200px 0px 0px 0px' }, // start a little before the very top
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadingOlder, loadOlder]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id ?? '';
    const last = messages.at(-1);
    const lastId = last?.id ?? '';
    const before = previous.current;
    if (firstId !== before.firstId && lastId === before.lastId && before.height) {
      // [CONCEPT: Scroll Anchoring] Older messages were added above: keep what the reader was looking at in place.
      el.scrollTop += el.scrollHeight - before.height;
    } else if (lastId !== before.lastId && (atBottom.current || last?.author.id === myId)) {
      el.scrollTop = el.scrollHeight;
    }
    previous.current = { firstId, lastId, height: el.scrollHeight };
  }, [messages, myId]);

  // Read as plain text, the way it looks: "MDN", not "[MDN](https://…)".
  const announcement = useMemo(
    () =>
      lastIncoming
        ? `@${lastIncoming.author.username}: ${markdownToText(lastIncoming.body).slice(0, 200)}`
        : '',
    [lastIncoming],
  );

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <h2 id={titleId} className="border-b border-border px-4 py-2 font-semibold">
        Chat
      </h2>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        // Scroll anchoring is done by hand above; the browser's own would apply it twice in some browsers.
        className="h-72 overflow-y-auto px-4 py-2 [overflow-anchor:none]"
      >
        <div ref={sentinelRef} />
        {loadingOlder && (
          <p className="py-1 text-center text-xs text-muted">Loading older messages…</p>
        )}
        {status === 'success' && !hasOlder && messages.length > 0 && (
          <p className="py-1 text-center text-xs text-muted">This is the start of the chat.</p>
        )}
        {status === 'pending' && (
          <p className="py-4 text-center text-sm text-muted">Loading chat…</p>
        )}
        {status === 'error' && (
          <p className="py-4 text-center text-sm text-danger">
            The chat history couldn't be loaded.
          </p>
        )}
        {status === 'success' && messages.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">No messages yet. Say hello!</p>
        )}
        <ol className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} mine={m.author.id === myId} />
          ))}
        </ol>
      </div>

      {/* Not a live region: "typing…" changes too often to be worth announcing. */}
      <p className="min-h-5 px-4 text-xs text-muted">{typingText(typing)}</p>
      {/* [CONCEPT: Live Regions] Announces new messages from others, but not history as it loads. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <Composer chat={chat} />
    </section>
  );
}

const MessageItem = memo(function MessageItem({
  message,
  mine,
}: {
  message: ChatMessage;
  mine: boolean;
}) {
  // Sanitised by DOMPurify inside renderMarkdown (see lib/markdown.ts), so setting it as HTML is safe.
  const html = useMemo(() => renderMarkdown(message.body), [message.body]);
  const sent = new Date(message.createdAt);
  return (
    <li className="text-sm">
      <p className="flex items-baseline gap-2">
        <span className={`font-semibold ${mine ? 'text-accent' : ''}`}>
          @{message.author.username}
        </span>
        <time
          dateTime={message.createdAt}
          title={fullDate.format(sent)}
          className="text-xs text-muted"
        >
          {time.format(sent)}
        </time>
      </p>
      <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: html }} />
    </li>
  );
});

function Composer({ chat }: { chat: ReturnType<typeof useChat> }) {
  const { send, signalTyping, connected } = chat;
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const tooLong = body.length > MAX_MESSAGE_LENGTH;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text || tooLong || sending) return;
    setSending(true);
    setError(null);
    try {
      await send(text);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the message.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a line. Composing text in an input method (e.g. Japanese) also uses Enter.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-1 border-t border-border p-3"
    >
      <label htmlFor={inputId} className="sr-only">
        Message
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={inputId}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
            if (e.target.value.trim()) signalTyping();
          }}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Message the room"
          aria-invalid={tooLong || !!error}
          aria-describedby={`${hintId} ${errorId}`}
          className="min-w-0 flex-1 resize-none rounded-md border border-border bg-bg p-2 text-sm"
        />
        <button
          type="submit"
          disabled={!body.trim() || tooLong || sending || !connected}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <p id={hintId} className="text-xs text-muted">
        {connected
          ? 'Enter to send · Shift+Enter for a new line · Markdown works'
          : 'Reconnecting… you can send once the chat is back.'}
        {body.length > MAX_MESSAGE_LENGTH * 0.9 && ` · ${body.length}/${MAX_MESSAGE_LENGTH}`}
      </p>
      <p id={errorId} role="alert" className="text-xs text-danger empty:hidden">
        {tooLong ? `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.` : error}
      </p>
    </form>
  );
}

export function typingText(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `@${names[0]} is typing…`;
  if (names.length === 2) return `@${names[0]} and @${names[1]} are typing…`;
  return 'Several people are typing…';
}
