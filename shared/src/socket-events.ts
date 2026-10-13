import type { Language } from './languages';
import type { RoomRole } from './roles';
import type { RunVerdict } from './schemas/run';

// [CONCEPT: Typed Event Contracts] Socket.IO generics make every emit/on call type-checked on both ends.

export type PresenceStatus = 'online' | 'idle';

export interface RoomMember {
  id: string;
  username: string;
  color: string;
  role: RoomRole;
  status: PresenceStatus;
}

export interface ChatMessage {
  id: string;
  roomSlug: string;
  author: { id: string; username: string };
  body: string;
  createdAt: string;
}

export type RunStream = 'stdout' | 'stderr';

export interface RunFinishedPayload {
  runId: string;
  /** null when the run failed before the program could finish (see `error`). */
  verdict: RunVerdict | null;
  exitCode: number | null;
  durationMs: number | null;
  truncated: boolean;
  error: string | null;
}

/** The connect_error message for a missing or expired access token: refresh it and reconnect. */
export const SOCKET_UNAUTHORIZED = 'unauthorized';

export interface ServerToClientEvents {
  'presence:update': (payload: { members: RoomMember[] }) => void;
  'chat:new': (message: ChatMessage) => void;
  'chat:typing': (payload: { userId: string; username: string }) => void;
  /** `by` is the username of whoever pressed Run. */
  'run:started': (payload: { runId: string; by: string; language: Language }) => void;
  'run:output': (payload: { runId: string; stream: RunStream; chunk: string }) => void;
  'run:finished': (payload: RunFinishedPayload) => void;
  'rtc:offer': (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  'rtc:answer': (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  'rtc:ice': (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
}

export type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'room:join': (payload: { slug: string }, ack: Ack<{ members: RoomMember[] }>) => void;
  'room:leave': (payload: { slug: string }) => void;
  'chat:send': (payload: { slug: string; body: string }, ack: Ack<ChatMessage>) => void;
  'chat:typing': (payload: { slug: string }) => void;
  'presence:status': (payload: { slug: string; status: PresenceStatus }) => void;
  'rtc:offer': (payload: { to: string; sdp: RTCSessionDescriptionInit }) => void;
  'rtc:answer': (payload: { to: string; sdp: RTCSessionDescriptionInit }) => void;
  'rtc:ice': (payload: { to: string; candidate: RTCIceCandidateInit }) => void;
}

// Minimal structural copies of the DOM WebRTC types so this package compiles in Node too.
export interface RTCSessionDescriptionInit {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}
export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}
