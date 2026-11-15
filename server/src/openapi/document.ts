import {
  createCommentSchema,
  createFileSchema,
  createReviewSchema,
  createRoomSchema,
  createRunSchema,
  createSnapshotSchema,
  folderQuerySchema,
  joinRoomSchema,
  listMessagesQuerySchema,
  listReviewsQuerySchema,
  listRoomsQuerySchema,
  listRunsQuerySchema,
  loginSchema,
  moveFolderSchema,
  registerSchema,
  renameFileSchema,
  updateCommentSchema,
  updateMeSchema,
  updateReviewSchema,
} from '@devverse/shared';
import { z } from 'zod';
import { REFRESH_COOKIE } from '../controllers/auth';
import { responseSchemas } from './schemas';

/**
 * The OpenAPI 3.1 description of the REST API, served at /api/docs/openapi.json and saved as docs/openapi.yaml.
 *
 * [CONCEPT: OpenAPI] A machine-readable contract: Swagger UI renders it as interactive docs, and tools can generate
 * clients or check responses against it. It is built from the same Zod schemas that validate requests, so the
 * documented rules ("3 to 60 characters") are the enforced ones and can't drift apart.
 */

// Request bodies: the exact schemas the routes validate with.
export const requestSchemas = {
  RegisterInput: registerSchema,
  LoginInput: loginSchema,
  UpdateMeInput: updateMeSchema,
  CreateRoomInput: createRoomSchema,
  JoinRoomInput: joinRoomSchema,
  CreateFileInput: createFileSchema,
  RenameFileInput: renameFileSchema,
  MoveFolderInput: moveFolderSchema,
  CreateRunInput: createRunSchema,
  CreateSnapshotInput: createSnapshotSchema,
  CreateReviewInput: createReviewSchema,
  UpdateReviewInput: updateReviewSchema,
  CreateCommentInput: createCommentSchema,
  UpdateCommentInput: updateCommentSchema,
};

type SchemaName = keyof typeof responseSchemas | keyof typeof requestSchemas;
type JsonSchema = Record<string, unknown>;

/** Turns Zod schemas into JSON Schema (which OpenAPI 3.1 uses as is), referencing each other by name. */
function componentSchemas(): Record<string, JsonSchema> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries({ ...responseSchemas, ...requestSchemas })) {
    registry.add(schema, { id });
  }
  const { schemas } = z.toJSONSchema(registry, {
    // Describe what a client may send: fields with defaults are optional, and transforms (trimming) don't matter.
    io: 'input',
    // Refinements such as "UTF-8 size ≤ 64 KB" can't be expressed in JSON Schema; they're left out, not fatal.
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _, $id: __, ...schema }]) => [id, tidy(schema)]),
  );
}

/**
 * Drops what Zod adds for its own validation but only clutters the docs: the long regex next to
 * `format: date-time`, and the ±2^53 bounds on every integer.
 */
function tidy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(tidy) as T;
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).filter(
    ([key, v]) =>
      !(key === 'pattern' && (value as JsonSchema).format === 'date-time') &&
      !(
        (key === 'minimum' || key === 'maximum') &&
        Math.abs(v as number) === Number.MAX_SAFE_INTEGER
      ),
  );
  return Object.fromEntries(entries.map(([key, v]) => [key, tidy(v)])) as T;
}

const ref = (name: SchemaName) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: SchemaName) => ({ type: 'array', items: ref(name) });

type Header = keyof typeof headers;
type ErrorStatus = 401 | 403 | 404 | 409 | 422 | 429 | 503;

interface Success {
  description: string;
  schema?: JsonSchema;
  /** Defaults to application/json. */
  contentType?: string;
  headers?: Header[];
}

interface Operation {
  operationId: string;
  tag: Tag;
  summary: string;
  description?: string;
  /** Who may call it. Defaults to a signed-in user (Bearer token). */
  security?: 'bearer' | 'refreshCookie' | 'none';
  query?: z.ZodObject;
  body?: keyof typeof requestSchemas;
  /** A realistic body. Without one, Swagger UI invents values from the patterns, such as a gibberish email. */
  example?: Record<string, unknown>;
  responses: Record<number, Success>;
  errors?: ErrorStatus[];
}

