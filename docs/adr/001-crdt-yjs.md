# ADR-001: Yjs (CRDT) for collaborative text editing

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Several users edit the same file at the same moment. Edits must merge without conflicts, survive brief disconnections, and appear in under ~150 ms.

## Decision

Use **Yjs**, a CRDT (Conflict-free Replicated Data Type), bound to Monaco via `y-monaco`. Presence (cursors, selections, names, colours) uses the Yjs **Awareness** protocol.

## Alternatives considered

| Option                          | Why not                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Operational Transform (ShareDB) | Needs a central server to transform every operation; offline editing is harder |
| Send whole-file snapshots       | Last write wins, so concurrent edits are lost                                  |
| Build our own CRDT              | Too much for 4 weeks; we document how CRDTs converge instead                   |

## Consequences

- Offline edits merge automatically on reconnect (shown in the demo).
- Documents are binary blobs, persisted to MongoDB as `Binary` with debounced writes.
- The team must understand the sync protocol (SyncStep1/SyncStep2/Update) to debug it. Documented in `docs/realtime.md`.
