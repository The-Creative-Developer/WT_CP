import type {
  RunDto,
  RunFinishedPayload,
  RunStatus,
  RunStream,
  RunVerdict,
} from '@devverse/shared';

export interface OutputChunk {
  stream: RunStream;
  text: string;
}

/** The run shown in a room's output panel: the latest one anybody in the room started. */
export interface RunView {
  id: string;
  /** Who pressed Run; null if we joined after it started and haven't been told. */
  by: string | null;
  status: RunStatus;
  output: OutputChunk[];
  verdict: RunVerdict | null;
  exitCode: number | null;
  durationMs: number | null;
  truncated: boolean;
  error: string | null;
}

export type RunAction =
  /** Our own POST /runs was accepted. */
  | { type: 'accepted'; run: RunDto }
  | { type: 'started'; runId: string; by: string }
  | { type: 'output'; runId: string; stream: RunStream; chunk: string }
  | { type: 'finished'; payload: RunFinishedPayload }
  /** A snapshot from GET /runs/:id, used while the socket is down. */
  | { type: 'synced'; run: RunDto };

export const isActive = (run: RunView | null) =>
  run?.status === 'queued' || run?.status === 'running';

export function fromDto(run: RunDto): RunView {
  // The API stores the two streams separately, so a snapshot can't recreate their exact interleaving.
  const output: OutputChunk[] = [];
  if (run.stdout) output.push({ stream: 'stdout', text: run.stdout });
  if (run.stderr) output.push({ stream: 'stderr', text: run.stderr });
  return {
    id: run.id,
    by: run.by.username,
    status: run.status,
    output,
    verdict: run.verdict,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    truncated: run.truncated,
    error: run.error,
  };
}

const outputLength = (run: RunView) => run.output.reduce((n, c) => n + c.text.length, 0);

function emptyRun(id: string, by: string | null): RunView {
  return {
    id,
    by,
    status: 'running',
    output: [],
    verdict: null,
    exitCode: null,
    durationMs: null,
    truncated: false,
    error: null,
  };
}

/**
 * Socket events and HTTP responses race each other: run:started can arrive before the POST that caused it returns.
 * Every case below is written so the order doesn't matter.
 */
export function runReducer(run: RunView | null, action: RunAction): RunView | null {
  switch (action.type) {
    case 'accepted':
      // Events for this run may already have arrived; they are newer than this response.
      return run?.id === action.run.id ? run : fromDto(action.run);

    case 'started':
      if (run?.id === action.runId) return { ...run, by: action.by, status: 'running' };
      return emptyRun(action.runId, action.by);

    case 'output': {
      // Joined mid-run: show the rest of it rather than nothing.
      const current = run?.id === action.runId ? run : emptyRun(action.runId, null);
      if (!isActive(current)) return current;
      const last = current.output.at(-1);
      const output =
        last?.stream === action.stream
          ? [...current.output.slice(0, -1), { ...last, text: last.text + action.chunk }]
          : [...current.output, { stream: action.stream, text: action.chunk }];
      return { ...current, status: 'running', output };
    }

    case 'finished': {
      if (run?.id !== action.payload.runId) return run;
      const { verdict, exitCode, durationMs, truncated, error } = action.payload;
      return {
        ...run,
        status: verdict ? 'finished' : 'failed',
        verdict,
        exitCode,
        durationMs,
        truncated,
        error,
      };
    }

    case 'synced': {
      if (run && run.id !== action.run.id) return run;
      const snapshot = fromDto(action.run);
      if (!run || !isActive(snapshot)) return snapshot;
      // A late answer from before the run finished must not bring it back to life.
      if (!isActive(run)) return run;
      // A socket event may have delivered newer output while the request was in flight; keep the longer copy.
      return outputLength(snapshot) >= outputLength(run) ? snapshot : run;
    }
  }
}
