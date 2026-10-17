import type { RoomMember, ServerToClientEvents } from '@devverse/shared';
import { useEffect, useState } from 'react';
import { usePresenceStatus } from '../../hooks/usePresenceStatus';
import { useSocket } from '../../lib/socket';

export type RoomChannel = ReturnType<typeof useRoomChannel>;

/**
 * The room's live channel: joins it (again after every reconnect, since the server forgets a dropped socket's
 * rooms), keeps the list of who is here, and reports whether this tab is in use. Features that need room events
 * (runs, chat) use this rather than joining on their own.
 */
export function useRoomChannel(slug: string) {
  const { socket, connected } = useSocket();
  const [present, setPresent] = useState<RoomMember[]>([]);
  // Counts successful joins, so features can catch up on what happened before each one.
  const [joins, setJoins] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const status = usePresenceStatus();

  useEffect(() => {
    const join = () => {
      socket
        .timeout(5_000)
        .emitWithAck('room:join', { slug })
        .then((res) => {
          if (!res.ok) return setError(res.error);
          setError(null);
          setPresent(res.data.members);
          setJoins((n) => n + 1);
        })
        .catch(() => setError('Live updates are unavailable right now'));
    };
    const onPresence: ServerToClientEvents['presence:update'] = ({ members }) =>
      setPresent(members);

    socket.on('connect', join);
    socket.on('presence:update', onPresence);
    if (socket.connected) join();
    return () => {
      socket.off('connect', join);
      socket.off('presence:update', onPresence);
      if (socket.connected) socket.emit('room:leave', { slug });
    };
  }, [socket, slug]);

  // A freshly joined socket starts as online on the server, so send the status again after every join too.
  useEffect(() => {
    if (connected && joins > 0) socket.emit('presence:status', { slug, status });
  }, [socket, slug, status, connected, joins]);

  return { socket, connected, present, joins, error };
}
