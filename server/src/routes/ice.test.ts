import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createAuthService } from '../services/auth';
import { createIceService } from '../services/ice';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();

const ice = createIceService({
  stunUrls: ['stun:stun.example.org:3478'],
  turnUrls: ['turn:turn.example.org:3478'],
  turnSecret: 'a-shared-secret-that-is-at-least-32-characters',
});
const app = createApp(testEnv, createAuthService(testEnv), undefined, undefined, ice);

describe('GET /turn-credentials', () => {
  it("gives a signed-in user STUN and TURN servers, with credentials tied to them, and isn't cached", async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'ada', email: 'ada@example.com', password: 'correct horse battery' });
    const res = await request(app)
      .get('/api/v1/turn-credentials')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.ttl).toBe(14_400);
    const [stun, turn] = res.body.iceServers;
    expect(stun).toEqual({ urls: ['stun:stun.example.org:3478'] });
    expect(turn.urls).toEqual(['turn:turn.example.org:3478']);
    const [expiry, userId] = turn.username.split(':');
    expect(userId).toBe(reg.body.user.id);
    expect(Number(expiry) - Date.now() / 1000).toBeGreaterThan(14_390);
    expect(turn.credential).toMatch(/^[A-Za-z0-9+/]{27}=$/);
  });

  it('is for signed-in users only', async () => {
    expect((await request(app).get('/api/v1/turn-credentials')).status).toBe(401);
  });
});
