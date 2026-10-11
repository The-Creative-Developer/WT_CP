import { LANGUAGES, type RoomDetail } from '@devverse/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useDeleteRoom, useJoinRoom, useRoom } from '../features/rooms/queries';
import { ApiError } from '../lib/api';

export function RoomPage() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const invite = searchParams.get('invite') ?? undefined;
  const room = useRoom(slug);

  // [CONCEPT: Secrets in URLs] Once the invite has done its job, drop it from the address bar so it doesn't linger
  // in history or get copy-pasted onwards by accident.
  const memberRole = room.data?.role;
  useEffect(() => {
    if (invite && memberRole && memberRole !== 'viewer') {
      setSearchParams(
        (params) => {
          params.delete('invite');
          return params;
        },
        { replace: true },
      );
    }
  }, [invite, memberRole, setSearchParams]);

  if (room.isPending) {
    return (
      <p role="status" className="py-16 text-center text-muted">
        Opening room…
      </p>
    );
  }

  if (room.isError) {
    const status = room.error instanceof ApiError ? room.error.status : 0;
    if (status === 403 && invite) return <JoinPrompt slug={slug} invite={invite} />;
    return (
      <Notice
        title={
          status === 404
            ? 'Room not found'
            : status === 403
              ? 'This room is private'
              : 'Something went wrong'
        }
        body={
          status === 404
            ? 'It may have been deleted, or the link is mistyped.'
            : status === 403
              ? 'Ask the owner for an invite link.'
              : 'Try refreshing the page.'
        }
      />
    );
  }

  // A public room you haven't joined, or an invite that would upgrade you from viewer to editor.
  if (!room.data.role || (invite && room.data.role === 'viewer')) {
    return <JoinPrompt slug={slug} invite={invite} room={room.data} />;
  }

  return <RoomView room={room.data} />;
}

function JoinPrompt({ slug, invite, room }: { slug: string; invite?: string; room?: RoomDetail }) {
  const join = useJoinRoom(slug);
  const error =
    join.error instanceof ApiError ? join.error.message : join.error ? 'Could not join.' : null;

  return (
    <section aria-labelledby="join-title" className="mx-auto max-w-md py-12 text-center">
      <title>{`Join ${room?.name ?? 'room'} · DevVerse`}</title>
      <h1 id="join-title" className="text-2xl font-bold">
        {room ? `Join “${room.name}”` : "You've been invited to a room"}
      </h1>
      <p className="mt-2 text-muted">
        {invite
          ? 'Your invite lets you edit code with everyone in the room.'
          : 'This room is public. You can join as a viewer and watch the code being written.'}
      </p>
      <div role="alert" className="empty:hidden">
        {error && <p className="mt-4 text-danger">{error}</p>}
      </div>
      <button
        type="button"
        disabled={join.isPending}
        onClick={() => join.mutate(invite)}
        className="mt-6 rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-contrast disabled:opacity-60"
      >
        {join.isPending ? 'Joining…' : invite ? 'Join as editor' : 'Join as viewer'}
      </button>
    </section>
  );
}

function RoomView({ room }: { room: RoomDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <title>{`${room.name} · DevVerse`}</title>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{room.name}</h1>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
          {LANGUAGES[room.language].label}
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
          {room.visibility === 'private' ? 'Private' : 'Public'}
        </span>
        <span className="text-sm text-muted">
          You're {room.role === 'owner' ? 'the owner' : `an ${room.role}`}
        </span>
      </header>

      {/* [CONCEPT: CSS Grid Layout] Editor beside a sidebar on wide screens; stacked on phones. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section
          aria-labelledby="files-title"
          className="rounded-xl border border-border bg-surface p-5"
        >
          <h2 id="files-title" className="font-semibold">
            Files
          </h2>
          <ul className="mt-2 font-mono text-sm">
            {room.files.map((file) => (
              <li key={file.id}>{file.path}</li>
            ))}
          </ul>
          <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-muted">
            The live editor arrives next, with Yjs real-time sync.
          </p>
        </section>

        <aside aria-label="Room details" className="flex flex-col gap-6">
          <section aria-labelledby="members-title">
            <h2 id="members-title" className="font-semibold">
              Members ({room.memberCount})
            </h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {room.members.map((member) => (
                <li key={member.id} className="flex justify-between gap-2">
                  <span>@{member.username}</span>
                  <span className="capitalize text-muted">{member.role}</span>
                </li>
              ))}
            </ul>
          </section>
          {room.inviteCode && <InviteLink slug={room.slug} code={room.inviteCode} />}
          {room.role === 'owner' && <DeleteRoom room={room} />}
        </aside>
      </div>
    </div>
  );
}

function InviteLink({ slug, code }: { slug: string; code: string }) {
  const inputId = useId();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const url = `${window.location.origin}/rooms/${slug}?invite=${encodeURIComponent(code)}`;

  async function copy() {
    try {
      // [CONCEPT: Clipboard API] Async, permission-aware copying (needs a secure context: HTTPS or localhost).
      await navigator.clipboard.writeText(url);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <section className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-semibold">
        Invite link
      </label>
      <p className="text-sm text-muted">Anyone with this link can join and edit.</p>
      <div className="flex gap-2">
        <input
          id={inputId}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Copy
        </button>
      </div>
      <p role="status" className="text-sm text-muted">
        {copied === 'copied'
          ? 'Link copied.'
          : copied === 'failed'
            ? 'Copy failed: select the link and copy it.'
            : ''}
      </p>
    </section>
  );
}

function DeleteRoom({ room }: { room: RoomDetail }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const deleteRoom = useDeleteRoom(room.slug);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="self-start rounded-md border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
      >
        Delete room
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(24rem,calc(100%-2rem))] rounded-xl border border-border bg-surface p-6 text-fg backdrop:bg-black/50"
      >
        <h2 id={titleId} className="text-lg font-bold">
          Delete “{room.name}”?
        </h2>
        <p className="mt-2 text-sm text-muted">
          This removes the room and all of its files for every member. It can't be undone.
        </p>
        <div role="alert" className="empty:hidden">
          {deleteRoom.isError && (
            <p className="mt-3 text-sm text-danger">Couldn't delete the room.</p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {/* The safe choice comes first, so it gets focus when the dialog opens. */}
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg border border-border px-4 py-2 hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleteRoom.isPending}
            onClick={() =>
              deleteRoom.mutate(undefined, {
                onSuccess: () => navigate('/dashboard', { replace: true }),
              })
            }
            className="rounded-lg bg-danger px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {deleteRoom.isPending ? 'Deleting…' : 'Delete room'}
          </button>
        </div>
      </dialog>
    </>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <section aria-labelledby="notice-title" className="py-16 text-center">
      <title>{`${title} · DevVerse`}</title>
      <h1 id="notice-title" className="text-2xl font-bold">
        {title}
      </h1>
      <p className="mt-2 text-muted">{body}</p>
      <Link to="/dashboard" className="mt-6 inline-block text-accent underline">
        Back to your dashboard
      </Link>
    </section>
  );
}
