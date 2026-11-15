import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SOCKET_UNAUTHORIZED,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@devverse/shared';
import { io as connectClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../app';
import { createAuthService } from '../services/auth';
import { createRunService } from '../services/runs';
import { RUNNER_TOKEN, startFakeRunner } from '../test/fake-runner';
import { testEnv, useTestDatabase } from '../test/helpers';
import { attachCollabServer, CloseCode } from '../yjs/collab-server';
import { attachSocketServer } from '.';

useTestDatabase();

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const auth = createAuthService(testEnv);
let runner: Awaited<ReturnType<typeof startFakeRunner>>;
let server: Server;
let base: string;
let collab: ReturnType<typeof attachCollabServer>;
let sockets: ReturnType<typeof attachSocketServer>;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  runner = await startFakeRunner();
  // Wired exactly like src/index.ts, so this also checks the three servers share one port without clashing.
  server = createServer();
  collab = attachCollabServer(server, { auth, allowedOrigins: testEnv.CORS_ORIGINS });
  const runs = createRunService({
    runnerUrl: runner.url,
    runnerToken: RUNNER_TOKEN,
    liveText: collab.liveText,
    outputFlushMs: 5,
  });
  server.on('request', createApp(testEnv, auth, runs));
  sockets = attachSocketServer(server, { auth, allowedOrigins: testEnv.CORS_ORIGINS, runs });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  clients.splice(0).forEach((c) => c.disconnect());
});

afterAll(async () => {
  sockets.close();
  await collab.close();
  await new Promise((resolve) => server.close(resolve));
  await runner.close();
});

async function signUp(username: string) {
  const res = await request(server)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return res.body.accessToken as string;
}

async function createRoom(token: string, visibility: 'private' | 'public' = 'private') {
  const res = await request(server)
    .post('/api/v1/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Socket Room', language: 'python', visibility });
  return { slug: res.body.slug as string, fileId: res.body.files[0].id as string };
}

function connect(token?: string): ClientSocket {
  const client: ClientSocket = connectClient(base, {
    auth: token ? { token } : {},
    reconnection: false,
    forceNew: true,
  });
  clients.push(client);
  return client;
}

