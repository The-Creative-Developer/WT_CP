import type { AddressInfo } from 'node:net';
import type { RunEvent } from '@devverse/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { RunnerError } from './execute';
import { createRunnerServer, type Executor } from './server';

const TOKEN = 'test-runner-token';
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function start(execute: Executor, maxConcurrent = 2) {
  const server = createRunnerServer({ token: TOKEN, maxConcurrent, execute });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  close = () => new Promise((resolve) => server.close(() => resolve()));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return (body: unknown, token = TOKEN, init: RequestInit = {}) =>
    fetch(`${base}/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    });
}

const valid = { language: 'python', code: 'print(1)' };
const lines = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);

const echoExecutor: Executor = async (request, emit) => {
  emit({ type: 'started' });
  emit({ type: 'output', stream: 'stdout', chunk: `ran ${request.language}\n` });
  return { verdict: 'ok', exitCode: 0, durationMs: 5, truncated: false };
};

describe('runner HTTP server', () => {
  it('rejects a wrong token', async () => {
    const post = await start(echoExecutor);
    expect((await post(valid, 'wrong-token-value')).status).toBe(401);
  });

  it('validates the body', async () => {
    const post = await start(echoExecutor);
    expect((await post('not json')).status).toBe(400);
    const invalid = await post({ language: 'cobol', code: 1 });
    expect(invalid.status).toBe(422);
    const { errors } = (await invalid.json()) as { errors: Record<string, string[]> };
    expect(Object.keys(errors).sort()).toEqual(['code', 'language']);
  });

  it('refuses oversized bodies with 413', async () => {
    const post = await start(echoExecutor);
    const res = await post({ ...valid, code: 'x'.repeat(600 * 1024) });
    expect(res.status).toBe(413);
  });

  it('streams events as NDJSON and ends with the result', async () => {
    const post = await start(echoExecutor);
    const res = await post(valid);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect(await lines(res)).toEqual([
      { type: 'started' },
      { type: 'output', stream: 'stdout', chunk: 'ran python\n' },
      { type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 5, truncated: false },
    ]);
  });

  it('reports runner failures as a "failed" event', async () => {
    const post = await start(async () => {
      throw new RunnerError('Could not create the sandbox: image missing');
    });
    expect(await lines(await post(valid))).toEqual([
      { type: 'failed', message: 'Could not create the sandbox: image missing' },
    ]);
  });

  it('answers 503 with Retry-After when every slot is busy', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const post = await start(async () => {
      await held;
      return { verdict: 'ok', exitCode: 0, durationMs: 1, truncated: false };
    }, 1);

    const first = post(valid);
    await new Promise((r) => setTimeout(r, 50)); // let the first run take the only slot
    const second = await post(valid);
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('1');

    release();
    expect((await first).status).toBe(200);
  });

  it('aborts the run when the caller disconnects', async () => {
    let aborted!: (value: boolean) => void;
    const wasAborted = new Promise<boolean>((resolve) => (aborted = resolve));
    const post = await start(
      (_req, emit, { signal }) =>
        new Promise((resolve) => {
          emit({ type: 'started' });
          signal?.addEventListener('abort', () => {
            aborted(true);
            resolve({ verdict: 'error', exitCode: null, durationMs: 1, truncated: false });
          });
        }),
    );

    const controller = new AbortController();
    const res = await post(valid, TOKEN, { signal: controller.signal });
    await res.body!.getReader().read(); // the "started" line
    controller.abort();
    expect(await wasAborted).toBe(true);
  });
});
