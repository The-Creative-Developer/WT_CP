import { useEffect, useState } from 'react';
import { useOnline } from '../../hooks/useOnline';
import { useSocketState } from '../../lib/socket-state';

type Problem = 'offline' | 'reconnecting' | null;

const RECOVERED_MS = 4_000;

const MESSAGES = {
  offline:
    "You're offline. Edits you make in the editor are kept on this device and sync when you reconnect.",
  reconnecting:
    'Lost the connection to DevVerse. Reconnecting… Editing, chat and runs pick up again once it’s back.',
  recovered: 'Back online.',
};

/**
 * A bar under the header while the network or the live connection is down, and briefly once it's back.
 * Rooms show finer detail (the editor's "Reconnecting…", chat's disabled Send); this is the page-wide summary.
 */
export function ConnectionBanner() {
  const online = useOnline();
  const socket = useSocketState();
  // 'connecting' (the first connection of a visit) isn't a problem; losing a connection that worked is.
  const problem: Problem = !online ? 'offline' : socket === 'reconnecting' ? 'reconnecting' : null;

  // "Back online" appears when a problem clears. Worked out while rendering, from the previous problem, rather
  // than in an effect that would render the stale banner first.
  const [previous, setPrevious] = useState<Problem>(problem);
  const [recovered, setRecovered] = useState(false);
  if (problem !== previous) {
    setPrevious(problem);
    setRecovered(problem === null);
  }
  useEffect(() => {
    if (!recovered) return;
    const timer = setTimeout(() => setRecovered(false), RECOVERED_MS);
    return () => clearTimeout(timer);
  }, [recovered]);

  const message = problem ? MESSAGES[problem] : recovered ? MESSAGES.recovered : null;
  return (
    // [CONCEPT: Live Regions] Always in the page (empty when all is well), so screen readers notice when it fills.
    <div role="status" className="sticky top-[var(--header-height)] z-[9]">
      {message && (
        <p
          className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${
            // Opaque (tint mixed into the surface colour), since it sits over the page as it scrolls.
            problem
              ? 'border-warning bg-[color-mix(in_srgb,var(--color-warning)_12%,var(--color-surface))]'
              : 'border-success bg-[color-mix(in_srgb,var(--color-success)_12%,var(--color-surface))]'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${problem ? 'bg-warning' : 'bg-success'}`}
          />
          {message}
        </p>
      )}
    </div>
  );
}
