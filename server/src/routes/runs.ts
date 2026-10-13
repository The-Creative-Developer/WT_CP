import { createRunSchema, listRunsQuerySchema } from '@devverse/shared';
import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { createRunsController } from '../controllers/runs';
import { currentUser } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import type { RunService } from '../services/runs';
import { HttpError } from '../utils/http-error';

export function createRunsRouter(authenticate: RequestHandler, runs: RunService) {
  const router = Router();
  const controller = createRunsController(runs);
  router.use(authenticate);

  // [CONCEPT: Per-User Rate Limiting] Keyed by account rather than IP: every run costs a container, and a class
  // sharing one campus IP shouldn't block each other.
  const runLimit = rateLimit({
    windowMs: 60_000,
    limit: runs.maxRunsPerMinute,
    keyGenerator: (req) => currentUser(req).id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'You are running code too often. Wait a moment and try again.')),
  });

  router.post('/', runLimit, validateBody(createRunSchema), controller.start);
  router.get('/', validateQuery(listRunsQuerySchema), controller.list);
  router.get('/:id', controller.get);

  return router;
}
