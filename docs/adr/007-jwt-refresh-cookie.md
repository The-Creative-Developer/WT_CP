# ADR-007: Short-lived JWT + rotating refresh token in an httpOnly cookie

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The REST API, Socket.IO and the Yjs WebSocket all need to know who the user is.

## Decision

- **Access token:** JWT, 15-minute expiry, held **in memory** only. Sent as `Authorization: Bearer` on REST calls and in the WebSocket handshake.
- **Refresh token:** random value, 7-day expiry, in an `httpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth`. Stored hashed in MongoDB with a TTL index, **rotated** on every use; reusing an old token revokes the whole token family.

## Alternatives considered

| Option              | Why not                                                               |
| ------------------- | --------------------------------------------------------------------- |
| Server sessions     | Simpler, but each WebSocket upgrade would need a session-store lookup |
| JWT in localStorage | Readable by any injected script (XSS)                                 |

## Consequences

- A page reload calls `/auth/refresh` to get a new access token.
- The SPA and API must be **same-site** (`app.<domain>` + `api.<domain>`, or one origin) or browsers block the cookie. See the plan, §4.
