import { createServer } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { loadEnv } from './config/env';
import { createAuthService } from './services/auth';
import { createRunService, markInterruptedRuns } from './services/runs';
import { attachSocketServer } from './sockets';
import { logger } from './utils/logger';
import { attachCollabServer } from './yjs/collab-server';

const env = loadEnv();
const auth = createAuthService(env);

// A raw HTTP server (not app.listen) so Socket.IO and the Yjs WebSocket server can share the same port.
const server = createServer();
const collab = attachCollabServer(server, { auth, allowedOrigins: env.CORS_ORIGINS });
const runs = createRunService({
  runnerUrl: env.RUNNER_URL,
  runnerToken: env.RUNNER_TOKEN,
  liveText: collab.liveText,
});
// Express must be listening before Socket.IO attaches: Socket.IO takes over the existing 'request' listeners and
// passes on everything outside /socket.io/. Added afterwards, Express would also answer Socket.IO's own requests.
server.on('request', createApp(env, auth, runs));
const sockets = attachSocketServer(server, { auth, allowedOrigins: env.CORS_ORIGINS, runs });

async function start() {
  await connectDatabase(env.MONGODB_URI);
  await markInterruptedRuns();
  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

// [CONCEPT: Graceful Shutdown] Stop accepting connections, finish in-flight requests, then close the DB.
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  // Open WebSockets would keep server.close() waiting forever, and documents and runs must be saved while the DB
  // is up.
  sockets.close();
  void Promise.allSettled([collab.close(), runs.close()]).finally(() =>
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    }),
  );
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
