import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketState } from '../../lib/socket-state';
import { ConnectionBanner } from './ConnectionBanner';

let socketState: SocketState = 'connected';
vi.mock('../../lib/socket-state', () => ({ useSocketState: () => socketState }));

let onLine = true;
function goOnline(value: boolean) {
  onLine = value;
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

describe('ConnectionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
    onLine = true;
    socketState = 'connected';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays empty while everything is connected, or still connecting for the first time', () => {
    const { rerender } = render(<ConnectionBanner />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    socketState = 'connecting';
    rerender(<ConnectionBanner />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says when the browser goes offline, and briefly when it is back', () => {
    render(<ConnectionBanner />);
    goOnline(false);
    expect(screen.getByRole('status')).toHaveTextContent("You're offline.");

    goOnline(true);
    expect(screen.getByRole('status')).toHaveTextContent('Back online.');
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says when a working live connection drops, until it reconnects', () => {
    const { rerender } = render(<ConnectionBanner />);
    socketState = 'reconnecting';
    rerender(<ConnectionBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    socketState = 'connected';
    rerender(<ConnectionBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Back online.');
  });
});
