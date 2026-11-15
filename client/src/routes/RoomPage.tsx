import { languageForPath, LANGUAGES, type RoomDetail } from '@devverse/shared';
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuth } from '../features/auth/AuthContext';
import { CallPanel } from '../features/call/CallPanel';
import { useCall } from '../features/call/useCall';
import { ChatPanel } from '../features/chat/ChatPanel';
import { useChat } from '../features/chat/useChat';
import { EditorTabs, tabId } from '../features/files/EditorTabs';
import {
  DeleteFileDialog,
  FileNameDialog,
  type DeleteFileDialogHandle,
  type FileNameDialogHandle,
} from '../features/files/FileDialogs';
import { FileTree } from '../features/files/FileTree';
import { useFileEvents, useFileMutations } from '../features/files/queries';
import type { TreeNode } from '../features/files/tree';
import { useOpenFiles } from '../features/files/useOpenFiles';
import { MembersList } from '../features/rooms/MembersList';
import { useDeleteRoom, useJoinRoom, useRoom } from '../features/rooms/queries';
import { useRoomChannel } from '../features/rooms/useRoomChannel';
import {
  SaveVersionDialog,
  type SaveVersionDialogHandle,
} from '../features/review/SaveVersionDialog';
import { RunPanel } from '../features/run/RunPanel';
import { useRoomRun, useRunShortcut } from '../features/run/useRoomRun';
import { ApiError } from '../lib/api';

