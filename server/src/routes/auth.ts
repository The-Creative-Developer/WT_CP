import { loginSchema, registerSchema } from '@devverse/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAuthController } from '../controllers/auth';
import { requireTrustedOrigin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import type { AuthService } from '../services/auth';
import { HttpError } from '../utils/http-error';

export interface AuthRouterOptions {
  secureCookies: boolean;
  trustedOrigins: string[];
  /** Failed login/register attempts allowed per IP per 15 minutes. */
  attemptLimit: number;
}

export function createAuthRouter(auth: AuthService, options: AuthRouterOptions) {
  const router = Router();
  const controller = createAuthController(auth, options);

  // [CONCEPT: Brute-Force Protection] A much tighter limit than the global one; only failed attempts count.
  const attemptLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: options.attemptLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.')),
  });

  router.use(requireTrustedOrigin(options.trustedOrigins));
  router.post('/register', attemptLimiter, validateBody(registerSchema), controller.register);
  router.post('/login', attemptLimiter, validateBody(loginSchema), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);

  return router;
}
