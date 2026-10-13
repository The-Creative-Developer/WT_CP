import type { Server as HttpServer } from 'node:http';
import {
  colorFor,
  SOCKET_UNAUTHORIZED,
  type ClientToServerEvents,
  type RoomMember,
  type RoomRole,
  type ServerToClientEvents,
} from '@devverse/shared';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { AuthService, AuthUser } from '../services/auth';
import { resolveRoomAccess } from '../services/rooms';
import type { RunBroadcast, RunService } from '../services/runs';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';

interface SocketData {
  user: AuthUser;
  /** The rooms this socket joined, and the role it had when it joined. */
  roles: Map<string, RoomRole>;
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
      next();
    } catch {
      // The client refreshes its token and reconnects when it sees this message.
      next(new Error(SOCKET_UNAUTHORIZED));
    }
  });

  async function connectedMembers(slug: string): Promise<RoomMember[]> {
    const members = new Map<string, RoomMember>();
    for (const socket of await io.in(roomChannel(slug)).fetchSockets()) {
      const { user, roles } = socket.data;
      const role = roles.get(slug);
      // Several tabs of the same person count once.
      if (role && !members.has(user.id)) {
        members.set(user.id, {
          id: user.id,
          username: user.username,
          color: colorFor(user.username), // the same colour as their cursor in the editor
          role,
          status: 'online',
        });
      }
    }
    return [...members.values()];
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
      socket.data.roles.delete(parsed.data.slug);
      await socket.leave(roomChannel(parsed.data.slug));
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
