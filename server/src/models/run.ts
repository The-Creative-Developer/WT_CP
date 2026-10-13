import { LANGUAGE_IDS, type Language, type RunStatus, type RunVerdict } from '@devverse/shared';
import { model, Schema, type Types } from 'mongoose';

export const RUN_TTL_SECONDS = 7 * 24 * 60 * 60;

const RUN_STATUSES: RunStatus[] = ['queued', 'running', 'finished', 'failed'];
const RUN_VERDICTS: RunVerdict[] = ['ok', 'error', 'timeout', 'memory', 'output-limit'];

export interface RunAttrs {
  userId: Types.ObjectId;
  roomId: Types.ObjectId;
  fileId: Types.ObjectId;
  language: Language;
  status: RunStatus;
  stdout: string;
  stderr: string;
  verdict: RunVerdict | null;
  exitCode: number | null;
  durationMs: number | null;
  truncated: boolean;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Output is written once, when the run ends. While it runs, the latest output lives in memory (see run-service).
const runSchema = new Schema<RunAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    language: { type: String, enum: LANGUAGE_IDS, required: true },
    status: { type: String, enum: RUN_STATUSES, default: 'queued' },
    stdout: { type: String, default: '' },
    stderr: { type: String, default: '' },
    verdict: { type: String, enum: [...RUN_VERDICTS, null], default: null },
    exitCode: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    truncated: { type: Boolean, default: false },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

// "My recent runs", newest first.
runSchema.index({ userId: 1, createdAt: -1 });
// [CONCEPT: Compound Index] "This room's latest runs": equality on roomId, then already in newest-first order, so
// MongoDB reads just the first `limit` entries instead of scanning and sorting every run. _id breaks ties between
// runs created in the same millisecond.
runSchema.index({ roomId: 1, createdAt: -1, _id: -1 });
// [CONCEPT: TTL Index] Run output is only useful for a while; MongoDB deletes each run 7 days after it was created.
runSchema.index({ createdAt: 1 }, { expireAfterSeconds: RUN_TTL_SECONDS });

export const Run = model<RunAttrs>('Run', runSchema);
