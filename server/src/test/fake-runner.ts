import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RunEvent, RunRequest } from '@devverse/shared';

export const RUNNER_TOKEN = 'test-runner-token';

export type FakeRunnerHandler = (
  request: RunRequest,
  res: ServerResponse,
  send: (event: RunEvent) => void,
) => void | Promise<void>;

/** By default: prints to both streams and exits 0, like a tiny successful program. */
export const succeed: FakeRunnerHandler = (_request, res, send) => {
  send({ type: 'started' });
  send({ type: 'output', stream: 'stdout', chunk: 'hello\n' });
  send({ type: 'output', stream: 'stderr', chunk: 'warning\n' });
  send({ type: 'finished', verdict: 'ok', exitCode: 0, durationMs: 42, truncated: false });
  res.end();
};

/**
 * A stand-in for the runner service that speaks the same HTTP + NDJSON protocol, so the API's queue and stream
 * parsing are tested for real without Docker.
 */
export async function startFakeRunner() {
  const requests: { request: RunRequest; authorization: string | undefined }[] = [];
  let handler: FakeRunnerHandler = succeed;

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw) as RunRequest;
    requests.push({ request, authorization: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${RUNNER_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    const send = (event: RunEvent) => {
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify(event)}\n`);
    };
    await handler(request, res, send);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  return {
    url: `http://localhost:${(server.address() as AddressInfo).port}`,
    requests,
    /** Replaces how the next runs are answered. */
    respondWith(next: FakeRunnerHandler) {
      handler = next;
    },
    reset() {
      handler = succeed;
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A promise you can resolve from outside, e.g. to hold a fake run open until the test says so. */
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
