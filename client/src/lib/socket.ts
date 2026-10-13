import {
  SOCKET_UNAUTHORIZED,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@devverse/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, onSessionChange, refreshSession } from './api';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let lastAuthRetry = 0;

/** One Socket.IO connection per tab, shared by every feature that needs live events. */
export function getSocket(): AppSocket {
  if (socket) return socket;

  // Same origin in development (Vite proxies /socket.io); the API's origin in production if it differs.
  const created: AppSocket = io(import.meta.env.VITE_API_URL || undefined, {
    autoConnect: false,
    // A function, not a value: it runs on every (re)connect, so a reconnect always sends the newest access token.
    auth: (send) => send({ token: getAccessToken() ?? '' }),
  });

  // Network failures are retried by Socket.IO itself, with exponential backoff. A rejected token is not: get a fresh
  // one and reconnect. The time check stops a loop if the server keeps refusing even fresh tokens.
  created.on('connect_error', (err) => {
    if (err.message !== SOCKET_UNAUTHORIZED || Date.now() - lastAuthRetry < 10_000) return;
    lastAuthRetry = Date.now();
    void refreshSession().then((session) => {
      if (session) created.connect();
    });
  });

  // Signing out ends the live connection too.
  onSessionChange((session) => {
    if (!session) created.disconnect();
  });

  socket = created;
  return created;
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
    if (!shared.active) shared.connect();
  }, [shared]);

  return { socket: shared, connected };
}
