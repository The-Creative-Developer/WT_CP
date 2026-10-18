import type { Server as HttpServer } from 'node:http';
import {
  chatSendSchema,
  chatTypingSchema,
  colorFor,
  SOCKET_UNAUTHORIZED,
  type ClientToServerEvents,
  type PresenceStatus,
  type RoomMember,
  type RoomRole,
  type ServerToClientEvents,
} from '@devverse/shared';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { AuthService, AuthUser } from '../services/auth';
import { postMessage } from '../services/chat';
import { resolveRoomAccess } from '../services/rooms';
import type { RunBroadcast, RunService } from '../services/runs';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';

interface SocketData {
  user: AuthUser;
  /** The rooms this socket joined, and the role it had when it joined. */
  roles: Map<string, RoomRole>;
  /** Whether this tab is in use (see presence:status). */
  status: PresenceStatus;
}

export type SocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

interface SocketOptions {
  auth: AuthService;
  allowedOrigins: string[];
  runs?: RunService;
}

const slugPayload = z.object({ slug: z.string().trim().min(1).max(64) });
// Chat flood control, per socket: at most CHAT_BURST messages in any CHAT_WINDOW_MS, and one typing signal per
// TYPING_INTERVAL_MS. The client throttles typing to one per 2 s on its own; this protects against clients that don't.
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5_000;
const TYPING_INTERVAL_MS = 1_500;

const statusPayload = z.object({
  slug: z.string().trim().min(1).max(64),
  status: z.enum(['online', 'idle']),
});

/** The Socket.IO room that carries one DevVerse room's events. */
export const roomChannel = (slug: string) => `room:${slug}`;

/**
 * App events (runs now; presence, chat and call signalling later), on the API's HTTP server and port.
 * Separate from the Yjs channel on purpose (ADR 002): that one carries only binary document sync.
 */