const tags = {
  Meta: 'About the API itself.',
  Auth: 'Accounts and sessions. A session is a short-lived access token (sent as a Bearer header) plus a refresh token kept in an httpOnly cookie.',
  Users: 'Your own profile.',
  Rooms:
    'Collaborative coding rooms: create, find, join and delete them, and read their chat history.',
  Files:
    "A room's project files. Contents are edited live over the Yjs WebSocket, not through these endpoints.",
  Versions:
    'Snapshots: saved copies of a whole project, like commits, plus downloading the project as a ZIP.',
  Reviews:
    'Code review: a version compared with an earlier one, with comment threads on its lines. Editors ask for reviews; any member of the room can comment.',
  Runs: 'Running a file in a sandbox. Output streams to the room over Socket.IO; these endpoints start runs and are the polling fallback.',
} as const;
type Tag = keyof typeof tags;

const pathParams: Record<string, string> = {
  slug: "The room's slug, as in its URL (`/rooms/pair-programming-k3x9a`).",
  projectId: "The room's project id (`projectId` in the room details).",
  fileId: 'The file id.',
  id: 'The run id.',
  snapshotId: 'The version (snapshot) id.',
  reviewId: 'The review id.',
  commentId: 'The comment id.',
};

const headers = {
  Location: {
    description: 'Where the new resource can be found.',
    schema: { type: 'string' },
  },
  SetRefreshCookie: {
    description: `Sets the \`${REFRESH_COOKIE}\` refresh token: httpOnly, SameSite=Lax, Path=/api/v1/auth, Secure in production.`,
    schema: { type: 'string' },
  },
  ClearRefreshCookie: {
    description: `Clears the \`${REFRESH_COOKIE}\` cookie.`,
    schema: { type: 'string' },
  },
  CacheControlNoStore: {
    description: '`no-store`: tokens and live data must not be cached.',
    schema: { type: 'string' },
  },
  CacheControlImmutable: {
    description: '`private, max-age=31536000, immutable`: a saved version never changes.',
    schema: { type: 'string' },
  },
  ContentDisposition: {
    description: '`attachment; filename=<room-slug>.zip`: save the file rather than show it.',
    schema: { type: 'string' },
  },
  RetryAfter: {
    description: 'Seconds to wait before trying again.',
    schema: { type: 'integer' },
  },
  RateLimit: {
    description: 'Requests left in the current window (IETF RateLimit header, draft 8).',
    schema: { type: 'string' },
    example: '"default";r=0;t=42',
  },
  RateLimitPolicy: {
    description: 'The limit that applies (IETF RateLimit-Policy header, draft 8).',
    schema: { type: 'string' },
    example: '"default";q=300;w=60',
  },
  WWWAuthenticate: {
    description: 'Which authentication scheme to use, and why the token was rejected.',
    schema: { type: 'string' },
    example: 'Bearer error="invalid_token"',
  },
  XRequestId: {
    description: 'Identifies this request in the server logs. Sent with every response.',
    schema: { type: 'string' },
  },
};

const problemContent = { 'application/problem+json': { schema: ref('Problem') } };
const withHeaders = (names: Header[]) =>
  Object.fromEntries(
    [...names, 'XRequestId' as const].map((name) => [
      name === 'XRequestId' ? 'X-Request-Id' : headerName(name),
      { $ref: `#/components/headers/${name}` },
    ]),
  );

function headerName(name: Header): string {
  const names: Partial<Record<Header, string>> = {
    SetRefreshCookie: 'Set-Cookie',
    ClearRefreshCookie: 'Set-Cookie',
    CacheControlNoStore: 'Cache-Control',
    CacheControlImmutable: 'Cache-Control',
    ContentDisposition: 'Content-Disposition',
    RetryAfter: 'Retry-After',
    RateLimitPolicy: 'RateLimit-Policy',
    WWWAuthenticate: 'WWW-Authenticate',
  };
  return names[name] ?? name;
}

