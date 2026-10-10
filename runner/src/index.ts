import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 5050);
const TOKEN = process.env.RUNNER_TOKEN ?? '';

if (TOKEN.length < 8) {
  console.error('RUNNER_TOKEN must be set (min 8 chars). Copy runner/.env.example to runner/.env.');
  process.exit(1);
}

function isAuthorised(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const actual = Buffer.from(header);
  // [CONCEPT: Timing-Safe Comparison] Prevents guessing the token one character at a time from response timing.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// The runner is only reachable on the internal Docker network; the API calls it with a shared token.
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { status: 'ok' });
  if (!isAuthorised(req)) return json(res, 401, { error: 'Unauthorised' });

  if (req.method === 'POST' && req.url === '/runs') {
    // Week 1, Days 6–7: write code to a temp dir, spawn `docker` with buildDockerArgs(),
    // stream stdout/stderr back as chunked NDJSON, kill the container after RUN_TIMEOUT_MS.
    return json(res, 501, { error: 'Not implemented yet' });
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`Runner listening on http://localhost:${PORT}`));
