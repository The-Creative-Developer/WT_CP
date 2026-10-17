import { colorFor, type PresenceStatus, type RoomMember, type RoomRole } from '@devverse/shared';
import { useEffect, useId, useRef, useState } from 'react';

interface MembersListProps {
  /** Everyone in the room, from the room's REST data (loaded with the page). */
  members: { id: string; username: string; role: RoomRole }[];
  /** Who is connected right now, from the room channel. */
  present: RoomMember[];
  connected: boolean;
  myId: string | undefined;
}

type Status = PresenceStatus | 'offline';

const ORDER: Record<Status, number> = { online: 0, idle: 1, offline: 2 };

export function MembersList({ members, present, connected, myId }: MembersListProps) {
  const titleId = useId();
  const announcement = useJoinLeaveAnnouncement(present);

  const byId = new Map(present.map((m) => [m.id, m]));
  // Someone who joined after the page loaded is in `present` but not yet in `members`.
  const all = [...members];
  for (const m of present) if (!all.some((x) => x.id === m.id)) all.push(m);
  const rows = all
    .map((m) => ({ ...m, status: (byId.get(m.id)?.status ?? 'offline') as Status }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.username.localeCompare(b.username));
  const here = rows.filter((r) => r.status !== 'offline').length;

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="font-semibold">
        Members ({rows.length})
        <span className="ml-2 text-sm font-normal text-muted">
          {connected ? `${here} here now` : 'reconnecting…'}
        </span>
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {rows.map((m) => {
          const color = colorFor(m.username); // the same colour as their cursor
          return (
            <li key={m.id} className="flex items-center gap-2">
              {/* Filled when here, hollow when not. The status is also written out, so colour isn't the only cue. */}
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2"
                style={{
                  borderColor: color,
                  backgroundColor: m.status === 'online' ? color : 'transparent',
                  opacity: m.status === 'offline' ? 0.5 : 1,
                }}
              />
              <span className={m.status === 'offline' ? 'text-muted' : undefined}>
                @{m.username}
                {m.id === myId && <span className="text-muted"> (you)</span>}
              </span>
              <span className="ml-auto text-xs text-muted">
                {m.status} · <span className="capitalize">{m.role}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {/* [CONCEPT: Live Regions] Joins and leaves are announced to screen readers without moving focus. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/** "@bob joined the room" / "@bob left the room", for changes after the first list arrived. */
function useJoinLeaveAnnouncement(present: RoomMember[]): string {
  const [message, setMessage] = useState('');
  const previous = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const now = new Map(present.map((m) => [m.id, m.username]));
    const before = previous.current;
    previous.current = now;
    // The first list after joining is the room as we found it, not a change. Until then the list is empty (we are
    // always in it once joined), so an empty "before" means there is nothing to compare with yet.
    if (!before?.size) return;
    const joined = [...now].filter(([id]) => !before.has(id)).map(([, name]) => name);
    const left = [...before].filter(([id]) => !now.has(id)).map(([, name]) => name);
    const parts = [
      ...joined.map((name) => `@${name} joined the room`),
      ...left.map((name) => `@${name} left the room`),
    ];
    if (parts.length) setMessage(parts.join('. '));
  }, [present]);

  return message;
}
