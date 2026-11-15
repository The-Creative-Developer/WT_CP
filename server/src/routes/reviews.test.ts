import type { ReviewComment, ReviewDetail } from '@devverse/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { File } from '../models/file';
import { Review } from '../models/review';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();
const app = createApp(testEnv);

async function signUp(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return `Bearer ${res.body.accessToken}`;
}

/**
 * Alice owns the room; Bob is an editor; Carol a viewer; Dave isn't a member. main.py has two versions: "v1" with
 * 3 lines and "v2" with 4.
 */
async function setUp() {
  const [alice, bob, carol, dave] = await Promise.all(
    ['alice', 'bob', 'carol', 'dave'].map(signUp),
  );
  const room = await request(app)
    .post('/api/v1/rooms')
    .set('Authorization', alice!)
    .send({ name: 'Review Room', language: 'python', visibility: 'public' });
  const { slug, projectId, inviteCode } = room.body;
  await request(app)
    .post(`/api/v1/rooms/${slug}/join`)
    .set('Authorization', bob!)
    .send({ inviteCode });
  await request(app).post(`/api/v1/rooms/${slug}/join`).set('Authorization', carol!).send({});

  const save = async (content: string, message: string) => {
    await File.updateOne({ projectId, path: 'main.py' }, { content });
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/snapshots`)
      .set('Authorization', alice!)
      .send({ message });
    return res.body.id as string;
  };
  const v1 = await save('a = 1\nb = 2\nprint(a + b)', 'v1');
  const v2 = await save('a = 1\nb = 3\nc = 4\nprint(a + b + c)', 'v2');

  return {
    alice: alice!,
    bob: bob!,
    carol: carol!,
    dave: dave!,
    projectId: projectId as string,
    v1,
    v2,
    request: (auth: string, body: Record<string, unknown>) =>
      request(app).post('/api/v1/reviews').set('Authorization', auth).send(body),
    get: (auth: string, id: string) =>
      request(app).get(`/api/v1/reviews/${id}`).set('Authorization', auth),
    list: (auth: string, query: Record<string, string>) =>
      request(app).get('/api/v1/reviews').query(query).set('Authorization', auth),
    setStatus: (auth: string, id: string, status: string) =>
      request(app).patch(`/api/v1/reviews/${id}`).set('Authorization', auth).send({ status }),
    comment: (auth: string, id: string, body: Record<string, unknown>) =>
      request(app).post(`/api/v1/reviews/${id}/comments`).set('Authorization', auth).send(body),
    editComment: (auth: string, id: string, cid: string, body: Record<string, unknown>) =>
      request(app)
        .patch(`/api/v1/reviews/${id}/comments/${cid}`)
        .set('Authorization', auth)
        .send(body),
  };
}

describe('POST /reviews', () => {
  it('compares a version with the one before it by default', async () => {
    const t = await setUp();
    const res = await t.request(t.bob, { snapshotId: t.v2 });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/reviews/${res.body.id}`);
    expect(res.body).toMatchObject({
      projectId: t.projectId,
      snapshot: { id: t.v2, message: 'v2', fileCount: 1, author: { username: 'alice' } },
      base: { id: t.v1, message: 'v1' },
      requester: { username: 'bob' },
      status: 'open',
      openThreads: 0,
      commentCount: 0,
      comments: [],
    });
  });

  it('compares the first version with nothing, or with a version you choose', async () => {
    const t = await setUp();
    expect((await t.request(t.alice, { snapshotId: t.v1 })).body.base).toBeNull();
    expect((await t.request(t.alice, { snapshotId: t.v2, baseSnapshotId: null })).body.base).toBe(
      null,
    );
    const chosen = await t.request(t.alice, { snapshotId: t.v1, baseSnapshotId: t.v2 });
    expect(chosen.body.base.id).toBe(t.v2);
  });

  it('checks the base version', async () => {
    const t = await setUp();
    const same = await t.request(t.alice, { snapshotId: t.v2, baseSnapshotId: t.v2 });
    expect(same.status).toBe(422);
    expect(same.body.errors.baseSnapshotId[0]).toBe('Compare with a different version');

    const other = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', t.dave)
      .send({ name: "Dave's Room" });
    const foreign = await request(app)
      .post(`/api/v1/projects/${other.body.projectId}/snapshots`)
      .set('Authorization', t.dave)
      .send({ message: 'elsewhere' });
    const res = await t.request(t.alice, { snapshotId: t.v2, baseSnapshotId: foreign.body.id });
    expect(res.status).toBe(422);
    expect(res.body.errors.baseSnapshotId[0]).toBe('Not a version of this project');
  });

  it('is for editors of the room', async () => {
    const t = await setUp();
    expect((await t.request(t.carol, { snapshotId: t.v2 })).status).toBe(403);
    expect((await t.request(t.dave, { snapshotId: t.v2 })).status).toBe(403);
    expect((await t.request(t.alice, { snapshotId: '000000000000000000000000' })).status).toBe(404);
    expect((await t.request(t.alice, { snapshotId: 'nope' })).status).toBe(422);
  });
});

