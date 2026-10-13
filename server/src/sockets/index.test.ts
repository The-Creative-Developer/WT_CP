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
