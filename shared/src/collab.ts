/** The Y.Text in each file's Y.Doc that the editor binds to. Client and server must agree on it. */
export const COLLAB_TEXT_NAME = 'content';

/**
 * A message type DevVerse adds to the y-websocket protocol (which uses 0–3): "this is what is saved now", followed
 * by an encoded Yjs snapshot of the saved document. Sent after every save and to each new connection.
 */
export const COLLAB_MESSAGE_SAVED = 100;
