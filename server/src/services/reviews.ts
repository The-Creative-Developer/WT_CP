import {
  hasRoomRole,
  MAX_COMMENTS_PER_REVIEW,
  MAX_REVIEWS_LISTED,
  type CreateCommentInput,
  type CreateReviewInput,
  type ListReviewsQuery,
  type ReviewComment,
  type ReviewDetail,
  type ReviewStatus,
  type ReviewSummary,
  type UpdateCommentInput,
} from '@devverse/shared';
import { Types } from 'mongoose';
import { Review, type CommentAttrs, type ReviewAttrs } from '../models/review';
import { Snapshot } from '../models/snapshot';
import { HttpError } from '../utils/http-error';
import type { AuthUser } from './auth';
import { resolveProjectAccess } from './files';
import type { RoomAccess } from './rooms';
import { usernamesById } from './rooms';
import { previousSnapshotId, snapshotSummaries } from './snapshots';

type ReviewRow = ReviewAttrs & { _id: Types.ObjectId };
type CommentRow = Pick<CommentAttrs, 'parentId' | 'resolved'> & Partial<CommentAttrs>;

const invalid = (field: string, message: string) =>
  new HttpError(422, 'Validation failed', { [field]: [message] });

function toComment(c: CommentAttrs, names: Map<string, string>): ReviewComment {
  const authorId = c.authorId.toString();
  return {
    id: c._id.toString(),
    author: { id: authorId, username: names.get(authorId) ?? 'deleted user' },
    path: c.path,
    line: c.line,
    body: c.body,
    parentId: c.parentId?.toString() ?? null,
    resolved: c.resolved,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt?.toISOString() ?? null,
  };
}

