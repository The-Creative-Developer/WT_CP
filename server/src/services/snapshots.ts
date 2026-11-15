import {
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOTS_LISTED,
  type SnapshotDetail,
  type SnapshotSummary,
} from '@devverse/shared';
import { Types } from 'mongoose';
import { Snapshot, type SnapshotAttrs } from '../models/snapshot';
import { HttpError } from '../utils/http-error';
import type { AuthUser } from './auth';
import { currentFiles, resolveProjectAccess, type LiveText } from './files';
import { usernamesById } from './rooms';

type SummaryRow = Pick<SnapshotAttrs, 'projectId' | 'authorId' | 'message' | 'createdAt'> & {
  _id: Types.ObjectId;
  fileCount: number;
};

/**
 * Everything but the files' contents.
 * [CONCEPT: Projection] `$size` is computed by MongoDB, so listing versions never sends their files over the wire.
 */
const SUMMARY_FIELDS = {
  projectId: 1,
  authorId: 1,
  message: 1,
  createdAt: 1,
  fileCount: { $size: '$files' },
} as const;

function toSummary(row: SummaryRow, names: Map<string, string>): SnapshotSummary {
  const authorId = row.authorId.toString();
  return {
    id: row._id.toString(),
    projectId: row.projectId.toString(),
    message: row.message,
    author: { id: authorId, username: names.get(authorId) ?? 'deleted user' },
    fileCount: row.fileCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Summaries of the given snapshots, keyed by id. Missing ids are left out. */
export async function snapshotSummaries(
  ids: Types.ObjectId[],
): Promise<Map<string, SnapshotSummary>> {
  const rows = await Snapshot.find({ _id: { $in: ids } }, SUMMARY_FIELDS).lean<SummaryRow[]>();
  const names = await usernamesById(rows.map((r) => r.authorId));
  return new Map(rows.map((r) => [r._id.toString(), toSummary(r, names)]));
}

/** Copies every file, as the room sees it right now, into a new snapshot. */
export async function createSnapshot(
  user: AuthUser,
  projectId: string,
  message: string,
  liveText?: LiveText,
): Promise<SnapshotDetail> {
  const access = await resolveProjectAccess(
    user,
    projectId,
    true,
    'Viewers can look at versions but not save them',
  );
  const files = await currentFiles(access.projectId, liveText);
  const bytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw HttpError.conflict(
      `This project is too big to save as a version (over ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB)`,
    );
  }
  const snapshot = await Snapshot.create({
    projectId: access.projectId,
    authorId: user.id,
    message,
    files,
  });
  return {
    ...toSummary(
      { ...snapshot.toObject(), fileCount: files.length },
      new Map([[user.id, user.username]]),
    ),
    files,
  };
}

/** Newest first. */
export async function listSnapshots(user: AuthUser, projectId: string): Promise<SnapshotSummary[]> {
  const access = await resolveProjectAccess(user, projectId, false);
  const rows = await Snapshot.find({ projectId: access.projectId }, SUMMARY_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(MAX_SNAPSHOTS_LISTED)
    .lean<SummaryRow[]>();
  const names = await usernamesById(rows.map((r) => r.authorId));
  return rows.map((r) => toSummary(r, names));
}

export async function getSnapshot(
  user: AuthUser,
  projectId: string,
  snapshotId: string,
): Promise<SnapshotDetail> {
  const access = await resolveProjectAccess(user, projectId, false);
  if (!Types.ObjectId.isValid(snapshotId)) throw HttpError.notFound('Version not found');
  const snapshot = await Snapshot.findOne({ _id: snapshotId, projectId: access.projectId }).lean();
  if (!snapshot) throw HttpError.notFound('Version not found');
  const names = await usernamesById([snapshot.authorId]);
  return {
    ...toSummary({ ...snapshot, fileCount: snapshot.files.length }, names),
    files: snapshot.files.map(({ path, content }) => ({ path, content })),
  };
}

/** The snapshot taken just before this one in the same project, if any. Ties on time are broken by id. */
export async function previousSnapshotId(snapshot: {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  createdAt: Date;
}): Promise<Types.ObjectId | null> {
  const before = await Snapshot.findOne(
    {
      projectId: snapshot.projectId,
      $or: [
        { createdAt: { $lt: snapshot.createdAt } },
        { createdAt: snapshot.createdAt, _id: { $lt: snapshot._id } },
      ],
    },
    { _id: 1 },
  )
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  return before?._id ?? null;
}

/** The project's current files and a name for the download, for GET /projects/:id/export.zip. */
export async function exportProject(user: AuthUser, projectId: string, liveText?: LiveText) {
  const access = await resolveProjectAccess(user, projectId, false);
  return { name: access.slug, files: await currentFiles(access.projectId, liveText) };
}
