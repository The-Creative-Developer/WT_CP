import type { SnapshotFile } from '@devverse/shared';

export type ChangeStatus = 'added' | 'deleted' | 'modified' | 'unchanged';

export interface FileChange {
  path: string;
  status: ChangeStatus;
  /** Lines only in the new version. */
  added: number;
  /** Lines only in the old version. */
  removed: number;
  /** The files were too different to compare exactly; the counts treat every line as changed. */
  approximate: boolean;
}

/** Past this many edits, a comparison stops and calls the file rewritten. Keeps a huge diff from taking seconds. */
export const MAX_EDIT_DISTANCE = 5_000;

/**
 * The lines of a file, counted the way `git diff` does: "" has no lines, and a final newline ends the last line
 * rather than starting an empty one.
 */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * The fewest line insertions plus deletions that turn `a` into `b`, or null if it's more than `max`.
 *
 * [CONCEPT: Myers Diff Algorithm] The same algorithm as `git diff`. Picture a grid with `a` down one side and `b`
 * across the other: moving right is an insertion, down a deletion, and diagonally (a matching line) is free. The
 * search follows the furthest-reaching path on each diagonal k for 0, 1, 2… edits, and stops the first time a path
 * reaches the bottom-right corner. It costs O((N+M)·D) time for D edits, so near-identical files are fast, and here
 * O(N+M) memory, because only the count is needed, not the edit script.
 */
export function editDistance(a: string[], b: string[], max = MAX_EDIT_DISTANCE): number | null {
  // Matching lines at either end never need edits: trimming them shrinks the search a lot for typical changes.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return n + m <= max ? n + m : null;

  const limit = Math.min(max, n + m);
  const offset = limit + 1;
  // v[k + offset] = the furthest row reached on diagonal k (k = column − row).
  const v = new Int32Array(2 * limit + 3);
  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      // Step down from diagonal k+1 (a deletion) or right from k−1 (an insertion), whichever got further.
      const down = k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!);
      let x = down ? v[k + 1 + offset]! : v[k - 1 + offset]! + 1;
      let y = x - k;
      // Then slide along matching lines for free.
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return d;
    }
  }
  return null;
}

/** How a file changed between two versions. `before` or `after` is null when the file didn't exist. */
export function compareFile(path: string, before: string | null, after: string | null): FileChange {
  if (before === null) {
    const lines = splitLines(after ?? '').length;
    return { path, status: 'added', added: lines, removed: 0, approximate: false };
  }
  if (after === null) {
    const lines = splitLines(before).length;
    return { path, status: 'deleted', added: 0, removed: lines, approximate: false };
  }
  if (before === after) {
    return { path, status: 'unchanged', added: 0, removed: 0, approximate: false };
  }
  const a = splitLines(before);
  const b = splitLines(after);
  const d = editDistance(a, b);
  if (d === null) {
    return { path, status: 'modified', added: b.length, removed: a.length, approximate: true };
  }
  // d = insertions + deletions, and deletions − insertions = |a| − |b|, which gives both counts.
  return {
    path,
    status: 'modified',
    added: (d - a.length + b.length) / 2,
    removed: (d + a.length - b.length) / 2,
    approximate: false,
  };
}

/** Every file in either version, sorted by path. `base` is null when comparing with an empty project. */
export function compareSnapshots(base: SnapshotFile[] | null, head: SnapshotFile[]): FileChange[] {
  const before = new Map((base ?? []).map((f) => [f.path, f.content]));
  const after = new Map(head.map((f) => [f.path, f.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.map((path) => compareFile(path, before.get(path) ?? null, after.get(path) ?? null));
}
