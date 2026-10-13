import type { CreateRunInput } from '@devverse/shared';
import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type { RunService } from '../services/runs';

export function createRunsController(runs: RunService) {
  const start: RequestHandler = async (req, res) => {
    const run = await runs.start(currentUser(req), req.body as CreateRunInput);
    // [CONCEPT: 202 Accepted] "Got it, working on it": the result isn't ready yet. Location says where to look for
    // it; output also streams to the room over Socket.IO.
    res.location(`/api/v1/runs/${run.id}`).status(202).json(run);
  };

  // [CONCEPT: Short Polling] The fallback when the socket is down: ask for the run's state every second.
  const get: RequestHandler<{ id: string }> = async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await runs.get(currentUser(req), req.params.id));
  };

  return { start, get };
}
