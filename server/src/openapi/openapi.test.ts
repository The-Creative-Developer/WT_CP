import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createApp } from '../app';
import { createAuthService } from '../services/auth';
import { postMessage } from '../services/chat';
import { createRunService } from '../services/runs';
import { testEnv, useTestDatabase } from '../test/helpers';
import { buildOpenApiDocument, requestSchemas } from './document';
import * as schemas from './schemas';
import { OPENAPI_YAML_PATH, renderOpenApiYaml } from './yaml';

useTestDatabase();

// A run service that is never asked to run anything here: it only makes /runs exist.
const auth = createAuthService(testEnv);
const runs = createRunService({
  runnerUrl: 'http://127.0.0.1:9',
  runnerToken: 'unused',
});
const app = createApp(testEnv, auth, runs);
const document = buildOpenApiDocument();
type RequestBody = {
  content: { 'application/json': { schema: { $ref: string }; example: unknown } };
};

async function signUp(username: string) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'correct horse battery' });
  return { res, header: `Bearer ${res.body.accessToken}`, user: res.body.user as { id: string } };
}

/** Fails with Zod's explanation (which field, what was wrong) rather than a bare "expected true". */
function expectMatches(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  expect(result.success, result.error?.message).toBe(true);
}

describe('docs/openapi.yaml', () => {
  it('is up to date with the code (run `npm run openapi` if not)', async () => {
    expect(await readFile(OPENAPI_YAML_PATH, 'utf8')).toBe(renderOpenApiYaml());
  });
});

describe('the OpenAPI document', () => {
  it('only references things it defines', () => {
    const refs = JSON.stringify(document).match(/"\$ref":"[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      const pointer = ref.slice(8, -1).replace(/^#\//, '').split('/');
      const target = pointer.reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        document,
      );
      expect(target, ref).toBeDefined();
    }
  });

  it('gives example bodies that the API would accept', () => {
    const bodies = Object.values(document.paths).flatMap((item) =>
      Object.values(item as Record<string, { requestBody?: RequestBody }>).flatMap((op) =>
        op.requestBody ? [op.requestBody.content['application/json']] : [],
      ),
    );
    expect(bodies.length).toBeGreaterThan(5);
    for (const { schema, example } of bodies) {
      const name = schema.$ref.split('/').pop() as keyof typeof requestSchemas;
      const result = requestSchemas[name].safeParse(example);
      expect(result.success, `${name}: ${result.error?.message}`).toBe(true);
    }
  });

  it('documents only routes that exist', async () => {
    const { header } = await signUp('router');
    const ops = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item as object)
        .filter((key) => ['get', 'post', 'patch', 'delete'].includes(key))
        .map((method) => ({ path, method: method as 'get' | 'post' | 'patch' | 'delete' })),
    );
    expect(ops.length).toBeGreaterThan(20);

    for (const { path, method } of ops) {
      const url =
        (path === '/healthz' ? '' : '/api/v1') +
        path.replace(/\{\w+\}/g, '0123456789abcdef01234567');
      const res = await request(app)[method](url).set('Authorization', header).send({});
      // A missing route answers "No route for ..."; a real one fails (or succeeds) for its own reasons.
      expect(res.body.title ?? '', `${method.toUpperCase()} ${path}`).not.toMatch(/^No route for/);
    }
  });
});

