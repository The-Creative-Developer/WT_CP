import { z } from 'zod';

export const MAX_SNAPSHOT_MESSAGE_LENGTH = 120;
/** Total size of the files in one snapshot. A snapshot is one MongoDB document, which can't exceed 16 MB. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SNAPSHOTS_LISTED = 100;
export const MAX_COMMENT_LENGTH = 2000;
/** Comments are embedded in their review, so the review document stays bounded. */
export const MAX_COMMENTS_PER_REVIEW = 500;
export const MAX_REVIEWS_LISTED = 50;

export const REVIEW_STATUSES = ['open', 'closed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const objectId = (what: string) => z.string().regex(/^[a-f\d]{24}$/i, `Not a valid ${what} id`);

/** POST /api/v1/projects/:projectId/snapshots */
export const createSnapshotSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Describe this version')
    .max(
      MAX_SNAPSHOT_MESSAGE_LENGTH,
      `Descriptions can be at most ${MAX_SNAPSHOT_MESSAGE_LENGTH} characters`,
    ),
});

/** POST /api/v1/reviews */
export const createReviewSchema = z.object({
  snapshotId: objectId('snapshot'),
  /**
   * The version to compare against. Leave it out to compare with the snapshot taken just before; null compares
   * with an empty project, so every line shows as added.
   */
  baseSnapshotId: objectId('snapshot').nullable().optional(),
});

/** GET /api/v1/reviews?projectId=<id> */
export const listReviewsQuerySchema = z.object({
  projectId: objectId('project'),
  status: z.enum(REVIEW_STATUSES).optional(),
});

/** PATCH /api/v1/reviews/:id */
export const updateReviewSchema = z.object({ status: z.enum(REVIEW_STATUSES) });

const commentBody = z
  .string()
  .trim()
  .min(1, 'Write a comment first')
  .max(MAX_COMMENT_LENGTH, `Comments can be at most ${MAX_COMMENT_LENGTH} characters`);

/**
 * POST /api/v1/reviews/:id/comments. A new thread is anchored to a line of a file in the reviewed snapshot; a reply
 * names its thread with `parentId` and shares the thread's place.
 */
export const createCommentSchema = z
  .object({
    body: commentBody,
    path: z.string().trim().min(1).max(200).optional(),
    line: z.int().min(1).optional(),
    parentId: objectId('comment').optional(),
  })
  .refine((c) => (c.parentId ? c.path === undefined && c.line === undefined : true), {
    message: 'A reply goes in its thread; leave out path and line',
    path: ['parentId'],
  })
  .refine((c) => c.parentId || (c.path !== undefined && c.line !== undefined), {
    message: 'Say which file and line the comment is about',
    path: ['line'],
  });

/** PATCH /api/v1/reviews/:id/comments/:commentId */
export const updateCommentSchema = z
  .object({ body: commentBody.optional(), resolved: z.boolean().optional() })
  .refine((c) => c.body !== undefined || c.resolved !== undefined, {
    message: 'Change the text or the resolved state',
    path: ['body'],
  });

export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

type UserRef = { id: string; username: string };

/** A saved version of a project, without its files. */
export interface SnapshotSummary {
  id: string;
  projectId: string;
  message: string;
  author: UserRef;
  fileCount: number;
  createdAt: string;
}

export interface SnapshotFile {
  path: string;
  content: string;
}

export interface SnapshotDetail extends SnapshotSummary {
  /** Sorted by path. */
  files: SnapshotFile[];
}

export interface ReviewComment {
  id: string;
  author: UserRef;
  /** A file in the reviewed snapshot. Replies repeat their thread's path and line. */
  path: string;
  /** 1-based line in the reviewed snapshot's version of the file. */
  line: number;
  body: string;
  /** The thread's first comment, or null if this comment starts a thread. */
  parentId: string | null;
  /** Only meaningful on the first comment of a thread: the whole thread is resolved or not. */
  resolved: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface ReviewSummary {
  id: string;
  projectId: string;
  snapshot: SnapshotSummary;
  /** What the snapshot is compared with; null means an empty project. */
  base: SnapshotSummary | null;
  requester: UserRef;
  status: ReviewStatus;
  /** Threads that aren't resolved yet. */
  openThreads: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDetail extends ReviewSummary {
  /** Oldest first. */
  comments: ReviewComment[];
}
