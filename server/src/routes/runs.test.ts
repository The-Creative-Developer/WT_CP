import type { RunDto } from '@devverse/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { File } from '../models/file';
import { Room } from '../models/room';
import { Run, RUN_TTL_SECONDS } from '../models/run';
import { createAuthService } from '../services/auth';
import {
  createRunService,
  markInterruptedRuns,
  readNdjson,
  type RunBroadcast,
  type RunServiceOptions,
} from '../services/runs';
import { deferred, RUNNER_TOKEN, startFakeRunner } from '../test/fake-runner';
import { testEnv, useTestDatabase } from '../test/helpers';

useTestDatabase();

const auth = createAuthService(testEnv);
let runner: Awaited<ReturnType<typeof startFakeRunner>>;
const liveTexts = new Map<string, string>();
const broadcasts: RunBroadcast[] = [];

function makeApp(options: Partial<RunServiceOptions> = {}) {
  const runs = createRunService({
    runnerUrl: runner.url,
    runnerToken: RUNNER_TOKEN,
    liveText: async (fileId) => liveTexts.get(fileId),
    maxRunsPerMinute: 5,
    outputFlushMs: 5,
    ...options,
  });
  runs.subscribe((b) => broadcasts.push(b));
  return { app: createApp(testEnv, auth, runs), runs };
}

let app: ReturnType<typeof makeApp>['app'];

beforeAll(async () => {
  runner = await startFakeRunner();
  ({ app } = makeApp());
});

afterEach(() => {
  runner.reset();
  liveTexts.clear();
  broadcasts.length = 0;
});

afterAll(() => runner.close());

let userCount = 0;
async function signUp(username = `user${++userCount}`): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return `Bearer ${res.body.accessToken}`;
}

/** A Python room owned by a new user. */
async function setUpRoom(visibility: 'private' | 'public' = 'private') {
  const owner = await signUp();
  const res = await request(app)
    .post('/api/v1/rooms')
    .set('Authorization', owner)
    .send({ name: 'Run Room', language: 'python', visibility });
  return { owner, slug: res.body.slug as string, fileId: res.body.files[0].id as string };
}

const startRun = (authHeader: string, body: object, target = app) =>
  request(target).post('/api/v1/runs').set('Authorization', authHeader).send(body);

const finishedEvent = (runId: string) =>
  vi.waitFor(
    () => {
      const found = broadcasts.find(
        (b): b is Extract<RunBroadcast, { event: 'run:finished' }> =>
          b.event === 'run:finished' && b.payload.runId === runId,
      );
      if (!found) throw new Error('not finished yet');
      return found;
    },
    { timeout: 5_000 },
  );

