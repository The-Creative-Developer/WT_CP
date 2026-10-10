# ADR-005: Code runner as a separate service with sole Docker access

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Users run untrusted code. Starting containers requires the Docker socket, and access to it is equivalent to root on the host.

## Decision

A separate **runner** service is the only component that mounts `/var/run/docker.sock`. It sits on an internal Docker network with no published port and accepts requests only from the API, authenticated with a shared token (compared in constant time). Each run gets a fresh container with hardening flags (see `runner/src/sandbox.ts`).

## Alternatives considered

| Option                        | Why not                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| Run code from the API process | An API bug would expose the Docker socket to the internet         |
| Hosted judge (Judge0/Piston)  | Kept as a fallback behind the same interface; less learning value |
| gVisor / Firecracker          | Stronger isolation; listed as future work                         |

## Consequences

- Needs a VM with Docker. Platform hosts (Render, Railway, Vercel) can't start containers.
- Container start adds ~300–800 ms per run.
