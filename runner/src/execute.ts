import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import type { RunEvent, RunRequest, RunResult, RunVerdict } from '@devverse/shared';
import {
  buildCreateArgs,
  DEFAULT_LIMITS,
  MAX_OUTPUT_BYTES,
  SANDBOX_IMAGES,
  type SandboxLimits,
} from './sandbox';

const execFileAsync = promisify(execFile);
const CONTAINER_PREFIX = 'devverse-run-';

export interface ExecuteOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  limits?: SandboxLimits;
  /**
   * Where code files are written before being mounted into the sandbox. When the runner itself runs in a container
   * and talks to the host's Docker, this must be a host directory mounted at the *same path* inside the runner,
   * because Docker resolves bind-mount paths on the host.
   */
  workDir?: string;
  /** Aborts the run (e.g. the API hung up). */
  signal?: AbortSignal;
}

/** The runner itself failed (Docker missing, image not built…), as opposed to the user's program failing. */
export class RunnerError extends Error {}

const docker = (args: string[], timeout = 15_000) =>
  execFileAsync('docker', args, { timeout, maxBuffer: 1024 * 1024 });

/**
 * Runs untrusted code in a throwaway container and streams its output through `emit`.
 *
 * [CONCEPT: Process Isolation] The program never runs in the runner's own process: it gets its own container with
 * no network, a read-only filesystem, capped memory/CPU/processes and a non-root user (see sandbox.ts).
 */
export async function executeRun(
  request: RunRequest,
  emit: (event: RunEvent) => void,
  options: ExecuteOptions = {},
): Promise<RunResult> {
  const sandbox = SANDBOX_IMAGES[request.language];
  const {
    timeoutMs = sandbox.timeoutMs,
    maxOutputBytes = MAX_OUTPUT_BYTES,
    limits = DEFAULT_LIMITS,
    workDir = tmpdir(),
    signal,
  } = options;
  const name = `${CONTAINER_PREFIX}${randomUUID()}`;
  const codeDir = await mkdtemp(join(workDir, CONTAINER_PREFIX));

  try {
    // mkdtemp creates the folder as 0700 (owner only); the sandbox user (uid 1000) needs to read it.
    await chmod(codeDir, 0o755);
    // [CONCEPT: Command Injection Prevention] The code is written to a file and mounted read-only. It is never
    // pasted into a shell command, and docker is spawned without a shell, so nothing in it is ever interpreted.
    await writeFile(join(codeDir, sandbox.file), request.code, { mode: 0o644 });

    try {
      await docker(buildCreateArgs(request.language, codeDir, name, limits));
    } catch (err) {
      throw new RunnerError(
        `Could not create the sandbox: ${(err as { stderr?: string }).stderr?.trim() || err}`,
      );
    }
    return await startAndWatch(name, request.stdin, emit, { timeoutMs, maxOutputBytes, signal });
  } finally {
    // Always clean up, whatever happened: the container and the code on disk.
    await docker(['rm', '--force', name]).catch(() => undefined);
    await rm(codeDir, { recursive: true, force: true });
  }
}

function startAndWatch(
  name: string,
  stdin: string,
  emit: (event: RunEvent) => void,
  {
    timeoutMs,
    maxOutputBytes,
    signal,
  }: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    // No shell, arguments as an array: see Command Injection Prevention above.
    const child = spawn('docker', ['start', '--attach', '--interactive', name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    emit({ type: 'started' });

    let outputBytes = 0;
    let truncated = false;
    let killedFor: RunVerdict | null = null;

    // [CONCEPT: Killing a Container, Not Just a Process] Killing the `docker start` client would only detach from the
    // container, which would keep running. `docker kill` stops the program itself.
    let exited = false;
    const kill = (reason: RunVerdict) => {
      if (killedFor) return;
      killedFor = reason;
      // If the container hasn't reached "running" yet, `docker kill` fails: keep trying until the run has ended.
      const attempt = () =>
        docker(['kill', name]).catch(() => {
          if (!exited) setTimeout(attempt, 250);
        });
      void attempt();
    };

    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const onAbort = () => kill('error');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    // [CONCEPT: Output Limits] A `while True: print(...)` would otherwise stream gigabytes to every user in the room.
    const forward = (stream: 'stdout' | 'stderr') => {
      // A StringDecoder never splits a multi-byte character (é, emoji) across two chunks.
      const decoder = new StringDecoder('utf8');
      child[stream].on('data', (data: Buffer) => {
        if (truncated) return;
        const remaining = maxOutputBytes - outputBytes;
        const piece = data.length > remaining ? data.subarray(0, remaining) : data;
        outputBytes += piece.length;
        const chunk = decoder.write(piece);
        if (chunk) emit({ type: 'output', stream, chunk });
        if (data.length > remaining) {
          truncated = true;
          kill('output-limit');
        }
      });
      child[stream].on('end', () => {
        const rest = decoder.end();
        if (rest && !truncated) emit({ type: 'output', stream, chunk: rest });
      });
    };
    forward('stdout');
    forward('stderr');

    // The program may exit without reading its input; writing to a closed pipe is then expected, not an error.
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new RunnerError(`Could not start docker: ${err.message}`));
    });

    child.on('close', async (exitCode) => {
      exited = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startedAt;
      const oomKilled = await docker(['inspect', '--format', '{{.State.OOMKilled}}', name])
        .then(({ stdout }) => stdout.trim() === 'true')
        .catch(() => false);

      // Our own kill reasons win; a SIGKILL from the kernel's OOM killer looks like any other exit 137.
      const verdict: RunVerdict =
        killedFor ?? (oomKilled ? 'memory' : exitCode === 0 ? 'ok' : 'error');
      resolve({ verdict, exitCode, durationMs, truncated });
    });
  });
}

/**
 * Removes sandbox containers left behind by a crash or a hard restart of the runner.
 * [CONCEPT: Crash Recovery] Cleanup in `finally` doesn't run if the process itself dies, so sweep at start-up.
 */
export async function removeLeftoverContainers(): Promise<number> {
  const { stdout } = await docker([
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `name=${CONTAINER_PREFIX}`,
  ]);
  const ids = stdout.split('\n').filter(Boolean);
  if (ids.length > 0) await docker(['rm', '--force', ...ids]);
  return ids.length;
}

/** Which sandbox images are built on this machine, for the health check. */
export async function availableImages(): Promise<string[]> {
  const images = [...new Set(Object.values(SANDBOX_IMAGES).map((s) => s.image))];
  const present = await Promise.all(
    images.map((image) =>
      docker(['image', 'inspect', '--format', '{{.Id}}', image]).then(
        () => image,
        () => null,
      ),
    ),
  );
  return present.filter((image): image is string => image !== null);
}