describe('responses match the documented schemas', () => {
  it('auth, profile, rooms, files and chat', async () => {
    const alice = await signUp('alice');
    expectMatches(schemas.authResponse, alice.res.body);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'correct horse battery' });
    expectMatches(schemas.authResponse, login.body);

    const me = await request(app).get('/api/v1/users/me').set('Authorization', alice.header);
    expectMatches(schemas.selfUser, me.body);
    const patched = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', alice.header)
      .send({ bio: 'Hello', avatarUrl: 'https://example.com/a.png' });
    expectMatches(schemas.selfUser, patched.body);

    const created = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', alice.header)
      .send({ name: 'Contract Room', language: 'python' });
    expect(created.status).toBe(201);
    expectMatches(schemas.roomDetail, created.body);
    const { slug, projectId, inviteCode } = created.body;

    const list = await request(app).get('/api/v1/rooms').set('Authorization', alice.header);
    expectMatches(schemas.roomSummary.array().min(1), list.body);

    const bob = await signUp('bob');
    const joined = await request(app)
      .post(`/api/v1/rooms/${slug}/join`)
      .set('Authorization', bob.header)
      .send({ inviteCode });
    expectMatches(schemas.roomDetail, joined.body);
    const seen = await request(app).get(`/api/v1/rooms/${slug}`).set('Authorization', bob.header);
    expectMatches(schemas.roomDetail, seen.body);

    const files = `/api/v1/projects/${projectId}`;
    const file = await request(app)
      .post(`${files}/files`)
      .set('Authorization', alice.header)
      .send({ path: 'lib/util.py' });
    expect(file.status).toBe(201);
    expectMatches(schemas.fileSummary, file.body);
    const renamed = await request(app)
      .patch(`${files}/files/${file.body.id}`)
      .set('Authorization', alice.header)
      .send({ path: 'lib/helpers.py' });
    expectMatches(schemas.fileSummary, renamed.body);
    const moved = await request(app)
      .patch(`${files}/folders`)
      .set('Authorization', alice.header)
      .send({ from: 'lib', to: 'src' });
    expectMatches(schemas.fileSummary.array().min(2), moved.body);
    const listed = await request(app).get(`${files}/files`).set('Authorization', bob.header);
    expectMatches(schemas.fileSummary.array().min(2), listed.body);

    await postMessage({ id: alice.user.id, username: 'alice' }, slug, 'Hi Bob');
    const page = await request(app)
      .get(`/api/v1/rooms/${slug}/messages?limit=5`)
      .set('Authorization', bob.header);
    expectMatches(schemas.messagePage, page.body);
    expect(page.body.messages).toHaveLength(1);
  });

  it('versions and reviews', async () => {
    const alice = await signUp('alice');
    const room = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', alice.header)
      .send({ name: 'Review Contract', language: 'python' });
    const base = `/api/v1/projects/${room.body.projectId}`;

    const v1 = await request(app)
      .post(`${base}/snapshots`)
      .set('Authorization', alice.header)
      .send({ message: 'First' });
    expect(v1.status).toBe(201);
    expectMatches(schemas.snapshotDetail, v1.body);
    const v2 = await request(app)
      .post(`${base}/snapshots`)
      .set('Authorization', alice.header)
      .send({ message: 'Second' });
    const list = await request(app).get(`${base}/snapshots`).set('Authorization', alice.header);
    expectMatches(schemas.snapshotSummary.array().length(2), list.body);
    const one = await request(app)
      .get(`${base}/snapshots/${v1.body.id}`)
      .set('Authorization', alice.header);
    expectMatches(schemas.snapshotDetail, one.body);

    const review = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', alice.header)
      .send({ snapshotId: v2.body.id });
    expect(review.status).toBe(201);
    expectMatches(schemas.reviewDetail, review.body);
    const reviews = `/api/v1/reviews/${review.body.id}`;

    const comment = await request(app)
      .post(`${reviews}/comments`)
      .set('Authorization', alice.header)
      .send({ path: 'main.py', line: 1, body: 'Looks good' });
    expect(comment.status).toBe(201);
    expectMatches(schemas.reviewComment, comment.body);
    const resolved = await request(app)
      .patch(`${reviews}/comments/${comment.body.id}`)
      .set('Authorization', alice.header)
      .send({ resolved: true, body: 'Looks great' });
    expectMatches(schemas.reviewComment, resolved.body);

    const detail = await request(app).get(reviews).set('Authorization', alice.header);
    expectMatches(schemas.reviewDetail, detail.body);
    const listed = await request(app)
      .get('/api/v1/reviews')
      .query({ projectId: room.body.projectId })
      .set('Authorization', alice.header);
    expectMatches(schemas.reviewSummary.array().length(1), listed.body);
    const closed = await request(app)
      .patch(reviews)
      .set('Authorization', alice.header)
      .send({ status: 'closed' });
    expectMatches(schemas.reviewDetail, closed.body);
  });

  it('errors are problem details', async () => {
    const { header } = await signUp('carol');
    const missing = await request(app).get('/api/v1/rooms/nope').set('Authorization', header);
    expect(missing.status).toBe(404);
    expect(missing.type).toBe('application/problem+json');
    expectMatches(schemas.problem, missing.body);

    const invalid = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', header)
      .send({ name: 'x' });
    expect(invalid.status).toBe(422);
    expectMatches(schemas.problem, invalid.body);
    expect(invalid.body.errors).toHaveProperty('name');

    const anonymous = await request(app).get('/api/v1/users/me');
    expect(anonymous.status).toBe(401);
    expectMatches(schemas.problem, anonymous.body);
  });
});
