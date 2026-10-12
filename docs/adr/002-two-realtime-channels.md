# ADR-002: Separate channels for document sync and app events

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The app needs real-time document sync (binary Yjs updates) and real-time app events (chat, presence, run output, WebRTC signalling).

## Decision

- **The y-websocket protocol** on `/yjs/:roomSlug/:fileId` for document sync and awareness.
- **Socket.IO** on `/socket.io` for app events, with typed events from `shared/src/socket-events.ts`.

Both share the API's HTTP server and port. Each authenticates during the HTTP Upgrade handshake.

## Alternatives considered

| Option                                       | Why not                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Everything over Socket.IO (e.g. y-socket.io) | Extra adapter layer; less community support than y-websocket            |
| Everything over raw WebSocket                | We would reimplement rooms, acknowledgements and reconnection ourselves |

## Consequences

- Two connections per client; the room-permission check must exist in both upgrade paths.
- Clean separation: the binary CRDT protocol never mixes with JSON events.

## Implementation note (2026-10-12)

The client uses the stock `y-websocket` provider, but the server side (`server/src/yjs/`) is our own ~300 lines on
top of `y-protocols` rather than `@y/websocket-server`. That gave us, without patching a library:

- **Auth in the upgrade:** the access token is checked and the room role resolved before the socket is attached to
  a document. Browsers hide the HTTP status of a failed handshake, so rejections complete the handshake and close
  with app codes (4401 expired token → client refreshes and reconnects; 4403 not a member; 4404 unknown file).
- **Read-only viewers:** sync step 1 (requests) is answered, step 2 / update messages from viewers are dropped.
- **Persistence:** debounced (2 s, max 10 s) writes of `encodeStateAsUpdate` to `files.yState`, plus a plain-text
  copy in `files.content`. A file's first open seeds from `content` and saves at once, so a re-seed can never
  duplicate text.
- **Lifecycle:** reference-counted documents, flush-before-reload, heartbeats, and save-everything on shutdown.
