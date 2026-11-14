import { z } from 'zod';
import { LANGUAGE_IDS, type Language } from '../languages';
import { ROOM_ROLES, type RoomRole } from '../roles';
import type { FileSummary } from './file';

export const MAX_ROOM_MEMBERS = 10;
export const ROOM_VISIBILITIES = ['private', 'public'] as const;
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

export const createRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Room name must be at least 3 characters')
    .max(60, 'Room name must be at most 60 characters'),
  visibility: z.enum(ROOM_VISIBILITIES).default('private'),
  language: z.enum(LANGUAGE_IDS as [Language, ...Language[]]).default('javascript'),
});

export const joinRoomSchema = z.object({
  inviteCode: z.string().trim().max(64).optional(),
});

export const MAX_ROOM_SEARCH_LENGTH = 60;

/** GET /api/v1/rooms?q=&language=&role= : the dashboard's search and filters. Empty values mean "any". */
export const listRoomsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(MAX_ROOM_SEARCH_LENGTH, `Search at most ${MAX_ROOM_SEARCH_LENGTH} characters`)
    .transform((q) => q || undefined)
    .optional(),
  language: z.enum(LANGUAGE_IDS as [Language, ...Language[]]).optional(),
  role: z.enum(ROOM_ROLES).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type ListRoomsQuery = z.infer<typeof listRoomsQuerySchema>;

/** One card on the dashboard. */
export interface RoomSummary {
  slug: string;
  name: string;
  language: Language;
  visibility: RoomVisibility;
  owner: { id: string; username: string };
  memberCount: number;
  /** The viewer's role in this room, or null if they haven't joined (possible for public rooms). */
  role: RoomRole | null;
  updatedAt: string;
}

export interface RoomDetail extends RoomSummary {
  projectId: string;
  members: { id: string; username: string; role: RoomRole }[];
  /** Sorted by path. */
  files: FileSummary[];
  /** Only sent to the room owner, so they can share an invite link (which grants edit access). */
  inviteCode?: string;
}
