import { z } from 'zod';
import { LANGUAGE_IDS, type Language } from '../languages';

export const createRoomSchema = z.object({
  name: z.string().trim().min(3).max(60),
  visibility: z.enum(['public', 'private']).default('private'),
  language: z.enum(LANGUAGE_IDS as [Language, ...Language[]]).default('javascript'),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
