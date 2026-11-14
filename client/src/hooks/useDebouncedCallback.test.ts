import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedCallback } from './useDebouncedCallback';

describe('useDebouncedCallback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once, after the calls have paused for the delay, with the last arguments', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    result.current.call('p');
    vi.advanceTimersByTime(200);
    result.current.call('py');
    vi.advanceTimersByTime(200);
    // 400 ms of calls, but never 300 ms without one.
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledExactlyOnceWith('py');
  });

  it('can be cancelled, and never fires after unmounting', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 300));

    result.current.call('a');
    result.current.cancel();
    vi.advanceTimersByTime(300);
    result.current.call('b');
    unmount();
    vi.advanceTimersByTime(300);
    expect(callback).not.toHaveBeenCalled();
  });

  it('calls the newest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useDebouncedCallback(cb, 300), {
      initialProps: { cb: first },
    });
    result.current.call();
    rerender({ cb: second });
    vi.advanceTimersByTime(300);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
