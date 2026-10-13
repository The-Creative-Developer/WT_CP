import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runRequestSchema, type RunEvent, type RunRequest, type RunResult } from '@devverse/shared';
import { RunnerError, type ExecuteOptions } from './execute';

/** Code and stdin are capped at 64 KB each; JSON escaping can inflate them, so allow some headroom. */
const MAX_BODY_BYTES = 512 * 1024;

export type Executor = (
  request: RunRequest,
  emit: (event: RunEvent) => void,
  options: ExecuteOptions,
) => Promise<RunResult>;

interface RunnerServerOptions {
  token: string;
  maxConcurrent: number;
  execute: Executor;
  workDir?: string;
  /** Reported by /healthz so a missing image is obvious before anyone presses Run. */
  listImages?: () => Promise<string[]>;
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createRunnerServer({
  token,
  maxConcurrent,
  execute,
  workDir,
  listImages,
}: RunnerServerOptions) {
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;

  function isAuthorised(req: IncomingMessage): boolean {
    const actual = Buffer.from(req.headers.authorization ?? '');
    // [CONCEPT: Timing-Safe Comparison] Prevents guessing the token one character at a time from response timing.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async function handleRun(req: IncomingMessage, res: ServerResponse) {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      if (err instanceof BodyTooLarge) return json(res, 413, { error: 'Request body too large' });
      return json(res, 400, { error: 'Body must be JSON' });
    }
    const parsed = runRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json(res, 422, {
        error: 'Validation failed',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // [CONCEPT: Backpressure] Each run costs a container; past the limit, say "busy, try again shortly" instead of
    // letting runs pile up. The API's queue (Week 2) retries after Retry-After seconds.
    if (active >= maxConcurrent) {
      return json(res, 503, { error: 'Runner is busy' }, { 'Retry-After': '1' });
    }
    active++;

    // If the API gives up (or crashes) mid-run, stop the program instead of letting it run to the time limit.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    // [CONCEPT: NDJSON over Chunked Transfer] One JSON object per line, flushed as it happens. The response has no
    // Content-Length, so Node sends it with Transfer-Encoding: chunked.
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = (event: RunEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const result = await execute(parsed.data, emit, { workDir, signal: abort.signal });
      emit({ type: 'finished', ...result });
    } catch (err) {
      const message = err instanceof RunnerError ? err.message : 'Unexpected runner error';
      if (!(err instanceof RunnerError)) console.error(err);
      emit({ type: 'failed', message });
    } finally {
      active--;
      res.end();
    }
  }

  // The runner is only reachable on the internal Docker network; the API calls it with a shared token.
  return createServer((req, res) => {
    const url = req.url?.split('?')[0];
    if (req.method === 'GET' && url === '/healthz') {
      void (listImages?.() ?? Promise.resolve([])).then(
        (images) => json(res, 200, { status: 'ok', activeRuns: active, maxConcurrent, images }),
        () => json(res, 503, { status: 'degraded', error: 'Docker is not reachable' }),
      );
      return;
    }
    if (!isAuthorised(req)) return json(res, 401, { error: 'Unauthorised' });
    if (req.method === 'POST' && url === '/runs') return void handleRun(req, res);
    json(res, 404, { error: 'Not found' });
  });
}
