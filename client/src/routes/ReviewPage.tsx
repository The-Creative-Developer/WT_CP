import type { ReviewDetail, RoomDetail } from '@devverse/shared';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuth } from '../features/auth/AuthContext';
import type { ChangeStatus, FileChange } from '../features/review/line-diff';
import { useReview, useReviewMutations, useSnapshot } from '../features/review/queries';
import { ReviewThreads } from '../features/review/ReviewThreads';
import { canResolve, groupThreads, threadCounts, type Thread } from '../features/review/threads';
import { useSnapshotDiff } from '../features/review/useSnapshotDiff';
import { useRoom } from '../features/rooms/queries';
import { ApiError } from '../lib/api';
import { timeAgo } from '../lib/format';

// [CONCEPT: Code Splitting] Monaco's diff editor is only downloaded when a review is opened.
const loadViewer = () => import('../features/review/DiffViewer');
let DiffViewer = lazy(loadViewer);

const STATUS: Record<ChangeStatus, { letter: string; label: string; className: string }> = {
  added: { letter: 'A', label: 'Added', className: 'text-success' },
  deleted: { letter: 'D', label: 'Deleted', className: 'text-danger' },
  modified: { letter: 'M', label: 'Changed', className: 'text-warning' },
  unchanged: { letter: '·', label: 'Unchanged', className: 'text-muted' },
};

export function ReviewPage() {
  const { slug = '', reviewId = '' } = useParams();
  const room = useRoom(slug);
  const review = useReview(reviewId);

  if (room.isPending || review.isPending) {
    return (
      <p role="status" className="py-16 text-center text-muted">
        Opening review…
      </p>
    );
  }
  const status = review.error instanceof ApiError ? review.error.status : 0;
  if (
    room.isError ||
    !room.data.role ||
    review.isError ||
    review.data.projectId !== room.data.projectId
  ) {
    return (
      <section className="py-16 text-center">
        <title>Review not found · DevVerse</title>
        <h1 className="text-2xl font-bold">
          {status === 403 ? "You can't see this review" : 'Review not found'}
        </h1>
        <p className="mt-2 text-muted">
          It may have been deleted with its room, or the link is wrong.
        </p>
        <Link to={`/rooms/${slug}/reviews`} className="mt-6 inline-block text-accent underline">
          All reviews
        </Link>
      </section>
    );
  }
  return <ReviewView room={room.data} review={review.data} />;
}