const errorResponses: Record<ErrorStatus, [string, string, Header[]]> = {
  401: [
    'Unauthorized',
    'Not signed in, or the access token is invalid or expired.',
    ['WWWAuthenticate'],
  ],
  403: ['Forbidden', 'Signed in, but not allowed to do this.', []],
  404: ['NotFound', 'No such resource (or route).', []],
  409: ['Conflict', 'Clashes with the current state, such as a name that is already taken.', []],
  422: [
    'ValidationFailed',
    'The request was understood but its values are invalid. `errors` lists them by field.',
    [],
  ],
  429: [
    'TooManyRequests',
    'Rate limited. Wait for `Retry-After` seconds.',
    ['RetryAfter', 'RateLimit', 'RateLimitPolicy'],
  ],
  503: [
    'ServiceUnavailable',
    'Temporarily overloaded. Try again after `Retry-After` seconds.',
    ['RetryAfter'],
  ],
};

/** Every endpoint, keyed by path then method. Paths are relative to the server URL, /api/v1. */
const operations: Record<
  string,
  Partial<Record<'get' | 'post' | 'patch' | 'delete', Operation>>
> = {
  '/': {
    get: {
      operationId: 'getApiInfo',
      tag: 'Meta',
      summary: 'Name and version of the API',
      security: 'none',
      responses: {
        200: {
          description: 'The API is up.',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, version: { type: 'string', examples: ['v1'] } },
            required: ['name', 'version'],
          },
        },
      },
    },
  },
  '/auth/register': {
    post: {
      operationId: 'register',
      tag: 'Auth',
      summary: 'Create an account and sign in',
      security: 'none',
      body: 'RegisterInput',
      example: { username: 'ada', email: 'ada@example.com', password: 'correct horse battery' },
      responses: {
        201: {
          description: 'Account created. You are signed in.',
          schema: ref('AuthResponse'),
          headers: ['Location', 'SetRefreshCookie', 'CacheControlNoStore'],
        },
      },
      errors: [403, 409, 422, 429],
    },
  },
  '/auth/login': {
    post: {
      operationId: 'login',
      tag: 'Auth',
      summary: 'Sign in with email and password',
      description:
        'Only failed attempts count towards the limit of 10 per 15 minutes per IP address.',
      security: 'none',
      body: 'LoginInput',
      example: { email: 'ada@example.com', password: 'correct horse battery' },
      responses: {
        200: {
          description: 'Signed in.',
          schema: ref('AuthResponse'),
          headers: ['SetRefreshCookie', 'CacheControlNoStore'],
        },
      },
      errors: [401, 403, 422, 429],
    },
  },
  '/auth/refresh': {
    post: {
      operationId: 'refreshSession',
      tag: 'Auth',
      summary: 'Get a new access token',
      description:
        'Uses the refresh cookie, and replaces it with a new one (refresh token rotation). Presenting a refresh token that was already used ends that session everywhere, because it means the token was copied.',
      security: 'refreshCookie',
      responses: {
        200: {
          description: 'A fresh session.',
          schema: ref('AuthResponse'),
          headers: ['SetRefreshCookie', 'CacheControlNoStore'],
        },
      },
      errors: [401, 403],
    },
  },
  '/auth/logout': {
    post: {
      operationId: 'logout',
      tag: 'Auth',
      summary: 'Sign out',
      description: 'Ends the session the refresh cookie belongs to. Succeeds even without one.',
      security: 'refreshCookie',
      responses: { 204: { description: 'Signed out.', headers: ['ClearRefreshCookie'] } },
      errors: [403],
    },
  },
  '/users/me': {
    get: {
      operationId: 'getMe',
      tag: 'Users',
      summary: 'Your profile',
      responses: {
        200: { description: 'Your profile, including private fields.', schema: ref('SelfUser') },
      },
      errors: [401],
    },
    patch: {
      operationId: 'updateMe',
      tag: 'Users',
      summary: 'Change your profile',
      description: 'Send only the fields to change. An empty `avatarUrl` removes the avatar.',
      body: 'UpdateMeInput',
      example: { bio: 'Learning Rust, one borrow checker error at a time.' },
      responses: { 200: { description: 'The updated profile.', schema: ref('SelfUser') } },
      errors: [401, 422],
    },
  },
  '/rooms': {
    get: {
      operationId: 'listRooms',
      tag: 'Rooms',
      summary: 'Rooms you are a member of',
      description: 'Newest activity first. Every filter is optional; blank means "any".',
      query: listRoomsQuerySchema,
      responses: { 200: { description: 'Matching rooms.', schema: arrayOf('RoomSummary') } },
      errors: [401, 422],
    },
    post: {
      operationId: 'createRoom',
      tag: 'Rooms',
      summary: 'Create a room',
      description:
        'You become its owner. The room gets a project with one starter file in its language.',
      body: 'CreateRoomInput',
      example: { name: 'Pair Programming', language: 'python', visibility: 'private' },
      responses: {
        201: { description: 'The new room.', schema: ref('RoomDetail'), headers: ['Location'] },
      },
      errors: [401, 422],
    },
  },
  '/rooms/{slug}': {
    get: {
      operationId: 'getRoom',
      tag: 'Rooms',
      summary: 'One room',
      description:
        'Members can see any room they belong to; anyone signed in can see a public room.',
      responses: { 200: { description: 'The room.', schema: ref('RoomDetail') } },
      errors: [401, 403, 404],
    },
    delete: {
      operationId: 'deleteRoom',
      tag: 'Rooms',
      summary: 'Delete a room',
      description: 'Owner only. Deletes its project, files, chat and runs too.',
      responses: { 204: { description: 'Deleted.' } },
      errors: [401, 403, 404],
    },
  },
  '/rooms/{slug}/join': {
    post: {
      operationId: 'joinRoom',
      tag: 'Rooms',
      summary: 'Join a room',
      description:
        'With a valid invite code you join as an editor. Without one you can only join a public room, as a viewer. Joining again is harmless, and an invite code upgrades a viewer to editor.',
      body: 'JoinRoomInput',
      example: { inviteCode: 'q3Vb9xT1mN0aLk8sRw2YpA' },
      responses: { 200: { description: 'You are a member.', schema: ref('RoomDetail') } },
      errors: [401, 403, 404, 409, 422],
    },
  },
  '/rooms/{slug}/messages': {
    get: {
      operationId: 'listMessages',
      tag: 'Rooms',
      summary: 'Chat history',
      description:
        'One page of messages, newest first. To go further back, pass the `nextCursor` you got as `before`. New messages arrive over Socket.IO (`chat:new`).',
      query: listMessagesQuerySchema,
      responses: {
        200: {
          description: 'A page of messages.',
          schema: ref('MessagePage'),
          headers: ['CacheControlNoStore'],
        },
      },
      errors: [401, 403, 404, 422],
    },
  },
  '/projects/{projectId}/files': {
    get: {
      operationId: 'listFiles',
      tag: 'Files',
      summary: 'Files in a project',
      responses: { 200: { description: 'Sorted by path.', schema: arrayOf('FileSummary') } },
      errors: [401, 403, 404],
    },
    post: {
      operationId: 'createFile',
      tag: 'Files',
      summary: 'Create an empty file',
      description:
        'Editors and owners only. Folders in the path are created implicitly. At most 100 files per project.',
      body: 'CreateFileInput',
      example: { path: 'src/utils.py' },
      responses: {
        201: { description: 'The new file.', schema: ref('FileSummary'), headers: ['Location'] },
      },
      errors: [401, 403, 404, 409, 422],
    },
  },
  '/projects/{projectId}/files/{fileId}': {
    patch: {
      operationId: 'renameFile',
      tag: 'Files',
      summary: 'Rename or move a file',
      description: 'Editors and owners only.',
      body: 'RenameFileInput',
      example: { path: 'src/helpers.py' },
      responses: { 200: { description: 'The file at its new path.', schema: ref('FileSummary') } },
      errors: [401, 403, 404, 409, 422],
    },
    delete: {
      operationId: 'deleteFile',
      tag: 'Files',
      summary: 'Delete a file',
      description: 'Editors and owners only.',
      responses: { 204: { description: 'Deleted.' } },
      errors: [401, 403, 404],
    },
  },
  '/projects/{projectId}/folders': {
    patch: {
      operationId: 'moveFolder',
      tag: 'Files',
      summary: 'Rename or move a folder',
      description: 'Moves every file inside it, all or nothing. Editors and owners only.',
      body: 'MoveFolderInput',
      example: { from: 'src', to: 'lib' },
      responses: {
        200: { description: "The project's files afterwards.", schema: arrayOf('FileSummary') },
      },
      errors: [401, 403, 404, 409, 422],
    },
    delete: {
      operationId: 'deleteFolder',
      tag: 'Files',
      summary: 'Delete a folder and everything in it',
      description: 'Editors and owners only.',
      query: folderQuerySchema,
      responses: { 204: { description: 'Deleted.' } },
      errors: [401, 403, 404, 422],
    },
  },
  '/projects/{projectId}/snapshots': {
    get: {
      operationId: 'listSnapshots',
      tag: 'Versions',
      summary: "A project's saved versions",
      description: 'Newest first, at most 100, without the files.',
      responses: { 200: { description: 'The versions.', schema: arrayOf('SnapshotSummary') } },
      errors: [401, 403, 404],
    },
    post: {
      operationId: 'createSnapshot',
      tag: 'Versions',
      summary: 'Save a version',
      description:
        "Copies every file as the room sees it right now, including edits that haven't been autosaved yet. Editors and owners only; at most 8 MB of files, and 10 versions a minute per account.",
      body: 'CreateSnapshotInput',
      example: { message: 'Loop works now' },
      responses: {
        201: {
          description: 'The new version, with its files.',
          schema: ref('SnapshotDetail'),
          headers: ['Location'],
        },
      },
      errors: [401, 403, 404, 409, 422, 429],
    },
  },
  '/projects/{projectId}/snapshots/{snapshotId}': {
    get: {
      operationId: 'getSnapshot',
      tag: 'Versions',
      summary: 'One version, with its files',
      responses: {
        200: {
          description: 'The version.',
          schema: ref('SnapshotDetail'),
          headers: ['CacheControlImmutable'],
        },
      },
      errors: [401, 403, 404],
    },
  },
  '/projects/{projectId}/export.zip': {
    get: {
      operationId: 'exportProject',
      tag: 'Versions',
      summary: 'Download the project as a ZIP',
      description:
        'The current files, inside a folder named after the room. The body is streamed (chunked), so there is no Content-Length.',
      responses: {
        200: {
          description: 'The ZIP file.',
          contentType: 'application/zip',
          schema: { type: 'string', contentMediaType: 'application/zip' },
          headers: ['ContentDisposition', 'CacheControlNoStore'],
        },
      },
      errors: [401, 403, 404],
    },
  },
  '/reviews': {
    post: {
      operationId: 'createReview',
      tag: 'Reviews',
      summary: 'Ask for a review of a version',
      description:
        'Compares the version with `baseSnapshotId`: by default the version saved just before it, or nothing (`null`). Editors and owners only.',
      body: 'CreateReviewInput',
      example: { snapshotId: '6730c2f4e1b2a3c4d5e6f701' },
      responses: {
        201: {
          description: 'The new review.',
          schema: ref('ReviewDetail'),
          headers: ['Location'],
        },
      },
      errors: [401, 403, 404, 422],
    },
    get: {
      operationId: 'listReviews',
      tag: 'Reviews',
      summary: "A project's reviews",
      description: 'Newest first, at most 50, without the comments.',
      query: listReviewsQuerySchema,
      responses: {
        200: {
          description: 'The reviews.',
          schema: arrayOf('ReviewSummary'),
          headers: ['CacheControlNoStore'],
        },
      },
      errors: [401, 403, 404, 422],
    },
  },
  '/reviews/{reviewId}': {
    get: {
      operationId: 'getReview',
      tag: 'Reviews',
      summary: 'One review, with every comment',
      responses: {
        200: {
          description: 'The review.',
          schema: ref('ReviewDetail'),
          headers: ['CacheControlNoStore'],
        },
      },
      errors: [401, 403, 404],
    },
    patch: {
      operationId: 'updateReview',
      tag: 'Reviews',
      summary: 'Close or reopen a review',
      description:
        'Whoever asked for the review, or the room owner. A closed review is read-only: no new comments, edits or resolving.',
      body: 'UpdateReviewInput',
      example: { status: 'closed' },
      responses: { 200: { description: 'The review.', schema: ref('ReviewDetail') } },
      errors: [401, 403, 404, 422],
    },
  },
  '/reviews/{reviewId}/comments': {
    post: {
      operationId: 'addComment',
      tag: 'Reviews',
      summary: 'Comment on a line, or reply to a thread',
      description:
        'A new thread needs `path` and `line` (a line of that file in the reviewed version); a reply needs `parentId` instead. Any member of the room, viewers included. At most 500 comments per review.',
      body: 'CreateCommentInput',
      example: { path: 'main.py', line: 3, body: 'Could this loop be a comprehension?' },
      responses: {
        201: {
          description: 'The new comment.',
          schema: ref('ReviewComment'),
          headers: ['Location'],
        },
      },
      errors: [401, 403, 404, 409, 422],
    },
  },
  '/reviews/{reviewId}/comments/{commentId}': {
    patch: {
      operationId: 'updateComment',
      tag: 'Reviews',
      summary: 'Edit a comment, or resolve its thread',
      description:
        "Only the author can change `body`. `resolved` goes on a thread's first comment and can be set by editors, whoever asked for the review, or whoever started the thread.",
      body: 'UpdateCommentInput',
      example: { resolved: true },
      responses: { 200: { description: 'The comment.', schema: ref('ReviewComment') } },
      errors: [401, 403, 404, 409, 422],
    },
  },
  '/runs': {
    post: {
      operationId: 'startRun',
      tag: 'Runs',
      summary: 'Run a file',
      description:
        'Runs the file as the room currently sees it in the shared editor, so there is no `code` field. Editors and owners only; one run at a time per person, and a few runs a minute.',
      body: 'CreateRunInput',
      example: {
        roomSlug: 'pair-programming-k3x9a',
        fileId: '6730c2f4e1b2a3c4d5e6f701',
        stdin: '',
      },
      responses: {
        202: {
          description:
            'Queued. Follow it over Socket.IO (`run:output`, `run:finished`) or poll the `Location`.',
          schema: ref('Run'),
          headers: ['Location'],
        },
      },
      errors: [401, 403, 404, 422, 429, 503],
    },
    get: {
      operationId: 'listRuns',
      tag: 'Runs',
      summary: "A room's recent runs",
      description: 'Newest first.',
      query: listRunsQuerySchema,
      responses: {
        200: {
          description: 'Recent runs.',
          schema: arrayOf('Run'),
          headers: ['CacheControlNoStore'],
        },
      },
      errors: [401, 403, 404, 422],
    },
  },
  '/runs/{id}': {
    get: {
      operationId: 'getRun',
      tag: 'Runs',
      summary: 'One run',
      description:
        'The fallback while the socket is down: ask about once a second until `status` is `finished` or `failed`.',
      responses: {
        200: {
          description: 'The run so far.',
          schema: ref('Run'),
          headers: ['CacheControlNoStore'],
        },
      },
      errors: [401, 404],
    },
  },
};

