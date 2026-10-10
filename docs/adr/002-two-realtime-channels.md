# ADR-002: Separate channels for document sync and app events

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The app needs real-time document sync (binary Yjs updates) and real-time app events (chat, presence, run output, WebRTC signalling).

## Decision

- **y-websocket** on `/yjs/:roomId:fileId` for document sync and awareness.
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
