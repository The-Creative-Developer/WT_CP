import type { RunDto, ServerToClientEvents } from '@devverse/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { RoomChannel } from '../rooms/useRoomChannel';
import { isActive, runReducer } from './run-state';

const POLL_INTERVAL_MS = 1_000;

/** The room's latest run, live over the room's channel, and a way to start a new one. */
export function useRoomRun(slug: string, username: string, channel: RoomChannel) {
  const { socket, connected, joins } = channel;
  const [run, dispatch] = useReducer(runReducer, null);
  const [stdin, setStdin] = useState('');

  // The room's latest run, so a page that was just opened or reconnected shows what it missed. Fetched straight
  // away, so the panel doesn't wait for the socket, and again after every (re)join: from a join on, every event
  // reaches us, and the fetch covers everything before it, so nothing falls through the gap.
  useEffect(() => {
    let cancelled = false;
    api<RunDto[]>(`/api/v1/runs?room=${encodeURIComponent(slug)}&limit=1`)
      .then(([latest]) => !cancelled && latest && dispatch({ type: 'synced', run: latest }))
      .catch(() => undefined); // the panel just starts empty
    return () => {
      cancelled = true;
    };
  }, [slug, joins]);

  useEffect(() => {
    const onStarted: ServerToClientEvents['run:started'] = ({ runId, by }) =>
      dispatch({ type: 'started', runId, by });
    const onOutput: ServerToClientEvents['run:output'] = ({ runId, stream, chunk }) =>
      dispatch({ type: 'output', runId, stream, chunk });
    const onFinished: ServerToClientEvents['run:finished'] = (payload) =>
      dispatch({ type: 'finished', payload });
    socket.on('run:started', onStarted);
    socket.on('run:output', onOutput);
    socket.on('run:finished', onFinished);
    return () => {
      socket.off('run:started', onStarted);
      socket.off('run:output', onOutput);
      socket.off('run:finished', onFinished);
    };
  }, [socket]);

  const start = useMutation({
    mutationFn: (input: { fileId: string; stdin: string }) =>
      api<RunDto>('/api/v1/runs', {
        method: 'POST',
        body: JSON.stringify({ roomSlug: slug, ...input }),
      }),
    onSuccess: (accepted) => dispatch({ type: 'accepted', run: accepted }),
  });

  // [CONCEPT: Polling Fallback] While the socket is down, ask for the run's state every second instead. Once it is
  // back, rejoining the room fetches the latest run (above), which catches up on anything sent while we were away.
  const runId = run?.id;
  const active = isActive(run);
  useEffect(() => {
    if (!runId || !active || connected) return;
    let cancelled = false;
    const sync = () =>
      api<RunDto>(`/api/v1/runs/${runId}`)
        .then((snapshot) => !cancelled && dispatch({ type: 'synced', run: snapshot }))
        .catch(() => undefined); // the next tick (or the socket) will try again
    void sync();
    const timer = setInterval(sync, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, active, connected]);

  const { mutate } = start;
  const runFile = useCallback((fileId: string) => mutate({ fileId, stdin }), [mutate, stdin]);

  return {
    run,
    runFile,
    /** Our request is in flight, or our own run hasn't finished: a second one would be refused. */
    busy: start.isPending || (active && run?.by === username),
    startError: start.error
      ? start.error instanceof ApiError
        ? start.error.message
        : 'Could not start the run. Check your connection.'
      : null,
    stdin,
    setStdin,
    connected,
    liveError: channel.error,
  };
}

/** Ctrl/⌘+Enter anywhere on the page runs the file (the editor registers the same keys itself). */
export function useRunShortcut(onRun: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.repeat || e.defaultPrevented) return;
      e.preventDefault();
      onRun();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onRun]);
}