/** Builds summaries for several reviews with two extra queries in total, however many there are. */
async function toSummaries(
  reviews: (Omit<ReviewRow, 'comments'> & { comments: CommentRow[] })[],
): Promise<ReviewSummary[]> {
  const [snapshots, names] = await Promise.all([
    snapshotSummaries(
      reviews.flatMap((r) =>
        r.baseSnapshotId ? [r.snapshotId, r.baseSnapshotId] : [r.snapshotId],
      ),
    ),
    usernamesById(reviews.map((r) => r.requesterId)),
  ]);
  return reviews.map((r) => {
    const snapshot = snapshots.get(r.snapshotId.toString());
    // Snapshots are never deleted on their own (only with their room, which takes its reviews too).
    if (!snapshot) throw new Error(`Review ${r._id.toString()} lost its snapshot`);
    const requesterId = r.requesterId.toString();
    return {
      id: r._id.toString(),
      projectId: r.projectId.toString(),
      snapshot,
      base: r.baseSnapshotId ? (snapshots.get(r.baseSnapshotId.toString()) ?? null) : null,
      requester: { id: requesterId, username: names.get(requesterId) ?? 'deleted user' },
      status: r.status,
      openThreads: r.comments.filter((c) => c.parentId === null && !c.resolved).length,
      commentCount: r.comments.length,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

async function toDetail(review: ReviewRow): Promise<ReviewDetail> {
  const [[summary], names] = await Promise.all([
    toSummaries([review]),
    usernamesById(review.comments.map((c) => c.authorId)),
  ]);
  return { ...summary!, comments: review.comments.map((c) => toComment(c, names)) };
}

/** A review the user may see (any member of the room), with their access to its room. */
async function findReview(user: AuthUser, reviewId: string) {
  if (!Types.ObjectId.isValid(reviewId)) throw HttpError.notFound('Review not found');
  const review = await Review.findById(reviewId).lean<ReviewRow>();
  if (!review) throw HttpError.notFound('Review not found');
  const access = await resolveProjectAccess(user, review.projectId.toString(), false);
  return { review, access };
}

function assertOpen(review: ReviewRow) {
  if (review.status === 'closed') {
    throw HttpError.conflict('This review is closed. Reopen it to change it.');
  }
}

/** Asks the room to review a snapshot, compared with an earlier one (by default, the one just before it). */
export async function createReview(
  user: AuthUser,
  { snapshotId, baseSnapshotId }: CreateReviewInput,
): Promise<ReviewDetail> {
  const snapshot = await Snapshot.findById(snapshotId, { projectId: 1, createdAt: 1 }).lean();
  if (!snapshot) throw HttpError.notFound('Version not found');
  const access = await resolveProjectAccess(
    user,
    snapshot.projectId.toString(),
    true,
    'Viewers can comment on reviews but not request them',
  );

  let base: Types.ObjectId | null;
  if (baseSnapshotId === undefined) {
    base = await previousSnapshotId(snapshot);
  } else if (baseSnapshotId === null) {
    base = null;
  } else {
    if (baseSnapshotId === snapshotId) {
      throw invalid('baseSnapshotId', 'Compare with a different version');
    }
    const found = await Snapshot.exists({ _id: baseSnapshotId, projectId: access.projectId });
    if (!found) throw invalid('baseSnapshotId', 'Not a version of this project');
    base = found._id;
  }

  const review = await Review.create({
    projectId: access.projectId,
    snapshotId: snapshot._id,
    baseSnapshotId: base,
    requesterId: user.id,
  });
  return toDetail(review.toObject());
}

/** A project's reviews, newest first. */
export async function listReviews(
  user: AuthUser,
  { projectId, status }: ListReviewsQuery,
): Promise<ReviewSummary[]> {
  const access = await resolveProjectAccess(user, projectId, false);
  const reviews = await Review.find(
    { projectId: access.projectId, ...(status ? { status } : {}) },
    // Only what the counts need, not the comments' text.
    {
      comments: { parentId: 1, resolved: 1 },
      projectId: 1,
      snapshotId: 1,
      baseSnapshotId: 1,
      requesterId: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  )
    .sort({ createdAt: -1 })
    .limit(MAX_REVIEWS_LISTED)
    .lean<(Omit<ReviewRow, 'comments'> & { comments: CommentRow[] })[]>();
  return toSummaries(reviews);
}

export async function getReview(user: AuthUser, reviewId: string): Promise<ReviewDetail> {
  return toDetail((await findReview(user, reviewId)).review);
}

/** Closing or reopening is up to whoever asked for the review, or the room's owner. */
export async function updateReview(
  user: AuthUser,
  reviewId: string,
  status: ReviewStatus,
): Promise<ReviewDetail> {
  const { review, access } = await findReview(user, reviewId);
  if (!review.requesterId.equals(user.id) && access.role !== 'owner') {
    throw HttpError.forbidden('Only whoever asked for the review, or the room owner, can close it');
  }
  // [CONCEPT: Idempotency] Closing a closed review changes nothing and still succeeds.
  if (review.status === status) return toDetail(review);
  const updated = await Review.findByIdAndUpdate(
    review._id,
    { $set: { status } },
    { returnDocument: 'after' },
  ).lean<ReviewRow>();
  if (!updated) throw HttpError.notFound('Review not found');
  return toDetail(updated);
}

/** Where a new thread is anchored: a real line of a file in the reviewed snapshot. */
async function checkAnchor(snapshotId: Types.ObjectId, path: string, line: number) {
  // [CONCEPT: Positional Projection] `files.$` returns only the matching file, not the whole snapshot.
  const found = await Snapshot.findOne(
    { _id: snapshotId, 'files.path': path },
    { 'files.$': 1 },
  ).lean();
  const file = found?.files[0];
  if (!file) throw invalid('path', 'Not a file in this version');
  const lines = file.content.split('\n').length;
  if (line > lines) {
    throw invalid('line', `${path} has ${lines} line${lines === 1 ? '' : 's'} in this version`);
  }
}

/** Any member of the room may comment: reviewing is reading, which viewers can do too. */
export async function addComment(
  user: AuthUser,
  reviewId: string,
  { body, path, line, parentId }: CreateCommentInput,
): Promise<ReviewComment> {
  const { review } = await findReview(user, reviewId);
  assertOpen(review);

  let anchor: { path: string; line: number; parentId: Types.ObjectId | null };
  if (parentId) {
    const parent = review.comments.find((c) => c._id.equals(parentId));
    if (!parent) throw invalid('parentId', 'That thread no longer exists');
    // A reply to a reply joins the same thread: threads are one level deep.
    const rootId = parent.parentId ?? parent._id;
    anchor = { path: parent.path, line: parent.line, parentId: rootId };
  } else {
    await checkAnchor(review.snapshotId, path!, line!);
    anchor = { path: path!, line: line!, parentId: null };
  }

  const comment: CommentAttrs = {
    _id: new Types.ObjectId(),
    authorId: new Types.ObjectId(user.id),
    body,
    ...anchor,
    resolved: false,
    createdAt: new Date(),
    editedAt: null,
  };
  // [CONCEPT: Atomic Update] The checks and the $push happen in one operation: if the review was closed or filled
  // up in the meantime, nothing matches and nothing is written. No read-modify-write race.
  const pushed = await Review.updateOne(
    {
      _id: review._id,
      status: 'open',
      [`comments.${MAX_COMMENTS_PER_REVIEW - 1}`]: { $exists: false },
    },
    { $push: { comments: comment } },
  );
  if (pushed.modifiedCount === 0) {
    const now = await Review.findById(review._id, { status: 1 }).lean();
    if (!now) throw HttpError.notFound('Review not found');
    assertOpen({ ...review, status: now.status });
    throw HttpError.conflict(`A review can have at most ${MAX_COMMENTS_PER_REVIEW} comments`);
  }
  return toComment(comment, new Map([[user.id, user.username]]));
}

function canResolve(user: AuthUser, review: ReviewRow, thread: CommentAttrs, access: RoomAccess) {
  return (
    hasRoomRole(access.role, 'editor') ||
    review.requesterId.equals(user.id) ||
    thread.authorId.equals(user.id)
  );
}

/** Edit your own comment's text, or resolve/reopen a thread (from its first comment). */
export async function updateComment(
  user: AuthUser,
  reviewId: string,
  commentId: string,
  { body, resolved }: UpdateCommentInput,
): Promise<ReviewComment> {
  const { review, access } = await findReview(user, reviewId);
  const comment = Types.ObjectId.isValid(commentId)
    ? review.comments.find((c) => c._id.equals(commentId))
    : undefined;
  if (!comment) throw HttpError.notFound('Comment not found');
  assertOpen(review);

  if (body !== undefined && !comment.authorId.equals(user.id)) {
    throw HttpError.forbidden('Only the author can edit a comment');
  }
  if (resolved !== undefined) {
    if (comment.parentId) throw invalid('resolved', 'Resolve the thread from its first comment');
    if (!canResolve(user, review, comment, access)) {
      throw HttpError.forbidden(
        'Only editors, whoever asked for the review, or whoever started the thread can resolve it',
      );
    }
  }

  const set: Record<string, unknown> = {};
  if (body !== undefined && body !== comment.body) {
    set['comments.$.body'] = body;
    set['comments.$.editedAt'] = new Date();
  }
  if (resolved !== undefined) set['comments.$.resolved'] = resolved;
  if (Object.keys(set).length === 0) {
    return toComment(comment, await usernamesById([comment.authorId]));
  }

  // [CONCEPT: Positional Operator] `comments.$` updates the one array element the filter matched, in place.
  const updated = await Review.findOneAndUpdate(
    { _id: review._id, status: 'open', 'comments._id': comment._id },
    { $set: set },
    { returnDocument: 'after', projection: { comments: { $elemMatch: { _id: comment._id } } } },
  ).lean<ReviewRow>();
  const saved = updated?.comments[0];
  if (!saved) throw HttpError.conflict('This review changed. Reload it and try again.');
  return toComment(saved, await usernamesById([saved.authorId]));
}
