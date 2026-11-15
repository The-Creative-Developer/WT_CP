# REST API

DevVerse's REST API lives under `/api/v1`. It is described in OpenAPI 3.1:

| Where                                         | What                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| [`/api/docs`](http://localhost:5173/api/docs) | Swagger UI: browse every endpoint and try it out                       |
| `/api/docs/openapi.json`                      | The OpenAPI document, for tools (client generators, Postman, Insomnia) |
| [`docs/openapi.yaml`](openapi.yaml)           | The same document, committed so it can be read and diffed on GitHub    |

Live features don't go through REST: see [Real time](#real-time) below.

## How the description is made

The document is generated from the code (`server/src/openapi/`), not written by hand:

- **Request bodies and query strings** come from the same Zod schemas in `@devverse/shared` that the routes validate with, converted with `z.toJSONSchema`. A documented rule ("3 to 60 characters") is the enforced rule.
- **Responses** are Zod schemas in `server/src/openapi/schemas.ts`. A compile-time check proves each one matches the shared TypeScript type the API returns, so adding a field to `RoomSummary` without documenting it fails `npm run typecheck`.
- **Tests** (`server/src/openapi/openapi.test.ts`) check that real responses match those schemas, that every documented route exists, that every example body would be accepted, and that `docs/openapi.yaml` is up to date.

After changing an endpoint, regenerate the YAML:

```bash
npm run openapi
```

## Trying it out

1. Open the docs **through the app's address**: `http://localhost:5173/api/docs` in development (Vite proxies `/api`), or `/api/docs` on the deployed site. The auth endpoints reject requests from origins other than the app's (CSRF protection), so register and login fail at `http://localhost:4000/api/docs`.
2. Run **POST /auth/login** (or **/auth/register**) and copy `accessToken` from the response.
3. Click **Authorize**, paste the token under `bearerAuth`, and close the dialog. Protected endpoints now send `Authorization: Bearer <token>`.

The token lives only in that page's memory, as in the app; reloading forgets it. It lasts 15 minutes.

## Conventions

**Versioning.** Everything is under `/api/v1`, so a breaking change can ship as `/api/v2` without breaking old clients.

**Authentication.** A session is two tokens:

- An **access token** (JWT, 15 minutes), sent as `Authorization: Bearer <token>`. It is never in a cookie, so other sites can't make a browser send it.
- A **refresh token** in the httpOnly `dv_refresh` cookie (`SameSite=Lax`, `Path=/api/v1/auth`). `POST /auth/refresh` trades it for a new pair. Each refresh token works once: reusing one ends the whole session, because it means the token was copied.

**Status codes.**

| Code | Meaning here                                                          |
| ---- | --------------------------------------------------------------------- |
| 200  | OK, with a body                                                       |
| 201  | Created; `Location` points at the new resource                        |
| 202  | Accepted, not done yet (`POST /runs`); `Location` is where to poll    |
| 204  | Done, no body (deletes, logout)                                       |
| 401  | Not signed in, or the access token expired; see `WWW-Authenticate`    |
| 403  | Signed in but not allowed, such as a viewer editing files             |
| 404  | No such resource or route                                             |
| 409  | Conflicts with current state, such as a taken username or a full room |
| 422  | Invalid values; `errors` lists them by field                          |
| 429  | Rate limited; wait `Retry-After` seconds                              |
| 503  | The code runner is busy; wait `Retry-After` seconds                   |

**Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details, sent as `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "instance": "/api/v1/rooms",
  "requestId": "6f1c0b9e-0d55-4a0e-9d61-2a4f5d6c7b8a",
  "errors": { "name": ["Room name must be at least 3 characters"] }
}
```

`title` is written for people and can be shown as is. `requestId` matches the `X-Request-Id` header and the server logs.

**Rate limits.** 300 requests a minute per IP across `/api`. Sign-in attempts have a tighter limit (10 failures per 15 minutes per IP), and runs are limited per account. The `RateLimit` and `RateLimit-Policy` headers (IETF draft 8) say how much is left.

**Pagination.** Chat history uses cursor pagination: `GET /rooms/{slug}/messages?limit=30` returns `nextCursor`; pass it back as `before` for the next, older page. Unlike `skip`, a cursor stays fast deep into the history and doesn't repeat or miss messages when new ones arrive.

**Caching.** Responses carrying tokens or live data (`/auth/*`, runs, chat) send `Cache-Control: no-store`.

## Endpoints

| Method        | Path                                   | Purpose                                                             |
| ------------- | -------------------------------------- | ------------------------------------------------------------------- |
| POST          | `/auth/register`                       | Create an account and sign in (201)                                 |
| POST          | `/auth/login`                          | Sign in                                                             |
| POST          | `/auth/refresh`                        | New access token from the refresh cookie                            |
| POST          | `/auth/logout`                         | Sign out (204)                                                      |
| GET, PATCH    | `/users/me`                            | Your profile                                                        |
| GET, POST     | `/rooms`                               | Your rooms (with `q`, `language` and `role` filters); create a room |
| GET, DELETE   | `/rooms/{slug}`                        | One room; delete it (owner only)                                    |
| POST          | `/rooms/{slug}/join`                   | Join with an invite code, or a public room as a viewer              |
| GET           | `/rooms/{slug}/messages`               | Chat history, newest first                                          |
| GET, POST     | `/projects/{projectId}/files`          | List files; create one                                              |
| PATCH, DELETE | `/projects/{projectId}/files/{fileId}` | Rename or move a file; delete it                                    |
| PATCH, DELETE | `/projects/{projectId}/folders`        | Rename or move a folder; delete it with its contents                |
| POST, GET     | `/runs`                                | Run a file (202); a room's recent runs                              |
| GET           | `/runs/{id}`                           | One run (polling fallback)                                          |
| GET           | `/healthz`                             | Health check, outside `/api/v1`                                     |

Request and response shapes, limits and every error each endpoint can return are in the [Swagger UI](http://localhost:5173/api/docs) and [`openapi.yaml`](openapi.yaml).

## Real time

Three channels sit alongside REST:

- **Socket.IO** (`/socket.io`), authenticated with the access token. Room presence (`presence:update`), chat (`chat:send`, `chat:new`, `chat:typing`), file tree changes (`files:changed`) and run output (`run:started`, `run:output`, `run:finished`). Every event and payload is typed in `shared/src/socket-events.ts`.
- **Yjs WebSocket** (`/yjs/<roomSlug>/<fileId>?token=<access token>`) syncs the shared editor and cursors with the Yjs protocol. The token and room role are checked during the HTTP upgrade. A custom message (type 100) tells clients when their edits are saved.
- **WebRTC** (Week 3) for calls, signalled over Socket.IO.
