import type { CreateRoomInput, ListRoomsQuery, RoomDetail, RoomSummary } from '@devverse/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

// [CONCEPT: Query Keys] Hierarchical keys let one invalidate(['rooms']) refresh both the list and every room.
export const roomKeys = {
  all: ['rooms'] as const,
  // 'lists' can't clash with a slug: slugs always end in "-<random suffix>".
  lists: ['rooms', 'lists'] as const,
  list: (filters: ListRoomsQuery) => ['rooms', 'lists', filters] as const,
  detail: (slug: string) => ['rooms', slug] as const,
  messages: (slug: string) => ['rooms', slug, 'messages'] as const,
};

/** The signed-in person's rooms, newest first, matching the dashboard's search and filters. */
export function useRooms(filters: ListRoomsQuery = {}) {
  return useQuery({
    queryKey: roomKeys.list(filters),
    queryFn: () => {
      const query = new URLSearchParams(
        Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ).toString();
      return api<RoomSummary[]>(`/api/v1/rooms${query ? `?${query}` : ''}`);
    },
    // Keep showing the last results while a new search loads, instead of flashing back to the skeleton.
    placeholderData: keepPreviousData,
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
      void queryClient.invalidateQueries({ queryKey: roomKeys.lists });
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
      void queryClient.invalidateQueries({ queryKey: roomKeys.lists });
    },
  });
}

export function useDeleteRoom(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/api/v1/rooms/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: roomKeys.detail(slug) });
      void queryClient.invalidateQueries({ queryKey: roomKeys.lists });
    },
  });
}
