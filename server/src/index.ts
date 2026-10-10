import { createServer } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { loadEnv } from './config/env';
import { logger } from './utils/logger';

const env = loadEnv();
const app = createApp(env);

// A raw HTTP server (not app.listen) so Socket.IO and the Yjs WebSocket server can share the same port.
const server = createServer(app);

async function start() {
  await connectDatabase(env.MONGODB_URI);
  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

// [CONCEPT: Graceful Shutdown] Stop accepting connections, finish in-flight requests, then close the DB.
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
