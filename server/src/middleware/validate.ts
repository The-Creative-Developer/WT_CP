import type { RequestHandler } from 'express';
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
