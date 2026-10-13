import type { RunDto } from '@devverse/shared';
import { describe, expect, it } from 'vitest';
import { runReducer, type RunAction, type RunView } from './run-state';

const dto = (overrides: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  roomSlug: 'room',
  fileId: 'f1',
  language: 'python',
  status: 'queued',
  by: { id: 'u1', username: 'alice' },
  stdout: '',
  stderr: '',
  verdict: null,
  exitCode: null,
  durationMs: null,
  truncated: false,
  error: null,
  createdAt: '2026-10-13T00:00:00Z',
  ...overrides,
});

const reduce = (actions: RunAction[], start: RunView | null = null) =>
  actions.reduce(runReducer, start);

const finished: RunAction = {
  type: 'finished',
  payload: {
    runId: 'r1',
    verdict: 'ok',
    exitCode: 0,
    durationMs: 12,
    truncated: false,
    error: null,
  },
};

describe('runReducer', () => {
  it('follows a run from start to finish, merging chunks of the same stream', () => {
    const run = reduce([
      { type: 'accepted', run: dto() },
      { type: 'started', runId: 'r1', by: 'alice' },
      { type: 'output', runId: 'r1', stream: 'stdout', chunk: 'a' },
      { type: 'output', runId: 'r1', stream: 'stdout', chunk: 'b' },
      { type: 'output', runId: 'r1', stream: 'stderr', chunk: '!' },
      finished,
    ]);
    expect(run).toMatchObject({
      status: 'finished',
      verdict: 'ok',
      exitCode: 0,
      output: [
        { stream: 'stdout', text: 'ab' },
        { stream: 'stderr', text: '!' },
      ],
    });
  });

  it('keeps socket output that arrived before the POST response', () => {
    const run = reduce([
      { type: 'started', runId: 'r1', by: 'alice' },
      { type: 'output', runId: 'r1', stream: 'stdout', chunk: 'early' },
      { type: 'accepted', run: dto({ status: 'queued' }) },
    ]);
    expect(run).toMatchObject({ status: 'running', output: [{ text: 'early' }] });
  });

  it("switches to someone else's newer run, and picks up a run already in progress", () => {
    const mine = reduce([{ type: 'accepted', run: dto() }, finished]);
    expect(reduce([{ type: 'started', runId: 'r2', by: 'bob' }], mine)).toMatchObject({
      id: 'r2',
      by: 'bob',
    });
    expect(
      reduce([{ type: 'output', runId: 'r3', stream: 'stdout', chunk: 'x' }], mine),
    ).toMatchObject({ id: 'r3', by: null, status: 'running' });
  });

  it('ignores a finish for another run', () => {
    const run = reduce([{ type: 'started', runId: 'r1', by: 'alice' }]);
    const other = { ...finished, payload: { ...finished.payload, runId: 'r9' } } as RunAction;
    expect(runReducer(run, other)).toBe(run);
  });

  it('marks a run without a verdict as failed', () => {
    const run = reduce([
      { type: 'started', runId: 'r1', by: 'alice' },
      {
        type: 'finished',
        payload: { ...(finished as { payload: object }).payload, verdict: null, error: 'Boom' },
      } as RunAction,
    ]);
    expect(run).toMatchObject({ status: 'failed', error: 'Boom' });
  });

  describe('the latest run, fetched after joining', () => {
    // Real ObjectIds made a minute apart.
    const earlier = '6acdda0960e165143a5daa68';
    const later = '6acdda4f60e165143a5daa6b';

    it('shows the latest run when the panel is empty', () => {
      expect(
        runReducer(null, { type: 'synced', run: dto({ id: later, status: 'finished' }) }),
      ).toMatchObject({ id: later, status: 'finished', by: 'alice' });
    });

    it('replaces an older run, e.g. one somebody started while we were offline', () => {
      const old = reduce([{ type: 'accepted', run: dto({ id: earlier, status: 'finished' }) }]);
      expect(runReducer(old, { type: 'synced', run: dto({ id: later }) })).toMatchObject({
        id: later,
      });
    });

    it('keeps a newer run that arrived over the socket while the fetch was in flight', () => {
      const live = reduce([{ type: 'started', runId: later, by: 'bob' }]);
      expect(runReducer(live, { type: 'synced', run: dto({ id: earlier }) })).toBe(live);
    });
  });

  describe('polling snapshots', () => {
    it('replace the run while it is active and they have more output', () => {
      const run = reduce([{ type: 'started', runId: 'r1', by: 'alice' }]);
      expect(
        runReducer(run, { type: 'synced', run: dto({ status: 'running', stdout: 'hi' }) }),
      ).toMatchObject({ output: [{ stream: 'stdout', text: 'hi' }] });
    });

    it('never roll back newer output or a finished run', () => {
      const streaming = reduce([
        { type: 'started', runId: 'r1', by: 'alice' },
        { type: 'output', runId: 'r1', stream: 'stdout', chunk: 'newer output' },
      ]);
      expect(
        runReducer(streaming, { type: 'synced', run: dto({ status: 'running', stdout: 'new' }) }),
      ).toBe(streaming);

      const done = reduce([finished], streaming);
      expect(runReducer(done, { type: 'synced', run: dto({ status: 'running' }) })).toBe(done);
    });
  });
});
