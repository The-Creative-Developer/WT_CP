import { Router } from 'express';

// [CONCEPT: API Versioning] All JSON endpoints live under /api/v1 so breaking changes can ship as /api/v2.
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({ name: 'DevVerse API', version: 'v1' });
});

// Feature routers are mounted here as they are built:
// apiRouter.use('/auth', authRouter);
// apiRouter.use('/rooms', roomsRouter);
// apiRouter.use('/projects', projectsRouter);
