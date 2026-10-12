import { MAX_ROOM_MEMBERS, type RoomDetail } from '@devverse/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { File } from '../models/file';
import { Project } from '../models/project';
import { Room } from '../models/room';
import { makeSlug } from '../services/rooms';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();
const app = createApp(testEnv);

/** Registers a user and returns an Authorization header value for them. */
async function signUp(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return `Bearer ${res.body.accessToken}`;
}

async function createRoom(auth: string, body: object = { name: 'Pair Programming' }) {
  return request(app).post('/api/v1/rooms').set('Authorization', auth).send(body);
}

const join = (auth: string, slug: string, inviteCode?: string) =>
  request(app)
    .post(`/api/v1/rooms/${slug}/join`)
    .set('Authorization', auth)
    .send(inviteCode ? { inviteCode } : {});

describe('makeSlug', () => {
  it('makes a readable, unique slug', () => {
    expect(makeSlug('Café Coders!')).toMatch(/^cafe-coders-[a-z0-9]{1,6}$/);
    expect(makeSlug('!!!')).toMatch(/^room-[a-z0-9]{1,6}$/);
    expect(makeSlug('same')).not.toBe(makeSlug('same'));
  });
});

describe('POST /rooms', () => {
  it('creates the room, its project and a starter file, with the creator as owner', async () => {
    const alice = await signUp('alice');
    const res = await createRoom(alice, { name: 'Python Night', language: 'python' });

    expect(res.status).toBe(201);
    const room = res.body as RoomDetail;
    expect(res.headers.location).toBe(`/api/v1/rooms/${room.slug}`);
    expect(room).toMatchObject({
      name: 'Python Night',
      language: 'python',
      visibility: 'private',
      role: 'owner',
      memberCount: 1,
      owner: { username: 'alice' },
      files: [{ path: 'main.py' }],
    });
    expect(room.inviteCode).toEqual(expect.any(String));
    expect(await Project.countDocuments()).toBe(1);
    expect(await File.findOne({ path: 'main.py' }).lean()).toMatchObject({
      content: expect.stringContaining('print('),
    });
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/rooms').send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('validates the body', async () => {
    const res = await createRoom(await signUp('alice'), { name: 'x', language: 'cobol' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors).sort()).toEqual(['language', 'name']);
  });
});

describe('GET /rooms', () => {
  it("lists only the rooms I'm a member of, newest first", async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await createRoom(alice, { name: 'First' });
    await createRoom(alice, { name: 'Second' });
    await createRoom(bob, { name: 'Bobs room' });

    const res = await request(app).get('/api/v1/rooms').set('Authorization', alice);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(['Second', 'First']);
    // The invite code is a secret: never part of a list response.
    expect(JSON.stringify(res.body)).not.toContain('inviteCode');
  });
});

describe('GET /rooms/:slug', () => {
  it('hides private rooms from non-members', async () => {
    const { slug } = (await createRoom(await signUp('alice'))).body;
    const res = await request(app)
      .get(`/api/v1/rooms/${slug}`)
      .set('Authorization', await signUp('bob'));
    expect(res.status).toBe(403);
  });

  it('shows public rooms to anyone, without the invite code', async () => {
    const { slug } = (
      await createRoom(await signUp('alice'), { name: 'Open', visibility: 'public' })
    ).body;
    const res = await request(app)
      .get(`/api/v1/rooms/${slug}`)
      .set('Authorization', await signUp('bob'));
    expect(res.status).toBe(200);
    expect(res.body.role).toBeNull();
    expect(res.body.inviteCode).toBeUndefined();
  });

  it('returns 404 for an unknown room', async () => {
    const res = await request(app)
      .get('/api/v1/rooms/does-not-exist')
      .set('Authorization', await signUp('alice'));
    expect(res.status).toBe(404);
  });
});

describe('POST /rooms/:slug/join', () => {
  it('lets someone with the invite code join a private room as an editor', async () => {
    const { slug, inviteCode } = (await createRoom(await signUp('alice'))).body;
    const bob = await signUp('bob');

    const res = await join(bob, slug, inviteCode);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'editor', memberCount: 2 });
    // Only the owner sees the invite code.
    expect(res.body.inviteCode).toBeUndefined();
  });

  it('rejects a private room without a valid invite code', async () => {
    const { slug } = (await createRoom(await signUp('alice'))).body;
    const bob = await signUp('bob');
    expect((await join(bob, slug)).status).toBe(403);
    expect((await join(bob, slug, 'wrong-code')).status).toBe(403);
  });

  it('lets anyone join a public room as a viewer, and an invite upgrades them', async () => {
    const { slug, inviteCode } = (
      await createRoom(await signUp('alice'), { name: 'Open', visibility: 'public' })
    ).body;
    const bob = await signUp('bob');

    expect((await join(bob, slug)).body.role).toBe('viewer');
    expect((await join(bob, slug, inviteCode)).body.role).toBe('editor');
  });

  it('is idempotent', async () => {
    const { slug, inviteCode } = (await createRoom(await signUp('alice'))).body;
    const bob = await signUp('bob');
    await join(bob, slug, inviteCode);
    const again = await join(bob, slug, inviteCode);
    expect(again.status).toBe(200);
    expect(again.body.memberCount).toBe(2);
  });

  it(`never lets a room exceed ${MAX_ROOM_MEMBERS} members, even with concurrent joins`, async () => {
    const { slug, inviteCode } = (await createRoom(await signUp('owner'))).body;
    const users = await Promise.all(
      Array.from({ length: MAX_ROOM_MEMBERS + 2 }, (_, i) => signUp(`user${i}`)),
    );

    const results = await Promise.all(users.map((u) => join(u, slug, inviteCode)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(MAX_ROOM_MEMBERS - 1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const room = await Room.findOne({ slug }).lean();
    expect(room?.members).toHaveLength(MAX_ROOM_MEMBERS);
  });
});

describe('DELETE /rooms/:slug', () => {
  it('only lets the owner delete, and removes the project and files too', async () => {
    const alice = await signUp('alice');
    const { slug, inviteCode } = (await createRoom(alice)).body;
    const bob = await signUp('bob');
    await join(bob, slug, inviteCode);

    const byEditor = await request(app).delete(`/api/v1/rooms/${slug}`).set('Authorization', bob);
    expect(byEditor.status).toBe(403);

    const byOwner = await request(app).delete(`/api/v1/rooms/${slug}`).set('Authorization', alice);
    expect(byOwner.status).toBe(204);
    expect(await Room.countDocuments()).toBe(0);
    expect(await Project.countDocuments()).toBe(0);
    expect(await File.countDocuments()).toBe(0);
  });
});
