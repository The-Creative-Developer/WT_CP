import { describe, expect, it } from 'vitest';
import { buildDockerArgs } from './sandbox';

describe('buildDockerArgs', () => {
  const args = buildDockerArgs('python', '/tmp/run-123', 'run-123');

  it.each([
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=1000:1000',
    '--pids-limit=64',
    '--memory=256m',
    '--memory-swap=256m',
  ])('includes hardening flag %s', (flag) => {
    expect(args).toContain(flag);
  });

  it('mounts the code read-only', () => {
    expect(args).toContain('--volume=/tmp/run-123:/code:ro');
  });

  it('ends with the image and command for the language', () => {
    expect(args.slice(-4)).toEqual(['devverse-sandbox-python', 'python3', '-u', '/code/main.py']);
  });
});
