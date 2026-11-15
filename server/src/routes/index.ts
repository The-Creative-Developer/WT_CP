import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { AuthService } from '../services/auth';
import type { LiveText } from '../services/files';
import { createIceService, type IceService } from '../services/ice';
import type { RunService } from '../services/runs';
import { createAuthRouter, type AuthRouterOptions } from './auth';
import { createIceRouter } from './ice';
import { createProjectsRouter } from './projects';
import { createReviewsRouter } from './reviews';
import { createRoomsRouter } from './rooms';
import { createRunsRouter } from './runs';
import { createUsersRouter } from './users';

export interface ApiDeps {
  auth: AuthService;
  authOptions: AuthRouterOptions;
  /** Optional so tests that never run code don't need a runner. */
  runs?: RunService;
  /** Reads open files from the live editor; without it, snapshots and downloads use the last save. */
  liveText?: LiveText;
  /** ICE servers for calls. Defaults to a public STUN server and no TURN. */
  ice?: IceService;
}

// [CONCEPT: API Versioning] All JSON endpoints live under /api/v1 so breaking changes can ship as /api/v2.
const defaultIce = createIceService({ stunUrls: ['stun:stun.l.google.com:19302'] });

export function createApiRouter({ auth, authOptions, runs, liveText, ice = defaultIce }: ApiDeps) {
  const router = Router();
  const authenticate = requireAuth(auth);

  router.get('/', (_req, res) => {
    res.json({ name: 'DevVerse API', version: 'v1' });
  });

  router.use('/auth', createAuthRouter(auth, authOptions));
  router.use('/users', createUsersRouter(authenticate));
  router.use('/rooms', createRoomsRouter(authenticate));
  router.use('/projects', createProjectsRouter(authenticate, liveText));
  router.use('/reviews', createReviewsRouter(authenticate));
  router.use('/turn-credentials', createIceRouter(authenticate, ice));
  if (runs) router.use('/runs', createRunsRouter(authenticate, runs));

  return router;
}
