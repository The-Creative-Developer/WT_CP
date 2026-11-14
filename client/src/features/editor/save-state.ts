import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

/** Reads the body of a COLLAB_MESSAGE_SAVED message (after its type), as sent by the server. */
export const readSavedSnapshot = (decoder: decoding.Decoder): Y.Snapshot =>
  Y.decodeSnapshot(decoding.readVarUint8Array(decoder));

/**
 * Whether everything in this copy of the document is saved on the server: null until the server has said what it
 * has saved.
 *
 * Equal snapshots mean the same insertions *and* deletions. The server sends every edit it receives before it can
 * save it, so by the time a "saved" message arrives this copy already has everything in it; anything extra here is
 * an edit the server hasn't saved yet (or hasn't even received, while offline).
 */
export function isSaved(doc: Y.Doc, saved: Y.Snapshot | null): boolean | null {
  return saved && Y.equalSnapshots(Y.snapshot(doc), saved);
}
