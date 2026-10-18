import type { ChatMessage, MessagePage, ServerToClientEvents } from '@devverse/shared';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { roomKeys } from '../rooms/queries';
import type { RoomChannel } from '../rooms/useRoomChannel';

/** How often this tab tells the room it's typing, at most. */
export const TYPING_SIGNAL_MS = 2_000;
/** How long someone shows as typing after their last signal. */
export const TYPING_SHOWN_MS = 3_500;

type Pages = InfiniteData<MessagePage, string | null>;

/** The room's chat: history (paged backwards), live messages, sending, and who is typing. */
export function useChat(slug: string, channel: RoomChannel, myId: string | undefined) {
  const { socket, connected, joins } = channel;
  const queryClient = useQueryClient();
  const key = roomKeys.messages(slug);

  const history = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        `/api/v1/rooms/${encodeURIComponent(slug)}/messages` +
          (pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Live messages keep it current; it only needs fetching again after a reconnect (below).
    staleTime: Infinity,
  });

  const addMessage = useCallback(
    (message: ChatMessage) => {
      const key = roomKeys.messages(slug);
      const current = queryClient.getQueryData<Pages>(key);
      // History hasn't loaded yet: the request in flight may predate this message, so fetch again afterwards.
      if (!current) return void queryClient.invalidateQueries({ queryKey: key });
      queryClient.setQueryData<Pages>(key, (data) => {
        if (!data || data.pages.some((p) => p.messages.some((m) => m.id === message.id)))
          return data;
        const [newest, ...older] = data.pages;
        return {
          ...data,
          pages: [{ ...newest!, messages: [message, ...newest!.messages] }, ...older],
        };
      });
    },
    [queryClient, slug],
  );

  // After a reconnect, fetch again: messages sent while we were away never reached this socket.
  const firstJoin = useRef(true);
  useEffect(() => {
    if (joins === 0) return;
    if (firstJoin.current) {
      firstJoin.current = false;
      return;
    }
    void queryClient.invalidateQueries({ queryKey: roomKeys.messages(slug) });
  }, [joins, queryClient, slug]);

  // Who is typing: userId → { username, until }.
  const [typing, setTyping] = useState<Map<string, { username: string; until: number }>>(
    () => new Map(),
  );
  const [lastIncoming, setLastIncoming] = useState<ChatMessage | null>(null);

  useEffect(() => {
    const onNew: ServerToClientEvents['chat:new'] = (message) => {
      addMessage(message);
      setLastIncoming(message);
      // Their message has arrived, so they've stopped typing it.
      setTyping((current) => {
        if (!current.has(message.author.id)) return current;
        const next = new Map(current);
        next.delete(message.author.id);
        return next;
      });
    };
    const onTyping: ServerToClientEvents['chat:typing'] = ({ userId, username }) => {
      if (userId === myId) return; // our own other tabs
      setTyping((current) =>
        new Map(current).set(userId, { username, until: Date.now() + TYPING_SHOWN_MS }),
      );
    };
    socket.on('chat:new', onNew);
    socket.on('chat:typing', onTyping);
    return () => {
      socket.off('chat:new', onNew);
      socket.off('chat:typing', onTyping);
    };
  }, [socket, addMessage, myId]);

  // Expire typing entries when their time is up.
  useEffect(() => {
    if (typing.size === 0) return;
    const nextExpiry = Math.min(...[...typing.values()].map((t) => t.until));
    const timer = setTimeout(
      () =>
        setTyping((current) => {
          const now = Date.now();
          return new Map([...current].filter(([, t]) => t.until > now));
        }),
      Math.max(0, nextExpiry - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [typing]);

  // [CONCEPT: Throttling] Typing produces an event per keystroke; the room hears about it at most every 2 s.
  // (Debouncing would wait for a pause, which is the opposite of what a "typing…" indicator needs.)
  const lastSignal = useRef(0);
  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (!connected || now - lastSignal.current < TYPING_SIGNAL_MS) return;
    lastSignal.current = now;
    socket.emit('chat:typing', { slug });
  }, [socket, slug, connected]);

  const send = useCallback(
    async (body: string) => {
      let res;
      try {
        res = await socket.timeout(5_000).emitWithAck('chat:send', { slug, body });
      } catch {
        throw new Error("Couldn't send the message. Check your connection and try again.");
      }
      if (!res.ok) throw new Error(res.error);
      lastSignal.current = 0; // the next keystroke is a new message: signal straight away
      addMessage(res.data);
    },
    [socket, slug, addMessage],
  );

  // Oldest first, for display.
  const messages = useMemo(
    () => (history.data?.pages ?? []).flatMap((p) => p.messages).reverse(),
    [history.data],
  );

  return {
    messages,
    status: history.status,
    hasOlder: history.hasNextPage,
    loadingOlder: history.isFetchingNextPage,
    loadOlder: history.fetchNextPage,
    send,
    signalTyping,
    typing: [...typing.values()].map((t) => t.username),
    lastIncoming,
    connected,
  };
}
