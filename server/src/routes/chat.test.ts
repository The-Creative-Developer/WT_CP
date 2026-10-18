import type { MessagePage } from '@devverse/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { Message } from '../models/message';
import { Room } from '../models/room';
import { decodeCursor, encodeCursor } from '../services/chat';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();
const app = createApp(testEnv);

async function signUp(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return `Bearer ${res.body.accessToken}`;
}

/** Alice's public room, with `count` messages one second apart (plus any extras at fixed times). */
async function roomWithMessages(count: number, extraTimes: Date[] = []) {
  const alice = await signUp('alice');
  const created = await request(app)
    .post('/api/v1/rooms')
    .set('Authorization', alice)
    .send({ name: 'Chatty', visibility: 'public' });
  const room = await Room.findOne({ slug: created.body.slug }).lean();
  const start = Date.parse('2026-10-18T10:00:00Z');
  const times = [
    ...Array.from({ length: count }, (_, i) => new Date(start + i * 1000)),
    ...extraTimes,
  ];
  await Message.insertMany(
    times.map((createdAt, i) => ({
      roomId: room!._id,
      authorId: room!.ownerId,
      body: `message ${i}`,
      createdAt,
    })),
  );
  return { alice, slug: created.body.slug as string, roomId: room!._id };
}

const page = (auth: string, slug: string, query = '') =>
  request(app).get(`/api/v1/rooms/${slug}/messages${query}`).set('Authorization', auth);

describe('GET /rooms/:slug/messages', () => {
  it('is empty for a new room', async () => {
    const { alice, slug } = await roomWithMessages(0);
    const res = await page(alice, slug);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ messages: [], nextCursor: null });
  });

  it('walks back through history, newest first, with every message exactly once', async () => {
    // Two extra messages share a timestamp with each other: only the _id tie-break keeps them apart.
    const tie = new Date('2026-10-18T10:00:02.500Z');
    const { alice, slug } = await roomWithMessages(5, [tie, tie]);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await page(alice, slug, `?limit=3${cursor ? `&before=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      const body = res.body as MessagePage;
      expect(body.messages.length).toBeLessThanOrEqual(3);
      seen.push(...body.messages.map((m) => m.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3); // 7 messages in pages of 3
    expect(new Set(seen).size).toBe(7);
    const all = await Message.find().sort({ createdAt: -1, _id: -1 }).lean();
    expect(seen).toEqual(all.map((m) => m._id.toString()));
  });

  it('includes the author and the room in each message', async () => {
    const { alice, slug } = await roomWithMessages(1);
    const res = await page(alice, slug);
    expect(res.body.messages[0]).toEqual({
      id: expect.any(String),
      roomSlug: slug,
      author: { id: expect.any(String), username: 'alice' },
      body: 'message 0',
      createdAt: '2026-10-18T10:00:00.000Z',
    });
  });

  it('lets any member read, including viewers, but not outsiders', async () => {
    const { slug } = await roomWithMessages(2);
    const viewer = await signUp('victor');
    await request(app).post(`/api/v1/rooms/${slug}/join`).set('Authorization', viewer).send({});
    expect((await page(viewer, slug)).body.messages).toHaveLength(2);
    expect((await page(await signUp('mallory'), slug)).status).toBe(403);
    expect((await page(viewer, 'no-such-room')).status).toBe(404);
  });

  it('rejects malformed cursors and limits', async () => {
    const { alice, slug } = await roomWithMessages(1);
    expect((await page(alice, slug, '?before=not-a-cursor')).status).toBe(422);
    expect((await page(alice, slug, '?limit=500')).status).toBe(422);
  });

  it('ignores operator-shaped parameters instead of passing them to MongoDB', async () => {
    // [CONCEPT: NoSQL Injection] Express 5's query parser doesn't build nested objects, so before[$gt]=x arrives as a
    // key literally named "before[$gt]", which the schema drops. No operator ever reaches the query.
    const { alice, slug } = await roomWithMessages(2);
    const res = await page(alice, slug, '?before[$gt]=x');
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
  });

  it('is deleted together with its room', async () => {
    const { alice, slug } = await roomWithMessages(3);
    await request(app).delete(`/api/v1/rooms/${slug}`).set('Authorization', alice);
    expect(await Message.countDocuments()).toBe(0);
  });
});

describe('message cursors', () => {
  it('round-trip createdAt and _id', () => {
    const message = { _id: new Message()._id, createdAt: new Date('2026-10-18T10:00:00.123Z') };
    const decoded = decodeCursor(encodeCursor(message));
    expect(decoded.createdAt.toISOString()).toBe('2026-10-18T10:00:00.123Z');
    expect(decoded.id.equals(message._id)).toBe(true);
  });
});