describe('POST /runs', () => {
  it('accepts the run with 202 + Location, then streams it to the room', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const res = await startRun(owner, { roomSlug: slug, fileId, stdin: '42\n' });

    expect(res.status).toBe(202);
    const run = res.body as RunDto;
    expect(res.headers.location).toBe(`/api/v1/runs/${run.id}`);
    expect(run).toMatchObject({ roomSlug: slug, fileId, language: 'python', verdict: null });
    expect(['queued', 'running']).toContain(run.status);

    await finishedEvent(run.id);
    const events = broadcasts.filter((b) => b.roomSlug === slug).map((b) => b.event);
    expect(events[0]).toBe('run:started');
    expect(events.at(-1)).toBe('run:finished');
    expect(broadcasts.filter((b) => b.event === 'run:output').map((b) => b.payload)).toEqual([
      { runId: run.id, stream: 'stdout', chunk: 'hello\n' },
      { runId: run.id, stream: 'stderr', chunk: 'warning\n' },
    ]);

    // The runner was called with the shared token, the saved file and the room's language.
    const saved = await File.findById(fileId).lean();
    expect(runner.requests).toEqual([
      {
        authorization: `Bearer ${RUNNER_TOKEN}`,
        request: { language: 'python', code: saved!.content, stdin: '42\n' },
      },
    ]);
  });

  it('runs what the room sees in the live editor, not the last saved copy', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    liveTexts.set(fileId, 'print("typed a second ago")');
    const res = await startRun(owner, { roomSlug: slug, fileId });
    await finishedEvent(res.body.id);
    expect(runner.requests[0]!.request.code).toBe('print("typed a second ago")');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/runs').send({});
    expect(res.status).toBe(401);
  });

  it('validates the body', async () => {
    const res = await startRun(await signUp(), { roomSlug: '', fileId: 'nope' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors).sort()).toEqual(['fileId', 'roomSlug']);
  });

  it('lets editors run code but not viewers or outsiders', async () => {
    const { slug, fileId } = await setUpRoom('public');
    const viewer = await signUp();
    await request(app).post(`/api/v1/rooms/${slug}/join`).set('Authorization', viewer).send({});

    const asViewer = await startRun(viewer, { roomSlug: slug, fileId });
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.title).toMatch(/viewers/i);

    const asOutsider = await startRun(await signUp(), { roomSlug: slug, fileId });
    expect(asOutsider.status).toBe(403);
    expect(runner.requests).toHaveLength(0);
  });

  it('404s for an unknown room, or a file from another room', async () => {
    const { owner, fileId } = await setUpRoom();
    const other = await setUpRoom();
    expect((await startRun(owner, { roomSlug: 'no-such-room', fileId })).status).toBe(404);
    expect((await startRun(other.owner, { roomSlug: other.slug, fileId })).status).toBe(404);
  });

  it('allows one run at a time per user', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const release = deferred();
    runner.respondWith(async (_req, res, send) => {
      send({ type: 'started' });
      await release.promise;
      send({ type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 1, truncated: false });
      res.end();
    });

    const first = await startRun(owner, { roomSlug: slug, fileId });
    const second = await startRun(owner, { roomSlug: slug, fileId });
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBe('2');

    release.resolve();
    await finishedEvent(first.body.id);
    expect((await startRun(owner, { roomSlug: slug, fileId })).status).toBe(202);
  });

  it('rate-limits each user per minute', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    for (let i = 0; i < 5; i++) {
      const res = await startRun(owner, { roomSlug: slug, fileId });
      expect(res.status).toBe(202);
      await finishedEvent(res.body.id);
    }
    const limited = await startRun(owner, { roomSlug: slug, fileId });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['content-type']).toContain('application/problem+json');
  });

  it('turns runs away with 503 + Retry-After when the queue is full', async () => {
    const { app: tinyApp } = makeApp({ concurrency: 1, maxQueued: 1 });
    const release = deferred();
    runner.respondWith(async (_req, res, send) => {
      send({ type: 'started' });
      await release.promise;
      send({ type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 1, truncated: false });
      res.end();
    });
    const { owner, slug, fileId } = await setUpRoom('public');
    const { owner: owner2, slug: slug2, fileId: fileId2 } = await setUpRoom();
    const { owner: owner3, slug: slug3, fileId: fileId3 } = await setUpRoom();

    const running = await startRun(owner, { roomSlug: slug, fileId }, tinyApp);
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    const queued = await startRun(owner2, { roomSlug: slug2, fileId: fileId2 }, tinyApp);
    const rejected = await startRun(owner3, { roomSlug: slug3, fileId: fileId3 }, tinyApp);

    expect([running.status, queued.status]).toEqual([202, 202]);
    expect(rejected.status).toBe(503);
    expect(rejected.headers['retry-after']).toBe('5');

    release.resolve();
    await finishedEvent(queued.body.id);
  });
});

