import { useSyncExternalStore } from 'react';

function subscribe(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

/**
 * Whether the browser thinks it has a network connection.
 *
 * [CONCEPT: Online/Offline Events] `navigator.onLine` plus the window's online/offline events. "Offline" is
 * reliable (no network at all); "online" only means some network, not that our server is reachable, which is why
 * the socket's own state is checked too.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
