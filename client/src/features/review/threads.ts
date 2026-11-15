import type { ReviewComment, RoomRole } from '@devverse/shared';

export interface Thread {
  /** The first comment's id, which replies point at. */
  id: string;
  path: string;
  line: number;
  resolved: boolean;
  /** The first comment, then replies, oldest first. */
  comments: ReviewComment[];
}

/** Groups a review's comments into threads, sorted by file then line, then when they started. */
export function groupThreads(comments: ReviewComment[]): Thread[] {
  const threads = new Map<string, Thread>();
  for (const c of comments) {
    if (c.parentId === null) {
      threads.set(c.id, {
        id: c.id,
        path: c.path,
        line: c.line,
        resolved: c.resolved,
        comments: [c],
      });
    }
  }
  for (const c of comments) {
    if (c.parentId !== null) threads.get(c.parentId)?.comments.push(c);
  }
  return [...threads.values()].sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.line - b.line ||
      a.comments[0]!.createdAt.localeCompare(b.comments[0]!.createdAt),
  );
}

/** Threads per file: { total, open }. */
export function threadCounts(threads: Thread[]): Map<string, { total: number; open: number }> {
  const counts = new Map<string, { total: number; open: number }>();
  for (const t of threads) {
    const c = counts.get(t.path) ?? { total: 0, open: 0 };
    c.total++;
    if (!t.resolved) c.open++;
    counts.set(t.path, c);
  }
  return counts;
}

/** The server's rule, mirrored so the button only shows for people it would work for. */
export function canResolve(
  thread: Thread,
  me: { id: string; role: RoomRole },
  requesterId: string,
): boolean {
  return me.role !== 'viewer' || requesterId === me.id || thread.comments[0]!.author.id === me.id;
}
