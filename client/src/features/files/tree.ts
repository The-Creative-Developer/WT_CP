import { basename, type FileSummary } from '@devverse/shared';

export type TreeNode =
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; path: string; id: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, then by name, the way file managers sort ("file2" before "file10"). */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .sort((a, b) =>
      a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1,
    )
    .map((node) =>
      node.kind === 'folder' ? { ...node, children: sortNodes(node.children) } : node,
    );
}

/**
 * Turns flat paths ("src/lib/a.py") into nested folders. Folders aren't stored anywhere: they are implied by the
 * paths of the files inside them.
 */
export function buildTree(files: FileSummary[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode[]>([['', root]]);

  // [CONCEPT: Recursion] Each folder's children list is found (or created) from its parent's, one level at a time.
  const childrenOf = (folder: string): TreeNode[] => {
    const existing = folders.get(folder);
    if (existing) return existing;
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
    const children: TreeNode[] = [];
    childrenOf(parent).push({ kind: 'folder', name: basename(folder), path: folder, children });
    folders.set(folder, children);
    return children;
  };

  for (const file of files) {
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    childrenOf(folder).push({
      kind: 'file',
      name: basename(file.path),
      path: file.path,
      id: file.id,
    });
  }
  return sortNodes(root);
}

export interface VisibleItem {
  node: TreeNode;
  level: number;
  parent: string | null;
}

/** The rows a person can currently see, top to bottom: what the arrow keys move through. */
export function visibleItems(
  nodes: TreeNode[],
  collapsed: ReadonlySet<string>,
  level = 1,
  parent: string | null = null,
): VisibleItem[] {
  return nodes.flatMap((node) => [
    { node, level, parent },
    ...(node.kind === 'folder' && !collapsed.has(node.path)
      ? visibleItems(node.children, collapsed, level + 1, node.path)
      : []),
  ]);
}

/** Number of files inside a folder, at any depth. */
export function countFiles(node: TreeNode): number {
  return node.kind === 'file'
    ? 1
    : node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

/** Where `node` ends up when dropped into `folder` ('' is the top level), or null if that changes nothing. */
export function dropTarget(node: TreeNode, folder: string): string | null {
  const to = folder ? `${folder}/${node.name}` : node.name;
  if (to === node.path) return null;
  // A folder can't go inside itself.
  if (node.kind === 'folder' && (folder === node.path || folder.startsWith(`${node.path}/`))) {
    return null;
  }
  return to;
}

/** A sentence for screen readers about a change someone else made to the file list. */
export function describeChange(before: FileSummary[], after: FileSummary[], by: string): string {
  const old = new Map(before.map((f) => [f.id, f.path]));
  const now = new Map(after.map((f) => [f.id, f.path]));
  const added = after.filter((f) => !old.has(f.id));
  const removed = before.filter((f) => !now.has(f.id));
  const renamed = after.filter((f) => old.has(f.id) && old.get(f.id) !== f.path);

  const total = added.length + removed.length + renamed.length;
  if (total === 0) return '';
  if (total > 1) {
    return removed.length === total
      ? `@${by} deleted ${total} files`
      : renamed.length === total
        ? `@${by} moved ${total} files`
        : `@${by} changed ${total} files`;
  }
  if (added[0]) return `@${by} added ${added[0].path}`;
  if (removed[0]) return `@${by} deleted ${removed[0].path}`;
  return `@${by} renamed ${old.get(renamed[0]!.id)} to ${renamed[0]!.path}`;
}
