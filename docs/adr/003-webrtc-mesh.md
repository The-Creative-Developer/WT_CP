# ADR-003: WebRTC mesh topology for calls

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Rooms need voice and video. There is no budget for a media server.

## Decision

A **mesh**: each participant opens one `RTCPeerConnection` to every other participant, capped at **4 participants**. Signalling runs over Socket.IO using the _perfect negotiation_ pattern. STUN finds public addresses; **coturn** on the VM relays media when a direct path fails.

## Alternatives considered

| Option                   | Why not                                                      |
| ------------------------ | ------------------------------------------------------------ |
| SFU (LiveKit, mediasoup) | Needs a media server with more CPU and bandwidth; setup time |
| MCU                      | Server mixes streams; very CPU-heavy                         |

## Consequences

- Upload bandwidth grows with participants: each user sends (n − 1) streams. At 4 users and ~1 Mbps per video stream, that's ~3 Mbps up per user. This is why we cap at 4.
- No server cost beyond TURN relaying.
