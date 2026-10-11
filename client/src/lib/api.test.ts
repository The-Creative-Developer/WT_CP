import type { AuthResponse } from '@devverse/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, refreshSession, setSession } from './api';

const session = (token: string): AuthResponse => ({
  accessToken: token,
  expiresIn: 900,
  user: {
    id: '1',
    username: 'alice',
    email: 'alice@example.com',
    stats: { solved: 0, xp: 0 },
    createdAt: '2026-10-10T00:00:00.000Z',
  },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const authHeader = (call: unknown[]) =>
  new Headers((call[1] as RequestInit).headers).get('Authorization');

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('api', () => {
  it('silently refreshes an expired access token and retries once', async () => {
    setSession(session('expired'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { title: 'Access token is invalid or expired' }))
      .mockResolvedValueOnce(json(200, session('fresh')))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/api/v1/users/me')).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/users/me',
      '/api/v1/auth/refresh',
      '/api/v1/users/me',
    ]);
    expect(authHeader(fetchMock.mock.calls[0]!)).toBe('Bearer expired');
    expect(authHeader(fetchMock.mock.calls[2]!)).toBe('Bearer fresh');
  });

  it('gives up with a 401 when the refresh also fails', async () => {
    setSession(session('expired'));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(401, { title: 'expired' }))
        .mockResolvedValueOnce(json(401, {})),
    );

    await expect(api('/api/v1/users/me')).rejects.toMatchObject({ status: 401 });
  });

  it('shares one refresh request between concurrent callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, session('fresh')));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('exposes field errors from problem+json bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(409, {
          title: 'That username is taken',
          errors: { username: ['That username is taken'] },
        }),
      ),
    );

    const error = await api<never>('/api/v1/auth/register', { method: 'POST', body: '{}' }).catch(
      (e: unknown) => e as ApiError,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.fieldErrors).toEqual({ username: ['That username is taken'] });
  });
});
