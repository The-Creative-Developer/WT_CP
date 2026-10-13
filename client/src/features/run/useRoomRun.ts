import type { RunDto, ServerToClientEvents } from '@devverse/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useSocket } from '../../lib/socket';
import { isActive, runReducer } from './run-state';

const POLL_INTERVAL_MS = 1_000;

/** The room's latest run, live over Socket.IO, and a way to start a new one. */
export function useRoomRun(slug: string, username: string) {
  const { socket, connected } = useSocket();
  const [run, dispatch] = useReducer(runReducer, null);
  const [stdin, setStdin] = useState('');
  const [liveError, setLiveError] = useState<string | null>(null);

  // Join the room's channel now and after every reconnect (the server forgets a socket's rooms when it drops).
  useEffect(() => {
    const join = () => {
      socket
        .timeout(5_000)
        .emitWithAck('room:join', { slug })
        .then((res) => setLiveError(res.ok ? null : res.error))
        .catch(() => setLiveError('Live output is unavailable right now'));
    };
    socket.on('connect', join);
    if (socket.connected) join();
    return () => {
      socket.off('connect', join);
      if (socket.connected) socket.emit('room:leave', { slug });
    };
  }, [socket, slug]);

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

  // [CONCEPT: Polling Fallback] While the socket is down, ask for the run's state every second instead. After it
  // comes back, fetch once more to catch up on anything sent while we were away.
  const runId = run?.id;
  const active = isActive(run);
  const missedEvents = useRef(false);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const sync = () =>
      api<RunDto>(`/api/v1/runs/${runId}`)
        .then((snapshot) => !cancelled && dispatch({ type: 'synced', run: snapshot }))
        .catch(() => undefined); // the next tick (or the socket) will try again

    if (connected) {
      if (missedEvents.current) void sync();
      missedEvents.current = false;
      return;
    }
    if (!active) return;
    missedEvents.current = true;
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
    liveError,
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
