import { MAX_COMMENT_LENGTH, REVIEW_STATUSES, type ReviewStatus } from '@devverse/shared';
import { model, Schema, type Types } from 'mongoose';

export interface CommentAttrs {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  path: string;
  line: number;
  body: string;
  parentId: Types.ObjectId | null;
  resolved: boolean;
  createdAt: Date;
  editedAt: Date | null;
}

export interface ReviewAttrs {
  projectId: Types.ObjectId;
  snapshotId: Types.ObjectId;
  baseSnapshotId: Types.ObjectId | null;
  requesterId: Types.ObjectId;
  status: ReviewStatus;
  comments: CommentAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<CommentAttrs>({
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  path: { type: String, required: true },
  line: { type: Number, required: true, min: 1 },
  body: { type: String, required: true, maxlength: MAX_COMMENT_LENGTH },
  parentId: { type: Schema.Types.ObjectId, default: null },
  resolved: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
  editedAt: { type: Date, default: null },
});

// [CONCEPT: Embedding] A review's comments are always loaded with it and are capped (MAX_COMMENTS_PER_REVIEW), so
// they're embedded: one read shows the whole review, and adding a comment is one atomic $push.
const reviewSchema = new Schema<ReviewAttrs>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'Snapshot', required: true },
    baseSnapshotId: { type: Schema.Types.ObjectId, ref: 'Snapshot', default: null },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: REVIEW_STATUSES, default: 'open' },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true },
);

// Serves a project's review list, newest first. Filtering by status walks the same index: a project has few reviews.
reviewSchema.index({ projectId: 1, createdAt: -1 });

export const Review = model<ReviewAttrs>('Review', reviewSchema);
