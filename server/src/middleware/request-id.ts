import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// [CONCEPT: Request Tracing] Every response carries X-Request-Id so a browser error can be matched to a server log line.
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}
