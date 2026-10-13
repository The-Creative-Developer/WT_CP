import type { RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from '../utils/http-error';

// [CONCEPT: Input Validation] Untrusted request bodies are parsed against a schema before reaching a controller.
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new HttpError(422, 'Validation failed', result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };
}

/**
 * Like validateBody, for the query string. Express 5 makes req.query read-only, so the parsed (and coerced) values
 * go in res.locals.query; read them with `validQuery`.
 */
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new HttpError(422, 'Validation failed', result.error.flatten().fieldErrors));
    }
    res.locals.query = result.data;
    next();
  };
}

/** The query string as parsed by validateQuery(schema) earlier in the chain. */
export function validQuery<T>(res: Response): T {
  return res.locals.query as T;
}
