import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MAX_ROOM_MEMBERS,
  type Language,
  type CreateRoomInput,
  type RoomDetail,
  type RoomRole,
  type RoomSummary,
} from '@devverse/shared';
import mongoose, { Types } from 'mongoose';
import { File } from '../models/file';
import { Project } from '../models/project';
import { Room, type RoomAttrs } from '../models/room';
import { Run } from '../models/run';
import { User } from '../models/user';
import { HttpError } from '../utils/http-error';
import { STARTER_FILES } from './starter-files';

type RoomDoc = mongoose.HydratedDocument<RoomAttrs>;

/** "My Cool Room!" → "my-cool-room-k3x9q2". The random suffix makes slugs unique and hard to guess. */
export function makeSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "café" → "cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(6)
    .toString('base64url')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 6);
  return base ? `${base}-${suffix}` : `room-${suffix}`;
}

const roleOf = (room: Pick<RoomAttrs, 'members'>, userId: string): RoomRole | null =>
  room.members.find((m) => m.userId.equals(userId))?.role ?? null;

function inviteMatches(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  // [CONCEPT: Constant-Time Comparison] Comparing secrets byte by byte with === leaks, through timing, how many
  // leading characters were right.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function usernamesById(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: ids } }, { username: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), u.username]));
}

function toSummary(room: RoomDoc, userId: string, names: Map<string, string>): RoomSummary {
  const ownerId = room.ownerId.toString();
  return {
    slug: room.slug,
    name: room.name,
    language: room.language,
    visibility: room.visibility,
    owner: { id: ownerId, username: names.get(ownerId) ?? 'deleted user' },
    memberCount: room.get('memberCount') as number,
    role: roleOf(room, userId),
    updatedAt: room.updatedAt.toISOString(),
  };
}

async function toDetail(room: RoomDoc, userId: string): Promise<RoomDetail> {
  const [names, files] = await Promise.all([
    usernamesById([room.ownerId, ...room.members.map((m) => m.userId)]),
    File.find({ projectId: room.projectId }, { path: 1 }).sort({ path: 1 }).lean(),
  ]);
  // Invite links grant edit access (even to public rooms), so only the owner may hand them out.
  const isOwner = room.ownerId.equals(userId);
  return {
    ...toSummary(room, userId, names),
    projectId: room.projectId.toString(),
    members: room.members.map((m) => ({
      id: m.userId.toString(),
      username: names.get(m.userId.toString()) ?? 'deleted user',
      role: m.role,
    })),
    files: files.map((f) => ({ id: f._id.toString(), path: f.path })),
    ...(isOwner ? { inviteCode: room.inviteCode } : {}),
  };
}

async function findRoom(slug: string): Promise<RoomDoc> {
  const room = await Room.findOne({ slug }).select('+inviteCode');
  if (!room) throw HttpError.notFound('Room not found');
  return room;
}

export async function createRoom(userId: string, input: CreateRoomInput): Promise<RoomDetail> {
  const ownerId = new Types.ObjectId(userId);
  const starter = STARTER_FILES[input.language];

  // [CONCEPT: Multi-Document Transaction] The project, its first file and the room are written all-or-nothing, so a
  // crash halfway can't leave a room pointing at a project that doesn't exist. Needs a replica set.
  const room = await mongoose.connection.transaction(async (session) => {
    const [project] = await Project.create(
      [{ ownerId, name: input.name, language: input.language }],
      { session },
    );
    await File.create([{ projectId: project!._id, ...starter }], { session });
    const [created] = await Room.create(
      [
        {
          slug: makeSlug(input.name),
          name: input.name,
          ownerId,
          projectId: project!._id,
          language: input.language,
          visibility: input.visibility,
          inviteCode: randomBytes(16).toString('base64url'),
          members: [{ userId: ownerId, role: 'owner' }],
        },
      ],
      { session },
    );
    return created!;
  });

  return toDetail(room, userId);
}

export async function listRooms(userId: string): Promise<RoomSummary[]> {
  // Uses the multikey index on members.userId; capped because the dashboard shows recent rooms only.
  const rooms = await Room.find({ 'members.userId': userId }).sort({ updatedAt: -1 }).limit(50);
  const names = await usernamesById(rooms.map((r) => r.ownerId));
  return rooms.map((room) => toSummary(room, userId, names));
}

