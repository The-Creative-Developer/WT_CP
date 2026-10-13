import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';

export const notFound: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`No route for ${req.method} ${req.path}`));
};

// [CONCEPT: Centralised Error Handling] One middleware formats every error as RFC 9457 application/problem+json.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) logger.error({ err, requestId: req.id }, 'Unhandled error');

  const isProd = process.env.NODE_ENV === 'production';
  if (err instanceof HttpError) res.set(err.headers);
  res
    .status(status)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title: err instanceof HttpError || !isProd ? err.message : 'Internal Server Error',
      status,
      instance: req.originalUrl,
      requestId: req.id,
      ...(err instanceof HttpError && err.details ? { errors: err.details } : {}),
    });
};
