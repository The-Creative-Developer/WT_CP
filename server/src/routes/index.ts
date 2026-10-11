import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { AuthService } from '../services/auth';
import { createAuthRouter, type AuthRouterOptions } from './auth';
import { createUsersRouter } from './users';

export interface ApiDeps {
  auth: AuthService;
  authOptions: AuthRouterOptions;
}

// [CONCEPT: API Versioning] All JSON endpoints live under /api/v1 so breaking changes can ship as /api/v2.
export function createApiRouter({ auth, authOptions }: ApiDeps) {
  const router = Router();
  const authenticate = requireAuth(auth);

  router.get('/', (_req, res) => {
    res.json({ name: 'DevVerse API', version: 'v1' });
  });

  router.use('/auth', createAuthRouter(auth, authOptions));
  router.use('/users', createUsersRouter(authenticate));
  // Mounted as they are built:
  // router.use('/rooms', createRoomsRouter(authenticate));
  // router.use('/projects', createProjectsRouter(authenticate));

  return router;
}
