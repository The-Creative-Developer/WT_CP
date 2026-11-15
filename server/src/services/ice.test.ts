import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { createIceService } from './ice';

const SECRET = 'a-shared-secret-that-is-at-least-32-characters';
const USER = '6730c2f4e1b2a3c4d5e6f701';

describe('createIceService', () => {
  it('signs TURN usernames the way coturn checks them', () => {
    const ice = createIceService({
      stunUrls: ['stun:stun.example.org:3478'],
      turnUrls: [
        'turn:turn.example.org:3478?transport=udp',
        'turn:turn.example.org:3478?transport=tcp',
      ],
      turnSecret: SECRET,
      ttlSeconds: 3600,
      now: () => 1_794_750_000_500, // 1794750000.5 s
    });
    expect(ice.hasTurn).toBe(true);
    expect(ice.credentialsFor(USER)).toEqual({
      ttl: 3600,
      iceServers: [
        { urls: ['stun:stun.example.org:3478'] },
        {
          urls: [
            'turn:turn.example.org:3478?transport=udp',
            'turn:turn.example.org:3478?transport=tcp',
          ],
          username: `1794753600:${USER}`,
          // printf '1794753600:<user>' | openssl dgst -sha1 -hmac <secret> -binary | base64
          credential: 'sor1wdWaH30WQgw9aNhgXM4hhNo=',
        },
      ],
    });
  });

  it('hands out only STUN without a secret or TURN URLs', () => {
    for (const ice of [
      createIceService({ stunUrls: ['stun:a:3478'], turnUrls: ['turn:t:3478'] }),
      createIceService({ stunUrls: ['stun:a:3478'], turnSecret: SECRET }),
    ]) {
      expect(ice.hasTurn).toBe(false);
      expect(ice.credentialsFor(USER).iceServers).toEqual([{ urls: ['stun:a:3478'] }]);
    }
  });
});

describe('TURN settings', () => {
  const base = {
    MONGODB_URI: 'mongodb://localhost/devverse',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    RUNNER_TOKEN: 'runner-token',
  };

  it('defaults to a public STUN server and no TURN', () => {
    const env = loadEnv(base);
    expect(env.STUN_URLS).toEqual(['stun:stun.l.google.com:19302']);
    expect(env.TURN_URLS).toEqual([]);
    expect(env.TURN_TTL_SECONDS).toBe(14_400);
  });

  it('reads comma-separated URLs and checks them', () => {
    const env = loadEnv({
      ...base,
      TURN_URLS: 'turn:a:3478?transport=udp, turns:a:5349',
      TURN_SECRET: SECRET,
    });
    expect(env.TURN_URLS).toEqual(['turn:a:3478?transport=udp', 'turns:a:5349']);
    expect(() => loadEnv({ ...base, TURN_URLS: 'https://a' })).toThrow(/TURN_URLS/);
    expect(() => loadEnv({ ...base, TURN_SECRET: 'short' })).toThrow(/TURN_SECRET/);
  });
});
