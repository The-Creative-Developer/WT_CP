import type { SnapshotFile } from '@devverse/shared';
import { useEffect, useState } from 'react';
import { compareSnapshots, type FileChange } from './line-diff';

export interface DiffRequest {
  id: number;
  base: SnapshotFile[] | null;
  head: SnapshotFile[];
}

export interface DiffResponse {
  id: number;
  changes: FileChange[];
}

/** One worker for the page, started on first use. */
let worker: Worker | null = null;
function getWorker(): Worker | null {
  // jsdom (tests) has no workers; there the comparison runs on the main thread instead.
  if (typeof Worker === 'undefined') return null;
  // Vite sees `new Worker(new URL(...))` and bundles the worker file separately.
  worker ??= new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

let nextId = 0;

type Result = { base: SnapshotFile[] | null; head: SnapshotFile[]; changes: FileChange[] };

/**
 * Which files changed between two versions, and by how many lines. Null while the worker is working, or until both
 * versions have loaded (`head` undefined; `base` undefined while loading, null for "an empty project").
 */
export function useSnapshotDiff(
  base: SnapshotFile[] | null | undefined,
  head: SnapshotFile[] | undefined,
): FileChange[] | null {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (head === undefined || base === undefined) return;
    const w = getWorker();
    if (!w) {
      // Answered asynchronously, like the worker would be.
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) setResult({ base, head, changes: compareSnapshots(base, head) });
      });
      return () => {
        cancelled = true;
      };
    }
    const id = nextId++;
    // The worker is shared, so only the answer to this request counts.
    const onMessage = ({ data }: MessageEvent<DiffResponse>) => {
      if (data.id === id) setResult({ base, head, changes: data.changes });
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, base, head } satisfies DiffRequest);
    return () => w.removeEventListener('message', onMessage);
  }, [base, head]);

  // An answer for versions that are no longer shown is stale.
  return result && result.base === base && result.head === head ? result.changes : null;
}