describe('GET /reviews', () => {
  it("lists a project's reviews with their thread counts, filtered by status", async () => {
    const t = await setUp();
    const first = (await t.request(t.alice, { snapshotId: t.v1 })).body as ReviewDetail;
    const second = (await t.request(t.bob, { snapshotId: t.v2 })).body as ReviewDetail;
    const thread = await t.comment(t.carol, second.id, {
      path: 'main.py',
      line: 2,
      body: 'Why 3?',
    });
    await t.comment(t.bob, second.id, { parentId: thread.body.id, body: 'It has to be.' });
    await t.comment(t.carol, second.id, { path: 'main.py', line: 4, body: 'Nice' });
    await t.setStatus(t.alice, first.id, 'closed');

    const all = await t.list(t.carol, { projectId: t.projectId });
    expect(all.status).toBe(200);
    expect(all.headers['cache-control']).toBe('no-store');
    expect(all.body.map((r: ReviewDetail) => r.id)).toEqual([second.id, first.id]);
    expect(all.body[0]).toMatchObject({ openThreads: 2, commentCount: 3 });
    expect(all.body[0]).not.toHaveProperty('comments');

    const open = await t.list(t.carol, { projectId: t.projectId, status: 'open' });
    expect(open.body.map((r: ReviewDetail) => r.id)).toEqual([second.id]);
  });

  it('is for members of the room', async () => {
    const t = await setUp();
    const { body } = await t.request(t.alice, { snapshotId: t.v2 });
    expect((await t.list(t.dave, { projectId: t.projectId })).status).toBe(403);
    expect((await t.get(t.dave, body.id)).status).toBe(403);
    expect((await t.list(t.alice, {})).status).toBe(422);
    expect((await t.get(t.alice, '000000000000000000000000')).status).toBe(404);
  });
});

