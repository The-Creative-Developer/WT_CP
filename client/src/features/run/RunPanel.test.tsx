import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunView } from './run-state';
import { RunPanel } from './RunPanel';
import type { useRoomRun } from './useRoomRun';

type Runner = ReturnType<typeof useRoomRun>;

const finishedRun: RunView = {
  id: 'r1',
  by: 'alice',
  status: 'finished',
  output: [
    { stream: 'stdout', text: 'plain \x1b[31mred\x1b[0m\n' },
    { stream: 'stderr', text: '<b>not bold</b>\n' },
  ],
  verdict: 'ok',
  exitCode: 0,
  durationMs: 42,
  truncated: false,
  error: null,
};

function renderPanel(overrides: Partial<Runner> = {}, canRun = true) {
  const onRun = vi.fn();
  const runner: Runner = {
    run: null,
    runFile: vi.fn(),
    busy: false,
    startError: null,
    stdin: '',
    setStdin: vi.fn(),
    connected: true,
    liveError: null,
    ...overrides,
  };
  render(<RunPanel runner={runner} canRun={canRun} onRun={onRun} />);
  return { onRun };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RunPanel', () => {
  it('runs the file from the Run button', async () => {
    const { onRun } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /^run/i }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('shows coloured output as text, never as HTML, with the verdict, exit code and duration', () => {
    renderPanel({ run: finishedRun });
    const output = screen.getByLabelText('Program output');
    expect(output).toHaveTextContent('plain red <b>not bold</b>');
    expect(output.querySelector('b')).toBeNull();
    expect(screen.getByText('red')).toHaveStyle({ color: 'var(--ansi-1)' });
    expect(screen.getByText('<b>not bold</b>', { exact: false })).toHaveClass(
      'text-terminal-stderr',
    );
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      /^Finished exit code 0 · 42\sms · run by @alice$/,
    );
  });

  it('explains why a viewer cannot run code, and ignores their clicks', async () => {
    const { onRun } = renderPanel({}, false);
    const button = screen.getByRole('button', { name: /^run/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Viewers can watch runs but not start them.');
    await userEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('copies the output without colour codes and announces it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderPanel({ run: finishedRun });

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('plain red\n<b>not bold</b>\n');
    expect(await screen.findByText('Output copied to the clipboard')).toBeInTheDocument();
  });

  it('reports a run that failed, and a request that was refused', () => {
    renderPanel({
      run: { ...finishedRun, status: 'failed', verdict: null, output: [], error: 'Runner down' },
      startError: 'Your last run is still going.',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Your last run is still going.');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Failed Runner down');
    expect(screen.getByLabelText('Program output')).toHaveTextContent('(no output)');
  });
});