export async function getRoom(userId: string, slug: string): Promise<RoomDetail> {
  const room = await findRoom(slug);
  if (!roleOf(room, userId) && room.visibility === 'private') {
    throw HttpError.forbidden('This room is private. Ask its owner for an invite link.');
  }
  return toDetail(room, userId);
}

export interface RoomAccess {
  roomId: string;
  slug: string;
  projectId: string;
  language: Language;
  role: RoomRole;
}

/**
 * The caller's role in a room, for anything that happens inside it (live files, runs, socket events).
 * Members only: someone browsing a public room joins first (as a viewer).
 */
export async function resolveRoomAccess(
  userId: string,
  room: { slug: string } | { id: Types.ObjectId | string },
  notMemberMessage = 'Join this room first',
): Promise<RoomAccess> {
  const found = await Room.findOne('slug' in room ? { slug: room.slug } : { _id: room.id })
    .select('slug projectId language members')
    .lean();
  if (!found) throw HttpError.notFound('Room not found');
  const role = roleOf(found, userId);
  if (!role) throw HttpError.forbidden(notMemberMessage);
  return {
    roomId: found._id.toString(),
    slug: found.slug,
    projectId: found.projectId.toString(),
    language: found.language,
    role,
  };
}

/** Who may open a file's live document, and how. */
export async function resolveFileAccess(
  userId: string,
  slug: string,
  fileId: string,
): Promise<RoomAccess> {
  const access = await resolveRoomAccess(userId, { slug }, 'Join this room to open its files');
  if (!Types.ObjectId.isValid(fileId)) throw HttpError.notFound('File not found');
  const file = await File.exists({ _id: fileId, projectId: access.projectId });
  if (!file) throw HttpError.notFound('File not found');
  return access;
}

/**
 * An invite link makes you an editor. Without one, anyone may join a public room as a viewer.
 * Joining twice is harmless (idempotent), and a valid invite upgrades an existing viewer.
 */
export async function joinRoom(
  userId: string,
  slug: string,
  inviteCode: string | undefined,
): Promise<RoomDetail> {
  const room = await findRoom(slug);
  const hasInvite = inviteMatches(room.inviteCode, inviteCode);
  if (!hasInvite && room.visibility === 'private') {
    throw HttpError.forbidden('This invite link is invalid or has been replaced.');
  }
  const role: RoomRole = hasInvite ? 'editor' : 'viewer';
  const current = roleOf(room, userId);

  if (current) {
    if (current === 'viewer' && role === 'editor') {
      // [CONCEPT: Positional $ Operator] Updates exactly the array element the filter matched.
      await Room.updateOne(
        { _id: room._id, 'members.userId': userId },
        { $set: { 'members.$.role': 'editor' } },
      );
    }
    return getRoom(userId, slug);
  }

  // [CONCEPT: Conditional Atomic Update] "Not already a member" and "not full" are checked in the same operation
  // as the $push, so two people grabbing the last seat at once can't push the room past its limit.
  const joined = await Room.findOneAndUpdate(
    {
      _id: room._id,
      'members.userId': { $ne: userId },
      [`members.${MAX_ROOM_MEMBERS - 1}`]: { $exists: false },
    },
    { $push: { members: { userId: new Types.ObjectId(userId), role, joinedAt: new Date() } } },
    { returnDocument: 'after' },
  ).select('+inviteCode');

  if (!joined) {
    // Either someone else filled the last seat, or this user joined in a parallel request.
    const latest = await findRoom(slug);
    if (roleOf(latest, userId)) return toDetail(latest, userId);
    throw HttpError.conflict(`This room is full (${MAX_ROOM_MEMBERS} members).`);
  }
  return toDetail(joined, userId);
}

export async function deleteRoom(userId: string, slug: string): Promise<void> {
  const room = await findRoom(slug);
  if (!room.ownerId.equals(userId)) throw HttpError.forbidden('Only the room owner can delete it');

  await mongoose.connection.transaction(async (session) => {
    await Room.deleteOne({ _id: room._id }, { session });
    await File.deleteMany({ projectId: room.projectId }, { session });
    await Project.deleteOne({ _id: room.projectId }, { session });
    // Without this a deleted room's runs would linger until their TTL. A run still in progress is fine: it finishes
    // in memory and its final save simply matches nothing.
    await Run.deleteMany({ roomId: room._id }, { session });
  });
}
