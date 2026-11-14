import type { FileSummary } from '@devverse/shared';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { File } from '../models/file';
import { roomEvents, type FilesChanged } from '../services/room-events';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();
const app = createApp(testEnv);

const events: FilesChanged[] = [];
const unsubscribe = roomEvents.onFilesChanged((e) => events.push(e));
afterEach(() => {
  events.length = 0;
});
afterAll(unsubscribe);

async function signUp(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return `Bearer ${res.body.accessToken}`;
}

/** Alice's public Python room with main.py; Bob joins as an editor (with the invite) unless told otherwise. */
async function setUp({ bobRole = 'editor' }: { bobRole?: 'editor' | 'viewer' | 'none' } = {}) {
  const alice = await signUp('alice');
  const room = await request(app)
    .post('/api/v1/rooms')
    .set('Authorization', alice)
    .send({ name: 'Files Room', language: 'python', visibility: 'public' });
  const bob = await signUp('bob');
  if (bobRole !== 'none') {
    await request(app)
      .post(`/api/v1/rooms/${room.body.slug}/join`)
      .set('Authorization', bob)
      .send(bobRole === 'editor' ? { inviteCode: room.body.inviteCode } : {});
  }
  const projectId = room.body.projectId as string;
  const base = `/api/v1/projects/${projectId}`;
  return {
    alice,
    bob,
    slug: room.body.slug as string,
    projectId,
    main: room.body.files[0] as FileSummary,
    create: (auth: string, path: string) =>
      request(app).post(`${base}/files`).set('Authorization', auth).send({ path }),
    rename: (auth: string, id: string, path: string) =>
      request(app).patch(`${base}/files/${id}`).set('Authorization', auth).send({ path }),
    remove: (auth: string, id: string) =>
      request(app).delete(`${base}/files/${id}`).set('Authorization', auth),
    moveFolder: (auth: string, from: string, to: string) =>
      request(app).patch(`${base}/folders`).set('Authorization', auth).send({ from, to }),
    removeFolder: (auth: string, path: string) =>
      request(app).delete(`${base}/folders`).query({ path }).set('Authorization', auth),
    list: (auth: string) => request(app).get(`${base}/files`).set('Authorization', auth),
  };
}

const paths = (files: FileSummary[]) => files.map((f) => f.path);

