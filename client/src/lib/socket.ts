import {
  SOCKET_UNAUTHORIZED,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@devverse/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, onSessionChange, refreshSession } from './api';
import { setSocketState, type SocketState } from './socket-state';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let lastAuthRetry = 0;
// Whether this sign-in has been connected before: a lost connection shows "Reconnecting…", a first one doesn't.
let everConnected = false;

/** One Socket.IO connection per tab, shared by every feature that needs live events. */
export function getSocket(): AppSocket {
  if (socket) return socket;

  // Same origin in development (Vite proxies /socket.io); the API's origin in production if it differs.
  const created: AppSocket = io(import.meta.env.VITE_API_URL || undefined, {
    autoConnect: false,
    // [CONCEPT: Exponential Backoff + Jitter] After a drop, retries wait 1 s, 2 s, 4 s… up to 10 s, each randomised by
    // ±50% so that when the server restarts, every client doesn't reconnect in the same instant and knock it over.
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
    // A function, not a value: it runs on every (re)connect, so a reconnect always sends the newest access token.
    auth: (send) => send({ token: getAccessToken() ?? '' }),
  });

  created.on('connect', () => {
    everConnected = true;
  });
  // Mirrored into socket-state for the connection banner. 'connect_error' covers a failed retry; the manager's
  // 'close' covers disconnect() when there was no connection left to close.
  const report = () => setSocketState(stateOf(created));
  created.on('connect', report);
  created.on('disconnect', report);
  created.on('connect_error', report);
  created.io.on('close', report);

  // The server only disconnects everyone when it shuts down (a restart or a deploy). Socket.IO never retries a
  // disconnect the server asked for, so without this the room would say "Reconnecting…" until a reload. The first
  // attempt fails while the server is down; Socket.IO's backoff then takes over.
  created.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    created.connect();
    report();
  });

  // Network failures are retried by Socket.IO itself, with exponential backoff. A rejected token is not: get a fresh
  // one and reconnect. The time check stops a loop if the server keeps refusing even fresh tokens.
  created.on('connect_error', (err) => {
    if (err.message !== SOCKET_UNAUTHORIZED || Date.now() - lastAuthRetry < 10_000) return;
    lastAuthRetry = Date.now();
    void refreshSession().then((session) => {
      if (session) created.connect();
      report();
    });
  });

  // Signing out ends the live connection too.
  onSessionChange((session) => {
    if (session) return;
    everConnected = false;
    created.disconnect();
  });

  // [CONCEPT: Online/Offline Events] When the network comes back, reconnect now rather than waiting out a backoff
  // that may have grown to 10 s. Disconnecting first cancels the pending retry and resets the backoff.
  window.addEventListener('online', () => {
    if (created.active && !created.connected) created.disconnect().connect();
    report();
  });

  socket = created;
  return created;
}

function stateOf(shared: AppSocket): SocketState {
  // `active`: connected, or Socket.IO is still trying to (re)connect on its own.
  if (!shared.active) return 'idle';
  if (shared.connected) return 'connected';
  return everConnected ? 'reconnecting' : 'connecting';
}

/** The shared socket, connected while the component is mounted, plus whether it is connected right now. */
export function useSocket() {
  const shared = getSocket();
  // [CONCEPT: External Store Subscription] React reads `connected` straight from the socket and re-renders when
  // it emits connect/disconnect, instead of keeping a copy in state that could drift.
  const subscribe = useCallback(
    (notify: () => void) => {
      shared.on('connect', notify);
      shared.on('disconnect', notify);
      return () => {
        shared.off('connect', notify);
        shared.off('disconnect', notify);
      };
    },
    [shared],
  );
  const connected = useSyncExternalStore(subscribe, () => shared.connected);

  useEffect(() => {
    // `active` is true while Socket.IO is connected or still trying to reconnect on its own.
    if (!shared.active) {
      shared.connect();
      setSocketState(stateOf(shared));
    }
  }, [shared]);

  return { socket: shared, connected };
}
