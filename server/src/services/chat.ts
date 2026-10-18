import type { ChatMessage, ListMessagesQuery, MessagePage } from '@devverse/shared';
import { Types } from 'mongoose';
import { Message, type MessageAttrs } from '../models/message';
import { HttpError } from '../utils/http-error';
import type { AuthUser } from './auth';
import { resolveRoomAccess, usernamesById } from './rooms';

/**
 * [CONCEPT: Cursor Pagination] A page is found by "older than this message" rather than "skip the first N".
 * skip has to walk past every skipped document (slow on page 50), and shifts when new messages arrive, so the next
 * page would repeat or miss messages. The cursor is (createdAt, _id): _id breaks ties between messages created in the
 * same millisecond. It is base64url-encoded so clients treat it as opaque.
 */
export function encodeCursor(message: Pick<MessageAttrs, 'createdAt'> & { _id: Types.ObjectId }) {
  return Buffer.from(`${message.createdAt.toISOString()}|${message._id.toString()}`).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): { createdAt: Date; id: Types.ObjectId } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || !Types.ObjectId.isValid(id) || Number.isNaN(createdAt.getTime())) {
    throw new HttpError(422, 'Invalid cursor', { before: ['Not a cursor this API returned'] });
  }
  return { createdAt, id: new Types.ObjectId(id) };
}

function toDto(
  message: MessageAttrs & { _id: Types.ObjectId },
  roomSlug: string,
  username: string,
): ChatMessage {
  return {
    id: message._id.toString(),
    roomSlug,
    author: { id: message.authorId.toString(), username },
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

/** Saves a message from a member of the room (any role: viewers can't edit code, but they can talk). */
export async function postMessage(
  user: AuthUser,
  slug: string,
  body: string,
): Promise<ChatMessage> {
  const access = await resolveRoomAccess(user.id, { slug });
  const message = await Message.create({ roomId: access.roomId, authorId: user.id, body });
  return toDto(message.toObject(), access.slug, user.username);
}

export async function listMessages(
  user: AuthUser,
  slug: string,
  { before, limit }: ListMessagesQuery,
): Promise<MessagePage> {
  const access = await resolveRoomAccess(user.id, { slug });
  const filter: Record<string, unknown> = { roomId: access.roomId };
  if (before) {
    const { createdAt, id } = decodeCursor(before);
    filter.$or = [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }];
  }
  // One extra tells us whether an older page exists, without a separate count.
  const found = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = found.slice(0, limit);
  const names = await usernamesById(page.map((m) => m.authorId));
  return {
    messages: page.map((m) =>
      toDto(m, access.slug, names.get(m.authorId.toString()) ?? 'deleted user'),
    ),
    nextCursor: found.length > limit ? encodeCursor(page.at(-1)!) : null,
  };
}
