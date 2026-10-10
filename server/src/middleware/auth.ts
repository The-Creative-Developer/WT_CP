import type { Request, RequestHandler } from 'express';
import type { AuthService, AuthUser } from '../services/auth';
import { HttpError } from '../utils/http-error';

// [CONCEPT: Bearer Authentication] The access token travels in the Authorization header, never in a cookie, so
// another site can't make the browser send it (no CSRF risk for these routes).
export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    try {
      if (!token) throw new Error('missing');
      req.user = await auth.verifyAccessToken(token);
      next();
    } catch {
      // [CONCEPT: WWW-Authenticate] Tells the client which scheme to use and why the token was rejected.
      res.set(
        'WWW-Authenticate',
        token ? 'Bearer error="invalid_token"' : 'Bearer realm="devverse"',
      );
      next(HttpError.unauthorized(token ? 'Access token is invalid or expired' : undefined));
    }
  };
}

/** The signed-in user. Only call this in handlers mounted after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw HttpError.unauthorized();
  return req.user;
}

// [CONCEPT: CSRF Defence in Depth] The refresh cookie is SameSite=Lax, which already stops cross-site POSTs from
// carrying it. As a second layer, reject cookie-authenticated requests whose Origin isn't one of ours.
export function requireTrustedOrigin(allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return next(HttpError.forbidden('Untrusted request origin'));
    }
    next();
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
