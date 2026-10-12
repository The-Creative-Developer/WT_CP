import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { createApp } from '../app';
import { File } from '../models/file';
import { createAuthService } from '../services/auth';
import { testEnv, useTestDatabase } from '../test/helpers';
import { attachCollabServer, CloseCode } from './collab-server';
import { TEXT_NAME } from './shared-doc';

useTestDatabase();

const auth = createAuthService(testEnv);
const app = createApp(testEnv, auth);
let server: Server;
let collab: ReturnType<typeof attachCollabServer>;
let wsBase: string;
const providers: WebsocketProvider[] = [];

beforeAll(async () => {
  server = createServer(app);
  collab = attachCollabServer(server, { auth, allowedOrigins: testEnv.CORS_ORIGINS });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  wsBase = `ws://localhost:${(server.address() as AddressInfo).port}/yjs`;
});

afterEach(() => {
  providers.splice(0).forEach((p) => p.destroy());
});

afterAll(async () => {
  await collab.close();
  await new Promise((resolve) => server.close(resolve));
});

async function signUp(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return res.body.accessToken as string;
}

/** Alice owns a private room; returns its slug, its first file and an invite code. */
async function setUpRoom(body: object = { name: 'Live Room' }) {
  const owner = await signUp('alice');
  const res = await request(app)
    .post('/api/v1/rooms')
    .set('Authorization', `Bearer ${owner}`)
    .send(body);
  return {
    owner,
    slug: res.body.slug as string,
    fileId: res.body.files[0].id as string,
    invite: res.body.inviteCode,
  };
}

async function joinAs(username: string, slug: string, inviteCode?: string) {
  const token = await signUp(username);
  await request(app)
    .post(`/api/v1/rooms/${slug}/join`)
    .set('Authorization', `Bearer ${token}`)
    .send(inviteCode ? { inviteCode } : {});
  return token;
}

function connect(token: string, slug: string, fileId: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsBase, `${slug}/${fileId}`, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as never,
    disableBc: true, // BroadcastChannel would let test clients sync without the server
  });
  providers.push(provider);
  return { doc, provider, text: doc.getText(TEXT_NAME) };
}

const synced = (provider: WebsocketProvider) =>
  new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    else provider.once('sync', (isSynced: boolean) => isSynced && resolve());
  });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 4000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Opens a raw socket and resolves with the close code the server sends. */
function closeCodeFor(url: string, origin?: string) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    ws.on('close', (code) => resolve(code));
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => undefined);
    setTimeout(() => reject(new Error('no close')), 4000);
  });
}

describe('collaborative editing', () => {
  it('seeds the document from the starter file and syncs edits between editors', async () => {
    const { owner, slug, fileId, invite } = await setUpRoom();
    const bob = await joinAs('bob', slug, invite);

    const a = connect(owner, slug, fileId);
    const b = connect(bob, slug, fileId);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    expect(a.text.toString()).toContain("console.log('Hello from DevVerse!')");

    a.text.insert(0, '// from alice\n');
    b.text.insert(b.text.length, '// from bob\n');

    await eventually(() => a.text.toString() === b.text.toString());
    expect(a.text.toString()).toMatch(/^\/\/ from alice\n/);
    expect(a.text.toString()).toMatch(/\/\/ from bob\n$/);
  });

  it('shows each user to the others through awareness (cursors)', async () => {
    const { owner, slug, fileId, invite } = await setUpRoom();
    const bob = await joinAs('bob', slug, invite);
    const a = connect(owner, slug, fileId);
    const b = connect(bob, slug, fileId);
    await Promise.all([synced(a.provider), synced(b.provider)]);

    a.provider.awareness.setLocalStateField('user', { name: 'alice' });
    await eventually(() =>
      [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === 'alice'),
    );
  });

  it("ignores a viewer's edits", async () => {
    const { owner, slug, fileId } = await setUpRoom({ name: 'Open Room', visibility: 'public' });
    const viewer = await joinAs('vic', slug); // public room, no invite → viewer

    const a = connect(owner, slug, fileId);
    const v = connect(viewer, slug, fileId);
    await Promise.all([synced(a.provider), synced(v.provider)]);
    const original = a.text.toString();

    v.text.insert(0, 'HACKED ');
    a.text.insert(a.text.length, '// owner edit\n');

    // The viewer still receives the owner's edits...
    await eventually(() => v.text.toString().includes('// owner edit'));
    // ...but nobody else ever sees the viewer's.
    await new Promise((r) => setTimeout(r, 200));
    expect(a.text.toString()).toBe(`${original}// owner edit\n`);
  });

  it('saves to MongoDB when everyone leaves, and reloads without duplicating text', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const a = connect(owner, slug, fileId);
    await synced(a.provider);
    a.text.insert(0, '# saved\n');
    await eventually(() => a.text.toString().startsWith('# saved'));
    const expected = a.text.toString();

    providers.splice(0).forEach((p) => p.destroy());
    await eventually(async () => (await File.findById(fileId).lean())?.content === expected);
    const saved = await File.findById(fileId).select('+yState');
    expect(saved?.yState?.length).toBeGreaterThan(0);

    const again = connect(owner, slug, fileId);
    await synced(again.provider);
    expect(again.text.toString()).toBe(expected);
  });
});

describe('collab handshake', () => {
  it('rejects a missing or invalid token with 4401', async () => {
    const { slug, fileId } = await setUpRoom();
    expect(await closeCodeFor(`${wsBase}/${slug}/${fileId}`)).toBe(CloseCode.Unauthorized);
    expect(await closeCodeFor(`${wsBase}/${slug}/${fileId}?token=nope`)).toBe(
      CloseCode.Unauthorized,
    );
  });

  it('rejects non-members with 4403', async () => {
    const { slug, fileId } = await setUpRoom();
    const mallory = await signUp('mallory');
    expect(await closeCodeFor(`${wsBase}/${slug}/${fileId}?token=${mallory}`)).toBe(
      CloseCode.Forbidden,
    );
  });

  it('rejects a file from another room with 4404', async () => {
    const { owner, slug } = await setUpRoom();
    const other = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Other Room' });
    const foreignFile = other.body.files[0].id;
    expect(await closeCodeFor(`${wsBase}/${slug}/${foreignFile}?token=${owner}`)).toBe(
      CloseCode.NotFound,
    );
  });

  it('refuses the upgrade from an untrusted origin', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    expect(
      await closeCodeFor(`${wsBase}/${slug}/${fileId}?token=${owner}`, 'https://evil.example'),
    ).toBe(403);
  });
});
