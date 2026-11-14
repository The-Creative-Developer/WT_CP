import {
  createFileSchema,
  folderQuerySchema,
  moveFolderSchema,
  renameFileSchema,
} from '@devverse/shared';
import { Router, type RequestHandler } from 'express';
import * as controller from '../controllers/files';
import { validateBody, validateQuery } from '../middleware/validate';

/**
 * A project's files. Access follows the room the project belongs to: members can list, editors and owners can
 * change. File *contents* are edited live over the Yjs WebSocket, not here.
 */
export function createProjectsRouter(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  router.get('/:projectId/files', controller.listFiles);
  router.post('/:projectId/files', validateBody(createFileSchema), controller.createFile);
  // [CONCEPT: PATCH vs PUT] PATCH changes one field (the path) and leaves the rest of the file alone.
  router.patch('/:projectId/files/:fileId', validateBody(renameFileSchema), controller.renameFile);
  router.delete('/:projectId/files/:fileId', controller.deleteFile);
  // Folders aren't stored, so they're addressed by path: moving or deleting one touches every file inside it.
  router.patch('/:projectId/folders', validateBody(moveFolderSchema), controller.moveFolder);
  router.delete('/:projectId/folders', validateQuery(folderQuerySchema), controller.deleteFolder);

  return router;
}
