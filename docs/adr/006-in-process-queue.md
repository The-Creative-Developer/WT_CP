# ADR-006: In-process job queue and a single API instance

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Code runs must be queued so a burst of clicks doesn't overload the VM. The timeline is 4 weeks.

## Decision

A single API instance with an in-process queue (`p-queue`, concurrency 2) in front of the runner. Socket.IO uses its default in-memory adapter.

## Alternatives considered

| Option         | Why not (for now)                                               |
| -------------- | --------------------------------------------------------------- |
| BullMQ + Redis | Another service to deploy and monitor; not needed at demo scale |

## Consequences

- Queued runs are lost if the API restarts (acceptable for a demo).
- **Scale-out path:** add Redis, switch to BullMQ and `@socket.io/redis-adapter`, then run several API instances behind Caddy. Documented, not built.
