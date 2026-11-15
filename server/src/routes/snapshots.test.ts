import { inflateRawSync } from 'node:zlib';
import type { FileSummary, SnapshotDetail } from '@devverse/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { File } from '../models/file';
import { Review } from '../models/review';
import { Snapshot } from '../models/snapshot';
import { createAuthService } from '../services/auth';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();

// Stands in for the live editor: files listed here are "open", with unsaved text.
const live = new Map<string, string>();
const app = createApp(testEnv, createAuthService(testEnv), undefined, async (id) => live.get(id));

async function signUp(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return `Bearer ${res.body.accessToken}`;
}

/** Alice's Python room; Bob is an editor or a viewer. */
async function setUp({ bobRole = 'editor' }: { bobRole?: 'editor' | 'viewer' | 'none' } = {}) {
  live.clear();
  const alice = await signUp('alice');
  const room = await request(app)
    .post('/api/v1/rooms')
    .set('Authorization', alice)
    .send({ name: 'Versions Room', language: 'python', visibility: 'public' });
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
    snapshot: (auth: string, message: string) =>
      request(app).post(`${base}/snapshots`).set('Authorization', auth).send({ message }),
    list: (auth: string) => request(app).get(`${base}/snapshots`).set('Authorization', auth),
    get: (auth: string, id: string) =>
      request(app).get(`${base}/snapshots/${id}`).set('Authorization', auth),
    download: (auth: string) =>
      request(app)
        .get(`${base}/export.zip`)
        .set('Authorization', auth)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        }),
  };
}

/** Reads a ZIP's entries from its central directory (enough for archiver's output: stored or deflated). */
function unzip(zip: Buffer): Map<string, string> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    entries.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('POST /projects/:id/snapshots', () => {
  it('copies every file, including unsaved edits from the live editor', async () => {
    const t = await setUp();
    await File.create({ projectId: t.projectId, path: 'lib/util.py', content: 'X = 1\n' });
    live.set(t.main.id, 'print("unsaved")\n');

    const res = await t.snapshot(t.bob, '  First version ');
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/projects/${t.projectId}/snapshots/${res.body.id}`);
    expect(res.body).toMatchObject({
      projectId: t.projectId,
      message: 'First version',
      author: { username: 'bob' },
      fileCount: 2,
      files: [
        { path: 'lib/util.py', content: 'X = 1\n' },
        { path: 'main.py', content: 'print("unsaved")\n' },
      ],
    });

    // A snapshot is a copy: later edits don't change it.
    await File.updateOne({ path: 'lib/util.py' }, { content: 'X = 2\n' });
    const again = await t.get(t.alice, res.body.id);
    expect(again.status).toBe(200);
    expect(again.headers['cache-control']).toContain('immutable');
    expect((again.body as SnapshotDetail).files[0]!.content).toBe('X = 1\n');
  });

  it('needs a description, and is for editors', async () => {
    const t = await setUp({ bobRole: 'viewer' });
    const empty = await t.snapshot(t.alice, '   ');
    expect(empty.status).toBe(422);
    expect(empty.body.errors.message[0]).toBe('Describe this version');

    const viewer = await t.snapshot(t.bob, 'Mine');
    expect(viewer.status).toBe(403);
    expect(viewer.body.title).toContain('Viewers can look at versions');
  });

  it('refuses projects too big for one document', async () => {
    const t = await setUp();
    await File.updateOne({ _id: t.main.id }, { content: 'x'.repeat(8 * 1024 * 1024 + 1) });
    const res = await t.snapshot(t.alice, 'Huge');
    expect(res.status).toBe(409);
    expect(res.body.title).toContain('too big');
    expect(await Snapshot.countDocuments()).toBe(0);
  });
});

describe('GET /projects/:id/snapshots', () => {
  it('lists versions newest first, without their files', async () => {
    const t = await setUp({ bobRole: 'viewer' });
    await t.snapshot(t.alice, 'One');
    await t.snapshot(t.alice, 'Two');

    const res = await t.list(t.bob);
    expect(res.status).toBe(200);
    expect(res.body.map((s: { message: string }) => s.message)).toEqual(['Two', 'One']);
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      projectId: t.projectId,
      message: 'Two',
      author: { id: expect.any(String), username: 'alice' },
      fileCount: 1,
      createdAt: expect.any(String),
    });
  });

  it('is for members of the room', async () => {
    const t = await setUp({ bobRole: 'none' });
    const { body } = await t.snapshot(t.alice, 'One');
    expect((await t.list(t.bob)).status).toBe(403);
    expect((await t.get(t.bob, body.id)).status).toBe(403);
  });

  it("can't read another project's version", async () => {
    const t = await setUp();
    const mine = await t.snapshot(t.alice, 'Mine');
    const other = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', t.bob)
      .send({ name: "Bob's Room" });
    const res = await request(app)
      .get(`/api/v1/projects/${other.body.projectId}/snapshots/${mine.body.id}`)
      .set('Authorization', t.bob);
    expect(res.status).toBe(404);
    expect((await t.get(t.alice, 'nope')).status).toBe(404);
  });
});

describe('GET /projects/:id/export.zip', () => {
  it('streams the current files as a ZIP inside a folder named after the room', async () => {
    const t = await setUp({ bobRole: 'viewer' });
    await File.create({ projectId: t.projectId, path: 'src/deep/util.py', content: 'Y = 2\n' });
    live.set(t.main.id, 'print("live")\n');

    const res = await t.download(t.bob);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    // Slugs need no quoting, so the content-disposition package leaves them bare (RFC 6266 allows either).
    expect(res.headers['content-disposition']).toBe(`attachment; filename=${t.slug}.zip`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['transfer-encoding']).toBe('chunked');

    expect(unzip(res.body as Buffer)).toEqual(
      new Map([
        [`${t.slug}/main.py`, 'print("live")\n'],
        [`${t.slug}/src/deep/util.py`, 'Y = 2\n'],
      ]),
    );
  });

  it('is for members of the room', async () => {
    const t = await setUp({ bobRole: 'none' });
    const res = await request(app)
      .get(`/api/v1/projects/${t.projectId}/export.zip`)
      .set('Authorization', t.bob);
    expect(res.status).toBe(403);
    expect(res.type).toBe('application/problem+json');
  });
});

describe('deleting the room', () => {
  it('deletes its versions and reviews too', async () => {
    const t = await setUp();
    const snap = await t.snapshot(t.alice, 'One');
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', t.alice)
      .send({ snapshotId: snap.body.id });
    expect(await Review.countDocuments()).toBe(1);

    const res = await request(app).delete(`/api/v1/rooms/${t.slug}`).set('Authorization', t.alice);
    expect(res.status).toBe(204);
    expect(await Snapshot.countDocuments()).toBe(0);
    expect(await Review.countDocuments()).toBe(0);
  });
});
