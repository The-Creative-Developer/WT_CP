# ADR-004: MongoDB with deliberate embed-vs-reference modelling

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The data includes users, rooms, projects, files, binary Yjs state, reviews with comment threads, challenges with test cases, and submissions.

## Decision

**MongoDB Atlas (M0) + Mongoose.**

- **Embed** data that is bounded and always read with its parent: room members, snapshot files, review comments, challenge tests.
- **Reference** data that grows without limit: chat messages, submissions, runs.
- Transactions (submission + user stats) need a replica set. Atlas is one; local dev runs a single-node replica set (`docker-compose.yml`).

## Alternatives considered

| Option     | Why not                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| PostgreSQL | Strong option, but the team chose MongoDB; documents fit Yjs blobs and nested threads well |

## Consequences

- Each embed/reference decision is justified in `docs/database.md`.
- Must defend against NoSQL operator injection (`{"$ne": null}`) with Zod validation at the boundary.
- Watch the 16 MB document limit: one document per file, never one per project.
