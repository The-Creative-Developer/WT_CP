import type { Server as HttpServer } from 'node:http';
import {
  chatSendSchema,
  chatTypingSchema,
  colorFor,
  MAX_CALL_PEERS,
  SOCKET_UNAUTHORIZED,
  type CallPeer,
  type ClientToServerEvents,
  type MediaState,
  type PresenceStatus,
  type RoomMember,
  type RoomRole,
  type ServerToClientEvents,
} from '@devverse/shared';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { AuthService, AuthUser } from '../services/auth';
import { postMessage } from '../services/chat';
import { roomEvents } from '../services/room-events';
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
  /** The call this socket is in (at most one), and whether its microphone and camera are on. */
  call: { slug: string; media: MediaState } | null;
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
/** The Socket.IO room of the people in a DevVerse room's call. */
export const callChannel = (slug: string) => `call:${slug}`;

const mediaSchema = z.object({ audio: z.boolean(), video: z.boolean() });
const callJoinPayload = z.object({ slug: z.string().trim().min(1).max(64), media: mediaSchema });
const callMediaPayload = callJoinPayload;
// Socket ids are 20 URL-safe characters; the bound just keeps garbage out.
const peerId = z.string().min(1).max(64);
// [CONCEPT: SDP] A session description lists the media, codecs, encryption keys and network details of one side of
// the connection. A few kilobytes of text; 32 KB is generous.
const descriptionPayload = z.object({
  to: peerId,
  description: z.object({
    type: z.enum(['offer', 'answer']),
    sdp: z.string().max(32 * 1024),
  }),
});
// [CONCEPT: ICE Candidates] One possible network path to a peer (a local address, a public one found through STUN, or
// a TURN relay). Both sides trade candidates and keep the best pair that works.
const icePayload = z.object({
  to: peerId,
  candidate: z.object({
    candidate: z.string().max(2048),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.int().min(0).max(64).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
});
// Signalling flood control, per socket. A call setup sends a few descriptions and tens of candidates per peer.
const SIGNAL_BURST = 200;
const SIGNAL_WINDOW_MS = 10_000;

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
      socket.data.call = null;
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

  async function callPeers(slug: string): Promise<CallPeer[]> {
    const sockets = await io.in(callChannel(slug)).fetchSockets();
    return sockets.flatMap(({ id, data: { user, call } }) =>
      call?.slug === slug
        ? [{ peerId: id, user: { id: user.id, username: user.username }, media: call.media }]
        : [],
    );
  }

  /** Everyone in the room (not just the call) sees who is in the call, so they know whether to join. */
  async function broadcastRoster(slug: string) {
    io.to(roomChannel(slug)).emit('call:roster', { slug, peers: await callPeers(slug) });
  }

  // [CONCEPT: Presence] Everyone in the room gets the full list of who is connected whenever it changes. Sending the
  // whole list (at most 10 people) rather than "X joined" deltas means a client can never drift out of sync.
  async function broadcastPresence(slug: string) {
    io.to(roomChannel(slug)).emit('presence:update', { members: await connectedMembers(slug) });
  }

  io.on('connection', (socket) => {
    const { user } = socket.data;

    async function leaveCall() {
      const call = socket.data.call;
      if (!call) return;
      socket.data.call = null;
      await socket.leave(callChannel(call.slug));
      await broadcastRoster(call.slug);
    }

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
        socket.emit('call:roster', { slug, peers: await callPeers(slug) });
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
      if (socket.data.call?.slug === slug) await leaveCall();
      await socket.leave(roomChannel(slug));
      await broadcastPresence(slug);
    });

    const others = async (slug: string) =>
      (await callPeers(slug)).filter((p) => p.peerId !== socket.id);

    // [CONCEPT: Signalling] WebRTC connects browsers directly, but they first need some way to exchange offers,
    // answers and ICE candidates. Socket.IO is that channel here: the server relays messages and never sees media.
    socket.on('call:join', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = callJoinPayload.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'Invalid call' });
      const { slug, media } = parsed.data;
      // Anyone in the room, viewers included, may talk: like chat, it doesn't change the code.
      if (!socket.data.roles.has(slug)) return ack({ ok: false, error: 'Join the room first' });
      if (socket.data.call?.slug === slug) {
        return ack({ ok: true, data: { peerId: socket.id, peers: await others(slug) } });
      }
      await leaveCall();

      // The count and the join happen with no await in between: Node runs this synchronously, so two people taking
      // the last place at the same moment can't both get in.
      const size = io.sockets.adapter.rooms.get(callChannel(slug))?.size ?? 0;
      if (size >= MAX_CALL_PEERS) {
        return ack({ ok: false, error: `The call is full (${MAX_CALL_PEERS} people at most)` });
      }
      socket.data.call = { slug, media };
      void socket.join(callChannel(slug));

      ack({ ok: true, data: { peerId: socket.id, peers: await others(slug) } });
      await broadcastRoster(slug);
    });

    socket.on('call:leave', async (payload) => {
      const parsed = slugPayload.safeParse(payload);
      if (parsed.success && socket.data.call?.slug === parsed.data.slug) await leaveCall();
    });

    socket.on('call:media', async (payload) => {
      const parsed = callMediaPayload.safeParse(payload);
      const call = socket.data.call;
      if (!parsed.success || call?.slug !== parsed.data.slug) return;
      const { media } = parsed.data;
      if (media.audio === call.media.audio && media.video === call.media.video) return;
      call.media = media;
      await broadcastRoster(call.slug);
    });

    const signalAt: number[] = [];
    /** The peer a signalling message may go to: another socket in the same call. Null drops the message. */
    function relayTarget(to: string) {
      const now = Date.now();
      while (signalAt.length && now - signalAt[0]! > SIGNAL_WINDOW_MS) signalAt.shift();
      if (signalAt.length >= SIGNAL_BURST) return null;
      signalAt.push(now);
      const call = socket.data.call;
      const target = io.sockets.sockets.get(to);
      if (!call || !target || target.id === socket.id) return null;
      // [CONCEPT: Server-Side Authorization] Only between two peers of the same call: a socket id alone isn't enough
      // to start sending someone offers.
      return target.data.call?.slug === call.slug ? target : null;
    }

    socket.on('rtc:description', (payload) => {
      const parsed = descriptionPayload.safeParse(payload);
      if (!parsed.success) return;
      relayTarget(parsed.data.to)?.emit('rtc:description', {
        from: socket.id,
        description: parsed.data.description,
      });
    });

    socket.on('rtc:ice', (payload) => {
      const parsed = icePayload.safeParse(payload);
      if (!parsed.success) return;
      relayTarget(parsed.data.to)?.emit('rtc:ice', {
        from: socket.id,
        candidate: parsed.data.candidate,
      });
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
      const call = socket.data.call;
      if (call) {
        socket.data.call = null;
        broadcastRoster(call.slug).catch((err: unknown) =>
          logger.warn(
            { err, slug: call.slug },
            'Could not send the call roster after a disconnect',
          ),
        );
      }
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

  const unsubscribeFiles = roomEvents.onFilesChanged(({ roomSlug, files, by }) => {
    io.to(roomChannel(roomSlug)).emit('files:changed', { files, by });
  });

  return {
    io,
    /** Disconnects every client. Leaves the HTTP server itself running (io.close() would close it too). */
    close() {
      unsubscribe?.();
      unsubscribeFiles();
      io.disconnectSockets(true);
      io.engine.close();
    },
  };
}
