import { z } from 'zod';
import type { ChatMessage } from '../socket-events';

export const MAX_MESSAGE_LENGTH = 2000;
export const MESSAGES_PAGE_SIZE = 30;

const slug = z.string().trim().min(1).max(64);

/** A chat message as sent over the socket (chat:send). */
export const chatSendSchema = z.object({
  slug,
  body: z
    .string()
    .trim()
    .min(1, 'Write a message first')
    .max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`),
});

export const chatTypingSchema = z.object({ slug });

/** GET /api/v1/rooms/:slug/messages?before=<cursor>&limit=<n> */
export const listMessagesQuerySchema = z.object({
  // Opaque: whatever nextCursor said. The server checks its format.
  before: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(MESSAGES_PAGE_SIZE),
});

export type ChatSendInput = z.infer<typeof chatSendSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** One page of chat history, newest first. */
export interface MessagePage {
  messages: ChatMessage[];
  /** Pass as `before` to get the next (older) page; null when this is the oldest. */
  nextCursor: string | null;
}