function connected(client: ClientSocket): Promise<void> {
  // It may have connected already, while the test was awaiting something else; 'connect' won't fire again.
  if (client.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

describe('handshake', () => {
  it.each([
    ['no token', undefined],
    ['a forged token', 'not-a-jwt'],
  ])('rejects a connection with %s', async (_label, token) => {
    await expect(connected(connect(token))).rejects.toThrow(SOCKET_UNAUTHORIZED);
  });

  it('accepts a valid access token', async () => {
    await expect(connected(connect(await signUp('alice')))).resolves.toBeUndefined();
  });

  it('leaves REST and the Yjs WebSocket working on the same port', async () => {
    expect((await request(server).get('/healthz')).status).toBe(200);
    const ws = new WebSocket(`${base.replace('http', 'ws')}/yjs/some-room/some-file`);
    const code = await new Promise<number>((resolve) => ws.on('close', resolve));
    expect(code).toBe(CloseCode.Unauthorized);
  });
});

describe('room:join', () => {
  it('joins a room I belong to and lists who is connected, once per person', async () => {
    const alice = await signUp('alice');
    const { slug } = await createRoom(alice);
    const tab1 = connect(alice);
    const tab2 = connect(alice);
    await Promise.all([connected(tab1), connected(tab2)]);

    await tab1.emitWithAck('room:join', { slug });
    const res = await tab2.emitWithAck('room:join', { slug });
    expect(res).toEqual({
      ok: true,
      data: {
        members: [
          {
            id: expect.any(String),
            username: 'alice',
            color: expect.stringMatching(/^hsl\(/),
            role: 'owner',
            status: 'online',
          },
        ],
      },
    });
  });

  it("refuses rooms I'm not a member of, unknown rooms and malformed payloads", async () => {
    const { slug } = await createRoom(await signUp('alice'));
    const bob = connect(await signUp('bob'));
    await connected(bob);

    expect(await bob.emitWithAck('room:join', { slug })).toEqual({
      ok: false,
      error: 'Join this room first',
    });
    expect(await bob.emitWithAck('room:join', { slug: 'missing' })).toEqual({
      ok: false,
      error: 'Room not found',
    });
    expect(
      await bob.emitWithAck('room:join', { slug: { $ne: null } } as unknown as { slug: string }),
    ).toEqual({ ok: false, error: 'Invalid room' });
  });
});

describe('run events', () => {
  it('reach everyone in the room, including viewers, and nobody outside it', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const { slug, fileId } = await createRoom(alice, 'public');
    await request(server)
      .post(`/api/v1/rooms/${slug}/join`)
      .set('Authorization', `Bearer ${bob}`)
      .send({});

    const owner = connect(alice);
    const viewer = connect(bob);
    const leaver = connect(bob);
    await Promise.all([connected(owner), connected(viewer), connected(leaver)]);
    for (const client of [owner, viewer, leaver]) await client.emitWithAck('room:join', { slug });
    leaver.emit('room:leave', { slug });
    // room:leave has no ack. Events from one socket are handled in order, so a round trip proves it was processed.
    await leaver.emitWithAck('room:join', { slug: 'elsewhere' });

    const received = new Map<ClientSocket, string[]>([
      [owner, []],
      [viewer, []],
      [leaver, []],
    ]);
    for (const [client, events] of received) {
      client.onAny((event: string) => events.push(event));
    }

    const res = await request(server)
      .post('/api/v1/runs')
      .set('Authorization', `Bearer ${alice}`)
      .send({ roomSlug: slug, fileId });
    expect(res.status).toBe(202);

    const expected = ['run:started', 'run:output', 'run:output', 'run:finished'];
    await vi.waitFor(() => {
      expect(received.get(owner)).toEqual(expected);
      expect(received.get(viewer)).toEqual(expected);
    });
    expect(received.get(leaver)).toEqual([]);
  });
});

describe('file events', () => {
  it('tell everyone in the room when the file list changes', async () => {
    const alice = await signUp('alice');
    const res = await request(server)
      .post('/api/v1/rooms')
      .set('Authorization', `Bearer ${alice}`)
      .send({ name: 'Socket Room', language: 'python' });
    const { slug, projectId } = res.body as { slug: string; projectId: string };
    const client = connect(alice);
    await connected(client);
    await client.emitWithAck('room:join', { slug });

    const changed = new Promise((resolve) => client.once('files:changed', resolve));
    await request(server)
      .post(`/api/v1/projects/${projectId}/files`)
      .set('Authorization', `Bearer ${alice}`)
      .send({ path: 'src/util.py' })
      .expect(201);
    expect(await changed).toEqual({
      by: 'alice',
      files: [
        { id: expect.any(String), path: 'main.py' },
        { id: expect.any(String), path: 'src/util.py' },
      ],
    });
  });
});

describe('presence', () => {
  /** Who each client was last told is in the room, as "username:status", sorted. */
  function watchPresence(client: ClientSocket) {
    const seen: { latest: string[] | null } = { latest: null };
    client.on('presence:update', ({ members }) => {
      seen.latest = members.map((m) => `${m.username}:${m.status}`).sort();
    });
    return seen;
  }

  /** Alice owns a public room that Bob has joined as a viewer. */
  async function setUp() {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const { slug } = await createRoom(alice, 'public');
    await request(server)
      .post(`/api/v1/rooms/${slug}/join`)
      .set('Authorization', `Bearer ${bob}`)
      .send({});
    return { alice, bob, slug };
  }

  it('tells everyone in the room when someone joins and leaves', async () => {
    const { alice, bob, slug } = await setUp();
    const aliceTab = connect(alice);
    await connected(aliceTab);
    const seenByAlice = watchPresence(aliceTab);
    await aliceTab.emitWithAck('room:join', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online']));

    const bobTab = connect(bob);
    await connected(bobTab);
    await bobTab.emitWithAck('room:join', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online', 'bob:online']));

    bobTab.emit('room:leave', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online']));
  });

  it('drops someone when their last tab disconnects, not before', async () => {
    const { alice, bob, slug } = await setUp();
    const aliceTab = connect(alice);
    const bobTab1 = connect(bob);
    const bobTab2 = connect(bob);
    await Promise.all([aliceTab, bobTab1, bobTab2].map(connected));
    const seenByAlice = watchPresence(aliceTab);
    for (const tab of [aliceTab, bobTab1, bobTab2]) await tab.emitWithAck('room:join', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online', 'bob:online']));

    bobTab1.disconnect();
    // Bob still has a tab open, so he stays; a round trip on that tab lets the server finish handling the disconnect.
    await bobTab2.emitWithAck('room:join', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online', 'bob:online']));

    bobTab2.disconnect();
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online']));
  });

  it('shows someone as idle only when all their tabs are idle', async () => {
    const { alice, bob, slug } = await setUp();
    const aliceTab = connect(alice);
    const bobTab1 = connect(bob);
    const bobTab2 = connect(bob);
    await Promise.all([aliceTab, bobTab1, bobTab2].map(connected));
    const seenByAlice = watchPresence(aliceTab);
    for (const tab of [aliceTab, bobTab1, bobTab2]) await tab.emitWithAck('room:join', { slug });

    bobTab1.emit('presence:status', { slug, status: 'idle' });
    await bobTab1.emitWithAck('room:join', { slug }); // round trip: the status change has been handled
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online', 'bob:online']));

    bobTab2.emit('presence:status', { slug, status: 'idle' });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online', 'bob:idle']));

    bobTab1.emit('presence:status', { slug, status: 'online' });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online', 'bob:online']));
  });

  it('ignores malformed status updates', async () => {
    const { alice, slug } = await setUp();
    const aliceTab = connect(alice);
    await connected(aliceTab);
    const seenByAlice = watchPresence(aliceTab);
    await aliceTab.emitWithAck('room:join', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online']));

    aliceTab.emit('presence:status', { slug, status: 'away' as 'idle' });
    aliceTab.emit('presence:status', null as unknown as { slug: string; status: 'idle' });
    await aliceTab.emitWithAck('room:join', { slug });
    await vi.waitFor(() => expect(seenByAlice.latest).toEqual(['alice:online']));
  });
});

describe('chat', () => {
  /** Alice and Bob (a viewer) are both in Alice's public room; Carol is connected but not a member. */
  async function setUp() {
    const aliceToken = await signUp('alice');
    const bobToken = await signUp('bob');
    const { slug } = await createRoom(aliceToken, 'public');
    await request(server)
      .post(`/api/v1/rooms/${slug}/join`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({});
    const alice = connect(aliceToken);
    const bob = connect(bobToken);
    const carol = connect(await signUp('carol'));
    await Promise.all([alice, bob, carol].map(connected));
    await alice.emitWithAck('room:join', { slug });
    await bob.emitWithAck('room:join', { slug });
    return { slug, alice, bob, carol };
  }

  it('saves a message, answers the sender and sends it to everyone else in the room', async () => {
    const { slug, alice, bob, carol } = await setUp();
    const toBob: unknown[] = [];
    const toAlice: unknown[] = [];
    const toCarol: unknown[] = [];
    bob.on('chat:new', (m) => toBob.push(m));
    alice.on('chat:new', (m) => toAlice.push(m));
    carol.on('chat:new', (m) => toCarol.push(m));

    const res = await alice.emitWithAck('chat:send', { slug, body: '  hello **room**  ' });
    expect(res).toEqual({
      ok: true,
      data: {
        id: expect.any(String),
        roomSlug: slug,
        author: { id: expect.any(String), username: 'alice' },
        body: 'hello **room**', // trimmed
        createdAt: expect.any(String),
      },
    });
    await vi.waitFor(() => expect(toBob).toEqual([res.ok && res.data]));
    // The sender has the ack; an outsider gets nothing.
    await bob.emitWithAck('room:join', { slug }); // round trip so any stray events have arrived
    expect(toAlice).toEqual([]);
    expect(toCarol).toEqual([]);
  });

  it('lets viewers chat, but not people outside the room', async () => {
    const { slug, bob, carol } = await setUp();
    expect((await bob.emitWithAck('chat:send', { slug, body: 'viewer here' })).ok).toBe(true);
    expect(await carol.emitWithAck('chat:send', { slug, body: 'let me in' })).toEqual({
      ok: false,
      error: 'Join this room first',
    });
  });

  it('rejects empty, oversized and malformed messages', async () => {
    const { slug, alice } = await setUp();
    expect(await alice.emitWithAck('chat:send', { slug, body: '   ' })).toEqual({
      ok: false,
      error: 'Write a message first',
    });
    expect((await alice.emitWithAck('chat:send', { slug, body: 'x'.repeat(2001) })).ok).toBe(false);
    expect(
      (
        await alice.emitWithAck('chat:send', { slug, body: { $ne: null } } as unknown as {
          slug: string;
          body: string;
        })
      ).ok,
    ).toBe(false);
  });

  it('limits how fast one socket can send', async () => {
    const { slug, alice } = await setUp();
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push((await alice.emitWithAck('chat:send', { slug, body: `spam ${i}` })).ok);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('relays typing to the others in the room, at most once per interval', async () => {
    const { slug, alice, bob } = await setUp();
    const seen: unknown[] = [];
    bob.on('chat:typing', (p) => seen.push(p));
    alice.emit('chat:typing', { slug });
    alice.emit('chat:typing', { slug }); // too soon: dropped
    await alice.emitWithAck('room:join', { slug }); // round trip
    await vi.waitFor(() =>
      expect(seen).toEqual([{ userId: expect.any(String), username: 'alice' }]),
    );
  });

  it('ignores typing for rooms the socket has not joined', async () => {
    const { slug, bob, carol } = await setUp();
    const seen: unknown[] = [];
    bob.on('chat:typing', (p) => seen.push(p));
    carol.emit('chat:typing', { slug });
    await carol.emitWithAck('room:join', { slug: 'elsewhere' }); // round trip
    await bob.emitWithAck('room:join', { slug });
    expect(seen).toEqual([]);
  });
});

describe('calls', () => {
  const on = { audio: true, video: true };
  const sdp = (type: 'offer' | 'answer') => ({ type, sdp: `v=0\r\n${type}` });

  /** Alice's public room, with `extra` other people who joined it as viewers, each connected and in the room. */
  async function setUp(extra: string[] = ['bob']) {
    const alice = await signUp('alice');
    const { slug } = await createRoom(alice, 'public');
    const tokens = [alice];
    for (const name of extra) {
      const token = await signUp(name);
      await request(server)
        .post(`/api/v1/rooms/${slug}/join`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      tokens.push(token);
    }
    const all = tokens.map((t) => connect(t));
    await Promise.all(all.map(connected));
    for (const c of all) await c.emitWithAck('room:join', { slug });
    return { slug, all };
  }

  type Roster = Parameters<ServerToClientEvents['call:roster']>[0];
  /**
   * The first call:roster a client receives that matches. Rosters from earlier changes can still be on their way
   * (the server answers the ack before telling the room), so waiting for "the next one" would be flaky.
   */
  const rosterWhere = (client: ClientSocket, match: (r: Roster) => boolean) =>
    new Promise<Roster>((resolve) => {
      const listener = (r: Roster) => {
        if (!match(r)) return;
        client.off('call:roster', listener);
        resolve(r);
      };
      client.on('call:roster', listener);
    });
  const names = (r: Roster) =>
    r.peers
      .map((p) => p.user.username)
      .sort()
      .join(',');
  const nextRoster = (client: ClientSocket) => rosterWhere(client, () => true);

  it('tells a new room member who is in the call', async () => {
    const { slug, all } = await setUp([]);
    const [alice] = all;
    await alice!.emitWithAck('call:join', { slug, media: on });

    const late = connect(await signUp('dora'));
    await connected(late);
    // dora isn't a member, so she gets nothing; a member who joins the room does.
    expect(await late.emitWithAck('room:join', { slug })).toMatchObject({ ok: false });
    const tab2 = connect(
      (
        await request(server).post('/api/v1/auth/login').send({
          email: 'alice@example.com',
          password: 'correct horse battery',
        })
      ).body.accessToken,
    );
    await connected(tab2);
    const roster = nextRoster(tab2);
    await tab2.emitWithAck('room:join', { slug });
    expect((await roster).peers).toEqual([
      { peerId: alice!.id, user: { id: expect.any(String), username: 'alice' }, media: on },
    ]);
  });

  it('joins, lists the others, and tells the whole room', async () => {
    const { slug, all } = await setUp(['bob', 'carol']);
    const [alice, bob, carol] = all;

    const first = await alice!.emitWithAck('call:join', { slug, media: on });
    expect(first).toEqual({ ok: true, data: { peerId: alice!.id, peers: [] } });

    // Carol isn't in the call but sees who is.
    const seen = rosterWhere(carol!, (r) => names(r) === 'alice,bob');
    const second = await bob!.emitWithAck('call:join', {
      slug,
      media: { audio: true, video: false },
    });
    expect(second).toEqual({
      ok: true,
      data: {
        peerId: bob!.id,
        peers: [
          { peerId: alice!.id, user: { id: expect.any(String), username: 'alice' }, media: on },
        ],
      },
    });
    expect((await seen).peers.map((p) => p.user.username).sort()).toEqual(['alice', 'bob']);

    // Changing media updates the roster; leaving removes the peer.
    let roster = rosterWhere(carol!, (r) => r.peers.some((p) => !p.media.audio));
    bob!.emit('call:media', { slug, media: { audio: false, video: false } });
    expect((await roster).peers.find((p) => p.peerId === bob!.id)?.media).toEqual({
      audio: false,
      video: false,
    });
    roster = rosterWhere(carol!, (r) => names(r) === 'alice');
    bob!.emit('call:leave', { slug });
    expect((await roster).peers.map((p) => p.peerId)).toEqual([alice!.id]);

    // Disconnecting counts as leaving.
    roster = rosterWhere(carol!, (r) => r.peers.length === 0);
    alice!.disconnect();
    expect((await roster).peers).toEqual([]);
  });

  it('needs the room joined first, and holds at most four', async () => {
    const { slug, all } = await setUp(['bob', 'carol', 'dave', 'erin']);
    const outsider = connect(await signUp('zed'));
    await connected(outsider);
    expect(await outsider.emitWithAck('call:join', { slug, media: on })).toEqual({
      ok: false,
      error: 'Join the room first',
    });

    const answers = await Promise.all(
      all.map((c) => c.emitWithAck('call:join', { slug, media: on })),
    );
    expect(answers.filter((a) => a.ok)).toHaveLength(4);
    expect(answers.filter((a) => !a.ok)).toEqual([
      { ok: false, error: 'The call is full (4 people at most)' },
    ]);
    expect(
      await all[0]!.emitWithAck('call:join', { slug, media: 'loud' } as unknown as {
        slug: string;
        media: { audio: boolean; video: boolean };
      }),
    ).toEqual({ ok: false, error: 'Invalid call' });
  });

  it('relays descriptions and candidates to one peer in the same call only', async () => {
    const { slug, all } = await setUp(['bob', 'carol']);
    const [alice, bob, carol] = all;
    await alice!.emitWithAck('call:join', { slug, media: on });
    await bob!.emitWithAck('call:join', { slug, media: on });

    const atBob = new Promise((resolve) => bob!.once('rtc:description', resolve));
    const iceAtBob = new Promise((resolve) => bob!.once('rtc:ice', resolve));
    const carolGot: string[] = [];
    carol!.onAny((event: string) => carolGot.push(event));

    alice!.emit('rtc:description', { to: bob!.id!, description: sdp('offer') });
    alice!.emit('rtc:ice', {
      to: bob!.id!,
      candidate: {
        candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    });
    expect(await atBob).toEqual({ from: alice!.id, description: sdp('offer') });
    expect(await iceAtBob).toMatchObject({ from: alice!.id, candidate: { sdpMid: '0' } });

    // Carol (in the room, not the call) can neither send nor receive signalling.
    const bobGot: string[] = [];
    bob!.onAny((event: string) => bobGot.push(event));
    carol!.emit('rtc:description', { to: bob!.id!, description: sdp('offer') });
    alice!.emit('rtc:description', { to: carol!.id!, description: sdp('offer') });
    // Malformed: a rollback isn't relayed, and neither is a huge SDP.
    alice!.emit('rtc:description', { to: bob!.id!, description: { type: 'rollback' } } as never);
    alice!.emit('rtc:description', {
      to: bob!.id!,
      description: { type: 'offer', sdp: 'x'.repeat(40 * 1024) },
    });
    // A round trip on each sender proves the server has handled the messages above.
    await carol!.emitWithAck('room:join', { slug });
    await alice!.emitWithAck('room:join', { slug });
    expect(bobGot.filter((e) => e.startsWith('rtc:'))).toEqual([]);
    expect(carolGot.filter((e) => e.startsWith('rtc:'))).toEqual([]);
  });

  it('leaves the call when leaving the room', async () => {
    const { slug, all } = await setUp(['bob']);
    const [alice, bob] = all;
    const inCall = rosterWhere(bob!, (r) => names(r) === 'alice');
    await alice!.emitWithAck('call:join', { slug, media: on });
    await inCall;
    const roster = rosterWhere(bob!, (r) => r.peers.length === 0);
    alice!.emit('room:leave', { slug });
    expect((await roster).peers).toEqual([]);
  });
});