describe('POST /projects/:id/files', () => {
  it('creates an empty file (and its folders), and tells the room', async () => {
    const t = await setUp();
    const res = await t.create(t.bob, '/src/utils.py ');
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/projects/${t.projectId}/files/${res.body.id}`);
    expect(res.body).toEqual({ id: expect.any(String), path: 'src/utils.py' });
    expect((await File.findById(res.body.id).lean())?.content).toBe('');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ roomSlug: t.slug, by: 'bob', deletedIds: [] });
    expect(paths(events[0]!.files)).toEqual(['main.py', 'src/utils.py']);

    const room = await request(app).get(`/api/v1/rooms/${t.slug}`).set('Authorization', t.alice);
    expect(paths(room.body.files)).toEqual(['main.py', 'src/utils.py']);
  });

  it('refuses names that clash with a file or folder', async () => {
    const t = await setUp();
    await t.create(t.alice, 'src/utils.py');
    for (const [path, message] of [
      ['main.py', '"main.py" already exists'],
      ['src', '"src" is already a folder'],
      ['main.py/x.py', '"main.py" is a file'],
    ] as const) {
      const res = await t.create(t.alice, path);
      expect(res.status).toBe(409);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.title).toContain(message);
    }
  });

  it('validates the path', async () => {
    const t = await setUp();
    const res = await t.create(t.alice, '../../etc/passwd');
    expect(res.status).toBe(422);
    expect(res.body.errors.path[0]).toContain('"." and ".."');
  });

  it('caps the number of files in a project', async () => {
    const t = await setUp();
    await File.insertMany(
      Array.from({ length: 99 }, (_, i) => ({ projectId: t.projectId, path: `f${i}.py` })),
    );
    const res = await t.create(t.alice, 'one-too-many.py');
    expect(res.status).toBe(409);
    expect(res.body.title).toContain('at most 100 files');
  });

  it('is for editors only', async () => {
    const viewer = await setUp({ bobRole: 'viewer' });
    expect((await viewer.create(viewer.bob, 'x.py')).status).toBe(403);
    // Viewers can still see the list.
    expect(paths((await viewer.list(viewer.bob)).body)).toEqual(['main.py']);
  });
});

describe('access', () => {
  it('hides projects from people outside the room, and unknown ids are 404', async () => {
    const t = await setUp({ bobRole: 'none' });
    expect((await t.list(t.bob)).status).toBe(403);
    expect((await t.create(t.bob, 'x.py')).status).toBe(403);
    const unknown = await request(app)
      .get('/api/v1/projects/000000000000000000000000/files')
      .set('Authorization', t.alice);
    expect(unknown.status).toBe(404);
    const malformed = await request(app)
      .get('/api/v1/projects/nope/files')
      .set('Authorization', t.alice);
    expect(malformed.status).toBe(404);
  });

  it("can't touch a file through another room's project", async () => {
    const t = await setUp();
    const other = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', t.bob)
      .send({ name: "Bob's Room" });
    const res = await request(app)
      .delete(`/api/v1/projects/${other.body.projectId}/files/${t.main.id}`)
      .set('Authorization', t.bob);
    expect(res.status).toBe(404);
    expect(await File.exists({ _id: t.main.id })).toBeTruthy();
  });
});

describe('PATCH /projects/:id/files/:fileId', () => {
  it('renames or moves a file, keeping its id and content', async () => {
    const t = await setUp();
    await File.updateOne({ _id: t.main.id }, { content: 'print(1)' });
    const res = await t.rename(t.bob, t.main.id, 'app/main.py');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: t.main.id, path: 'app/main.py' });
    expect(await File.findById(t.main.id).lean()).toMatchObject({
      path: 'app/main.py',
      content: 'print(1)',
    });
    expect(paths(events[0]!.files)).toEqual(['app/main.py']);
  });

  it('is a no-op when the name is unchanged, and refuses clashes', async () => {
    const t = await setUp();
    const res = await t.rename(t.alice, t.main.id, 'main.py');
    expect(res.status).toBe(200);
    expect(events).toHaveLength(0);

    await t.create(t.alice, 'lib/a.py');
    expect((await t.rename(t.alice, t.main.id, 'lib')).status).toBe(409);
    expect((await t.rename(t.alice, t.main.id, 'lib/a.py')).status).toBe(409);
  });

  it('is 404 for a file that does not exist', async () => {
    const t = await setUp();
    expect((await t.rename(t.alice, '000000000000000000000000', 'x.py')).status).toBe(404);
  });
});

describe('DELETE /projects/:id/files/:fileId', () => {
  it('deletes the file and says which one went', async () => {
    const t = await setUp();
    const res = await t.remove(t.bob, t.main.id);
    expect(res.status).toBe(204);
    expect(await File.exists({ _id: t.main.id })).toBeNull();
    expect(events[0]).toMatchObject({ files: [], deletedIds: [t.main.id] });
    expect((await t.remove(t.bob, t.main.id)).status).toBe(404);
  });
});

describe('folders', () => {
  it('moves every file in a folder at once, merging into an existing folder', async () => {
    const t = await setUp();
    const a = (await t.create(t.alice, 'src/a.py')).body as FileSummary;
    await t.create(t.alice, 'src/deep/b.py');
    await t.create(t.alice, 'lib/c.py');
    events.length = 0;

    const res = await t.moveFolder(t.bob, 'src', 'lib/src');
    expect(res.status).toBe(200);
    expect(paths(res.body)).toEqual(['lib/c.py', 'lib/src/a.py', 'lib/src/deep/b.py', 'main.py']);
    expect((await File.findById(a.id).lean())?.path).toBe('lib/src/a.py');
    expect(events).toHaveLength(1);
  });

  it('moves nothing if any file would clash', async () => {
    const t = await setUp();
    await t.create(t.alice, 'src/a.py');
    await t.create(t.alice, 'src/b.py');
    await t.create(t.alice, 'lib/b.py');
    const res = await t.moveFolder(t.alice, 'src', 'lib');
    expect(res.status).toBe(409);
    expect(res.body.title).toBe('"lib/b.py" already exists');
    expect(paths((await t.list(t.alice)).body)).toEqual([
      'lib/b.py',
      'main.py',
      'src/a.py',
      'src/b.py',
    ]);
  });

  it('refuses to move into a file, into itself, or a folder that does not exist', async () => {
    const t = await setUp();
    await t.create(t.alice, 'src/a.py');
    expect((await t.moveFolder(t.alice, 'src', 'main.py/src')).status).toBe(409);
    expect((await t.moveFolder(t.alice, 'src', 'src/inner')).status).toBe(422);
    expect((await t.moveFolder(t.alice, 'nope', 'other')).status).toBe(404);
    // "src" is a prefix of "srcs" but not its folder.
    await t.create(t.alice, 'srcs.py');
    expect((await t.moveFolder(t.alice, 'src', 'lib')).status).toBe(200);
    expect(paths((await t.list(t.alice)).body)).toContain('srcs.py');
  });

  it('deletes a folder and everything in it', async () => {
    const t = await setUp();
    const a = (await t.create(t.alice, 'src/a.py')).body as FileSummary;
    const b = (await t.create(t.alice, 'src/deep/b.py')).body as FileSummary;
    events.length = 0;
    const res = await t.removeFolder(t.bob, 'src');
    expect(res.status).toBe(204);
    expect(paths((await t.list(t.alice)).body)).toEqual(['main.py']);
    expect(events[0]?.deletedIds.sort()).toEqual([a.id, b.id].sort());
    expect((await t.removeFolder(t.bob, 'src')).status).toBe(404);
  });

  it('is for editors only', async () => {
    const t = await setUp({ bobRole: 'viewer' });
    await t.create(t.alice, 'src/a.py');
    expect((await t.moveFolder(t.bob, 'src', 'lib')).status).toBe(403);
    expect((await t.removeFolder(t.bob, 'src')).status).toBe(403);
  });
});