export function attachSocketServer(
  server: HttpServer,
  { auth, allowedOrigins, runs }: SocketOptions,
) {
  const io: SocketServer = new Server(server, {
    cors: { origin: allowedOrigins },
    // [CONCEPT: Cross-Site WebSocket Hijacking] CORS doesn't apply to the WebSocket transport, so check Origin here.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    // Every client → server event is small; refuse anything bigger before parsing it.
    maxHttpBufferSize: 64 * 1024,
  });

  // [CONCEPT: Handshake Authentication] The access token is checked once, when the connection opens. It travels in
  // the handshake's auth payload rather than the URL, so it never ends up in access logs.
  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    try {
      if (typeof token !== 'string' || !token) throw new Error('missing token');
      socket.data.user = await auth.verifyAccessToken(token);
      socket.data.roles = new Map();
      socket.data.status = 'online';
      next();
    } catch {
      // The client refreshes its token and reconnects when it sees this message.
      next(new Error(SOCKET_UNAUTHORIZED));
    }
  });

  async function connectedMembers(slug: string): Promise<RoomMember[]> {
    const members = new Map<string, RoomMember>();
    for (const socket of await io.in(roomChannel(slug)).fetchSockets()) {
      const { user, roles, status } = socket.data;
      const role = roles.get(slug);
      if (!role) continue;
      const seen = members.get(user.id);
      // Several tabs of the same person count once: online if any of them is in use.
      if (seen) {
        if (status === 'online') seen.status = 'online';
        continue;
      }
      members.set(user.id, {
        id: user.id,
        username: user.username,
        color: colorFor(user.username), // the same colour as their cursor in the editor
        role,
        status,
      });
    }
    return [...members.values()];
  }

  // [CONCEPT: Presence] Everyone in the room gets the full list of who is connected whenever it changes. Sending the
  // whole list (at most 10 people) rather than "X joined" deltas means a client can never drift out of sync.
  async function broadcastPresence(slug: string) {
    io.to(roomChannel(slug)).emit('presence:update', { members: await connectedMembers(slug) });
  }

  io.on('connection', (socket) => {
    const { user } = socket.data;

    socket.on('room:join', async (payload, ack) => {
      // Payloads come from the client and can't be trusted to match the TypeScript types.
      if (typeof ack !== 'function') return;
      const parsed = slugPayload.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'Invalid room' });
      const { slug } = parsed.data;
      try {
        // [CONCEPT: Server-Side Authorization] Membership is checked against the database on every join, the same
        // rule as the REST API and the Yjs upgrade, so being able to connect doesn't mean being able to listen in.
        const access = await resolveRoomAccess(user.id, { slug });
        socket.data.roles.set(slug, access.role);
        // [CONCEPT: Socket.IO Rooms] A named group of sockets; emitting to it reaches everyone in the DevVerse room.
        await socket.join(roomChannel(slug));
        ack({ ok: true, data: { members: await connectedMembers(slug) } });
        await broadcastPresence(slug);
      } catch (err) {
        if (!(err instanceof HttpError)) logger.error({ err, slug }, 'room:join failed');
        ack({
          ok: false,
          error: err instanceof HttpError ? err.message : 'Could not join the room',
        });
      }
    });

    socket.on('room:leave', async (payload) => {
      const parsed = slugPayload.safeParse(payload);
      if (!parsed.success) return;
      const { slug } = parsed.data;
      if (!socket.data.roles.delete(slug)) return;
      await socket.leave(roomChannel(slug));
      await broadcastPresence(slug);
    });

    // The tab was hidden for a while (idle) or came back (online). Sent by the client on visibility changes.
    socket.on('presence:status', async (payload) => {
      const parsed = statusPayload.safeParse(payload);
      // Ignore repeats, so a client can't make the server broadcast in a tight loop by resending the same status.
      if (!parsed.success || parsed.data.status === socket.data.status) return;
      socket.data.status = parsed.data.status;
      // A tab's visibility is the same for every room it's in.
      await Promise.all([...socket.data.roles.keys()].map(broadcastPresence));
    });

    // [CONCEPT: Rate Limiting] A sliding window of this socket's recent message times.
    const sentAt: number[] = [];
    let lastTyping = 0;

    socket.on('chat:send', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success) {
        return ack({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid message' });
      }
      const now = Date.now();
      while (sentAt.length && now - sentAt[0]! > CHAT_WINDOW_MS) sentAt.shift();
      if (sentAt.length >= CHAT_BURST) {
        return ack({ ok: false, error: "You're sending messages too fast. Wait a moment." });
      }
      sentAt.push(now);
      const { slug, body } = parsed.data;
      try {
        // Membership is checked against the database on every message, like every other room action.
        const message = await postMessage(user, slug, body);
        ack({ ok: true, data: message });
        // Everyone else in the room, including the sender's other tabs; the sending tab has the ack.
        socket.to(roomChannel(slug)).emit('chat:new', message);
      } catch (err) {
        if (!(err instanceof HttpError)) logger.error({ err, slug }, 'chat:send failed');
        ack({
          ok: false,
          error: err instanceof HttpError ? err.message : 'Could not send the message',
        });
      }
    });

    socket.on('chat:typing', (payload) => {
      const parsed = chatTypingSchema.safeParse(payload);
      // Only for rooms this socket joined (membership was checked then), and not more often than the interval.
      if (!parsed.success || !socket.data.roles.has(parsed.data.slug)) return;
      const now = Date.now();
      if (now - lastTyping < TYPING_INTERVAL_MS) return;
      lastTyping = now;
      socket
        .to(roomChannel(parsed.data.slug))
        .emit('chat:typing', { userId: user.id, username: user.username });
    });

    // Socket.IO removes a disconnected socket from its rooms by itself; tell those rooms who is left.
    socket.on('disconnect', () => {
      for (const slug of socket.data.roles.keys()) {
        broadcastPresence(slug).catch((err: unknown) =>
          logger.warn({ err, slug }, 'Could not send presence after a disconnect'),
        );
      }
    });
  });

  const unsubscribe = runs?.subscribe((broadcast: RunBroadcast) => {
    const room = io.to(roomChannel(broadcast.roomSlug));
    // Narrowed one by one so each emit is checked against its own payload type.
    if (broadcast.event === 'run:started') room.emit(broadcast.event, broadcast.payload);
    else if (broadcast.event === 'run:output') room.emit(broadcast.event, broadcast.payload);
    else room.emit(broadcast.event, broadcast.payload);
  });

  return {
    io,
    /** Disconnects every client. Leaves the HTTP server itself running (io.close() would close it too). */
    close() {
      unsubscribe?.();
      io.disconnectSockets(true);
      io.engine.close();
    },
  };
}
