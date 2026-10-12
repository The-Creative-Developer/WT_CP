import { LANGUAGES, type RoomSummary } from '@devverse/shared';
import { useRef } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../features/auth/AuthContext';
import { CreateRoomDialog, type CreateRoomDialogHandle } from '../features/rooms/CreateRoomDialog';
import { useRooms } from '../features/rooms/queries';
import { timeAgo } from '../lib/format';

// [CONCEPT: Responsive Grid] auto-fill + minmax fits as many 16rem-wide cards per row as the screen allows.
const gridClass = 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]';

export function Dashboard() {
  const { state } = useAuth();
  const dialogRef = useRef<CreateRoomDialogHandle>(null);
  const rooms = useRooms();
  const username = state.status === 'authenticated' ? state.user.username : '';
  const openDialog = () => dialogRef.current?.open();

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <title>Dashboard · DevVerse</title>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="page-title" className="text-2xl font-bold">
            Welcome back, {username}
          </h1>
          <p className="mt-1 text-muted">Pick up where you left off, or start something new.</p>
        </div>
        <button
          type="button"
          onClick={openDialog}
          className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast"
        >
          <span aria-hidden="true">+ </span>New room
        </button>
      </div>

      <section aria-labelledby="rooms-title">
        <h2 id="rooms-title" className="mb-3 text-lg font-semibold">
          Your rooms
        </h2>
        {rooms.isPending ? (
          <RoomsSkeleton />
        ) : rooms.isError ? (
          <div role="alert" className="rounded-xl border border-danger p-6 text-center">
            <p>Couldn't load your rooms.</p>
            <button
              type="button"
              onClick={() => rooms.refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : rooms.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="font-medium">No rooms yet</p>
            <p className="mt-1 text-sm text-muted">
              Create one, then share the invite link with a friend.
            </p>
            <button
              type="button"
              onClick={openDialog}
              className="mt-4 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-contrast"
            >
              Create your first room
            </button>
          </div>
        ) : (
          <ul className={gridClass}>
            {rooms.data.map((room) => (
              <li key={room.slug}>
                <RoomCard room={room} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateRoomDialog ref={dialogRef} />
    </section>
  );
}

function RoomCard({ room }: { room: RoomSummary }) {
  return (
    // [CONCEPT: Block Link Card] The heading's link stretches over the whole card (::after), so the card is one
    // big click target while screen readers still hear a short link name, not the whole card's text.
    <article className="relative flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-shadow focus-within:ring-2 focus-within:ring-accent hover:shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">
          <Link
            to={`/rooms/${room.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {room.name}
          </Link>
        </h3>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
          {room.visibility === 'private' ? 'Private' : 'Public'}
        </span>
      </div>
      <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Language</dt>
        <dd>{LANGUAGES[room.language].label}</dd>
        <dt className="text-muted">Members</dt>
        <dd>{room.memberCount}</dd>
        <dt className="text-muted">Your role</dt>
        <dd className="capitalize">{room.role ?? 'none'}</dd>
        <dt className="text-muted">Updated</dt>
        <dd>
          <time dateTime={room.updatedAt}>{timeAgo(room.updatedAt)}</time>
        </dd>
      </dl>
    </article>
  );
}

function RoomsSkeleton() {
  return (
    <div role="status" className={gridClass}>
      <span className="sr-only">Loading your rooms…</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-40 animate-pulse rounded-xl border border-border bg-surface-2"
        />
      ))}
    </div>
  );
}
