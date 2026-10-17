import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_AFTER_MS, usePresenceStatus } from './usePresenceStatus';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('usePresenceStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns idle only after the tab has been hidden for a while, and back at once', () => {
    const { result } = renderHook(() => usePresenceStatus());
    expect(result.current).toBe('online');

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS - 1));
    expect(result.current).toBe('online'); // a quick tab switch doesn't count

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('idle');

    act(() => setVisibility('visible'));
    expect(result.current).toBe('online');
  });

  it('cancels going idle when the tab comes back in time', () => {
    const { result } = renderHook(() => usePresenceStatus());
    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS / 2));
    act(() => setVisibility('visible'));
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS));
    expect(result.current).toBe('online');
  });
});
