import {
  LANGUAGE_IDS,
  ROOM_ROLES,
  REVIEW_STATUSES,
  ROOM_VISIBILITIES,
  type AuthResponse,
  type ChatMessage,
  type FileSummary,
  type Language,
  type MessagePage,
  type PublicUser,
  type ReviewComment,
  type ReviewDetail,
  type ReviewSummary,
  type RoomDetail,
  type RoomSummary,
  type RunDto,
  type SelfUser,
  type SnapshotDetail,
  type SnapshotSummary,
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

export const snapshotSummary = z.strictObject({
  id: objectId,
  projectId: objectId,
  message: z.string().meta({ examples: ['Loop works now'] }),
  author: userRef,
  fileCount: z.int(),
  createdAt: dateTime,
});

export const snapshotDetail = snapshotSummary.extend({
  files: z
    .array(
      z.strictObject({
        path: z.string().meta({ examples: ['main.py'] }),
        content: z.string().meta({ examples: ['print("Hello")\n'] }),
      }),
    )
    .meta({ description: 'Sorted by path.' }),
});

export const reviewComment = z.strictObject({
  id: objectId,
  author: userRef,
  path: z.string().meta({ description: 'A file in the reviewed version.', examples: ['main.py'] }),
  line: z.int().meta({
    description: "1-based line in the reviewed version's copy of the file.",
    examples: [3],
  }),
  body: z.string().meta({ examples: ['Could this loop be a comprehension?'] }),
  parentId: objectId
    .nullable()
    .meta({ description: "The thread's first comment; null if this one starts the thread." }),
  resolved: z
    .boolean()
    .meta({ description: 'Set on the first comment of a thread, for the whole thread.' }),
  createdAt: dateTime,
  editedAt: dateTime.nullable(),
});

export const reviewSummary = z.strictObject({
  id: objectId,
  projectId: objectId,
  snapshot: snapshotSummary.meta({ description: 'The version under review.' }),
  base: snapshotSummary
    .nullable()
    .meta({ description: 'What it is compared with; null means an empty project.' }),
  requester: userRef,
  status: z.enum(REVIEW_STATUSES),
  openThreads: z.int().meta({ description: "Threads that aren't resolved yet." }),
  commentCount: z.int(),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const reviewDetail = reviewSummary.extend({
  comments: z.array(reviewComment).meta({ description: 'Oldest first.' }),
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
  SnapshotSummary: snapshotSummary,
  SnapshotDetail: snapshotDetail,
  ReviewComment: reviewComment,
  ReviewSummary: reviewSummary,
  ReviewDetail: reviewDetail,
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
  Assert<Same<z.infer<typeof snapshotSummary>, SnapshotSummary>>,
  Assert<Same<z.infer<typeof snapshotDetail>, SnapshotDetail>>,
  Assert<Same<z.infer<typeof reviewComment>, ReviewComment>>,
  Assert<Same<z.infer<typeof reviewSummary>, ReviewSummary>>,
  Assert<Same<z.infer<typeof reviewDetail>, ReviewDetail>>,
];
