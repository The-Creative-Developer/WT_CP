import type { AuthResponse } from '@devverse/shared';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, type AuthService, type Session } from '../services/auth';
import { toSelfUser } from '../utils/user-dto';

export const REFRESH_COOKIE = 'dv_refresh';

// [CONCEPT: Secure Cookies] httpOnly hides the token from JavaScript (XSS can't steal it), Secure sends it only over
// HTTPS, SameSite=Lax keeps it off cross-site POSTs, and Path limits it to the auth endpoints.
export function refreshCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/api/v1/auth' };
}

export function createAuthController(
  auth: AuthService,
  { secureCookies }: { secureCookies: boolean },
) {
  const cookieOptions = refreshCookieOptions(secureCookies);

  function sendSession(res: Response, session: Session, status = 200) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions,
      expires: session.refreshExpiresAt,
    });
    // [CONCEPT: Cache-Control] Responses carrying tokens must never be stored by a browser or proxy cache.
    res.set('Cache-Control', 'no-store');
    const body: AuthResponse = {
      user: toSelfUser(session.user),
      accessToken: session.accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
    res.status(status).json(body);
  }

  const register: RequestHandler = async (req, res) => {
    const session = await auth.register(req.body);
    // [CONCEPT: 201 Created + Location] Points the client at the resource that was just created.
    res.location('/api/v1/users/me');
    sendSession(res, session, 201);
  };

  const login: RequestHandler = async (req, res) => {
    sendSession(res, await auth.login(req.body));
  };

  const refresh: RequestHandler = async (req, res) => {
    try {
      sendSession(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      // A dead cookie is useless, so stop the browser from sending it again.
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw err;
    }
  };

  const logout: RequestHandler = async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).end();
  };

  return { register, login, refresh, logout };
}
