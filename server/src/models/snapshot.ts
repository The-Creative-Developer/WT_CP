import { MAX_SNAPSHOT_MESSAGE_LENGTH } from '@devverse/shared';
import { model, Schema, type Types } from 'mongoose';

export interface SnapshotAttrs {
  projectId: Types.ObjectId;
  authorId: Types.ObjectId;
  message: string;
  files: { path: string; content: string }[];
  createdAt: Date;
}

// [CONCEPT: Embedding] A snapshot is an immutable point-in-time copy, like a commit: its files are always read
// together and never change, so they live inside it. MAX_SNAPSHOT_BYTES keeps it well under the 16 MB limit.
const snapshotSchema = new Schema<SnapshotAttrs>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true, trim: true, maxlength: MAX_SNAPSHOT_MESSAGE_LENGTH },
    files: {
      type: [{ _id: false, path: { type: String, required: true }, content: String }],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Serves "this project's versions, newest first" and "the version before this one" (PLAN §6).
snapshotSchema.index({ projectId: 1, createdAt: -1, _id: -1 });

export const Snapshot = model<SnapshotAttrs>('Snapshot', snapshotSchema);
