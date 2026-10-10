import { updateMeSchema } from '@devverse/shared';
import { Router, type RequestHandler } from 'express';
import { getMe, updateMe } from '../controllers/users';
import { validateBody } from '../middleware/validate';

export function createUsersRouter(authenticate: RequestHandler) {
  const router = Router();
  router.get('/me', authenticate, getMe);
  router.patch('/me', authenticate, validateBody(updateMeSchema), updateMe);
  return router;
}
