import type { IceConfig } from '@devverse/shared';
import { api } from '../../lib/api';
import { stunServers } from './media';

let cached: { servers: RTCIceServer[]; expiresAt: number } | null = null;

/** Credentials this close to expiring are fetched again, so they can't run out while a call is being set up. */
const MARGIN_MS = 5 * 60_000;

/**
 * The STUN and TURN servers for a call, from GET /api/v1/turn-credentials. They're reused until shortly before the
 * TURN credentials expire. If the request fails, calls still get STUN, which is enough on most networks.
 */
export async function loadIceServers(now = Date.now()): Promise<RTCIceServer[]> {
  if (cached && cached.expiresAt - MARGIN_MS > now) return cached.servers;
  try {
    const config = await api<IceConfig>('/api/v1/turn-credentials');
    cached = { servers: config.iceServers, expiresAt: now + config.ttl * 1000 };
    return config.iceServers;
  } catch {
    return stunServers();
  }
}

/** For tests. */
export function resetIceCache() {
  cached = null;
}
