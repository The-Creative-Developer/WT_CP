import { dirname, parentFolders, type FileSummary } from '@devverse/shared';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { buildTree, dropTarget, visibleItems, type TreeNode } from './tree';

interface FileTreeProps {
  files: FileSummary[];
  activeId: string | null;
  canEdit: boolean;
  onOpen: (id: string) => void;
  /** `folder` is where the new file should go by default ('' for the top level). */
  onNewFile: (folder: string) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onMove: (node: TreeNode, to: string) => void;
  /** Changes other people made, read out by screen readers. */
  announcement: string;
  error: string | null;
}

/** The folder a drop on `node` lands in: the folder itself, or the folder a file is in. */
const folderOf = (node: TreeNode) => (node.kind === 'folder' ? node.path : dirname(node.path));

/**
 * The project's files and folders.
 *
 * [CONCEPT: ARIA Tree Pattern] role="tree" with nested role="group" lists. Only one item is in the tab order
 * (roving tabindex); arrow keys move between visible items, Right/Left open and close folders, Enter opens a file,
 * typing a letter jumps to the next item starting with it.
 */
export function FileTree({
  files,
  activeId,
  canEdit,
  onOpen,
  onNewFile,
  onRename,
  onDelete,
  onMove,
  announcement,
  error,
}: FileTreeProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const tree = useMemo(() => buildTree(files), [files]);
  // Folders start open; this remembers the ones someone closed.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => visibleItems(tree, collapsed), [tree, collapsed]);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const pendingFocus = useRef<string | null>(null);
  const dragged = useRef<TreeNode | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);

  // Opening a file from somewhere else (a tab, a link) reveals it: its folders open. Adjusted during render, the
  // React way to update state when a prop changes, rather than in an effect that would render twice.
  const activePath = files.find((f) => f.id === activeId)?.path;
  const [revealed, setRevealed] = useState<string | undefined>(undefined);
  if (activePath !== revealed) {
    setRevealed(activePath);
    const parents = activePath ? parentFolders(activePath) : [];
    if (parents.some((p) => collapsed.has(p))) {
      setCollapsed(new Set([...collapsed].filter((p) => !parents.includes(p))));
    }
  }

  // The item in the tab order: the last one focused if it's still visible, else the open file, else the first.
  const current =
    rows.find((r) => r.node.path === focusedPath) ??
    rows.find((r) => r.node.path === activePath) ??
    rows[0];

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    items.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  function focus(path: string | undefined) {
    if (path === undefined) return;
    setFocusedPath(path);
    pendingFocus.current = path;
  }

  function toggle(path: string, open?: boolean) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function activate(node: TreeNode) {
    if (node.kind === 'file') onOpen(node.id);
    else toggle(node.path);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!current) return;
    const index = rows.indexOf(current);
    const { node } = current;
    const isOpenFolder = node.kind === 'folder' && !collapsed.has(node.path);

    switch (e.key) {
      case 'ArrowDown':
        focus(rows[index + 1]?.node.path);
        break;
      case 'ArrowUp':
        focus(rows[index - 1]?.node.path);
        break;
      case 'Home':
        focus(rows[0]?.node.path);
        break;
      case 'End':
        focus(rows.at(-1)?.node.path);
        break;
      case 'ArrowRight':
        if (node.kind !== 'folder') return;
        if (isOpenFolder)
          focus(rows[index + 1]?.parent === node.path ? rows[index + 1]!.node.path : undefined);
        else toggle(node.path, true);
        break;
      case 'ArrowLeft':
        if (isOpenFolder) toggle(node.path, false);
        else focus(current.parent ?? undefined);
        break;
      case 'Enter':
      case ' ':
        activate(node);
        break;
      case 'F2':
        if (!canEdit) return;
        onRename(node);
        break;
      case 'Delete':
      case 'Backspace': // the key labelled "delete" on a Mac
        if (!canEdit) return;
        onDelete(node);
        break;
      default: {
        // [CONCEPT: Type-Ahead] A printable character jumps to the next item whose name starts with it.
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const key = e.key.toLowerCase();
        const after = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
        const match = after.find((r) => r.node.name.toLowerCase().startsWith(key));
        if (!match) return;
        focus(match.node.path);
      }
    }
    e.preventDefault();
  }

  // [CONCEPT: Drag and Drop API] Items are draggable; folders (and the empty space below the tree, for the top
  // level) accept drops. Rename (F2) is the keyboard way to move something, since dragging needs a pointer.
  const dragHandlers = (node: TreeNode) =>
    canEdit
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.stopPropagation();
            dragged.current = node;
            // Firefox only starts a drag when some data is set.
            e.dataTransfer.setData('text/plain', node.path);
            e.dataTransfer.effectAllowed = 'move';
          },
          onDragOver: (e: DragEvent) => dragOver(e, folderOf(node)),
          onDrop: (e: DragEvent) => drop(e, folderOf(node)),
          onDragEnd: () => {
            dragged.current = null;
            setDropFolder(null);
          },
        }
      : {};

  function dragOver(e: DragEvent, folder: string) {
    const node = dragged.current;
    if (!node) return; // something dragged in from outside, like a file from the desktop
    e.stopPropagation();
    if (dropTarget(node, folder) === null) {
      setDropFolder(null);
      return;
    }
    // Cancelling dragover is what marks this element as a place that accepts the drop.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropFolder(folder);
  }

  function drop(e: DragEvent, folder: string) {
    const node = dragged.current;
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    dragged.current = null;
    setDropFolder(null);
    const to = dropTarget(node, folder);
    if (to) onMove(node, to);
  }

  function renderNodes(nodes: TreeNode[], level: number) {
    return nodes.map((node, index) => {
      const isFolder = node.kind === 'folder';
      const open = isFolder && !collapsed.has(node.path);
      const labelId = `${baseId}-${node.path}`;
      const isActive = node.kind === 'file' && node.id === activeId;
      return (
        <li
          key={node.path}
          ref={(el) => {
            if (el) items.current.set(node.path, el);
            else items.current.delete(node.path);
          }}
          role="treeitem"
          // Named by its own label only; otherwise the names of everything inside a folder would be read too.
          aria-labelledby={labelId}
          aria-level={level}
          aria-setsize={nodes.length}
          aria-posinset={index + 1}
          aria-expanded={isFolder ? open : undefined}
          aria-selected={isFolder ? undefined : isActive}
          tabIndex={node.path === current?.node.path ? 0 : -1}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocusedPath(node.path);
          }}
          // Only the focused item reacts; the same key bubbling up from an item inside a folder is ignored.
          onKeyDown={(e) => {
            if (e.target === e.currentTarget) onKeyDown(e);
          }}
          onClick={(e) => {
            e.stopPropagation();
            setFocusedPath(node.path);
            activate(node);
          }}
          className="outline-none [&:focus-visible>div]:ring-2 [&:focus-visible>div]:ring-accent"
          {...dragHandlers(node)}
        >
          <div
            style={{ paddingLeft: `${(level - 1) * 0.875 + 0.5}rem` }}
            className={`flex cursor-pointer items-center gap-1.5 rounded py-1 pr-2 text-sm ${
              isActive ? 'bg-accent/15 font-medium' : 'hover:bg-surface-2'
            } ${isFolder && dropFolder === node.path ? 'bg-accent/25 ring-1 ring-accent' : ''}`}
          >
            <span aria-hidden="true" className="w-3 shrink-0 text-center text-xs text-muted">
              {isFolder ? (open ? '▾' : '▸') : ''}
            </span>
            <span id={labelId} className={`truncate ${isFolder ? '' : 'font-mono'}`}>
              {node.name}
            </span>
          </div>
          {isFolder && open && <ul role="group">{renderNodes(node.children, level + 1)}</ul>}
        </li>
      );
    });
  }

  const focusedNode = current?.node;

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 id={titleId} className="font-semibold">
          Files
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => onNewFile(focusedNode ? folderOf(focusedNode) : '')}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2"
          >
            New file
          </button>
        )}
      </div>

      <div
        // The space around the tree is the top level: dropping here moves things out of their folders.
        onDragOver={(e) => dragOver(e, '')}
        onDrop={(e) => drop(e, '')}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropFolder(null);
        }}
        className={`max-h-64 min-h-24 flex-1 overflow-y-auto p-1.5 md:max-h-[60vh] ${
          dropFolder === '' ? 'bg-accent/10 ring-1 ring-accent ring-inset' : ''
        }`}
      >
        {rows.length === 0 ? (
          <p className="p-2 text-sm text-muted">No files yet.</p>
        ) : (
          <ul role="tree" aria-labelledby={titleId} aria-describedby={canEdit ? hintId : undefined}>
            {renderNodes(tree, 1)}
          </ul>
        )}
      </div>

      {canEdit && focusedNode && (
        <div className="flex gap-2 border-t border-border px-3 py-2">
          {/* The visible word starts the accessible name (WCAG 2.5.3), which adds what it acts on. */}
          <button
            type="button"
            aria-label={`Rename ${focusedNode.path}`}
            onClick={() => onRename(focusedNode)}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2"
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Delete ${focusedNode.path}`}
            onClick={() => onDelete(focusedNode)}
            className="rounded-md border border-border px-2 py-1 text-xs text-danger hover:bg-danger/10"
          >
            Delete
          </button>
        </div>
      )}
      <div role="alert" className="empty:hidden">
        {error && <p className="border-t border-border px-3 py-2 text-xs text-danger">{error}</p>}
      </div>
      {canEdit && (
        <p id={hintId} className="border-t border-border px-3 py-1.5 text-xs text-muted">
          Drag to move. <kbd>F2</kbd> renames, <kbd>Delete</kbd> deletes.
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
