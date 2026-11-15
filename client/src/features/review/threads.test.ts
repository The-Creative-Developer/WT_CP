import type { ReviewComment } from '@devverse/shared';
import { describe, expect, it } from 'vitest';
import { canResolve, groupThreads, threadCounts } from './threads';

let n = 0;
function comment(over: Partial<ReviewComment>): ReviewComment {
  n++;
  return {
    id: `c${n}`,
    author: { id: 'u1', username: 'ada' },
    path: 'main.py',
    line: 1,
    body: `comment ${n}`,
    parentId: null,
    resolved: false,
    createdAt: new Date(2026, 10, 15, 9, n).toISOString(),
    editedAt: null,
    ...over,
  };
}

describe('groupThreads', () => {
  it('puts replies under their thread and sorts by file, line, then time', () => {
    const late = comment({ path: 'b.py', line: 1 });
    const root = comment({ line: 9 });
    const early = comment({ line: 2 });
    const reply = comment({ parentId: root.id, line: 9 });
    const threads = groupThreads([late, root, early, reply]);
    expect(threads.map((t) => [t.path, t.line, t.comments.map((c) => c.id)])).toEqual([
      ['b.py', 1, [late.id]],
      ['main.py', 2, [early.id]],
      ['main.py', 9, [root.id, reply.id]],
    ]);
  });

  it('counts threads per file, and the open ones', () => {
    const threads = groupThreads([
      comment({}),
      comment({ resolved: true }),
      comment({ path: 'x.py' }),
    ]);
    expect(threadCounts(threads)).toEqual(
      new Map([
        ['main.py', { total: 2, open: 1 }],
        ['x.py', { total: 1, open: 1 }],
      ]),
    );
  });
});

describe('canResolve', () => {
  const [thread] = groupThreads([comment({ author: { id: 'starter', username: 's' } })]);
  it('lets editors, the requester and the thread starter resolve', () => {
    expect(canResolve(thread!, { id: 'x', role: 'editor' }, 'req')).toBe(true);
    expect(canResolve(thread!, { id: 'req', role: 'viewer' }, 'req')).toBe(true);
    expect(canResolve(thread!, { id: 'starter', role: 'viewer' }, 'req')).toBe(true);
    expect(canResolve(thread!, { id: 'x', role: 'viewer' }, 'req')).toBe(false);
  });
});
