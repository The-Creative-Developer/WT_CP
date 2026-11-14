import type { CreateFileInput, MoveFolderInput, RenameFileInput } from '@devverse/shared';
import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { validQuery } from '../middleware/validate';
import * as files from '../services/files';

type ProjectParams = { projectId: string };
type FileParams = ProjectParams & { fileId: string };

export const listFiles: RequestHandler<ProjectParams> = async (req, res) => {
  res.json(await files.listFiles(currentUser(req), req.params.projectId));
};

export const createFile: RequestHandler<ProjectParams> = async (req, res) => {
  const { projectId } = req.params;
  const file = await files.createFile(
    currentUser(req),
    projectId,
    (req.body as CreateFileInput).path,
  );
  res.location(`/api/v1/projects/${projectId}/files/${file.id}`).status(201).json(file);
};

export const renameFile: RequestHandler<FileParams> = async (req, res) => {
  const { projectId, fileId } = req.params;
  const { path } = req.body as RenameFileInput;
  res.json(await files.renameFile(currentUser(req), projectId, fileId, path));
};

export const deleteFile: RequestHandler<FileParams> = async (req, res) => {
  await files.deleteFile(currentUser(req), req.params.projectId, req.params.fileId);
  res.status(204).end();
};

export const moveFolder: RequestHandler<ProjectParams> = async (req, res) => {
  res.json(
    await files.moveFolder(currentUser(req), req.params.projectId, req.body as MoveFolderInput),
  );
};

export const deleteFolder: RequestHandler<ProjectParams> = async (req, res) => {
  const { path } = validQuery<{ path: string }>(res);
  await files.deleteFolder(currentUser(req), req.params.projectId, path);
  res.status(204).end();
};
