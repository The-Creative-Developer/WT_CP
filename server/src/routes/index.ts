import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { AuthService } from '../services/auth';
import type { RunService } from '../services/runs';
import { createAuthRouter, type AuthRouterOptions } from './auth';
import { createRoomsRouter } from './rooms';
import { createRunsRouter } from './runs';
import { createUsersRouter } from './users';

export interface ApiDeps {
  auth: AuthService;
  authOptions: AuthRouterOptions;
  /** Optional so tests that never run code don't need a runner. */
  runs?: RunService;
}

// [CONCEPT: API Versioning] All JSON endpoints live under /api/v1 so breaking changes can ship as /api/v2.
export function createApiRouter({ auth, authOptions, runs }: ApiDeps) {
  const router = Router();
  const authenticate = requireAuth(auth);

  router.get('/', (_req, res) => {
    res.json({ name: 'DevVerse API', version: 'v1' });
  });

  router.use('/auth', createAuthRouter(auth, authOptions));
  router.use('/users', createUsersRouter(authenticate));
  router.use('/rooms', createRoomsRouter(authenticate));
  if (runs) router.use('/runs', createRunsRouter(authenticate, runs));
  // Mounted as they are built:
  // router.use('/projects', createProjectsRouter(authenticate));

  return router;
}
