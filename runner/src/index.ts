import { availableImages, executeRun, removeLeftoverContainers } from './execute';
import { createRunnerServer } from './server';

const PORT = Number(process.env.PORT ?? 5050);
const TOKEN = process.env.RUNNER_TOKEN ?? '';
const MAX_CONCURRENT_RUNS = Number(process.env.MAX_CONCURRENT_RUNS ?? 2);

if (TOKEN.length < 8) {
  console.error('RUNNER_TOKEN must be set (min 8 chars). Copy runner/.env.example to runner/.env.');
  process.exit(1);
}

const server = createRunnerServer({
  token: TOKEN,
  maxConcurrent: MAX_CONCURRENT_RUNS,
  execute: executeRun,
  workDir: process.env.RUNS_DIR || undefined,
  listImages: availableImages,
});

removeLeftoverContainers()
  .then((count) => count > 0 && console.log(`Removed ${count} leftover sandbox container(s)`))
  .catch(() => console.warn('Docker is not reachable yet; runs will fail until it is.'));

server.listen(PORT, () => console.log(`Runner listening on http://localhost:${PORT}`));