// [CONCEPT: Code Splitting] Monaco is the biggest dependency in the app; React.lazy downloads it only when a room
// is opened, keeping the dashboard and login pages fast.
const loadEditor = () => import('../features/editor/CollabEditor');
let CollabEditor = lazy(loadEditor);

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

  if (room.isPending) return <RoomSkeleton />;

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
  const { state } = useAuth();
  const username = state.status === 'authenticated' ? state.user.username : 'anonymous';
  const myId = state.status === 'authenticated' ? state.user.id : undefined;
  const canEdit = room.role !== 'viewer';
  const channel = useRoomChannel(room.slug);
  const runner = useRoomRun(room.slug, username, channel);
  const chat = useChat(room.slug, channel, myId);
  const call = useCall(room.slug, channel);
  // Opened on a first visit: a top-level file that runs here (main.py), not whatever sorts first (README.md).
  const runnable = room.files.filter((f) => languageForPath(f.path) === room.language);
  const starter = runnable.find((f) => !f.path.includes('/')) ?? runnable[0];
  const tabs = useOpenFiles(room.slug, room.files, starter?.id);
  const files = useFileMutations(room.slug, room.projectId);
  const filesAnnouncement = useFileEvents(room.slug, channel, username);
  const nameDialog = useRef<FileNameDialogHandle>(null);
  const deleteDialog = useRef<DeleteFileDialogHandle>(null);
  const saveDialog = useRef<SaveVersionDialogHandle>(null);
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const panelId = useId();

  const activeFile = room.files.find((f) => f.id === tabs.activeId);
  const openFiles = tabs.open.flatMap((id) => room.files.find((f) => f.id === id) ?? []);
  const { label, extension } = LANGUAGES[room.language];
  const cannotRun = !canEdit
    ? 'Viewers can watch runs but not start them.'
    : !activeFile
      ? 'Open a file to run it.'
      : languageForPath(activeFile.path) !== room.language
        ? `Only .${extension} files can be run in a ${label} room.`
        : null;
  const { runFile, busy } = runner;
  const activeId = activeFile?.id;
  // Not wrapped in useCallback: the React Compiler memoizes it.
  const run = () => {
    if (cannotRun === null && activeId && !busy) runFile(activeId);
  };
  useRunShortcut(run);

  const { openFile } = tabs;
  async function createFile(path: string) {
    const file = await files.createFile.mutateAsync(path);
    openFile(file.id);
  }
  async function rename(node: TreeNode, path: string) {
    if (node.kind === 'file') await files.renameFile.mutateAsync({ id: node.id, path });
    else await files.moveFolder.mutateAsync({ from: node.path, to: path });
  }
  async function remove(node: TreeNode) {
    if (node.kind === 'file') await files.deleteFile.mutateAsync(node.id);
    else await files.deleteFolder.mutateAsync(node.path);
  }
  function move(node: TreeNode, to: string) {
    setMoveError(null);
    rename(node, to).catch((err: unknown) =>
      setMoveError(
        `Couldn't move ${node.name}: ${err instanceof ApiError ? err.message : 'check your connection.'}`,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <title>{`${room.name} · DevVerse`}</title>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{room.name}</h1>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{label}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
          {room.visibility === 'private' ? 'Private' : 'Public'}
        </span>
        <span className="text-sm text-muted">
          You're{' '}
          {room.role === 'owner' ? 'the owner' : room.role === 'editor' ? 'an editor' : 'a viewer'}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Link
            to={`/rooms/${room.slug}/reviews`}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
          >
            Versions and reviews
          </Link>
          {canEdit && (
            <button
              type="button"
              onClick={() => saveDialog.current?.open()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
            >
              Save version
            </button>
          )}
        </span>
        <p role="status" className="w-full text-sm text-muted empty:hidden">
          {savedVersion && (
            <>
              Saved “{savedVersion}”.{' '}
              <Link to={`/rooms/${room.slug}/reviews`} className="text-accent underline">
                Ask for a review
              </Link>
            </>
          )}
        </p>
      </header>

      <CallPanel call={call} username={username} />

      {/* [CONCEPT: CSS Grid Layout] Editor beside a sidebar on wide screens; stacked on phones. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* min-w-0 lets the grid column shrink below the editor's natural width instead of overflowing. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
            <FileTree
              files={room.files}
              activeId={tabs.activeId}
              canEdit={canEdit}
              onOpen={openFile}
              onNewFile={(folder) => nameDialog.current?.open({ kind: 'create', folder })}
              onRename={(node) => nameDialog.current?.open({ kind: 'rename', node })}
              onDelete={(node) => deleteDialog.current?.open(node)}
              onMove={move}
              announcement={filesAnnouncement}
              error={moveError}
            />
            <section
              aria-label="Code editor"
              className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
            >
              <EditorTabs
                files={openFiles}
                activeId={tabs.activeId}
                panelId={panelId}
                onSelect={openFile}
                onClose={tabs.closeFile}
              />
              <div
                id={panelId}
                role={activeFile ? 'tabpanel' : undefined}
                aria-labelledby={activeFile ? tabId(activeFile.id) : undefined}
              >
                {activeFile ? (
                  <ErrorBoundary
                    fallback={(retry) => (
                      <div
                        role="alert"
                        className="flex h-[60vh] min-h-80 flex-col items-center justify-center gap-3 text-center"
                      >
                        <p>The editor failed to load.</p>
                        <button
                          type="button"
                          onClick={() => {
                            // React.lazy caches a failed import, so start a fresh one before retrying.
                            CollabEditor = lazy(loadEditor);
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
                          className="flex h-[60vh] min-h-80 items-center justify-center text-muted"
                        >
                          Loading the editor…
                        </p>
                      }
                    >
                      {/* A new key per file gives each its own connection and undo history. */}
                      <CollabEditor
                        key={activeFile.id}
                        slug={room.slug}
                        fileId={activeFile.id}
                        path={activeFile.path}
                        readOnly={!canEdit}
                        username={username}
                        onRun={cannotRun === null ? run : undefined}
                      />
                    </Suspense>
                  </ErrorBoundary>
                ) : (
                  <p className="flex h-[60vh] min-h-80 items-center justify-center p-6 text-center text-muted">
                    {room.files.length === 0
                      ? canEdit
                        ? 'This room has no files yet. Create one with “New file”.'
                        : 'This room has no files yet.'
                      : 'No file open. Choose one from Files.'}
                  </p>
                )}
              </div>
            </section>
          </div>
          <RunPanel runner={runner} cannotRun={cannotRun} onRun={run} />
        </div>

        <aside aria-label="Room details" className="flex flex-col gap-6">
          <MembersList
            members={room.members}
            present={channel.present}
            connected={channel.connected}
            myId={myId}
          />
          <ChatPanel chat={chat} myId={myId} />
          {room.inviteCode && <InviteLink slug={room.slug} code={room.inviteCode} />}
          {room.role === 'owner' && <DeleteRoom room={room} />}
        </aside>
      </div>

      {canEdit && (
        <>
          <FileNameDialog
            ref={nameDialog}
            existing={room.files.map((f) => f.path)}
            onCreate={createFile}
            onRename={rename}
          />
          <DeleteFileDialog ref={deleteDialog} onDelete={remove} />
          <SaveVersionDialog
            ref={saveDialog}
            projectId={room.projectId}
            onSaved={(snapshot) => setSavedVersion(snapshot.message)}
          />
        </>
      )}
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

/**
 * Grey blocks in the shape of the room (title, file tree, editor, sidebar), so the page doesn't jump when it
 * arrives. Hidden from screen readers, which hear the status message instead.
 */
function RoomSkeleton() {
  const block = 'animate-pulse rounded-xl border border-border bg-surface-2';
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Opening room…</span>
      <div
        aria-hidden="true"
        className="h-8 w-64 max-w-full animate-pulse rounded-md bg-surface-2"
      />
      <div aria-hidden="true" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className={`h-40 md:h-[60vh] ${block}`} />
          <div className={`h-[60vh] min-h-80 ${block}`} />
        </div>
        <div className={`h-64 ${block}`} />
      </div>
    </div>
  );
}
