import { useEffect, useRef } from 'react';

/**
 * Wraps `callback` so that a burst of calls runs it once, `delay` ms after the last one, with the last arguments.
 *
 * [CONCEPT: Debouncing] Each call restarts the timer, so typing "python" sends one search when the typing pauses
 * instead of six (one per letter). Throttling would instead run it at most once every `delay` ms *while* typing.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
) {
  // The newest callback, so a timer started a few renders ago doesn't call a stale one.
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Nothing fires after the component has gone.
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    call(...args: Args) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current(...args), delay);
    },
    /** Drops a pending call (e.g. because the caller is acting right now instead). */
    cancel() {
      clearTimeout(timer.current);
    },
  };
}