describe('running', () => {
  it('waits and retries while the runner says it is busy', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    let calls = 0;
    runner.respondWith((request, res, send) => {
      if (++calls === 1) {
        res.writeHead(503, { 'Retry-After': '0' }).end();
        return;
      }
      send({ type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 3, truncated: false });
      res.end();
    });
    const res = await startRun(owner, { roomSlug: slug, fileId });
    expect((await finishedEvent(res.body.id)).payload).toMatchObject({
      verdict: 'ok',
      error: null,
    });
    expect(calls).toBe(2);
  });

  it('records a program that crashed as finished, with its verdict', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    runner.respondWith((_req, res, send) => {
      send({ type: 'output', stream: 'stderr', chunk: 'Traceback…\n' });
      send({ type: 'finished', verdict: 'error', exitCode: 1, durationMs: 9, truncated: false });
      res.end();
    });
    const { body } = await startRun(owner, { roomSlug: slug, fileId });
    await finishedEvent(body.id);
    const run = await request(app).get(`/api/v1/runs/${body.id}`).set('Authorization', owner);
    expect(run.body).toMatchObject({
      status: 'finished',
      verdict: 'error',
      exitCode: 1,
      stderr: 'Traceback…\n',
      error: null,
    });
  });

  it('marks the run failed when the runner itself fails', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    runner.respondWith((_req, res, send) => {
      send({ type: 'failed', message: 'Sandbox image is missing' });
      res.end();
    });
    const { body } = await startRun(owner, { roomSlug: slug, fileId });
    expect((await finishedEvent(body.id)).payload).toMatchObject({
      verdict: null,
      error: 'Sandbox image is missing',
    });
    expect(await Run.findById(body.id).lean()).toMatchObject({ status: 'failed' });
  });

  it('marks the run failed when the runner cannot be reached', async () => {
    const { app: unreachable } = makeApp({ runnerUrl: 'http://127.0.0.1:9' });
    const { owner, slug, fileId } = await setUpRoom();
    const { body } = await startRun(owner, { roomSlug: slug, fileId }, unreachable);
    expect((await finishedEvent(body.id)).payload.error).toBe('Could not reach the code runner');
  });

  it('stops runs and saves them as failed on shutdown', async () => {
    const { app: closing, runs } = makeApp();
    runner.respondWith((_req, _res, send) => send({ type: 'started' })); // never finishes
    const { owner, slug, fileId } = await setUpRoom();
    const { body } = await startRun(owner, { roomSlug: slug, fileId }, closing);
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));

    await runs.close();
    expect(await Run.findById(body.id).lean()).toMatchObject({
      status: 'failed',
      error: 'Interrupted because the server is restarting',
    });
  });
});

describe('GET /runs/:id', () => {
  it('shows the run to any member of its room, including viewers', async () => {
    const { owner, slug, fileId } = await setUpRoom('public');
    const viewer = await signUp('watcher');
    await request(app).post(`/api/v1/rooms/${slug}/join`).set('Authorization', viewer).send({});
    const { body } = await startRun(owner, { roomSlug: slug, fileId });
    await finishedEvent(body.id);

    const res = await request(app).get(`/api/v1/runs/${body.id}`).set('Authorization', viewer);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      id: body.id,
      status: 'finished',
      stdout: 'hello\n',
      stderr: 'warning\n',
      verdict: 'ok',
      exitCode: 0,
      durationMs: 42,
      by: { username: expect.any(String) },
    });
  });

  it('shows output so far while the run is still going', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const release = deferred();
    runner.respondWith(async (_req, res, send) => {
      send({ type: 'output', stream: 'stdout', chunk: 'partial\n' });
      await release.promise;
      send({ type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 1, truncated: false });
      res.end();
    });
    const { body } = await startRun(owner, { roomSlug: slug, fileId });
    await vi.waitFor(async () => {
      const res = await request(app).get(`/api/v1/runs/${body.id}`).set('Authorization', owner);
      expect(res.body).toMatchObject({ status: 'running', stdout: 'partial\n' });
    });
    release.resolve();
    await finishedEvent(body.id);
  });

  it('404s for outsiders, so run ids cannot be probed', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const { body } = await startRun(owner, { roomSlug: slug, fileId });
    await finishedEvent(body.id);

    const outsider = await signUp();
    const res = await request(app).get(`/api/v1/runs/${body.id}`).set('Authorization', outsider);
    expect(res.status).toBe(404);
    expect((await request(app).get('/api/v1/runs/nope').set('Authorization', owner)).status).toBe(
      404,
    );
  });
});

