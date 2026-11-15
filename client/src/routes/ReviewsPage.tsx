import type { ReviewStatus, RoomDetail } from '@devverse/shared';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useRoom } from '../features/rooms/queries';
import { useCreateReview, useReviews, useSnapshots } from '../features/review/queries';
import {
  SaveVersionDialog,
  type SaveVersionDialogHandle,
} from '../features/review/SaveVersionDialog';
import { apiFile, ApiError } from '../lib/api';
import { saveBlob } from '../lib/download';
import { timeAgo } from '../lib/format';

const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60';

const FILTERS: { value: ReviewStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export function ReviewsPage() {
  const { slug = '' } = useParams();
  const room = useRoom(slug);

  if (room.isPending) {
    return (
      <p role="status" className="py-16 text-center text-muted">
        Loading…
      </p>
    );
  }
  if (room.isError || !room.data.role) {
    return (
      <section className="py-16 text-center">
        <title>Versions and reviews · DevVerse</title>
        <h1 className="text-2xl font-bold">You can't see this room's reviews</h1>
        <p className="mt-2 text-muted">Open the room and join it first.</p>
        <Link to={`/rooms/${slug}`} className="mt-6 inline-block text-accent underline">
          Go to the room
        </Link>
      </section>
    );
  }
  return <ReviewsView room={room.data} />;
}

function ReviewsView({ room }: { room: RoomDetail }) {
  const canEdit = room.role !== 'viewer';
  const [params, setParams] = useSearchParams();
  // [CONCEPT: URL as State] The filter lives in the address, so it survives a reload and can be shared.
  const filter = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'open') as
    ReviewStatus | 'all';
  const reviews = useReviews(room.projectId, filter === 'all' ? undefined : filter);
  const snapshots = useSnapshots(room.projectId);
  const createReview = useCreateReview(room.projectId);
  const navigate = useNavigate();
  const saveDialog = useRef<SaveVersionDialogHandle>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await apiFile(
        `/api/v1/projects/${encodeURIComponent(room.projectId)}/export.zip`,
      );
      saveBlob(blob, filename ?? `${room.slug}.zip`);
      setStatus('Download started.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't download. Check your connection.");
    } finally {
      setDownloading(false);
    }
  }

  async function requestReview(snapshotId: string) {
    setRequesting(snapshotId);
    setError(null);
    try {
      const review = await createReview.mutateAsync(snapshotId);
      await navigate(`/rooms/${room.slug}/reviews/${review.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't ask for a review.");
      setRequesting(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <title>{`Versions and reviews · ${room.name} · DevVerse`}</title>
      <header className="flex flex-col gap-3">
        <Link to={`/rooms/${room.slug}`} className="self-start text-sm text-accent underline">
          ← Back to {room.name}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Versions and reviews</h1>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className={buttonClass}
            >
              {downloading ? 'Preparing…' : 'Download ZIP'}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => saveDialog.current?.open()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast"
              >
                Save version
              </button>
            )}
          </div>
        </div>
        <p role="status" className="text-sm text-muted empty:hidden">
          {status}
        </p>
        <div role="alert" className="empty:hidden">
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </header>

      <section aria-labelledby="reviews-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="reviews-title" className="text-lg font-semibold">
            Reviews
          </h2>
          <nav aria-label="Filter reviews" className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() =>
                  setParams((p) => {
                    p.set('status', f.value);
                    return p;
                  })
                }
                className="rounded-md px-3 py-1 text-sm aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:shadow-sm"
              >
                {f.label}
              </button>
            ))}
          </nav>
        </div>
        {reviews.isPending ? (
          <p role="status" className="text-muted">
            Loading reviews…
          </p>
        ) : reviews.isError ? (
          <p role="alert" className="text-danger">
            Couldn't load reviews.
          </p>
        ) : reviews.data.length === 0 ? (
          <p className="text-muted">
            {filter === 'closed'
              ? 'No closed reviews.'
              : canEdit
                ? 'No reviews yet. Save a version, then ask for a review of it below.'
                : 'No reviews yet.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {reviews.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    to={`/rooms/${room.slug}/reviews/${r.id}`}
                    className="font-semibold break-words hover:text-accent hover:underline"
                  >
                    {r.snapshot.message}
                  </Link>
                  <p className="text-sm text-muted">
                    {r.base
                      ? `Compared with “${r.base.message}”`
                      : 'Compared with an empty project'}{' '}
                    · asked by {r.requester.username} {timeAgo(r.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span>
                    {r.commentCount} comment{r.commentCount === 1 ? '' : 's'}
                  </span>
                  {r.openThreads > 0 && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
                      {r.openThreads} unresolved
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 ${r.status === 'open' ? 'bg-success/15 text-success' : 'bg-surface-2 text-muted'}`}
                  >
                    {r.status === 'open' ? 'Open' : 'Closed'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="versions-title" className="flex flex-col gap-3">
        <h2 id="versions-title" className="text-lg font-semibold">
          Saved versions
        </h2>
        {snapshots.isPending ? (
          <p role="status" className="text-muted">
            Loading versions…
          </p>
        ) : snapshots.isError ? (
          <p role="alert" className="text-danger">
            Couldn't load versions.
          </p>
        ) : snapshots.data.length === 0 ? (
          <p className="text-muted">
            {canEdit
              ? 'No versions yet. “Save version” keeps a copy of every file as it is now.'
              : 'No versions yet.'}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {snapshots.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold break-words">{s.message}</span>
                  <span className="text-sm text-muted">
                    {s.author.username} ·{' '}
                    <time dateTime={s.createdAt} title={new Date(s.createdAt).toLocaleString()}>
                      {timeAgo(s.createdAt)}
                    </time>{' '}
                    · {s.fileCount} file{s.fileCount === 1 ? '' : 's'}
                  </span>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    disabled={requesting !== null}
                    onClick={() => void requestReview(s.id)}
                    className={buttonClass}
                  >
                    {requesting === s.id ? 'Starting…' : 'Ask for a review'}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {canEdit && (
        <SaveVersionDialog
          ref={saveDialog}
          projectId={room.projectId}
          onSaved={(s) => setStatus(`Saved “${s.message}”.`)}
        />
      )}
    </div>
  );
}
