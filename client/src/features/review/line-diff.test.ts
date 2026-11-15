import { describe, expect, it } from 'vitest';
import { compareFile, compareSnapshots, editDistance, splitLines } from './line-diff';

const lines = (s: string) => s.split('');

/** Reference answer: n + m − 2·LCS, by dynamic programming. Slow, but obviously right. */
function slowDistance(a: string[], b: string[]): number {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      lcs[i]![j] =
        a[i - 1] === b[j - 1]
          ? lcs[i - 1]![j - 1]! + 1
          : Math.max(lcs[i - 1]![j]!, lcs[i]![j - 1]!);
    }
  }
  return a.length + b.length - 2 * lcs[a.length]![b.length]!;
}

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['abc', 'abd', 2],
    ['abcabba', 'cbabac', 5], // the example from Myers' paper
    ['xaby', 'ab', 2],
  ])('%s → %s takes %i edits', (a, b, d) => {
    expect(editDistance(lines(a), lines(b))).toBe(d);
  });

  it('agrees with the slow LCS answer on random inputs', () => {
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const word = () =>
      Array.from({ length: Math.floor(random() * 12) }, () => 'abc'[Math.floor(random() * 3)]!);
    for (let i = 0; i < 300; i++) {
      const a = word();
      const b = word();
      expect(editDistance(a, b), `${a.join('')} → ${b.join('')}`).toBe(slowDistance(a, b));
    }
  });

  it('gives up past the limit', () => {
    expect(editDistance(lines('aaaa'), lines('bbbb'), 7)).toBeNull();
    expect(editDistance(lines('aaaa'), lines('bbbb'), 8)).toBe(8);
  });
});

describe('compareFile', () => {
  it('counts added and removed lines', () => {
    expect(compareFile('a.py', 'a = 1\nb = 2\nprint(a)', 'a = 1\nb = 3\nc = 4\nprint(a)')).toEqual({
      path: 'a.py',
      status: 'modified',
      added: 2,
      removed: 1,
      approximate: false,
    });
  });

  it('handles new, deleted, unchanged and empty files', () => {
    expect(compareFile('n.py', null, 'x\ny')).toMatchObject({ status: 'added', added: 2 });
    expect(compareFile('d.py', 'x', null)).toMatchObject({ status: 'deleted', removed: 1 });
    expect(compareFile('u.py', 'x', 'x')).toMatchObject({ status: 'unchanged', added: 0 });
    expect(compareFile('e.py', null, '')).toMatchObject({ status: 'added', added: 0 });
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    // Only the final newline differs: changed, but no line was added or removed.
    expect(compareFile('t.py', 'a\n', 'a')).toMatchObject({
      status: 'modified',
      added: 0,
      removed: 0,
    });
  });

  it('calls very different big files rewritten', () => {
    const a = Array.from({ length: 6000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 6000 }, (_, i) => `b${i}`).join('\n');
    expect(compareFile('big.txt', a, b)).toEqual({
      path: 'big.txt',
      status: 'modified',
      added: 6000,
      removed: 6000,
      approximate: true,
    });
  });
});

describe('compareSnapshots', () => {
  it('lists every path from both versions, sorted', () => {
    const changes = compareSnapshots(
      [
        { path: 'main.py', content: 'print(1)' },
        { path: 'old.py', content: 'x' },
      ],
      [
        { path: 'lib/new.py', content: 'y' },
        { path: 'main.py', content: 'print(1)' },
      ],
    );
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['lib/new.py', 'added'],
      ['main.py', 'unchanged'],
      ['old.py', 'deleted'],
    ]);
  });

  it('treats a missing base as an empty project', () => {
    expect(compareSnapshots(null, [{ path: 'a.py', content: 'x' }])[0]!.status).toBe('added');
  });
});
