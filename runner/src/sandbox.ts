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
export const MAX_OUTPUT_BYTES = 64 * 1024;

export const SANDBOX_IMAGES: Record<Language, { image: string; file: string; command: string[] }> =
  {
    javascript: {
      image: 'devverse-sandbox-node',
      file: 'main.js',
      command: ['node', '/code/main.js'],
    },
    python: {
      image: 'devverse-sandbox-python',
      file: 'main.py',
      command: ['python3', '-u', '/code/main.py'],
    },
    cpp: {
      image: 'devverse-sandbox-cpp',
      file: 'main.cpp',
      command: ['sh', '-c', 'g++ -O2 -o /tmp/a.out /code/main.cpp && /tmp/a.out'],
    },
    java: {
      image: 'devverse-sandbox-java',
      file: 'Main.java',
      command: ['sh', '-c', 'javac -d /tmp /code/Main.java && java -Xmx128m -cp /tmp Main'],
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
