import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';

const files = [
  { id: 'm', path: 'main.py' },
  { id: 'u', path: 'src/util.py' },
  { id: 'd', path: 'src/lib/deep.py' },
  { id: 'r', path: 'README.md' },
];

function renderTree(props: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onNewFile: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
  };
  render(
    <FileTree
      files={files}
      activeId="m"
      canEdit
      announcement=""
      error={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const item = (name: string) => screen.getByRole('treeitem', { name });

describe('FileTree', () => {
  it('shows folders and files as an ARIA tree, with the open file selected', () => {
    renderTree();
    const tree = screen.getByRole('tree', { name: 'Files' });
    const top = within(tree)
      .getAllByRole('treeitem')
      .filter((el) => el.getAttribute('aria-level') === '1');
    expect(top.map((el) => el.getAttribute('aria-labelledby') && el.textContent)).toHaveLength(3);
    expect(item('src')).toHaveAttribute('aria-expanded', 'true');
    expect(item('src')).toHaveAttribute('aria-posinset', '1');
    expect(item('src')).toHaveAttribute('aria-setsize', '3');
    expect(item('deep.py')).toHaveAttribute('aria-level', '3');
    expect(item('main.py')).toHaveAttribute('aria-selected', 'true');
    expect(item('README.md')).toHaveAttribute('aria-selected', 'false');
    // Roving tabindex: only the open file is in the tab order.
    expect(item('main.py')).toHaveAttribute('tabindex', '0');
    expect(item('src')).toHaveAttribute('tabindex', '-1');
  });

  it('moves with the arrow keys, opening and closing folders', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTree();
    item('main.py').focus();

    await user.keyboard('{Home}');
    expect(item('src')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(item('src')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'util.py' })).toBeNull();

    await user.keyboard('{ArrowRight}');
    expect(item('src')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    expect(item('lib')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('util.py')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(item('src')).toHaveFocus();

    await user.keyboard('{End}{Enter}');
    expect(onOpen).toHaveBeenCalledWith('r');
  });

  it('jumps to an item by its first letter', async () => {
    const user = userEvent.setup();
    renderTree();
    item('main.py').focus();
    await user.keyboard('r');
    expect(item('README.md')).toHaveFocus();
    await user.keyboard('s');
    expect(item('src')).toHaveFocus();
  });

  it('opens a file on click, and renames or deletes the focused item', async () => {
    const user = userEvent.setup();
    const { onOpen, onRename, onDelete, onNewFile } = renderTree();
    await user.click(screen.getByText('util.py'));
    expect(onOpen).toHaveBeenCalledWith('u');

    await user.keyboard('{F2}');
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/util.py' }));
    await user.keyboard('{Delete}');
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/util.py' }));

    await user.click(screen.getByRole('button', { name: 'Rename src/util.py' }));
    expect(onRename).toHaveBeenCalledTimes(2);
    // A new file goes next to the focused one by default.
    await user.click(screen.getByRole('button', { name: 'New file' }));
    expect(onNewFile).toHaveBeenCalledWith('src');
  });

  it('lets viewers browse but not change anything', async () => {
    const user = userEvent.setup();
    const { onRename, onDelete } = renderTree({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'New file' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(item('main.py')).not.toHaveAttribute('draggable');
    item('main.py').focus();
    await user.keyboard('{F2}{Delete}');
    expect(onRename).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('moves a file by dragging it onto a folder, or onto the space below the tree', () => {
    const { onMove } = renderTree();
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(item('main.py'), { dataTransfer });
    fireEvent.dragOver(item('lib'), { dataTransfer });
    fireEvent.drop(item('lib'), { dataTransfer });
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'main.py' }),
      'src/lib/main.py',
    );

    fireEvent.dragStart(item('deep.py'), { dataTransfer });
    fireEvent.drop(screen.getByRole('tree').parentElement!, { dataTransfer });
    expect(onMove).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'src/lib/deep.py' }),
      'deep.py',
    );
  });

  it("won't drop a folder into itself", () => {
    const { onMove } = renderTree();
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(item('src'), { dataTransfer });
    fireEvent.drop(item('lib'), { dataTransfer });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('reads out changes made by others, and says when there are no files', () => {
    renderTree({ files: [], announcement: '@bob deleted main.py' });
    expect(screen.getByRole('status')).toHaveTextContent('@bob deleted main.py');
    expect(screen.getByText('No files yet.')).toBeInTheDocument();
  });
});
