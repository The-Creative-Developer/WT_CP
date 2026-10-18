import { createRoomSchema, joinRoomSchema, listMessagesQuerySchema } from '@devverse/shared';
import { Router, type RequestHandler } from 'express';
import * as controller from '../controllers/rooms';
import { validateBody, validateQuery } from '../middleware/validate';

export function createRoomsRouter(authenticate: RequestHandler) {
  const router = Router();
  // Every room endpoint needs a signed-in user.
  router.use(authenticate);

  router.get('/', controller.listRooms);
  router.post('/', validateBody(createRoomSchema), controller.createRoom);
  router.get('/:slug', controller.getRoom);
  router.post('/:slug/join', validateBody(joinRoomSchema), controller.joinRoom);
  router.delete('/:slug', controller.deleteRoom);
  router.get('/:slug/messages', validateQuery(listMessagesQuerySchema), controller.listMessages);

  return router;
}
