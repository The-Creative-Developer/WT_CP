import type { Language } from './languages';
import type { RoomRole } from './roles';
import type { FileSummary } from './schemas/file';
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

export interface FilesChangedPayload {
  files: FileSummary[];
  /** Username of whoever made the change. */
  by: string;
}

/** A call is a mesh: everyone sends their media to everyone else, so the upload cost grows with each person. */
export const MAX_CALL_PEERS = 4;

/** Whether someone's microphone and camera are on. Off means the track is disabled, not removed. */
export interface MediaState {
  audio: boolean;
  video: boolean;
}

/** One connection in a room's call. A person with two tabs in the call is two peers. */
export interface CallPeer {
  /** The peer's socket id: where signalling messages for it are addressed. */
  peerId: string;
  user: { id: string; username: string };
  media: MediaState;
}

/** One entry of RTCConfiguration.iceServers, as GET /api/v1/turn-credentials returns it. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** What a call needs to find a network path: STUN servers, and TURN relays with time-limited credentials. */
export interface IceConfig {
  iceServers: IceServer[];
  /** Seconds until the TURN credentials expire. Fetch new ones before joining a call after that. */
  ttl: number;
}

/** The connect_error message for a missing or expired access token: refresh it and reconnect. */
export const SOCKET_UNAUTHORIZED = 'unauthorized';

export interface ServerToClientEvents {
  'presence:update': (payload: { members: RoomMember[] }) => void;
  'chat:new': (message: ChatMessage) => void;
  'chat:typing': (payload: { userId: string; username: string }) => void;
  /** A file was added, renamed, moved or deleted. Carries the whole (small) list, so clients can't drift. */
  'files:changed': (payload: FilesChangedPayload) => void;
  /** `by` is the username of whoever pressed Run. */
  'run:started': (payload: { runId: string; by: string; language: Language }) => void;
  'run:output': (payload: { runId: string; stream: RunStream; chunk: string }) => void;
  'run:finished': (payload: RunFinishedPayload) => void;
  /** Who is in the room's call, sent to everyone in the room whenever it changes (and after joining the room). */
  'call:roster': (payload: { slug: string; peers: CallPeer[] }) => void;
  /** An offer or answer from another peer in the call. */
  'rtc:description': (payload: { from: string; description: RTCSessionDescriptionInit }) => void;
  'rtc:ice': (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
}

export type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'room:join': (payload: { slug: string }, ack: Ack<{ members: RoomMember[] }>) => void;
  'room:leave': (payload: { slug: string }) => void;
  'chat:send': (payload: { slug: string; body: string }, ack: Ack<ChatMessage>) => void;
  'chat:typing': (payload: { slug: string }) => void;
  'presence:status': (payload: { slug: string; status: PresenceStatus }) => void;
  /** Joins the room's call. The ack names this connection (peerId) and lists the peers already there. */
  'call:join': (
    payload: { slug: string; media: MediaState },
    ack: Ack<{ peerId: string; peers: CallPeer[] }>,
  ) => void;
  'call:leave': (payload: { slug: string }) => void;
  'call:media': (payload: { slug: string; media: MediaState }) => void;
  /** Relayed to one peer in the same call. */
  'rtc:description': (payload: { to: string; description: RTCSessionDescriptionInit }) => void;
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
