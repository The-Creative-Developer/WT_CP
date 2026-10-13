import { execFileSync } from 'node:child_process';
import type { RunEvent, RunRequest } from '@devverse/shared';
import { describe, expect, it } from 'vitest';
import { availableImages, executeRun } from './execute';

// These tests start real containers. They are skipped when Docker or the sandbox images aren't available
// (build them with: npm run sandboxes:build -w runner -- node python).
const dockerReady = await availableImages()
  .then((images) =>
    ['devverse-sandbox-node', 'devverse-sandbox-python'].every((i) => images.includes(i)),
  )
  .catch(() => false);

async function run(request: Partial<RunRequest> & Pick<RunRequest, 'code'>, options = {}) {
  const events: RunEvent[] = [];
  const result = await executeRun(
    { language: 'python', stdin: '', ...request },
    (event) => events.push(event),
    { timeoutMs: 3000, ...options },
  );
  const text = (stream: 'stdout' | 'stderr') =>
    events
      .filter(
        (e): e is Extract<RunEvent, { type: 'output' }> =>
          e.type === 'output' && e.stream === stream,
      )
      .map((e) => e.chunk)
      .join('');
  return { result, events, stdout: text('stdout'), stderr: text('stderr') };
}

const leftoverContainers = () =>
  execFileSync('docker', ['ps', '--all', '--quiet', '--filter', 'name=devverse-run-'])
    .toString()
    .trim();

describe.skipIf(!dockerReady)('executeRun (real containers)', { timeout: 30_000 }, () => {
  it('runs JavaScript and streams its output', async () => {
    const { result, events, stdout } = await run({
      language: 'javascript',
      code: "console.log('hello from node', 1 + 1)",
    });
    expect(events[0]).toEqual({ type: 'started' });
    expect(stdout).toBe('hello from node 2\n');
    expect(result).toMatchObject({ verdict: 'ok', exitCode: 0, truncated: false });
  });

  it('passes stdin to the program and keeps Unicode intact', async () => {
    const { stdout } = await run({
      code: 'name = input()\nprint(f"héllo {name} 😀")',
      stdin: 'Ada\n',
    });
    expect(stdout).toBe('héllo Ada 😀\n');
  });

  it('reports a runtime error with its exit code and stderr', async () => {
    const { result, stderr } = await run({ code: 'raise ValueError("boom")' });
    expect(result).toMatchObject({ verdict: 'error', exitCode: 1 });
    expect(stderr).toContain('ValueError: boom');
  });

  it('kills an infinite loop at the time limit', async () => {
    const { result } = await run({ code: 'while True: pass' }, { timeoutMs: 1500 });
    expect(result.verdict).toBe('timeout');
    expect(result.durationMs).toBeLessThan(1500 + 4000);
  });

  it('stops a program that prints too much', async () => {
    const { result, stdout } = await run(
      { code: 'while True: print("x" * 1000)' },
      { maxOutputBytes: 10_000 },
    );
    expect(result).toMatchObject({ verdict: 'output-limit', truncated: true });
    expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(10_000);
  });

  it('kills a program that uses too much memory', async () => {
    // 256 MB limit; bytearray zero-fills, so every page is really touched.
    const { result } = await run({ code: 'b = bytearray(400 * 1024 * 1024)\nprint("survived")' });
    expect(result.verdict).toBe('memory');
  });

  it('has no network access', async () => {
    const { stdout } = await run({
      code: [
        'import socket',
        'try:',
        '    socket.create_connection(("1.1.1.1", 53), timeout=2)',
        '    print("CONNECTED")',
        'except OSError as e:',
        '    print("blocked")',
      ].join('\n'),
    });
    expect(stdout.trim()).toBe('blocked');
  });

  it('runs as a non-root user on a read-only filesystem, with a writable /tmp', async () => {
    const { stdout } = await run({
      code: [
        'import os',
        'print("uid", os.getuid())',
        'for path in ["/code/evil.py", "/etc/evil", "/home/evil", "/tmp/ok"]:',
        '    try:',
        '        open(path, "w").write("x")',
        '        print(path, "writable")',
        '    except OSError:',
        '        print(path, "blocked")',
      ].join('\n'),
    });
    expect(stdout).toBe(
      'uid 1000\n/code/evil.py blocked\n/etc/evil blocked\n/home/evil blocked\n/tmp/ok writable\n',
    );
  });

  it('contains a fork bomb with the process limit', async () => {
    const { result, stdout } = await run({
      code: [
        'import os',
        'children = 0',
        'try:',
        '    while True:',
        '        if os.fork() == 0:',
        '            import time; time.sleep(60)',
        '        children += 1',
        'except OSError:',
        '    print("fork refused after", children)',
      ].join('\n'),
    });
    expect(stdout).toMatch(/^fork refused after \d+\n/);
    expect(Number(stdout.match(/\d+/)![0])).toBeLessThan(64);
    expect(['ok', 'timeout']).toContain(result.verdict);
  });

  it('leaves no containers behind', async () => {
    await run({ code: 'print(1)' });
    expect(leftoverContainers()).toBe('');
  });
});
