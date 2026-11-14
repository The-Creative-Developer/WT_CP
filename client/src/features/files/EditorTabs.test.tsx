import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorTabs } from './EditorTabs';
import { useOpenFiles } from './useOpenFiles';

const files = [
  { id: 'a', path: 'main.py' },
  { id: 'b', path: 'src/main.py' },
  { id: 'c', path: 'util.py' },
];

describe('EditorTabs', () => {
  function renderTabs(activeId = 'a') {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <EditorTabs
        files={files}
        activeId={activeId}
        panelId="panel"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    return { onSelect, onClose };
  }

  it('is a tab list with one tab stop, the open file selected', () => {
    renderTabs();
    expect(screen.getByRole('tablist', { name: 'Open files' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'panel');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('tells two files with the same name apart by their folder', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: 'main.py in src' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'util.py' })).toBeInTheDocument();
  });

  it('moves focus with the arrows without switching, and opens with Enter', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs();
    screen.getAllByRole('tab')[0]!.focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'util.py' })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('closes a tab with Delete or its × button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderTabs();
    screen.getAllByRole('tab')[0]!.focus();
    await user.keyboard('{Delete}');
    expect(onClose).toHaveBeenCalledWith('a');
    await user.click(screen.getByTitle('Close util.py'));
    expect(onClose).toHaveBeenCalledWith('c');
  });
});

describe('useOpenFiles', () => {
  afterEach(() => sessionStorage.clear());

  function setUp(initialUrl = '/rooms/r', list = files, defaultId?: string) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
    );
    return renderHook(
      ({ current }) => ({
        tabs: useOpenFiles('r', current, defaultId),
        params: useSearchParams()[0],
      }),
      { wrapper, initialProps: { current: list } },
    );
  }

  it('shows the default file (else the first) on a first visit', () => {
    const { result } = setUp();
    expect(result.current.tabs.activeId).toBe('a');
    expect(result.current.tabs.open).toEqual(['a']);
    expect(setUp('/rooms/r', files, 'c').result.current.tabs.activeId).toBe('c');
  });

  it('opens the file named in the URL, and puts the active file in the URL', () => {
    const { result } = setUp('/rooms/r?file=c');
    expect(result.current.tabs.activeId).toBe('c');
    act(() => result.current.tabs.openFile('b'));
    expect(result.current.tabs.open).toEqual(['c', 'b']);
    expect(result.current.params.get('file')).toBe('b');
  });

  it('closing the active tab shows its neighbour, and closing the last shows nothing', () => {
    const { result } = setUp();
    act(() => result.current.tabs.openFile('b'));
    act(() => result.current.tabs.openFile('c'));
    act(() => result.current.tabs.openFile('b'));
    act(() => result.current.tabs.closeFile('b'));
    expect(result.current.tabs.activeId).toBe('c');
    act(() => result.current.tabs.closeFile('c'));
    act(() => result.current.tabs.closeFile('a'));
    expect(result.current.tabs.open).toEqual([]);
    expect(result.current.tabs.activeId).toBeNull();
  });

  it('drops a file someone else deleted, moving to its neighbour', () => {
    const { result, rerender } = setUp();
    act(() => result.current.tabs.openFile('b'));
    act(() => result.current.tabs.openFile('c'));
    act(() => result.current.tabs.openFile('b'));
    rerender({ current: files.filter((f) => f.id !== 'b') });
    expect(result.current.tabs.open).toEqual(['a', 'c']);
    expect(result.current.tabs.activeId).toBe('c');
  });

  it('remembers open tabs for the rest of the browser session', () => {
    const first = setUp();
    act(() => first.result.current.tabs.openFile('c'));
    first.unmount();
    const again = setUp();
    expect(again.result.current.tabs.open).toEqual(['a', 'c']);
  });
});
