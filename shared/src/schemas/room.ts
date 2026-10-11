import { z } from 'zod';
import { LANGUAGE_IDS, type Language } from '../languages';
import type { RoomRole } from '../roles';

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

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;

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
  files: { id: string; path: string }[];
  /** Only sent to the room owner, so they can share an invite link (which grants edit access). */
  inviteCode?: string;
}
