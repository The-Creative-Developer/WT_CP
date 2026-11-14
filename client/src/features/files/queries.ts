import type {
  FileSummary,
  FilesChangedPayload,
  RoomDetail,
  ServerToClientEvents,
} from '@devverse/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { roomKeys } from '../rooms/queries';
import type { RoomChannel } from '../rooms/useRoomChannel';
import { describeChange } from './tree';

// Same order as the server (MongoDB compares strings by code unit), so a local update and the next broadcast agree.
const byPath = (a: FileSummary, b: FileSummary) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function updateFiles(
  queryClient: QueryClient,
  slug: string,
  update: (files: FileSummary[]) => FileSummary[],
) {
  queryClient.setQueryData<RoomDetail>(roomKeys.detail(slug), (room) =>
    room ? { ...room, files: update(room.files).sort(byPath) } : room,
  );
}

/** Create, rename, move and delete. The room's file list (in the room query) updates as soon as each succeeds. */
export function useFileMutations(slug: string, projectId: string) {
  const queryClient = useQueryClient();
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  const json = (method: string, body: object) => ({ method, body: JSON.stringify(body) });

  const createFile = useMutation({
    mutationFn: (path: string) => api<FileSummary>(`${base}/files`, json('POST', { path })),
    onSuccess: (file) =>
      updateFiles(queryClient, slug, (files) => [...files.filter((f) => f.id !== file.id), file]),
  });
  const renameFile = useMutation({
    mutationFn: ({ id, path }: FileSummary) =>
      api<FileSummary>(`${base}/files/${id}`, json('PATCH', { path })),
    onSuccess: (file) =>
      updateFiles(queryClient, slug, (files) => files.map((f) => (f.id === file.id ? file : f))),
  });
  const deleteFile = useMutation({
    mutationFn: (id: string) => api<void>(`${base}/files/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) =>
      updateFiles(queryClient, slug, (files) => files.filter((f) => f.id !== id)),
  });
  const moveFolder = useMutation({
    mutationFn: (move: { from: string; to: string }) =>
      api<FileSummary[]>(`${base}/folders`, json('PATCH', move)),
    onSuccess: (files) => updateFiles(queryClient, slug, () => files),
  });
  const deleteFolder = useMutation({
    mutationFn: (path: string) =>
      api<void>(`${base}/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    onSuccess: (_, path) =>
      updateFiles(queryClient, slug, (files) =>
        files.filter((f) => !f.path.startsWith(`${path}/`)),
      ),
  });

  return { createFile, renameFile, deleteFile, moveFolder, deleteFolder };
}

/**
 * Keeps the file list in step with changes other people make, and describes them for screen readers.
 * After a reconnect the room is fetched again, since changes made meanwhile never reached this socket.
 */
export function useFileEvents(slug: string, channel: RoomChannel, myUsername: string) {
  const { socket, joins } = channel;
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const onChanged: ServerToClientEvents['files:changed'] = ({
      files,
      by,
    }: FilesChangedPayload) => {
      const before = queryClient.getQueryData<RoomDetail>(roomKeys.detail(slug))?.files ?? [];
      if (by !== myUsername) setAnnouncement(describeChange(before, files, by));
      updateFiles(queryClient, slug, () => [...files]);
    };
    socket.on('files:changed', onChanged);
    return () => {
      socket.off('files:changed', onChanged);
    };
  }, [socket, slug, myUsername, queryClient]);

  const firstJoin = useRef(true);
  useEffect(() => {
    if (joins === 0) return;
    if (firstJoin.current) {
      firstJoin.current = false;
      return;
    }
    void queryClient.invalidateQueries({ queryKey: roomKeys.detail(slug), exact: true });
  }, [joins, slug, queryClient]);

  return announcement;
}
