import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isSaved, readSavedSnapshot } from './save-state';

/** A server copy and a client copy of the same document, in sync. */
function pair(text = 'hello world') {
  const server = new Y.Doc();
  server.getText('content').insert(0, text);
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}

/** What the server sends after saving, decoded the way the editor decodes it. */
function savedMessage(doc: Y.Doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint8Array(encoder, Y.encodeSnapshot(Y.snapshot(doc)));
  return readSavedSnapshot(decoding.createDecoder(encoding.toUint8Array(encoder)));
}

describe('isSaved', () => {
  it("is unknown until the server says what it's saved", () => {
    expect(isSaved(new Y.Doc(), null)).toBeNull();
  });

  it('is true when this copy holds exactly what was saved', () => {
    const { server, client } = pair();
    expect(isSaved(client, savedMessage(server))).toBe(true);
  });

  it('is false after a local insert, until a save includes it', () => {
    const { server, client } = pair();
    client.getText('content').insert(0, '>> ');
    expect(isSaved(client, savedMessage(server))).toBe(false);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    expect(isSaved(client, savedMessage(server))).toBe(true);
  });

  it('notices a delete-only edit, which leaves the state vector unchanged', () => {
    const { server, client } = pair();
    const before = Y.encodeStateVector(client);
    client.getText('content').delete(0, 6);
    expect(Y.encodeStateVector(client)).toEqual(before);
    expect(isSaved(client, savedMessage(server))).toBe(false);
  });
});
