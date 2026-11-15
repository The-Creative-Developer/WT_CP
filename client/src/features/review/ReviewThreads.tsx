import { MAX_COMMENT_LENGTH, type CreateCommentInput } from '@devverse/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import type { Thread } from './threads';

const buttonClass =
  'rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-60';
const primaryClass =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast disabled:opacity-60';
const textareaClass =
  'w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-muted aria-[invalid=true]:border-danger';

const errorMessage = (err: unknown) =>
  err instanceof ApiError
    ? (Object.values(err.fieldErrors)[0]?.[0] ?? err.message)
    : 'Could not reach the server. Check your connection.';

/** A textarea and a submit button, with the same rules as the server (not empty, not too long). */
function CommentForm({
  label,
  submitLabel,
  focusOnMount,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  /** Move focus to the text box when the form appears (it appears because the user just asked for it). */
  focusOnMount?: boolean;
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusOnMount) textareaRef.current?.focus();
  }, [focusOnMount]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return setError('Write a comment first');
    if (text.length > MAX_COMMENT_LENGTH) {
      return setError(`Comments can be at most ${MAX_COMMENT_LENGTH} characters`);
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit(text);
      setBody('');
      onCancel?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={textareaRef}
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        // Ctrl/⌘+Enter sends, as in most review tools.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
        }}
        rows={3}
        placeholder={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={textareaClass}
      />
      <div role="alert" className="empty:hidden">
        {error && (
          <p id={`${id}-error`} className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClass}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={sending} className={primaryClass}>
          {sending ? 'Sending…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function ThreadCard({
  thread,
  active,
  canComment,
  canResolve,
  onFocus,
  onReply,
  onResolve,
}: {
  thread: Thread;
  active: boolean;
  canComment: boolean;
  canResolve: boolean;
  onFocus: () => void;
  onReply: (body: string) => Promise<unknown>;
  onResolve: (resolved: boolean) => Promise<unknown>;
}) {
  const [replying, setReplying] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();

  // Picking the thread's marker in the editor brings its card into view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  async function toggleResolved() {
    setResolving(true);
    setResolveError(null);
    try {
      await onResolve(!thread.resolved);
    } catch (err) {
      setResolveError(errorMessage(err));
    } finally {
      setResolving(false);
    }
  }

  return (
    <article
      ref={ref}
      aria-labelledby={titleId}
      className={`flex flex-col gap-3 rounded-lg border p-3 ${active ? 'border-accent' : 'border-border'} ${thread.resolved ? 'bg-surface-2' : 'bg-surface'}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          <button
            type="button"
            onClick={onFocus}
            className="underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            Line {thread.line}
          </button>
        </h3>
        {thread.resolved && (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
            Resolved
          </span>
        )}
      </header>
      <ol className="flex flex-col gap-3">
        {thread.comments.map((c) => (
          <li key={c.id} className="flex flex-col gap-1">
            <p className="text-xs text-muted">
              <span className="font-semibold text-fg">{c.author.username}</span>{' '}
              <time dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>
                {timeAgo(c.createdAt)}
              </time>
              {c.editedAt && ' (edited)'}
            </p>
            {/* Plain text, never HTML: comments come from other people. */}
            <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ol>
      {replying ? (
        <CommentForm
          label={`Reply about line ${thread.line}`}
          submitLabel="Reply"
          focusOnMount
          onSubmit={onReply}
          onCancel={() => setReplying(false)}
        />
      ) : (
        (canComment || canResolve) && (
          <div className="flex flex-wrap gap-2">
            {canComment && (
              <button type="button" onClick={() => setReplying(true)} className={buttonClass}>
                Reply
              </button>
            )}
            {canComment && canResolve && (
              <button
                type="button"
                disabled={resolving}
                onClick={() => void toggleResolved()}
                className={buttonClass}
              >
                {thread.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
          </div>
        )
      )}
      <div role="alert" className="empty:hidden">
        {resolveError && <p className="text-sm text-danger">{resolveError}</p>}
      </div>
    </article>
  );
}

export interface ReviewThreadsProps {
  path: string;
  threads: Thread[];
  /** Lines in the reviewed version of the file; 0 if it was deleted (no comments possible). */
  lineCount: number;
  /** The review is open, so comments can be added. */
  open: boolean;
  selectedLine: number | null;
  activeThreadId: string | null;
  canResolve: (thread: Thread) => boolean;
  onSelectLine: (line: number | null) => void;
  onFocusThread: (thread: Thread) => void;
  onComment: (input: CreateCommentInput) => Promise<unknown>;
  onResolve: (thread: Thread, resolved: boolean) => Promise<unknown>;
}

/** The comment threads on one file of a review, and the form for starting a new one. */
export function ReviewThreads({
  path,
  threads,
  lineCount,
  open,
  selectedLine,
  activeThreadId,
  canResolve,
  onSelectLine,
  onFocusThread,
  onComment,
  onResolve,
}: ReviewThreadsProps) {
  const lineId = useId();
  const [lineDraft, setLineDraft] = useState('');
  const line = selectedLine;

  return (
    <section aria-labelledby={`${lineId}-title`} className="flex flex-col gap-3">
      <h2 id={`${lineId}-title`} className="font-semibold break-all">
        Comments on {path}
      </h2>

      {!open ? (
        <p className="text-sm text-muted">This review is closed, so it can't be changed.</p>
      ) : lineCount === 0 ? (
        <p className="text-sm text-muted">
          This file was deleted in the reviewed version, so there are no lines to comment on.
        </p>
      ) : line === null ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(lineDraft);
            if (Number.isInteger(n) && n >= 1 && n <= lineCount) onSelectLine(n);
          }}
        >
          <p className="w-full text-sm text-muted">
            Click a line number in the reviewed version, or choose a line:
          </p>
          <label htmlFor={lineId} className="text-sm">
            Line
          </label>
          <input
            id={lineId}
            type="number"
            inputMode="numeric"
            min={1}
            max={lineCount}
            required
            value={lineDraft}
            onChange={(e) => setLineDraft(e.target.value)}
            className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
          <button type="submit" className={buttonClass}>
            Comment on line
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-accent p-3">
          <h3 className="text-sm font-semibold">New comment on line {line}</h3>
          <CommentForm
            key={`${path}:${line}`}
            label={`Comment on line ${line} of ${path}`}
            submitLabel="Comment"
            focusOnMount
            onSubmit={(body) => onComment({ path, line, body })}
            onCancel={() => onSelectLine(null)}
          />
        </div>
      )}

      {threads.length === 0 ? (
        <p className="text-sm text-muted">No comments on this file yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {threads.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              active={t.id === activeThreadId}
              canComment={open}
              canResolve={canResolve(t)}
              onFocus={() => onFocusThread(t)}
              onReply={(body) => onComment({ parentId: t.id, body })}
              onResolve={(resolved) => onResolve(t, resolved)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
