import type { FileSummary } from '@devverse/shared';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

const storageKey = (slug: string) => `devverse:open-files:${slug}`;

function readStored(slug: string): string[] | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(slug)) ?? 'null');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

/** Where focus goes when the tab at `index` disappears: the tab to its right, else the one to its left. */
function neighbour(ids: string[], index: number, exists: (id: string) => boolean): string | null {
  return ids.slice(index + 1).find(exists) ?? ids.slice(0, index).reverse().find(exists) ?? null;
}

/**
 * The room's editor tabs: which files are open, and which one is showing.
 *
 * [CONCEPT: URL as State] The active file lives in the address bar (?file=<id>), so a link or a reload opens the
 * same file. The list of open tabs is per browser tab, in sessionStorage.
 */
export function useOpenFiles(slug: string, files: FileSummary[], defaultId?: string) {
  const [params, setParams] = useSearchParams();
  // null until this person has opened or closed a tab here; until then `defaultId` (or the first file) is shown.
  const [stored, setStored] = useState<string[] | null>(() => readStored(slug));
  const ids = useMemo(() => new Set(files.map((f) => f.id)), [files]);
  const exists = useCallback((id: string) => ids.has(id), [ids]);
  const requested = params.get('file');

  // Derived on every render rather than synced with effects: files deleted by someone else simply drop out.
  const activeId = useMemo(() => {
    if (requested && exists(requested)) return requested;
    const list = stored ?? [];
    const index = requested ? list.indexOf(requested) : -1;
    if (index >= 0) return neighbour(list, index, exists); // the open file was deleted
    if (stored !== null) return list.find(exists) ?? null;
    return defaultId && exists(defaultId) ? defaultId : (files[0]?.id ?? null);
  }, [requested, stored, exists, files, defaultId]);

  const open = useMemo(() => {
    const list = (stored ?? []).filter(exists);
    if (activeId && !list.includes(activeId)) list.push(activeId);
    return list;
  }, [stored, exists, activeId]);

  const save = useCallback(
    (next: string[]) => {
      setStored(next);
      sessionStorage.setItem(storageKey(slug), JSON.stringify(next));
    },
    [slug],
  );

  const show = useCallback(
    (id: string | null) =>
      // replace: switching tabs shouldn't fill the Back button's history.
      setParams(
        (current) => {
          if (id) current.set('file', id);
          else current.delete('file');
          return current;
        },
        { replace: true },
      ),
    [setParams],
  );

  const openFile = useCallback(
    (id: string) => {
      if (!open.includes(id)) save([...open, id]);
      else if (stored === null) save(open);
      show(id);
    },
    [open, stored, save, show],
  );

  const closeFile = useCallback(
    (id: string) => {
      const index = open.indexOf(id);
      if (index < 0) return;
      save(open.filter((other) => other !== id));
      if (id === activeId) show(neighbour(open, index, exists));
    },
    [open, activeId, save, show, exists],
  );

  return { open, activeId, openFile, closeFile };
}
