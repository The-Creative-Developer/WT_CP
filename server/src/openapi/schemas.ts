import {
  LANGUAGE_IDS,
  ROOM_ROLES,
  ROOM_VISIBILITIES,
  type AuthResponse,
  type ChatMessage,
  type FileSummary,
  type Language,
  type MessagePage,
  type PublicUser,
  type RoomDetail,
  type RoomSummary,
  type RunDto,
  type SelfUser,
} from '@devverse/shared';
import { z } from 'zod';

/**
 * What the API sends back, as Zod schemas. Request bodies are already Zod schemas in @devverse/shared (they validate
 * input); responses are plain TypeScript interfaces, so these exist to describe them in the OpenAPI document and to
 * check real responses in tests. Objects are strict: DTOs are built field by field, so an extra field is a bug.
 */

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/)
  .meta({ examples: ['6730c2f4e1b2a3c4d5e6f701'] });
const dateTime = z.iso.datetime({ offset: true }).meta({ examples: ['2026-11-15T09:30:00.000Z'] });
const language = z.enum(LANGUAGE_IDS as [Language, ...Language[]]);
const roomRole = z.enum(ROOM_ROLES);
const userRef = z.strictObject({ id: objectId, username: z.string().meta({ examples: ['ada'] }) });

export const publicUser = z.strictObject({
  id: objectId,
  username: z.string().meta({ examples: ['ada'] }),
  avatarUrl: z.string().optional(),
  bio: z.string().optional(),
});

export const selfUser = publicUser.extend({
  email: z.string().meta({ examples: ['ada@example.com'] }),
  stats: z.strictObject({ solved: z.int(), xp: z.int() }),
  createdAt: dateTime,
});

export const authResponse = z.strictObject({
  user: selfUser,
  accessToken: z.string().meta({ description: 'Send as `Authorization: Bearer <token>`.' }),
  expiresIn: z
    .int()
    .meta({ description: 'Seconds until the access token expires.', examples: [900] }),
});

export const fileSummary = z.strictObject({
  id: objectId,
  path: z.string().meta({ examples: ['src/main.py'] }),
});

export const roomSummary = z.strictObject({
  slug: z.string().meta({ examples: ['pair-programming-k3x9a'] }),
  name: z.string().meta({ examples: ['Pair Programming'] }),
  language,
  visibility: z.enum(ROOM_VISIBILITIES),
  owner: userRef,
  memberCount: z.int(),
  role: roomRole
    .nullable()
    .meta({ description: "Your role here, or null if you haven't joined (public rooms)." }),
  updatedAt: dateTime,
});

export const roomDetail = roomSummary.extend({
  projectId: objectId,
  members: z.array(userRef.extend({ role: roomRole })),
  files: z.array(fileSummary).meta({ description: 'Sorted by path.' }),
  inviteCode: z
    .string()
    .optional()
    .meta({ description: 'Only sent to the owner. Anyone who has it can join as an editor.' }),
});

export const chatMessage = z.strictObject({
  id: objectId,
  roomSlug: z.string(),
  author: userRef,
  body: z.string(),
  createdAt: dateTime,
});

export const messagePage = z.strictObject({
  messages: z.array(chatMessage).meta({ description: 'Newest first.' }),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `before` for the next, older page; null on the oldest page.' }),
});

export const run = z.strictObject({
  id: objectId,
  roomSlug: z.string(),
  fileId: objectId,
  language,
  status: z.enum(['queued', 'running', 'finished', 'failed']).meta({
    description:
      '`finished`: the program ran, whatever its verdict. `failed`: it could not be run.',
  }),
  by: userRef,
  stdout: z.string(),
  stderr: z.string(),
  verdict: z.enum(['ok', 'error', 'timeout', 'memory', 'output-limit']).nullable(),
  exitCode: z.int().nullable(),
  durationMs: z.int().nullable(),
  truncated: z.boolean().meta({ description: 'Some output was dropped for going over the limit.' }),
  error: z
    .string()
    .nullable()
    .meta({ description: "Why the run failed, when status is 'failed'." }),
  createdAt: dateTime,
});

// [CONCEPT: Problem Details (RFC 9457)] Every error has this shape, whichever endpoint sent it.
export const problem = z
  .strictObject({
    type: z.string().meta({ examples: ['about:blank'] }),
    title: z
      .string()
      .meta({ description: 'What went wrong, written for people.', examples: ['Room not found'] }),
    status: z.int().meta({ examples: [404] }),
    instance: z
      .string()
      .meta({ description: 'The path that was requested.', examples: ['/api/v1/rooms/nope'] }),
    requestId: z
      .string()
      .meta({ description: 'Also in the X-Request-Id header. Quote it in bug reports.' }),
    errors: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .meta({
        description:
          'Field-by-field problems, on validation errors (422) and some conflicts (409).',
        examples: [{ name: ['Room name must be at least 3 characters'] }],
      }),
  })
  .meta({ description: 'An RFC 9457 problem details object, sent as application/problem+json.' });

/** Everything that becomes a named entry under components.schemas, so it is shown once and referenced. */
export const responseSchemas = {
  PublicUser: publicUser,
  SelfUser: selfUser,
  AuthResponse: authResponse,
  FileSummary: fileSummary,
  RoomSummary: roomSummary,
  RoomDetail: roomDetail,
  ChatMessage: chatMessage,
  MessagePage: messagePage,
  Run: run,
  Problem: problem,
};

// Compile-time proof that each schema describes exactly the shared type the API returns: adding, removing or
// retyping a field on one side without the other fails `npm run typecheck`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type ResponseSchemaChecks = [
  Assert<Same<z.infer<typeof publicUser>, PublicUser>>,
  Assert<Same<z.infer<typeof selfUser>, SelfUser>>,
  Assert<Same<z.infer<typeof authResponse>, AuthResponse>>,
  Assert<Same<z.infer<typeof fileSummary>, FileSummary>>,
  Assert<Same<z.infer<typeof roomSummary>, RoomSummary>>,
  Assert<Same<z.infer<typeof roomDetail>, RoomDetail>>,
  Assert<Same<z.infer<typeof chatMessage>, ChatMessage>>,
  Assert<Same<z.infer<typeof messagePage>, MessagePage>>,
  Assert<Same<z.infer<typeof run>, RunDto>>,
];
