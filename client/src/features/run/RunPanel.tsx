import type { RunStream, RunVerdict } from '@devverse/shared';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { parseAnsi, stripAnsi, type AnsiStyle } from '../../lib/ansi';
import { formatDuration } from '../../lib/format';
import type { RunView } from './run-state';
import type { useRoomRun } from './useRoomRun';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const VERDICT_LABEL: Record<RunVerdict, string> = {
  ok: 'Finished',
  error: 'Exited with an error',
  timeout: 'Timed out',
  memory: 'Ran out of memory',
  'output-limit': 'Too much output',
};

interface RunPanelProps {
  runner: ReturnType<typeof useRoomRun>;
  canRun: boolean;
  onRun: () => void;
}

export function RunPanel({ runner, canRun, onRun }: RunPanelProps) {
  const { run, busy, startError, stdin, setStdin, connected, liveError } = runner;
  const titleId = useId();
  const hintId = useId();
  const stdinId = useId();
  const disabled = !canRun || busy;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
        <h2 id={titleId} className="font-semibold">
          Output
        </h2>
        <RunStatus run={run} canRun={canRun} />
        <div className="ml-auto flex items-center gap-2">
          <CopyButton text={run ? run.output.map((c) => stripAnsi(c.text)).join('') : ''} />
          {/* aria-disabled rather than disabled: the button stays focusable, so the reason it can't be used
              (aria-describedby) is still read out. */}
          <button
            type="button"
            aria-disabled={disabled}
            aria-describedby={canRun ? undefined : hintId}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onClick={() => !disabled && onRun()}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {busy ? 'Running…' : 'Run'}
            <kbd className="rounded bg-black/15 px-1 font-sans text-xs font-normal max-sm:hidden">
              {IS_MAC ? '⌘' : 'Ctrl'}+Enter
            </kbd>
          </button>
        </div>
      </div>

      {!canRun && (
        <p id={hintId} className="border-b border-border px-4 py-2 text-sm text-muted">
          Viewers can watch runs but not start them.
        </p>
      )}
      <div role="alert" className="empty:hidden">
        {startError && (
          <p className="border-b border-border px-4 py-2 text-sm text-danger">{startError}</p>
        )}
      </div>

      {canRun && (
        <details className="border-b border-border px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted">Program input (stdin)</summary>
          <label htmlFor={stdinId} className="mt-2 block text-muted">
            Sent to the program's standard input when it runs
          </label>
          <textarea
            id={stdinId}
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            rows={3}
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-border bg-bg p-2 font-mono text-sm"
          />
        </details>
      )}

      <Output run={run} canRun={canRun} />

      {(!connected || liveError) && (
        <p className="border-t border-border px-4 py-1.5 text-xs text-muted">
          {liveError ?? 'Reconnecting… output will catch up.'}
        </p>
      )}
    </section>
  );
}

/** [CONCEPT: Live Regions] Announces "Running", then the verdict, without moving focus away from the editor. */
function RunStatus({ run, canRun }: { run: RunView | null; canRun: boolean }) {
  let tone = 'bg-surface-2 text-muted';
  let label = '';
  let detail = '';

  if (!run) {
    detail = canRun ? 'Run the file to see its output here.' : 'Runs appear here.';
  } else if (run.status === 'queued') {
    label = 'Queued';
    detail = 'Waiting for a free runner…';
  } else if (run.status === 'running') {
    tone = 'bg-accent/15 text-fg';
    label = 'Running';
    detail = run.by ? `Started by @${run.by}` : '';
  } else if (run.status === 'failed') {
    tone = 'bg-danger/15 text-danger';
    label = 'Failed';
    detail = run.error ?? 'The run could not be completed.';
  } else if (run.verdict) {
    tone = run.verdict === 'ok' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger';
    label = VERDICT_LABEL[run.verdict];
    detail = [
      run.exitCode === null ? 'stopped' : `exit code ${run.exitCode}`,
      run.durationMs === null ? null : formatDuration(run.durationMs),
      run.by ? `run by @${run.by}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return (
    <p role="status" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      {label && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      )}
      {/* The flex gap only separates them visually; screen readers need a real space. */}{' '}
      <span className="text-muted">{detail}</span>
    </p>
  );
}

function Output({ run, canRun }: { run: RunView | null; canRun: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  // Follow new output, unless the reader has scrolled up to look at something.
  const followOutput = useRef(true);

  // Colour state carries over between chunks of the same stream, like it would in a terminal.
  const spans = useMemo(() => {
    const styles: Record<RunStream, AnsiStyle> = { stdout: {}, stderr: {} };
    return (run?.output ?? []).flatMap((chunk, i) => {
      const { segments, style } = parseAnsi(chunk.text, styles[chunk.stream]);
      styles[chunk.stream] = style;
      return segments.map((segment, j) => (
        <span
          key={`${i}:${j}`}
          className={spanClass(segment.style, chunk.stream)}
          style={spanStyle(segment.style)}
        >
          {segment.text}
        </span>
      ));
    });
  }, [run?.output]);

  const runId = run?.id;
  useEffect(() => {
    followOutput.current = true;
  }, [runId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && followOutput.current) el.scrollTop = el.scrollHeight;
  }, [spans]);

  const finished = run && run.status !== 'queued' && run.status !== 'running';

  return (
    <pre
      ref={ref}
      // A scrollable region must be reachable by keyboard, so it can be scrolled without a mouse.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label="Program output"
      onScroll={(e) => {
        const el = e.currentTarget;
        followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="h-64 overflow-auto bg-terminal p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-terminal-fg"
    >
      {spans}
      {!run && (
        <span className="text-terminal-muted">
          {canRun ? `Press Run or ${IS_MAC ? '⌘' : 'Ctrl'}+Enter.` : 'Nothing has run yet.'}
        </span>
      )}
      {finished && spans.length === 0 && <span className="text-terminal-muted">(no output)</span>}
      {run?.truncated && (
        <span className="mt-2 block text-terminal-muted">
          Output was cut off because the program printed too much.
        </span>
      )}
    </pre>
  );
}

function spanClass(style: AnsiStyle, stream: RunStream): string | undefined {
  const classes = [
    style.fg === undefined && stream === 'stderr' ? 'text-terminal-stderr' : '',
    style.bold ? 'font-bold' : '',
    style.dim ? 'opacity-70' : '',
    style.italic ? 'italic' : '',
    style.underline ? 'underline' : '',
  ].filter(Boolean);
  return classes.length ? classes.join(' ') : undefined;
}

function spanStyle(style: AnsiStyle): CSSProperties | undefined {
  if (style.fg === undefined && style.bg === undefined) return undefined;
  return {
    color: style.fg === undefined ? undefined : `var(--ansi-${style.fg})`,
    backgroundColor: style.bg === undefined ? undefined : `var(--ansi-${style.bg})`,
  };
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2_000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      // [CONCEPT: Clipboard API] Asynchronous, permission-aware copying; only available on HTTPS or localhost.
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!text}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
      <span role="status" className="sr-only">
        {state === 'copied'
          ? 'Output copied to the clipboard'
          : state === 'failed'
            ? "Couldn't copy. Select the output and copy it manually."
            : ''}
      </span>
    </>
  );
}