/** Query-string schema → OpenAPI parameters, one per field. */
function queryParameters(schema: z.ZodObject) {
  const json = tidy(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, { description, ...rest }]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    ...(description ? { description } : {}),
    schema: rest,
  }));
}

function buildOperation(path: string, op: Operation) {
  const parameters = [
    ...[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      description: pathParams[name!],
      schema: { type: 'string' },
    })),
    ...(op.query ? queryParameters(op.query) : []),
  ];

  const security = op.security ?? 'bearer';
  // Anything behind the Bearer check can answer 401, so that one is implied.
  const errors = [
    ...new Set<ErrorStatus>([
      ...(op.errors ?? []),
      ...(security === 'bearer' ? [401 as const] : []),
    ]),
  ].sort((a, b) => a - b);

  return {
    operationId: op.operationId,
    tags: [op.tag],
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    // The document-wide default is Bearer; only differences are spelled out.
    ...(security === 'none' ? { security: [] } : {}),
    ...(security === 'refreshCookie' ? { security: [{ refreshCookie: [] }] } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(op.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref(op.body), example: op.example } },
          },
        }
      : {}),
    responses: {
      ...Object.fromEntries(
        Object.entries(op.responses).map(
          ([status, { description, schema, contentType, headers: names = [] }]) => [
            status,
            {
              description,
              headers: withHeaders(names),
              ...(schema ? { content: { [contentType ?? 'application/json']: { schema } } } : {}),
            },
          ],
        ),
      ),
      ...Object.fromEntries(
        errors.map((status) => [
          status,
          { $ref: `#/components/responses/${errorResponses[status][0]}` },
        ]),
      ),
    },
  };
}