describe('GET /runs?room=', () => {
  const listRuns = (authHeader: string, query: string) =>
    request(app).get(`/api/v1/runs?${query}`).set('Authorization', authHeader);

  /** Saves a finished run directly, so tests control how old it is. */
  async function savedRun(slug: string, fileId: string, minutesAgo: number, stdout = '') {
    const room = await Room.findOne({ slug }).lean();
    return Run.create({
      userId: room!.ownerId,
      roomId: room!._id,
      fileId,
      language: 'python',
      status: 'finished',
      verdict: 'ok',
      exitCode: 0,
      durationMs: 5,
      stdout,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    });
  }

  it('is an empty list for a room that has never run anything', async () => {
    const { owner, slug } = await setUpRoom();
    const res = await listRuns(owner, `room=${slug}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("lists the room's runs newest first, up to the limit, with their authors", async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const other = await setUpRoom();
    await savedRun(slug, fileId, 3, 'oldest');
    await savedRun(slug, fileId, 1, 'newest');
    await savedRun(slug, fileId, 2, 'middle');
    await savedRun(other.slug, other.fileId, 0, 'another room');

    const latest = await listRuns(owner, `room=${slug}&limit=1`);
    expect(latest.headers['cache-control']).toBe('no-store');
    expect(latest.body).toEqual([
      expect.objectContaining({
        roomSlug: slug,
        stdout: 'newest',
        by: { id: expect.any(String), username: expect.stringMatching(/^user\d+$/) },
      }),
    ]);

    const all = await listRuns(owner, `room=${slug}`);
    expect(all.body.map((r: RunDto) => r.stdout)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('includes output so far for a run that is still going', async () => {
    const { owner, slug, fileId } = await setUpRoom();
    const release = deferred();
    runner.respondWith(async (_req, res, send) => {
      send({ type: 'output', stream: 'stdout', chunk: 'partial\n' });
      await release.promise;
      send({ type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 1, truncated: false });
      res.end();
    });
    const { body } = await startRun(owner, { roomSlug: slug, fileId });
    await vi.waitFor(async () => {
      const res = await listRuns(owner, `room=${slug}&limit=1`);
      expect(res.body).toEqual([
        expect.objectContaining({ id: body.id, status: 'running', stdout: 'partial\n' }),
      ]);
    });
    release.resolve();
    await finishedEvent(body.id);
  });

  it('lets viewers read the list, but not outsiders', async () => {
    const { slug } = await setUpRoom('public');
    const viewer = await signUp();
    await request(app).post(`/api/v1/rooms/${slug}/join`).set('Authorization', viewer).send({});
    expect((await listRuns(viewer, `room=${slug}`)).status).toBe(200);
    expect((await listRuns(await signUp(), `room=${slug}`)).status).toBe(403);
    expect((await listRuns(viewer, 'room=no-such-room')).status).toBe(404);
  });

  it('validates the query string', async () => {
    const owner = await signUp();
    const res = await listRuns(owner, 'limit=50');
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.errors).sort()).toEqual(['limit', 'room']);
    expect((await listRuns(owner, 'room=a&room=b')).status).toBe(422);
  });

  it('answers from the room index without sorting in memory', async () => {
    const { slug, fileId } = await setUpRoom();
    const room = await Room.findOne({ slug }).lean();
    for (let i = 0; i < 5; i++) await savedRun(slug, fileId, i);

    const explained = (await Run.find({ roomId: room!._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .explain('executionStats')) as unknown as {
      queryPlanner: { winningPlan: unknown };
      executionStats: { totalDocsExamined: number };
    };
    const plan = JSON.stringify(explained.queryPlanner.winningPlan);
    expect(plan).toContain('roomId_1_createdAt_-1__id_-1');
    expect(plan).not.toContain('"SORT"');
    expect(explained.executionStats.totalDocsExamined).toBe(1);
  });
});

describe('runs collection', () => {
  it('expires runs after 7 days with a TTL index', async () => {
    const indexes = await Run.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { createdAt: 1 }, expireAfterSeconds: RUN_TTL_SECONDS }),
    );
  });

  it('marks runs left over from a previous server process as failed', async () => {
    const leftover = await Run.create({
      userId: '0'.repeat(24),
      roomId: '0'.repeat(24),
      fileId: '0'.repeat(24),
      language: 'python',
      status: 'running',
    });
    await markInterruptedRuns();
    expect(await Run.findById(leftover.id).lean()).toMatchObject({ status: 'failed' });
  });
});

describe('readNdjson', () => {
  it('reassembles lines and characters split across network chunks', async () => {
    const bytes = new TextEncoder().encode(
      '{"type":"output","stream":"stdout","chunk":"é"}\n{"type":"started"}',
    );
    const splitInsideE = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitInsideE));
        controller.enqueue(bytes.slice(splitInsideE));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readNdjson(body)) events.push(event);
    expect(events).toEqual([{ type: 'output', stream: 'stdout', chunk: 'é' }, { type: 'started' }]);
  });
});
