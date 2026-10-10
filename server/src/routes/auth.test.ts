import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { RefreshToken } from '../models/refresh-token';
import { User } from '../models/user';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();
const app = createApp(testEnv);

const alice = { username: 'Alice', email: 'alice@example.com', password: 'correct horse battery' };

/** Pulls the `dv_refresh=...` pair out of a response so it can be sent back like a browser would. */
function refreshCookie(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = raw.find((c) => c.startsWith('dv_refresh='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0]!;
}

async function register(body = alice) {
  return request(app).post('/api/v1/auth/register').send(body);
}

describe('POST /auth/register', () => {
  it('creates the user, returns an access token and sets a locked-down refresh cookie', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/v1/users/me');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: 'Alice', email: 'alice@example.com' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('stores an argon2id hash, never the password', async () => {
    await register();
    const user = await User.findOne({ email: alice.email }).select('+passwordHash').lean();
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(user)).not.toContain(alice.password);
  });

  it('rejects a username that differs only by case with 409', async () => {
    await register();
    const res = await register({ ...alice, username: 'ALICE', email: 'other@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.errors).toEqual({ username: ['That username is taken'] });
  });

  it('rejects a duplicate email with 409', async () => {
    await register();
    const res = await register({ ...alice, username: 'alice2', email: 'ALICE@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.errors).toHaveProperty('email');
  });

  it('returns field errors for invalid input', async () => {
    const res = await register({ username: 'a!', email: 'nope', password: 'short' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors).sort()).toEqual(['email', 'password', 'username']);
  });
});

describe('POST /auth/login', () => {
  it('logs in with the right password', async () => {
    await register();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'Alice@Example.com', password: alice.password });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('Alice');
    expect(refreshCookie(res)).toMatch(/^dv_refresh=/);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    await register();
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password: 'wrong password' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.title).toBe(unknownEmail.body.title);
  });

  it('blocks NoSQL operator injection at the validation layer', async () => {
    await register();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
  });

  it('rejects requests from an untrusted origin', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: alice.email, password: alice.password });
    expect(res.status).toBe(403);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const first = refreshCookie(await register());

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).not.toBe(first);
  });

  it('revokes the whole session family when a used token is replayed', async () => {
    const stolen = refreshCookie(await register());
    const rotated = refreshCookie(
      await request(app).post('/api/v1/auth/refresh').set('Cookie', stolen),
    );

    // The attacker replays the old token: rejected...
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', stolen);
    expect(replay.status).toBe(401);
    // ...and the legitimate user's newer token is now dead too.
    const victim = await request(app).post('/api/v1/auth/refresh').set('Cookie', rotated);
    expect(victim.status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('returns 401 without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const cookie = refreshCookie(await register());

    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/dv_refresh=;/);

    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});

describe('/users/me', () => {
  it('requires a bearer token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it('rejects a tampered token', async () => {
    const { accessToken } = (await register()).body;
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}x`);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
  });

  it('returns the signed-in user', async () => {
    const { accessToken } = (await register()).body;
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: 'Alice',
      email: 'alice@example.com',
      stats: { solved: 0, xp: 0 },
    });
  });

  it('PATCH updates only the fields sent', async () => {
    const { accessToken } = (await register()).body;
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bio: 'I like CRDTs' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'Alice', bio: 'I like CRDTs' });
  });

  it('PATCH refuses fields that are not editable', async () => {
    const { accessToken } = (await register()).body;
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ stats: { xp: 9999 } });
    expect(res.status).toBe(422);
  });
});
