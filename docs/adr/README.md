# Architecture Decision Records

Each ADR records one significant decision: the context, the choice, and its consequences. Add a new file for each new decision; never rewrite an accepted one. Supersede it instead.

| #                                   | Decision                                                       | Status   |
| ----------------------------------- | -------------------------------------------------------------- | -------- |
| [001](001-crdt-yjs.md)              | Yjs (CRDT) for collaborative text editing                      | Accepted |
| [002](002-two-realtime-channels.md) | Separate channels for document sync and app events             | Accepted |
| [003](003-webrtc-mesh.md)           | WebRTC mesh topology for calls (≤ 4 peers)                     | Accepted |
| [004](004-mongodb.md)               | MongoDB with deliberate embed-vs-reference modelling           | Accepted |
| [005](005-isolated-runner.md)       | Code runner as a separate service with sole Docker access      | Accepted |
| [006](006-in-process-queue.md)      | In-process job queue and a single API instance                 | Accepted |
| [007](007-jwt-refresh-cookie.md)    | Short-lived JWT + rotating refresh token in an httpOnly cookie | Accepted |
| [008](008-ssr-portfolios.md)        | Server-side rendering only for public portfolio pages          | Accepted |

Template: [000-template.md](000-template.md)
