import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadIceServers, resetIceCache } from './ice';

const turn = { urls: ['turn:t.example:3478'], username: '1:u', credential: 'c' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  resetIceCache();
});

describe('loadIceServers', () => {
  it('fetches the servers and reuses them until shortly before they expire', async () => {
    const fetchMock = vi.fn(async () => json({ iceServers: [turn], ttl: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const t0 = 1_000_000;
    expect(await loadIceServers(t0)).toEqual([turn]);
    expect(await loadIceServers(t0 + 50 * 60_000)).toEqual([turn]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Within five minutes of expiring: fetched again.
    await loadIceServers(t0 + 56 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to STUN when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ title: 'nope' }, 500)),
    );
    expect(await loadIceServers()).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
  });
});
