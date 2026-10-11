import type { CreateRoomInput, RoomDetail, RoomSummary } from '@devverse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

// [CONCEPT: Query Keys] Hierarchical keys let one invalidate(['rooms']) refresh both the list and every room.
export const roomKeys = {
  all: ['rooms'] as const,
  detail: (slug: string) => ['rooms', slug] as const,
};

export function useRooms() {
  return useQuery({
    queryKey: roomKeys.all,
    queryFn: () => api<RoomSummary[]>('/api/v1/rooms'),
  });
}

export function useRoom(slug: string) {
  return useQuery({
    queryKey: roomKeys.detail(slug),
    queryFn: () => api<RoomDetail>(`/api/v1/rooms/${encodeURIComponent(slug)}`),
    // 403 (private, not a member) and 404 are answers, not glitches: retrying won't change them.
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomInput) =>
      api<RoomDetail>('/api/v1/rooms', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (room) => {
      // [CONCEPT: Cache Seeding] The room page opens instantly from the create response instead of refetching.
      queryClient.setQueryData(roomKeys.detail(room.slug), room);
      void queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    },
  });
}

export function useJoinRoom(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteCode?: string) =>
      api<RoomDetail>(`/api/v1/rooms/${encodeURIComponent(slug)}/join`, {
        method: 'POST',
        body: JSON.stringify(inviteCode ? { inviteCode } : {}),
      }),
    onSuccess: (room) => {
      queryClient.setQueryData(roomKeys.detail(slug), room);
      void queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    },
  });
}

export function useDeleteRoom(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/api/v1/rooms/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: roomKeys.detail(slug) });
      void queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    },
  });
}