function ReviewView({ room, review }: { room: RoomDetail; review: ReviewDetail }) {
  const { state } = useAuth();
  const me = { id: state.status === 'authenticated' ? state.user.id : '', role: room.role! };
  const head = useSnapshot(room.projectId, review.snapshot.id);
  const base = useSnapshot(room.projectId, review.base?.id);
  const changes = useSnapshotDiff(review.base ? base.data?.files : null, head.data?.files);
  const mutations = useReviewMutations(review);
  const threads = useMemo(() => groupThreads(review.comments), [review.comments]);
  const counts = useMemo(() => threadCounts(threads), [threads]);

  const [params, setParams] = useSearchParams();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [active, setActive] = useState<{ threadId: string | null; line: number } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const changed = changes?.filter((c) => c.status !== 'unchanged') ?? [];
  const listed =
    changes?.filter((c) => showUnchanged || c.status !== 'unchanged' || counts.has(c.path)) ?? [];
  // [CONCEPT: URL as State] The open file is in the address (?file=), so a link can point straight at it.
  const requested = params.get('file');
  const current: FileChange | undefined =
    changes?.find((c) => c.path === requested) ?? changed[0] ?? changes?.[0];
  const path = current?.path ?? null;

  const original = path ? (base.data?.files.find((f) => f.path === path)?.content ?? null) : null;
  const modified = path ? (head.data?.files.find((f) => f.path === path)?.content ?? null) : null;
  const fileThreads = threads.filter((t) => t.path === path);
  // Lines as the editor numbers them (and the server checks): a final newline starts one more, empty line.
  const lineCount = modified === null ? 0 : modified.split('\n').length;
  const isOpen = review.status === 'open';
  const mayClose = review.requester.id === me.id || me.role === 'owner';
  const totals = changed.reduce(
    (sum, c) => ({ added: sum.added + c.added, removed: sum.removed + c.removed }),
    {
      added: 0,
      removed: 0,
    },
  );

  function openFile(next: string) {
    setSelectedLine(null);
    setActive(null);
    setParams(
      (p) => {
        p.set('file', next);
        return p;
      },
      { replace: true },
    );
  }

  function selectLine(line: number | null) {
    setSelectedLine(line);
    if (line === null) return;
    // A line that already has a thread focuses it; the form still lets you start another.
    const existing = fileThreads.find((t) => t.line === line);
    setActive({ threadId: existing?.id ?? null, line });
  }

  async function toggleStatus() {
    setStatusError(null);
    try {
      await mutations.setStatus.mutateAsync(isOpen ? 'closed' : 'open');
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : "Couldn't change the review.");
    }
  }

  const loadingFiles =
    head.isPending || (review.base !== null && base.isPending) || changes === null;
  const filesFailed = head.isError || base.isError;

  return (
    <div className="flex flex-col gap-6">
      <title>{`Review: ${review.snapshot.message} · ${room.name} · DevVerse`}</title>
      <header className="flex flex-col gap-2">
        <Link
          to={`/rooms/${room.slug}/reviews`}
          className="self-start text-sm text-accent underline"
        >
          ← All reviews
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold break-words">{review.snapshot.message}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-sm ${isOpen ? 'bg-success/15 text-success' : 'bg-surface-2 text-muted'}`}
          >
            {isOpen ? 'Open' : 'Closed'}
          </span>
          {mayClose && (
            <button
              type="button"
              disabled={mutations.setStatus.isPending}
              onClick={() => void toggleStatus()}
              className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60"
            >
              {isOpen ? 'Close review' : 'Reopen review'}
            </button>
          )}
        </div>
        <p className="text-sm text-muted">
          {review.base ? (
            <>Compared with “{review.base.message}”</>
          ) : (
            'Compared with an empty project'
          )}{' '}
          · saved by {review.snapshot.author.username} {timeAgo(review.snapshot.createdAt)} · review
          asked for by {review.requester.username} {timeAgo(review.createdAt)}
        </p>
        <p className="text-sm">
          {changes && (
            <>
              {changed.length} file{changed.length === 1 ? '' : 's'} changed,{' '}
              <span className="text-success">+{totals.added}</span>{' '}
              <span className="text-danger">−{totals.removed}</span> ·{' '}
            </>
          )}
          {review.openThreads} unresolved thread{review.openThreads === 1 ? '' : 's'}
        </p>
        <div role="alert" className="empty:hidden">
          {statusError && <p className="text-sm text-danger">{statusError}</p>}
        </div>
      </header>

      {filesFailed ? (
        <p role="alert" className="text-danger">
          Couldn't load the versions being compared. Try refreshing the page.
        </p>
      ) : loadingFiles ? (
        <p role="status" className="text-muted">
          Comparing versions…
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] 2xl:grid-cols-[14rem_minmax(0,1fr)_22rem]">
          <nav aria-label="Files in this review" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Files</h2>
            <ul className="flex flex-col gap-0.5">
              {listed.map((c) => {
                const s = STATUS[c.status];
                const n = counts.get(c.path);
                return (
                  <li key={c.path}>
                    <button
                      type="button"
                      aria-current={c.path === path ? 'true' : undefined}
                      onClick={() => openFile(c.path)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-surface-2 aria-[current=true]:bg-surface-2 aria-[current=true]:font-semibold"
                    >
                      <span aria-hidden="true" className={`w-3 font-mono font-bold ${s.className}`}>
                        {s.letter}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono" title={c.path}>
                        {c.path}
                      </span>
                      <span className="sr-only">
                        {s.label}
                        {c.status !== 'unchanged' &&
                          `, ${c.added} lines added, ${c.removed} removed`}
                        {n && `, ${n.total} thread${n.total === 1 ? '' : 's'}`}
                      </span>
                      {n && (
                        <span
                          aria-hidden="true"
                          className={`rounded-full px-1.5 text-xs ${n.open ? 'bg-accent text-accent-contrast' : 'bg-surface-2 text-muted'}`}
                        >
                          {n.total}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!showUnchanged && changes && changes.length > listed.length && (
              <button
                type="button"
                onClick={() => setShowUnchanged(true)}
                className="self-start text-sm text-accent underline"
              >
                Show {changes.length - listed.length} unchanged file
                {changes.length - listed.length === 1 ? '' : 's'}
              </button>
            )}
            {changed.length === 0 && <p className="text-sm text-muted">No files changed.</p>}
          </nav>

          <section
            aria-label={path ? `Changes to ${path}` : 'Changes'}
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
          >
            {path && current ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
                  <span className="font-mono break-all">{path}</span>
                  <span className="text-muted">
                    {STATUS[current.status].label}
                    {current.status !== 'unchanged' && (
                      <>
                        {' '}
                        <span className="text-success">+{current.added}</span>{' '}
                        <span className="text-danger">−{current.removed}</span>
                        {current.approximate && ' (approximately)'}
                      </>
                    )}
                  </span>
                </div>
                <ErrorBoundary
                  fallback={(retry) => (
                    <div
                      role="alert"
                      className="flex h-80 flex-col items-center justify-center gap-3"
                    >
                      <p>The comparison view failed to load.</p>
                      <button
                        type="button"
                        onClick={() => {
                          DiffViewer = lazy(loadViewer);
                          retry();
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                >
                  <Suspense
                    fallback={
                      <p
                        role="status"
                        className="flex h-[65vh] min-h-80 items-center justify-center text-muted"
                      >
                        Loading the comparison…
                      </p>
                    }
                  >
                    <DiffViewer
                      path={path}
                      original={original}
                      modified={modified}
                      threads={fileThreads.map((t) => ({
                        line: t.line,
                        resolved: t.resolved,
                        count: t.comments.length,
                      }))}
                      focusLine={active?.line ?? null}
                      onLineSelect={
                        modified === null ? undefined : (line) => selectLine(isOpen ? line : null)
                      }
                    />
                  </Suspense>
                </ErrorBoundary>
              </>
            ) : (
              <p className="p-6 text-center text-muted">These versions have no files.</p>
            )}
          </section>

          {path && (
            <aside className="lg:col-span-2 2xl:col-span-1">
              <ReviewThreads
                path={path}
                threads={fileThreads}
                lineCount={lineCount}
                open={isOpen}
                selectedLine={selectedLine}
                activeThreadId={active?.threadId ?? null}
                canResolve={(t: Thread) => canResolve(t, me, review.requester.id)}
                onSelectLine={selectLine}
                onFocusThread={(t) => setActive({ threadId: t.id, line: t.line })}
                onComment={async (input) => {
                  const comment = await mutations.addComment.mutateAsync(input);
                  if (comment.parentId === null) {
                    setSelectedLine(null);
                    setActive({ threadId: comment.id, line: comment.line });
                  }
                }}
                onResolve={(t, resolved) =>
                  mutations.setResolved.mutateAsync({ id: t.id, resolved })
                }
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
