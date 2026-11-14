import {
  folderMoveConflict,
  hasRoomRole,
  MAX_FILES_PER_PROJECT,
  pathConflict,
  type FileSummary,
  type MoveFolderInput,
} from '@devverse/shared';
import mongoose, { Types } from 'mongoose';
import { File } from '../models/file';
import { HttpError } from '../utils/http-error';
import type { AuthUser } from './auth';
import { roomEvents } from './room-events';
import { resolveRoomAccess, type RoomAccess } from './rooms';

const toSummary = (file: { _id: Types.ObjectId; path: string }): FileSummary => ({
  id: file._id.toString(),
  path: file.path,
});

/** The caller's access to the room that owns a project. Any member may look; editors and owners may change. */
async function projectAccess(user: AuthUser, projectId: string, edit: boolean) {
  if (!Types.ObjectId.isValid(projectId)) throw HttpError.notFound('Project not found');
  const access = await resolveRoomAccess(user.id, { projectId }, 'Join this room to see its files');
  if (edit && !hasRoomRole(access.role, 'editor')) {
    throw HttpError.forbidden('Viewers can open files but not change them');
  }
  return access;
}

async function projectFiles(projectId: string) {
  // Projects are capped at MAX_FILES_PER_PROJECT, so loading every path for a check is cheap.
  return File.find({ projectId }, { path: 1 }).sort({ path: 1 }).lean();
}

/** Tells everyone in the room, and returns the new list. */
async function announce(access: RoomAccess, user: AuthUser, deletedIds: string[] = []) {
  const files = (await projectFiles(access.projectId)).map(toSummary);
  roomEvents.publishFilesChanged({ roomSlug: access.slug, files, deletedIds, by: user.username });
  return files;
}

function rethrowDuplicate(err: unknown, path: string): never {
  // The unique {projectId, path} index catches two people creating the same name at the same moment, which the
  // check before the write can't.
  if ((err as { code?: number }).code === 11000)
    throw HttpError.conflict(`"${path}" already exists`);
  throw err;
}

export async function listFiles(user: AuthUser, projectId: string): Promise<FileSummary[]> {
  const access = await projectAccess(user, projectId, false);
  return (await projectFiles(access.projectId)).map(toSummary);
}

/** New files start empty. Folders in the path appear by themselves. */
export async function createFile(
  user: AuthUser,
  projectId: string,
  path: string,
): Promise<FileSummary> {
  const access = await projectAccess(user, projectId, true);
  const existing = await projectFiles(access.projectId);
  if (existing.length >= MAX_FILES_PER_PROJECT) {
    throw HttpError.conflict(`A project can have at most ${MAX_FILES_PER_PROJECT} files`);
  }
  const clash = pathConflict(
    existing.map((f) => f.path),
    path,
  );
  if (clash) throw HttpError.conflict(clash);

  const file = await File.create({ projectId: access.projectId, path }).catch((err: unknown) =>
    rethrowDuplicate(err, path),
  );
  await announce(access, user);
  return toSummary(file);
}

/** Renames and moves are the same thing: a new path. The live document is keyed by id, so editing carries on. */
export async function renameFile(
  user: AuthUser,
  projectId: string,
  fileId: string,
  path: string,
): Promise<FileSummary> {
  const access = await projectAccess(user, projectId, true);
  const existing = await projectFiles(access.projectId);
  const file = Types.ObjectId.isValid(fileId) && existing.find((f) => f._id.equals(fileId));
  if (!file) throw HttpError.notFound('File not found');
  // [CONCEPT: Idempotency] Asking for the name it already has succeeds without changing (or announcing) anything.
  if (file.path === path) return toSummary(file);

  const clash = pathConflict(
    existing.filter((f) => f !== file).map((f) => f.path),
    path,
  );
  if (clash) throw HttpError.conflict(clash);
  await File.updateOne({ _id: file._id }, { $set: { path } }).catch((err: unknown) =>
    rethrowDuplicate(err, path),
  );
  await announce(access, user);
  return { id: fileId, path };
}

export async function deleteFile(user: AuthUser, projectId: string, fileId: string) {
  const access = await projectAccess(user, projectId, true);
  if (!Types.ObjectId.isValid(fileId)) throw HttpError.notFound('File not found');
  const { deletedCount } = await File.deleteOne({ _id: fileId, projectId: access.projectId });
  if (!deletedCount) throw HttpError.notFound('File not found');
  await announce(access, user, [fileId]);
}

/** Every file under `from/` moves to the same place under `to/`. */
export async function moveFolder(
  user: AuthUser,
  projectId: string,
  { from, to }: MoveFolderInput,
): Promise<FileSummary[]> {
  const access = await projectAccess(user, projectId, true);
  const existing = await projectFiles(access.projectId);
  const moving = existing.filter((f) => f.path.startsWith(`${from}/`));
  if (moving.length === 0) throw HttpError.notFound('Folder not found');

  const clash = folderMoveConflict(
    existing.map((f) => f.path),
    from,
    to,
  );
  if (clash) throw HttpError.conflict(clash);
  const moves = moving.map((f) => ({ id: f._id, path: `${to}${f.path.slice(from.length)}` }));

  // [CONCEPT: Multi-Document Transaction] A folder is many documents. Either every file moves or none does, so a
  // failure halfway can't leave the folder split in two.
  await mongoose.connection
    .transaction(async (session) => {
      await File.bulkWrite(
        moves.map(({ id, path }) => ({
          updateOne: { filter: { _id: id }, update: { $set: { path } } },
        })),
        { session },
      );
    })
    .catch((err: unknown) => rethrowDuplicate(err, to));
  return announce(access, user);
}

export async function deleteFolder(user: AuthUser, projectId: string, path: string) {
  const access = await projectAccess(user, projectId, true);
  const existing = await projectFiles(access.projectId);
  const ids = existing.filter((f) => f.path.startsWith(`${path}/`)).map((f) => f._id);
  if (ids.length === 0) throw HttpError.notFound('Folder not found');
  await File.deleteMany({ _id: { $in: ids }, projectId: access.projectId });
  await announce(
    access,
    user,
    ids.map((id) => id.toString()),
  );
}
