import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { AuthService } from '../services/auth';
import { resolveFileAccess } from '../services/rooms';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';
import { SharedDoc, TEXT_NAME } from './shared-doc';

export const COLLAB_PATH = '/yjs';

// Application close codes (4000–4999 are free for apps). y-websocket stops reconnecting on 4400–4499.
export const CloseCode = {
  Unauthorized: 4401, // token missing/expired: the client refreshes it and reconnects
  Forbidden: 4403,
  NotFound: 4404,
  ServerError: 1011,
  ServiceRestart: 1012, // standard code: "come back in a moment"
} as const;

const PING_INTERVAL_MS = 30_000;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

interface CollabOptions {
  auth: AuthService;
  allowedOrigins: string[];
}

/**
 * Real-time document sync for the editor, sharing the API's HTTP server and port.
 *
 * URL: /yjs/<roomSlug>/<fileId>?token=<access token>
 */
export function attachCollabServer(server: Server, { auth, allowedOrigins }: CollabOptions) {
  // [CONCEPT: Message Size Limits] maxPayload stops one client from making the server buffer huge frames.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  // [CONCEPT: Reference Counting] Each connection (including one still mid-handshake) holds a reference. The document
  // is saved and dropped from memory only when the count reaches zero, so a newcomer can't get a destroyed doc.
  const docs = new Map<string, { doc: Promise<SharedDoc>; refs: number }>();
  // Saves still running for documents that were just closed; a reopen waits for them so it never loads stale data.
  const pendingFlushes = new Map<string, Promise<void>>();
  const alive = new WeakSet<WebSocket>();

  function acquire(fileId: string): Promise<SharedDoc> {
    let entry = docs.get(fileId);
    if (!entry) {
      // [CONCEPT: Promise Deduplication] Two people opening a file at the same moment share one load.
      const doc = (async () => {
        await pendingFlushes.get(fileId);
        const shared = new SharedDoc(fileId);
        await shared.load();
        return shared;
      })();
      const created = { doc, refs: 0 };
      doc.catch(() => {
        if (docs.get(fileId) === created) docs.delete(fileId);
      });
      docs.set(fileId, created);
      entry = created;
    }
    entry.refs++;
    return entry.doc;
  }

  function release(fileId: string) {
    const entry = docs.get(fileId);
    if (!entry || --entry.refs > 0) return;
    docs.delete(fileId);
    const flush: Promise<void> = entry.doc
      .then(
        (shared) => shared.flush().finally(() => shared.destroy()),
        () => undefined,
      )
      .finally(() => {
        if (pendingFlushes.get(fileId) === flush) pendingFlushes.delete(fileId);
      });
    pendingFlushes.set(fileId, flush);
  }

  // [CONCEPT: HTTP Upgrade] A WebSocket starts life as an HTTP GET with "Upgrade: websocket". We inspect it here,
  // before any WebSocket exists, and turn away requests from other sites outright.
  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Not ours (e.g. Socket.IO, which registers its own upgrade listener).
    if (!url.pathname.startsWith(`${COLLAB_PATH}/`)) return;

    // [CONCEPT: Cross-Site WebSocket Hijacking] WebSockets aren't covered by CORS, so check Origin ourselves.
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void accept(ws, url);
    });
  }

  async function accept(ws: WebSocket, url: URL) {
    // Buffer frames that arrive while we authorise and load, so none of the client's first messages are lost.
    const queued: Uint8Array[] = [];
    let onMessage: (data: Uint8Array) => void = (data) => queued.push(data);
    ws.on('message', (data: RawData) => onMessage(toUint8Array(data)));
    ws.on('error', (err) => logger.debug({ err }, 'Collab socket error'));
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    const [slug = '', fileId = ''] = url.pathname.slice(COLLAB_PATH.length + 1).split('/');
    // [CONCEPT: Tokens in WebSocket URLs] Browsers can't set headers on a WebSocket handshake, so the short-lived
    // access token travels in the query string. These URLs must never be written to logs.
    const token = url.searchParams.get('token');

    let user;
    try {
      if (!token) throw new Error('missing token');
      user = await auth.verifyAccessToken(token);
    } catch {
      // [CONCEPT: WebSocket Close Codes] Browsers hide the HTTP status of a failed handshake from JavaScript, so we
      // complete it and close with an application code the client can act on.
      ws.close(CloseCode.Unauthorized, 'Access token is invalid or expired');
      return;
    }

    let readOnly: boolean;
    try {
      readOnly = (await resolveFileAccess(user.id, slug, fileId)).role === 'viewer';
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) logger.error({ err, fileId }, 'Failed to open collaborative document');
      ws.close(
        status === 403
          ? CloseCode.Forbidden
          : status === 404
            ? CloseCode.NotFound
            : CloseCode.ServerError,
        err instanceof HttpError ? err.message : 'Could not open the document',
      );
      return;
    }

    let shared: SharedDoc;
    try {
      shared = await acquire(fileId);
    } catch (err) {
      release(fileId);
      logger.error({ err, fileId }, 'Failed to load collaborative document');
      ws.close(CloseCode.ServerError, 'Could not open the document');
      return;
    }
    if (ws.readyState !== ws.OPEN) {
      release(fileId); // the client gave up while we were loading
      return;
    }

    const conn = { ws, readOnly, clientIds: new Set<number>() };
    shared.addConnection(conn);
    onMessage = (data) => {
      try {
        shared.handleMessage(conn, data);
      } catch (err) {
        // A malformed frame means a broken or hostile client; drop it rather than corrupt the doc.
        logger.warn({ err, fileId, userId: user.id }, 'Bad collab message');
        ws.close(CloseCode.ServerError, 'Malformed message');
      }
    };
    queued.splice(0).forEach(onMessage);

    ws.on('close', () => {
      shared.removeConnection(ws);
      release(fileId);
    });
    logger.info({ fileId, userId: user.id, readOnly }, 'Collab connection opened');
  }

  // [CONCEPT: Heartbeats] A laptop that sleeps or loses Wi-Fi never sends a close frame. Pinging every 30 s and
  // dropping sockets that didn't answer the last ping cleans those ghosts (and their cursors) up.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, PING_INTERVAL_MS);
  heartbeat.unref();

  server.on('upgrade', onUpgrade);

  return {
    /**
     * The text everyone currently sees in a file, straight from the live document. Returns undefined when nobody
     * has the file open, once any save still in flight has finished, so the copy in MongoDB is up to date.
     */
    async liveText(fileId: string): Promise<string | undefined> {
      const entry = docs.get(fileId);
      if (!entry) {
        await pendingFlushes.get(fileId);
        return undefined;
      }
      try {
        return (await entry.doc).doc.getText(TEXT_NAME).toString();
      } catch {
        return undefined; // failed to load; the caller falls back to the saved copy
      }
    },

    /** Disconnects everyone and saves every open document. Call before closing the database. */
    async close() {
      server.off('upgrade', onUpgrade);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(CloseCode.ServiceRestart, 'Server restarting');
      const open = await Promise.allSettled([...docs.values()].map((entry) => entry.doc));
      await Promise.all([
        ...open.flatMap((r) => (r.status === 'fulfilled' ? [r.value.flush()] : [])),
        ...pendingFlushes.values(),
      ]);
      wss.close();
    },
  };
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
