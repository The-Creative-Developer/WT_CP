import {
  createFileSchema,
  createSnapshotSchema,
  folderQuerySchema,
  moveFolderSchema,
  renameFileSchema,
} from '@devverse/shared';
import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/files';
import { createSnapshotsController } from '../controllers/snapshots';
import { currentUser } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import type { LiveText } from '../services/files';
import { HttpError } from '../utils/http-error';

/**
 * A project's files, versions (snapshots) and ZIP download. Access follows the room the project belongs to: members
 * can look, editors and owners can change. File *contents* are edited live over the Yjs WebSocket, not here.
 *
 * `liveText` reads files as the room sees them right now, so a snapshot or download includes edits from the last
 * couple of seconds that haven't been saved yet.
 */
export function createProjectsRouter(authenticate: RequestHandler, liveText?: LiveText) {
  const router = Router();
  const snapshots = createSnapshotsController(liveText);
  router.use(authenticate);

  // Each version copies the whole project (up to 8 MB), so saving them is limited per account.
  const snapshotLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    keyGenerator: (req) => currentUser(req).id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'You are saving versions too often. Wait a moment and try again.')),
  });

  router.get('/:projectId/files', controller.listFiles);
  router.post('/:projectId/files', validateBody(createFileSchema), controller.createFile);
  // [CONCEPT: PATCH vs PUT] PATCH changes one field (the path) and leaves the rest of the file alone.
  router.patch('/:projectId/files/:fileId', validateBody(renameFileSchema), controller.renameFile);
  router.delete('/:projectId/files/:fileId', controller.deleteFile);
  // Folders aren't stored, so they're addressed by path: moving or deleting one touches every file inside it.
  router.patch('/:projectId/folders', validateBody(moveFolderSchema), controller.moveFolder);
  router.delete('/:projectId/folders', validateQuery(folderQuerySchema), controller.deleteFolder);

  router.get('/:projectId/snapshots', snapshots.list);
  router.post(
    '/:projectId/snapshots',
    snapshotLimit,
    validateBody(createSnapshotSchema),
    snapshots.create,
  );
  router.get('/:projectId/snapshots/:snapshotId', snapshots.get);
  router.get('/:projectId/export.zip', snapshots.exportZip);

  return router;
}
