import type { AuthResponse } from '@devverse/shared';

// Empty in development (Vite proxies /api). In production, the API's origin if it differs from the SPA's.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }

  /** Per-field messages from a 409/422 problem+json body, e.g. { email: ['Enter a valid email address'] }. */
  get fieldErrors(): Record<string, string[]> {
    const errors = (this.body as { errors?: unknown } | undefined)?.errors;
    return errors && typeof errors === 'object' ? (errors as Record<string, string[]>) : {};
  }
}

// [CONCEPT: Access Token in Memory] Not in localStorage, where any injected script could read it. A page reload
// loses it, and the httpOnly refresh cookie gets a new one.
let accessToken: string | null = null;
const sessionListeners = new Set<(session: AuthResponse | null) => void>();

export function setSession(session: AuthResponse | null) {
  accessToken = session?.accessToken ?? null;
  sessionListeners.forEach((listener) => listener(session));
}

/** The current access token, for transports that can't go through api() (e.g. WebSocket URLs). */
export function getAccessToken(): string | null {
  return accessToken;
}

export function onSessionChange(listener: (session: AuthResponse | null) => void) {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
}

let refreshInFlight: Promise<AuthResponse | null> | null = null;

/**
 * Trades the refresh cookie for a new access token. Resolves to null when there is no valid session.
 * Concurrent callers share one request, because a refresh token only works once.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= withRefreshLock(async () => {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    const session = res.ok ? ((await res.json()) as AuthResponse) : null;
    setSession(session);
    return session;
  }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// [CONCEPT: Web Locks API] Tabs share one cookie jar. If two tabs refreshed at once, the second would replay an
// already-used token and the server would revoke the session. The lock makes tabs take turns.
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('devverse-auth-refresh', fn)
    : fn();
}

const AUTH_PATH = '/api/v1/auth/';

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include', // send the refresh-token cookie to /auth endpoints
  });

  // [CONCEPT: Silent Refresh] An expired access token gets one transparent retry with a fresh token.
  if (res.status === 401 && !retried && !path.startsWith(AUTH_PATH)) {
    const session = await refreshSession();
    if (session) return api<T>(path, init, true);
  }

  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const title =
      isJson && body && typeof body === 'object' && 'title' in body
        ? String(body.title)
        : res.statusText;
    throw new ApiError(res.status, title, body);
  }
  return body as T;
}