describe('comments', () => {
  it('starts threads on a line of the reviewed version, and replies join them', async () => {
    const t = await setUp();
    const { body: review } = await t.request(t.bob, { snapshotId: t.v2 });

    // Viewers can comment: reviewing is reading.
    const root = await t.comment(t.carol, review.id, { path: 'main.py', line: 3, body: ' New? ' });
    expect(root.status).toBe(201);
    expect(root.headers.location).toBe(`/api/v1/reviews/${review.id}/comments/${root.body.id}`);
    expect(root.body).toEqual({
      id: expect.any(String),
      author: { id: expect.any(String), username: 'carol' },
      path: 'main.py',
      line: 3,
      body: 'New?',
      parentId: null,
      resolved: false,
      createdAt: expect.any(String),
      editedAt: null,
    });

    const reply = await t.comment(t.bob, review.id, { parentId: root.body.id, body: 'Yes' });
    expect(reply.body).toMatchObject({ path: 'main.py', line: 3, parentId: root.body.id });
    // A reply to a reply goes in the same thread.
    const nested = await t.comment(t.alice, review.id, { parentId: reply.body.id, body: '+1' });
    expect(nested.body.parentId).toBe(root.body.id);

    const detail = (await t.get(t.carol, review.id)).body as ReviewDetail;
    expect(detail.comments.map((c) => c.body)).toEqual(['New?', 'Yes', '+1']);
    expect(detail).toMatchObject({ openThreads: 1, commentCount: 3 });
  });

  it('checks where a thread is anchored', async () => {
    const t = await setUp();
    const { body: review } = await t.request(t.bob, { snapshotId: t.v2 });
    const cases: [Record<string, unknown>, string, string][] = [
      [{ path: 'nope.py', line: 1 }, 'path', 'Not a file in this version'],
      [{ path: 'main.py', line: 5 }, 'line', 'main.py has 4 lines in this version'],
      [{ path: 'main.py' }, 'line', 'Say which file and line the comment is about'],
      [{ parentId: '000000000000000000000000' }, 'parentId', 'That thread no longer exists'],
      [
        { parentId: '000000000000000000000000', line: 1 },
        'parentId',
        'A reply goes in its thread; leave out path and line',
      ],
    ];
    for (const [anchor, field, message] of cases) {
      const res = await t.comment(t.alice, review.id, { ...anchor, body: 'Hm' });
      expect(res.status, JSON.stringify(anchor)).toBe(422);
      expect(res.body.errors[field]).toEqual([message]);
    }
    expect((await t.comment(t.alice, review.id, { path: 'main.py', line: 1 })).status).toBe(422);
    expect(
      (await t.comment(t.dave, review.id, { path: 'main.py', line: 1, body: 'x' })).status,
    ).toBe(403);
  });

  it('only lets authors edit their words', async () => {
    const t = await setUp();
    const { body: review } = await t.request(t.bob, { snapshotId: t.v2 });
    const { body: c } = await t.comment(t.carol, review.id, {
      path: 'main.py',
      line: 1,
      body: 'Hi',
    });

    expect((await t.editComment(t.alice, review.id, c.id, { body: 'Hacked' })).status).toBe(403);
    const edited = await t.editComment(t.carol, review.id, c.id, { body: 'Hello' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ body: 'Hello', editedAt: expect.any(String) });
    expect((await t.editComment(t.carol, review.id, c.id, {})).status).toBe(422);
    expect(
      (await t.editComment(t.carol, review.id, '000000000000000000000000', { body: 'x' })).status,
    ).toBe(404);
  });

  it('resolves and reopens threads', async () => {
    const t = await setUp();
    const { body: review } = await t.request(t.bob, { snapshotId: t.v2 });
    const { body: aliceThread } = await t.comment(t.alice, review.id, {
      path: 'main.py',
      line: 2,
      body: 'Check this',
    });
    const { body: reply } = await t.comment(t.carol, review.id, {
      parentId: aliceThread.id,
      body: 'Agreed',
    });

    // Viewers can't resolve other people's threads, and replies aren't resolved on their own.
    expect(
      (await t.editComment(t.carol, review.id, aliceThread.id, { resolved: true })).status,
    ).toBe(403);
    const onReply = await t.editComment(t.alice, review.id, reply.id, { resolved: true });
    expect(onReply.status).toBe(422);
    expect(onReply.body.errors.resolved[0]).toBe('Resolve the thread from its first comment');

    // The requester (Bob, an editor) can.
    const resolved = await t.editComment(t.bob, review.id, aliceThread.id, { resolved: true });
    expect(resolved.status).toBe(200);
    expect((resolved.body as ReviewComment).resolved).toBe(true);
    expect((await t.get(t.alice, review.id)).body.openThreads).toBe(0);

    // A viewer can resolve a thread they started.
    const { body: carolThread } = await t.comment(t.carol, review.id, {
      path: 'main.py',
      line: 1,
      body: 'Mine',
    });
    expect(
      (await t.editComment(t.carol, review.id, carolThread.id, { resolved: true })).status,
    ).toBe(200);
    const reopened = await t.editComment(t.alice, review.id, aliceThread.id, { resolved: false });
    expect(reopened.body.resolved).toBe(false);
  });

  it('caps the number of comments in a review', async () => {
    const t = await setUp();
    const { body: review } = await t.request(t.bob, { snapshotId: t.v2 });
    const filler = Array.from({ length: 499 }, () => ({
      authorId: review.requester.id,
      path: 'main.py',
      line: 1,
      body: 'x',
    }));
    await Review.updateOne({ _id: review.id }, { $push: { comments: { $each: filler } } });
    expect(
      (await t.comment(t.alice, review.id, { path: 'main.py', line: 1, body: '500' })).status,
    ).toBe(201);
    const full = await t.comment(t.alice, review.id, { path: 'main.py', line: 1, body: '501' });
    expect(full.status).toBe(409);
    expect(full.body.title).toBe('A review can have at most 500 comments');
  });
});

describe('PATCH /reviews/:id', () => {
  it('closes and reopens; closed reviews are read-only', async () => {
    const t = await setUp();
    const { body: review } = await t.request(t.bob, { snapshotId: t.v2 });
    const { body: c } = await t.comment(t.carol, review.id, {
      path: 'main.py',
      line: 1,
      body: 'Hi',
    });

    // Only the requester or the room owner.
    expect((await t.setStatus(t.carol, review.id, 'closed')).status).toBe(403);
    const closed = await t.setStatus(t.bob, review.id, 'closed');
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    expect((await t.setStatus(t.bob, review.id, 'closed')).status).toBe(200);

    const late = await t.comment(t.carol, review.id, { path: 'main.py', line: 1, body: 'Late' });
    expect(late.status).toBe(409);
    expect(late.body.title).toContain('This review is closed');
    expect((await t.editComment(t.carol, review.id, c.id, { body: 'Edit' })).status).toBe(409);

    expect((await t.setStatus(t.alice, review.id, 'open')).body.status).toBe('open');
    expect((await t.setStatus(t.alice, review.id, 'merged')).status).toBe(422);
  });
});
