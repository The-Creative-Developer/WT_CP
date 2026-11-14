import { useSyncExternalStore } from 'react';

export type SocketState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

/*
 * The live connection's state, kept apart from socket.ts so the page-wide banner can read it without pulling
 * socket.io-client (~14 kB gzipped) into the bundle every page loads. socket.ts, loaded with the room page, writes it.
 */
let state: SocketState = 'idle';
const listeners = new Set<() => void>();

export function setSocketState(next: SocketState) {
  if (next === state) return;
  state = next;
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The shared socket's state: 'idle' until a page that needs live events (a room) opens it. */
export function useSocketState(): SocketState {
  return useSyncExternalStore(subscribe, () => state);
}
