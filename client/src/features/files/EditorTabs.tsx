import { basename, dirname, type FileSummary } from '@devverse/shared';
import { useRef, type KeyboardEvent } from 'react';

interface EditorTabsProps {
  /** Open files, in tab order. */
  files: FileSummary[];
  activeId: string | null;
  /** The id of the element showing the active file, for aria-controls. */
  panelId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export const tabId = (fileId: string) => `editor-tab-${fileId}`;

/**
 * [CONCEPT: ARIA Tabs Pattern] One tab stop for the whole strip; arrow keys move between tabs and Enter or Space
 * opens one. Activation is manual (not on arrow), because each switch reconnects the live editor.
 */
export function EditorTabs({ files, activeId, panelId, onSelect, onClose }: EditorTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Two open files called main.py get their folder shown too, so they can be told apart.
  const names = files.map((f) => basename(f.path));
  const duplicated = new Set(names.filter((name, i) => names.indexOf(name) !== i));

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const tabs = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const focus = (i: number) => tabs[(i + tabs.length) % tabs.length]?.focus();
    if (e.key === 'ArrowRight') focus(index + 1);
    else if (e.key === 'ArrowLeft') focus(index - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(tabs.length - 1);
    else if (e.key === 'Delete') {
      onClose(files[index]!.id);
      // Keep focus in the strip rather than dropping it on <body>.
      requestAnimationFrame(() => {
        const left = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
        left?.[Math.min(index, left.length - 1)]?.focus();
      });
    } else return;
    e.preventDefault();
  }

  if (files.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Open files"
      className="flex overflow-x-auto border-b border-border bg-surface-2/50"
    >
      {files.map((file, index) => {
        const active = file.id === activeId;
        const name = basename(file.path);
        return (
          <div
            key={file.id}
            role="none"
            className={`group flex shrink-0 items-center border-r border-border ${active ? 'bg-surface' : ''}`}
          >
            <button
              type="button"
              role="tab"
              id={tabId(file.id)}
              aria-selected={active}
              aria-controls={active ? panelId : undefined}
              aria-keyshortcuts="Delete"
              title={file.path}
              tabIndex={active || (!activeId && index === 0) ? 0 : -1}
              onClick={() => onSelect(file.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`py-2 pr-1 pl-3 font-mono text-sm ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
            >
              {name}
              {duplicated.has(name) && dirname(file.path) && (
                <>
                  {' '}
                  <span className="font-sans text-xs text-muted">
                    <span className="sr-only">in</span> {dirname(file.path)}
                  </span>
                </>
              )}
            </button>
            {/* Mouse users click ×; keyboard and screen reader users press Delete on the tab (aria-keyshortcuts).
                Hidden from assistive tech because a tab list may only contain tabs. */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              title={`Close ${file.path}`}
              onClick={() => onClose(file.id)}
              className={`mr-1 rounded px-1.5 text-muted hover:bg-surface-2 hover:text-fg ${active ? '' : 'opacity-50 group-hover:opacity-100'}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
