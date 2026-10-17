import type { PresenceStatus } from '@devverse/shared';
import { useEffect, useState } from 'react';

/** How long a tab may stay hidden before its user counts as idle. Short tab switches don't flicker the status. */
export const IDLE_AFTER_MS = 30_000;

/**
 * 'online' while this tab is visible, 'idle' once it has been hidden for a while.
 * [CONCEPT: Page Visibility API] document.visibilityState says whether the user can see the page: it turns hidden
 * when they switch tabs, minimise the window or lock the screen.
 */
export function usePresenceStatus(idleAfterMs = IDLE_AFTER_MS): PresenceStatus {
  const [status, setStatus] = useState<PresenceStatus>(() =>
    document.visibilityState === 'hidden' ? 'idle' : 'online',
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') setStatus('online');
      else timer = setTimeout(() => setStatus('idle'), idleAfterMs);
    };
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [idleAfterMs]);

  return status;
}
