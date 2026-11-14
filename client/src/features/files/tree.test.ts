import { describe, expect, it } from 'vitest';
import {
  buildTree,
  countFiles,
  describeChange,
  dropTarget,
  visibleItems,
  type TreeNode,
} from './tree';

const files = [
  { id: '1', path: 'main.py' },
  { id: '2', path: 'src/util.py' },
  { id: '3', path: 'src/lib/deep.py' },
  { id: '4', path: 'README.md' },
  { id: '5', path: 'file10.py' },
  { id: '6', path: 'file2.py' },
];

/** A compact picture of the tree: folders end in "/", children indented. */
function draw(nodes: TreeNode[], indent = ''): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder'
      ? [`${indent}${n.name}/`, ...draw(n.children, `${indent}  `)]
      : [`${indent}${n.name}`],
  );
}

describe('buildTree', () => {
  it('nests files in folders, folders first, sorted like a file manager', () => {
    expect(draw(buildTree(files))).toEqual([
      'src/',
      '  lib/',
      '    deep.py',
      '  util.py',
      'file2.py',
      'file10.py',
      'main.py',
      'README.md',
    ]);
  });

  it('keeps full paths and ids on every node', () => {
    const [src] = buildTree(files);
    expect(src).toMatchObject({ kind: 'folder', path: 'src' });
    const lib = src!.kind === 'folder' ? src!.children[0] : null;
    expect(lib).toMatchObject({ kind: 'folder', path: 'src/lib' });
    expect(lib?.kind === 'folder' && lib.children[0]).toEqual({
      kind: 'file',
      name: 'deep.py',
      path: 'src/lib/deep.py',
      id: '3',
    });
  });

  it('is empty for no files', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('visibleItems', () => {
  it('lists rows top to bottom with their level, skipping collapsed folders', () => {
    const tree = buildTree(files);
    const rows = (collapsed: string[]) =>
      visibleItems(tree, new Set(collapsed)).map((r) => `${r.level}:${r.node.path}`);
    expect(rows([]).slice(0, 4)).toEqual([
      '1:src',
      '2:src/lib',
      '3:src/lib/deep.py',
      '2:src/util.py',
    ]);
    expect(rows(['src/lib']).slice(0, 3)).toEqual(['1:src', '2:src/lib', '2:src/util.py']);
    expect(rows(['src'])[1]).toBe('1:file2.py');
    expect(visibleItems(tree, new Set())[2]?.parent).toBe('src/lib');
  });
});

describe('countFiles', () => {
  it('counts files at any depth', () => {
    expect(countFiles(buildTree(files)[0]!)).toBe(2);
  });
});

describe('dropTarget', () => {
  const [src] = buildTree(files);
  const main = buildTree(files).find((n) => n.path === 'main.py')!;

  it('gives the new path, or null when nothing would change', () => {
    expect(dropTarget(main, 'src')).toBe('src/main.py');
    expect(dropTarget(main, '')).toBeNull();
    expect(dropTarget(src!, 'other')).toBe('other/src');
  });

  it("won't put a folder inside itself", () => {
    expect(dropTarget(src!, 'src')).toBeNull();
    expect(dropTarget(src!, 'src/lib')).toBeNull();
  });
});

describe('describeChange', () => {
  const before = [
    { id: '1', path: 'main.py' },
    { id: '2', path: 'a.py' },
  ];

  it('describes one change in words', () => {
    expect(describeChange(before, [...before, { id: '3', path: 'b.py' }], 'bob')).toBe(
      '@bob added b.py',
    );
    expect(describeChange(before, [before[0]!], 'bob')).toBe('@bob deleted a.py');
    expect(describeChange(before, [before[0]!, { id: '2', path: 'lib/a.py' }], 'bob')).toBe(
      '@bob renamed a.py to lib/a.py',
    );
  });

  it('summarises several', () => {
    expect(describeChange(before, [], 'bob')).toBe('@bob deleted 2 files');
    expect(
      describeChange(
        before,
        before.map((f) => ({ ...f, path: `src/${f.path}` })),
        'bob',
      ),
    ).toBe('@bob moved 2 files');
    expect(describeChange(before, before, 'bob')).toBe('');
  });
});
