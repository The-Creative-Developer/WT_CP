import { Router, type RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type { IceService } from '../services/ice';

/** GET /api/v1/turn-credentials: ICE servers for a call, fetched by the browser just before it joins. */
export function createIceRouter(authenticate: RequestHandler, ice: IceService) {
  const router = Router();
  router.get('/', authenticate, (req, res) => {
    // The credentials are personal and expire: never cache them.
    res.set('Cache-Control', 'no-store').json(ice.credentialsFor(currentUser(req).id));
  });
  return router;
}
