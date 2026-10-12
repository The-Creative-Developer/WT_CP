import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { File } from '../models/file';
import { logger } from '../utils/logger';

// Message types of the y-websocket wire protocol (first varint of every binary frame).
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

/** The Y.Text that the editor binds to. Client and server must use the same name. */
export const TEXT_NAME = 'content';

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_MAX_WAIT_MS = 10_000;

export interface Connection {
  ws: WebSocket;
  readOnly: boolean;
  /** Awareness client ids this connection controls, so they can be removed when it disconnects. */
  clientIds: Set<number>;
}

/**
 * One file's live document: the CRDT, who is connected, their cursors (awareness) and debounced persistence.
 *
 * [CONCEPT: CRDT] Every client holds a full copy of the Y.Doc. Edits are merged with a conflict-free algorithm, so
 * the server just relays updates and never has to transform or order them (contrast with Operational Transform).
 */
export class SharedDoc {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Connection>();
  private saveTimer: NodeJS.Timeout | null = null;
  private firstUnsavedAt: number | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(readonly fileId: string) {
    // The server is not a user: it has no cursor of its own.
    this.awareness.setLocalState(null);

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.broadcast(
        encodeMessage(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)),
        origin,
      );
      this.scheduleSave();
    });

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        const conn = this.conns.get(origin as WebSocket);
        if (conn) {
          added.forEach((id) => conn.clientIds.add(id));
          removed.forEach((id) => conn.clientIds.delete(id));
        }
        // Sent to everyone, including the sender: clients treat any message as a keep-alive.
        this.broadcast(
          encodeMessage(MESSAGE_AWARENESS, (e) =>
            encoding.writeVarUint8Array(
              e,
              awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
            ),
          ),
        );
      },
    );
  }

  /** Loads the saved CRDT state, or seeds it from the plain-text content the first time a file is opened. */
  async load(): Promise<void> {
    // Not lean(): a hydrated document turns the BSON Binary into a Node Buffer for us.
    const file = await File.findById(this.fileId).select('+yState content');
    if (!file) throw new Error(`File ${this.fileId} disappeared`);
    if (file.yState?.length) {
      Y.applyUpdate(this.doc, new Uint8Array(file.yState), 'load');
      // Loading isn't an edit; don't write the same state straight back.
      this.cancelSave();
      return;
    }
    this.doc.getText(TEXT_NAME).insert(0, file.content);
    this.cancelSave();
    // Save the seeded state immediately. Seeding again later (e.g. after a restart) would create the same text
    // with a different CRDT history, and a client still holding the old one would merge both: duplicated text.
    await this.save();
  }

  addConnection(conn: Connection) {
    this.conns.set(conn.ws, conn);
    // Start the sync handshake: "here is my state vector, send me what I'm missing".
    this.send(
      conn.ws,
      encodeMessage(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, this.doc)),
    );
    const states = this.awareness.getStates();
    if (states.size > 0) {
      this.send(
        conn.ws,
        encodeMessage(MESSAGE_AWARENESS, (e) =>
          encoding.writeVarUint8Array(
            e,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
          ),
        ),
      );
    }
  }

  removeConnection(ws: WebSocket) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    // Their cursor disappears for everyone else.
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clientIds], null);
  }

  handleMessage(conn: Connection, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);

    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        if (conn.readOnly) {
          // [CONCEPT: Server-Side Authorization] A viewer may ask for the document (step 1), but any update it
          // sends (step 2 / update) is dropped here. Hiding the editor's typing in the UI alone would be bypassable.
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, this.doc);
          }
        } else {
          // The connection is the transaction origin, so its own update isn't echoed back to it.
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn.ws);
        }
        // Only reply if there is more than the message-type byte (i.e. a step 2 answer).
        if (encoding.length(encoder) > 1) this.send(conn.ws, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          conn.ws,
        );
        break;
      case MESSAGE_QUERY_AWARENESS:
        this.send(
          conn.ws,
          encodeMessage(MESSAGE_AWARENESS, (e) =>
            encoding.writeVarUint8Array(
              e,
              awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
                ...this.awareness.getStates().keys(),
              ]),
            ),
          ),
        );
        break;
      default:
        logger.debug({ type }, 'Ignoring unknown y-websocket message type');
    }
  }

  /** Writes any pending changes now. Resolves once they are in MongoDB. */
  flush(): Promise<void> {
    if (this.saveTimer) {
      this.cancelSave();
      this.saving = this.saving.then(() => this.save());
    }
    return this.saving;
  }

  destroy() {
    this.cancelSave();
    this.awareness.destroy();
    this.doc.destroy();
  }

  // [CONCEPT: Debouncing] Typing produces an update per keystroke; the file is written at most once per pause
  // (2 s), but never less often than every 10 s while someone types non-stop.
  private scheduleSave() {
    this.firstUnsavedAt ??= Date.now();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const waited = Date.now() - this.firstUnsavedAt;
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS - waited));
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.firstUnsavedAt = null;
      // Chained, so two saves of the same file never run at the same time.
      this.saving = this.saving.then(() => this.save());
    }, delay);
  }

  private cancelSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.firstUnsavedAt = null;
  }

  private async save() {
    try {
      await File.updateOne(
        { _id: this.fileId },
        {
          $set: {
            // The full CRDT state (keeps history needed to merge offline edits)...
            yState: Buffer.from(Y.encodeStateAsUpdate(this.doc)),
            // ...and a plain-text copy for runs, downloads and search.
            content: this.doc.getText(TEXT_NAME).toString(),
          },
        },
      );
    } catch (err) {
      logger.error({ err, fileId: this.fileId }, 'Failed to save document');
      // Try again on the next edit rather than losing the change silently.
      this.firstUnsavedAt = null;
    }
  }

  private broadcast(message: Uint8Array, except?: unknown) {
    for (const ws of this.conns.keys()) if (ws !== except) this.send(ws, message);
  }

  private send(ws: WebSocket, message: Uint8Array) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(message, (err) => {
      if (err) ws.terminate();
    });
  }
}

function encodeMessage(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}