export function buildOpenApiDocument() {
  const paths: Record<string, unknown> = Object.fromEntries(
    Object.entries(operations).map(([path, methods]) => [
      path,
      Object.fromEntries(
        Object.entries(methods).map(([method, op]) => [method, buildOperation(path, op)]),
      ),
    ]),
  );

  // The health check lives outside /api/v1, because load balancers and Docker probe it directly.
  paths['/healthz'] = {
    servers: [{ url: '/' }],
    get: {
      operationId: 'getHealth',
      tags: ['Meta'],
      summary: 'Health check',
      security: [],
      responses: Object.fromEntries(
        [
          [200, 'Up, and connected to the database.'],
          [503, 'Up, but the database is unreachable.'],
        ].map(([status, description]) => [
          status,
          {
            description,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok', 'degraded'] },
                    db: { type: 'string', enum: ['connected', 'disconnected'] },
                    uptimeSeconds: { type: 'integer' },
                  },
                  required: ['status', 'db', 'uptimeSeconds'],
                },
              },
            },
          },
        ]),
      ),
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'DevVerse API',
      version: '1.0.0',
      description: [
        'The REST API behind DevVerse, a real-time collaborative coding platform.',
        '',
        '**Authentication.** Call `POST /auth/login` (or `/auth/register`), then send the `accessToken` as `Authorization: Bearer <token>`. In this page, use **Authorize** and paste the token. Access tokens last 15 minutes; `POST /auth/refresh` swaps the refresh cookie for a new one.',
        '',
        '**Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` objects. `title` says what went wrong; on a 422, `errors` lists the problems by field.',
        '',
        '**Rate limits.** 300 requests a minute per IP address across the API, with tighter limits on sign-in attempts and code runs. A 429 comes with `Retry-After` and `RateLimit` headers.',
        '',
        "**Real time.** Live features don't use REST: chat, presence and run output go over Socket.IO, and the shared editor syncs over a Yjs WebSocket at `/yjs/<roomSlug>/<fileId>`. See `docs/api.md` in the repository.",
      ].join('\n'),
    },
    servers: [{ url: '/api/v1', description: 'This server' }],
    tags: Object.entries(tags).map(([name, description]) => ({ name, description })),
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The `accessToken` from login, register or refresh.',
        },
        refreshCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: REFRESH_COOKIE,
          description:
            "Set by login and register. Browsers send it automatically; scripts can't read it (httpOnly).",
        },
      },
      schemas: componentSchemas(),
      headers,
      responses: Object.fromEntries(
        Object.values(errorResponses).map(([name, description, names]) => [
          name,
          { description, headers: withHeaders(names), content: problemContent },
        ]),
      ),
    },
  };
}
