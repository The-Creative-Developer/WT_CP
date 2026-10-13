import type { Language } from '@devverse/shared';

export interface SandboxLimits {
  memoryMb: number;
  cpus: number;
  pids: number;
  tmpSizeMb: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { memoryMb: 256, cpus: 0.5, pids: 64, tmpSizeMb: 16 };
/** Wall-clock limit per run, including container start-up (~0.3–1 s). */
export const RUN_TIMEOUT_MS = 5_000;
/**
 * C++ and Java compile before they run (~1–1.5 s on half a CPU, more on a slow VM). That time shouldn't come out of
 * the program's own 5 s, so they get this much extra.
 */
export const COMPILE_ALLOWANCE_MS = 3_000;
export const MAX_OUTPUT_BYTES = 64 * 1024;

/** Must match CPP_FLAGS in sandboxes/cpp/Dockerfile, or its precompiled <bits/stdc++.h> is silently ignored. */
export const CPP_FLAGS = ['-std=gnu++20', '-O2'];

export interface Sandbox {
  image: string;
  file: string;
  command: string[];
  timeoutMs: number;
}

export const SANDBOX_IMAGES: Record<Language, Sandbox> = {
  javascript: {
    image: 'devverse-sandbox-node',
    file: 'main.js',
    command: ['node', '/code/main.js'],
    timeoutMs: RUN_TIMEOUT_MS,
  },
  python: {
    image: 'devverse-sandbox-python',
    file: 'main.py',
    command: ['python3', '-u', '/code/main.py'],
    timeoutMs: RUN_TIMEOUT_MS,
  },
  cpp: {
    image: 'devverse-sandbox-cpp',
    file: 'main.cpp',
    // A fixed string: the user's code is a file, never part of this command. `exec` replaces the shell with the
    // program, so signals and the exit code reach it directly.
    command: [
      'sh',
      '-c',
      `g++ ${CPP_FLAGS.join(' ')} -o /tmp/a.out /code/main.cpp && exec /tmp/a.out`,
    ],
    timeoutMs: RUN_TIMEOUT_MS + COMPILE_ALLOWANCE_MS,
  },
  java: {
    image: 'devverse-sandbox-java',
    file: 'Main.java',
    command: [
      'java',
      '-Xmx128m', // heap cap, well inside the container's 256 MB (the JVM needs memory beyond the heap too)
      '-XX:+UseSerialGC', // one GC thread: there is only half a CPU, and threads count towards --pids-limit
      // [CONCEPT: JIT Compilation Tiers] Only the fast C1 compiler. On half a CPU, the optimising C2 compiler's
      // threads compete with the program itself; measured, start-up and a CPU-bound loop both ran about 2× faster.
      '-XX:TieredStopAtLevel=1',
      // The JVM logs its own warnings (e.g. "Failed to start thread") to stdout by default, mixing them into the
      // program's output. Send them to stderr instead.
      '-Xlog:disable',
      '-Xlog:all=warning:stderr',
      // Source-file mode: compiles in memory and runs in the same JVM. The class needn't be called Main.
      '/code/Main.java',
    ],
    timeoutMs: RUN_TIMEOUT_MS + COMPILE_ALLOWANCE_MS,
  },
};

// [CONCEPT: Sandboxing Untrusted Code] Every flag removes one capability an attacker could abuse.
// The user's code is mounted as a read-only file, never interpolated into a shell command.
export function buildCreateArgs(
  language: Language,
  hostCodeDir: string,
  containerName: string,
  limits: SandboxLimits = DEFAULT_LIMITS,
): string[] {
  const sandbox = SANDBOX_IMAGES[language];
  return [
    // create (then `docker start --attach`) rather than `run`: the container exists before the program starts, so
    // set-up errors are told apart from program errors and a timeout always has a container to kill.
    'create',
    // No --rm: after the program exits we ask Docker whether it was OOM-killed, then remove it ourselves.
    '--interactive', // keep stdin open so the program can read input
    '--pull=never', // only ever run our own pre-built images; never fetch one from a registry mid-run
    '--init', // a tiny init process reaps zombies and forwards signals (matters for fork bombs)
    `--name=${containerName}`,
    '--network=none', // no internet, no access to internal services
    `--memory=${limits.memoryMb}m`,
    `--memory-swap=${limits.memoryMb}m`, // equal to --memory, so no swap
    `--cpus=${limits.cpus}`,
    `--pids-limit=${limits.pids}`, // stops fork bombs
    '--read-only', // root filesystem cannot be modified
    `--tmpfs=/tmp:rw,exec,size=${limits.tmpSizeMb}m`, // small writable scratch space for compilers
    '--ulimit=nofile=256:256', // cap open files, so a program can't exhaust the host's file handles
    '--cap-drop=ALL', // no Linux capabilities
    '--security-opt=no-new-privileges', // setuid binaries cannot escalate
    '--user=1000:1000', // non-root inside the container
    `--volume=${hostCodeDir}:/code:ro`,
    '--workdir=/tmp',
    sandbox.image,
    ...sandbox.command,
  ];
}
