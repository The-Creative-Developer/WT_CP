import { model, Schema, type Types } from 'mongoose';

export interface FileAttrs {
  projectId: Types.ObjectId;
  /** POSIX-style path inside the project, e.g. "src/main.py". */
  path: string;
  /** Plain-text snapshot, used for runs, downloads and search. */
  content: string;
  /** Yjs document state (Week 1, Days 6–7). The source of truth while a room is being edited. */
  yState: Buffer | null;
  updatedAt: Date;
}

// [CONCEPT: Referencing for Unbounded Data] One document per file, rather than an array inside the project, keeps
// every document far below MongoDB's 16 MB limit however big a project grows.
const fileSchema = new Schema<FileAttrs>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    path: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '' },
    yState: { type: Buffer, default: null, select: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

// Two files in the same project can't share a path; this index also serves "all files of a project".
fileSchema.index({ projectId: 1, path: 1 }, { unique: true });

export const File = model<FileAttrs>('File', fileSchema);
