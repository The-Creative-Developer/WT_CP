# Contributing

## Workflow

1. Pick an issue from the GitHub Projects board and assign yourself.
2. Branch from `main`: `feat/editor-cursors`, `fix/auth-refresh`, `docs/adr-webrtc`.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/). The `commit-msg` hook enforces this:
   - `feat(rooms): add invite links`
   - `fix(runner): kill container on timeout`
   - `docs: add ADR for WebRTC mesh`
4. Open a PR using the template. At least one teammate reviews before a squash merge.
5. CI (lint, format, typecheck, tests, build) must be green.

## Code style

- Prettier formats on commit (lint-staged). Don't fight it.
- TypeScript `strict` mode; avoid `any`.
- Validate every external input with a Zod schema from `shared/`.
- Tag web-development concepts with `// [CONCEPT: Name] one-line explanation` and run `npm run concepts`.

## Ownership

| Track              | Owner | Areas                                                           |
| ------------------ | ----- | --------------------------------------------------------------- |
| Frontend & UX      | Dev A | `client/` UI, design system, accessibility, portfolio templates |
| Real-time          | Dev B | Socket.IO, Yjs, presence, chat, WebRTC                          |
| Platform & Backend | Dev C | `server/` API + models, `runner/`, AI proxy, deployment, CI     |

## Daily stand-up (async, in Discord)

Yesterday / Today / Blockers. Every Friday: merge, deploy, run the demo script so far.
