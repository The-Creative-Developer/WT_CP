# 🌐 DevVerse — Multiplayer Coding World

> GitHub + Discord + VS Code + a multiplayer game. Enter a room, code together with live cursors, talk over voice/video, run code in sandboxed containers, review each other's code, ask an AI assistant, compete in challenges and publish a portfolio.

Web Development course project · 3-person team · 4-week build. The full execution plan is in [docs/PLAN.md](docs/PLAN.md).

## Status

| Week | Milestone                                                       | Status |
| ---- | --------------------------------------------------------------- | ------ |
| 0    | Repo scaffold, tooling, CI, app shell, API skeleton             | ✅     |
| 1    | Auth, rooms, Yjs sync, deployed skeleton                        | ⏳     |
| 2    | Live cursors, chat, file tree, code execution                   | ⏳     |
| 3    | WebRTC calls, AI assistant, code review, challenges, portfolios | ⏳     |
| 4    | Stretch features, hardening, docs, demo                         | ⏳     |

## Tech stack

**Client:** React · TypeScript · Vite · React Router · TanStack Query · Tailwind CSS · Monaco · Yjs · Socket.IO client · WebRTC
**Server:** Node.js · Express · Socket.IO · y-websocket · MongoDB (Mongoose) · Zod · EJS (SSR portfolios)
**Runner:** Node.js · Docker (hardened sandbox containers)
**Tooling:** npm workspaces · ESLint · Prettier · Husky + lint-staged · Commitlint · Vitest · Supertest · Playwright · GitHub Actions

## Repository layout

```
client/   React single-page app
server/   REST API, Socket.IO, Yjs WebSocket server, SSR portfolio pages
runner/   Code-execution service + sandbox Dockerfiles
shared/   Zod schemas, types and socket event contracts used by all three
docs/     Plan, architecture decision records, concepts index
scripts/  Repo tooling (concept index generator)
```

## Getting started

**Prerequisites:** Node.js 22+ (see `.nvmrc`), Docker Desktop.

```bash
npm install
cp server/.env.example server/.env
cp runner/.env.example runner/.env
npm run db:up        # MongoDB single-node replica set in Docker
npm run dev          # API on :4000, client on :5173
```

Open http://localhost:5173. The footer shows whether the API and database are reachable.

To build the code-execution sandbox images (needed to run code):

```bash
npm run sandboxes:build -w runner -- node python
```

Leave off `-- node python` to also build the C++ and Java images. They are much bigger (about 1.4 GB and 400 MB). The
runner's `/healthz` lists which images are built, and its tests that start real containers are skipped until the Node
and Python images exist.

## Scripts

| Command                           | What it does                                                              |
| --------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                     | Server + client with hot reload                                           |
| `npm run dev:all`                 | Also starts the runner                                                    |
| `npm test`                        | Vitest suites in every workspace                                          |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                         |
| `npm run typecheck`               | TypeScript across all workspaces                                          |
| `npm run build`                   | Production builds                                                         |
| `npm run concepts`                | Regenerates [docs/CONCEPTS.md](docs/CONCEPTS.md) from `[CONCEPT: …]` tags |

## Documenting web concepts

Wherever you implement a web-development concept, tag it in a comment:

```ts
// [CONCEPT: Debouncing] Delays autosave until typing pauses for 800 ms.
```

`npm run concepts` collects every tag into [docs/CONCEPTS.md](docs/CONCEPTS.md) with links to the exact line, so reviewers can go straight from a concept to its implementation.

## Documentation

- [Execution plan](docs/PLAN.md)
- [Architecture decision records](docs/adr/)
- [Concepts index](docs/CONCEPTS.md)
- [Contributing](CONTRIBUTING.md)
