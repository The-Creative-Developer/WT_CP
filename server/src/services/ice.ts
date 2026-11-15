import { createHmac } from 'node:crypto';
import type { IceConfig } from '@devverse/shared';

export interface IceOptions {
  stunUrls: string[];
  turnUrls?: string[];
  /** coturn's static-auth-secret. Without it, no TURN servers are handed out. */
  turnSecret?: string;
  ttlSeconds?: number;
  now?: () => number;
}

export type IceService = ReturnType<typeof createIceService>;

/**
 * Hands out ICE servers for calls.
 *
 * [CONCEPT: Time-Limited Credentials] A TURN relay forwards anyone's traffic, so it can't be open to the internet,
 * and a fixed password in the browser would be copied. Instead the API and coturn share a secret (coturn's
 * `use-auth-secret`, the "TURN REST API"): the username is "<expiry time>:<user id>" and the password is an HMAC of
 * that username. coturn recomputes the HMAC to check it and refuses it once the time has passed, so nothing is stored
 * and a leaked credential stops working by itself.
 */
export function createIceService({
  stunUrls,
  turnUrls = [],
  turnSecret,
  ttlSeconds = 4 * 3600,
  now = Date.now,
}: IceOptions) {
  return {
    /** Whether TURN relays are configured (both the URLs and the shared secret). */
    hasTurn: Boolean(turnSecret && turnUrls.length),

    credentialsFor(userId: string): IceConfig {
      const iceServers: IceConfig['iceServers'] = stunUrls.length ? [{ urls: stunUrls }] : [];
      if (turnSecret && turnUrls.length) {
        const expiry = Math.floor(now() / 1000) + ttlSeconds;
        const username = `${expiry}:${userId}`;
        // HMAC-SHA1 because that's what coturn implements for this scheme; it's an HMAC, not a password hash.
        const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
        iceServers.push({ urls: turnUrls, username, credential });
      }
      return { iceServers, ttl: ttlSeconds };
    },
  };
}
