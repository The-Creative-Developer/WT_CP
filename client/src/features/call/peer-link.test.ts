import { describe, expect, it, vi } from 'vitest';
import { isPolite, PeerLink, type Signal } from './peer-link';

/**
 * Just enough of RTCPeerConnection's signalling state machine to exercise negotiation: offers, answers, implicit
 * rollback, and the rule that candidates need a remote description first. No media or networking.
 */
class FakeConnection {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { type: RTCSdpType; sdp: string; toJSON(): RTCSessionDescriptionInit } | null =
    null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  candidates: RTCIceCandidateInit[] = [];
  transceivers: string[] = [];
  tracks: string[] = [];
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  restarts = 0;
  private offers = 0;

  constructor(readonly name: string) {}

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track.kind);
  }
  addTransceiver(kind: string) {
    this.transceivers.push(kind);
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit) {
    await Promise.resolve();
    const type =
      description?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    if (type === 'offer') {
      if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') {
        throw new DOMException('offer in wrong state', 'InvalidStateError');
      }
      this.signalingState = 'have-local-offer';
    } else if (type === 'answer') {
      if (this.signalingState !== 'have-remote-offer') {
        throw new DOMException('answer in wrong state', 'InvalidStateError');
      }
      this.signalingState = 'stable';
    }
    const sdp = `${type} ${type === 'offer' ? ++this.offers : ''} from ${this.name}`;
    this.localDescription = { type, sdp, toJSON: () => ({ type, sdp }) };
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    await Promise.resolve();
    if (description.type === 'offer') {
      // Modern browsers roll back a pending local offer by themselves (implicit rollback).
      if (this.signalingState === 'have-local-offer') this.signalingState = 'stable';
      if (this.signalingState !== 'stable') throw new DOMException('offer', 'InvalidStateError');
      this.signalingState = 'have-remote-offer';
    } else if (description.type === 'answer') {
      if (this.signalingState !== 'have-local-offer') {
        throw new DOMException('answer in wrong state', 'InvalidStateError');
      }
      this.signalingState = 'stable';
    }
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescription)
      throw new DOMException('no remote description', 'InvalidStateError');
    this.candidates.push(candidate);
  }

  restartIce() {
    this.restarts++;
  }
  close() {}
}

const stream = (...kinds: string[]) =>
  ({
    getTracks: () => kinds.map((kind) => ({ kind }) as MediaStreamTrack),
  }) as unknown as MediaStream;

/** Two links joined by an in-memory signalling channel. Messages are delivered when `deliver` is called. */
function pair(
  streams: [MediaStream | null, MediaStream | null] = [
    stream('audio', 'video'),
    stream('audio', 'video'),
  ],
) {
  const queues: Record<'a' | 'b', Signal[]> = { a: [], b: [] };
  const fakes: Record<'a' | 'b', FakeConnection> = {
    a: new FakeConnection('a'),
    b: new FakeConnection('b'),
  };
  const make = (me: 'a' | 'b', them: 'a' | 'b', index: 0 | 1) =>
    new PeerLink({
      peerId: them,
      polite: isPolite(me, them),
      stream: streams[index],
      iceServers: [],
      send: (signal) => queues[them].push(signal),
      onStream: () => {},
      createConnection: () => fakes[me] as unknown as RTCPeerConnection,
    });
  const links = { a: make('a', 'b', 0), b: make('b', 'a', 1) };
  /** Delivers queued messages, in order, until both queues are empty. */
  async function deliver() {
    for (let i = 0; i < 20 && (queues.a.length || queues.b.length); i++) {
      for (const who of ['a', 'b'] as const) {
        const batch = queues[who].splice(0);
        for (const signal of batch) await links[who].receive(signal);
      }
    }
  }
  return { links, fakes, queues, deliver };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isPolite', () => {
  it('makes exactly one side of a pair polite', () => {
    expect(isPolite('b', 'a')).toBe(true);
    expect(isPolite('a', 'b')).toBe(false);
  });
});

describe('PeerLink', () => {
  it('negotiates when one side offers', async () => {
    const { fakes, deliver } = pair();
    fakes.a.onnegotiationneeded!();
    await flush();
    await deliver();
    expect(fakes.a.signalingState).toBe('stable');
    expect(fakes.b.signalingState).toBe('stable');
    expect(fakes.b.remoteDescription?.sdp).toBe('offer 1 from a');
    expect(fakes.a.remoteDescription?.type).toBe('answer');
  });

  it('settles a collision: the polite side gives way and answers', async () => {
    const { fakes, deliver } = pair();
    // Both sides offer at the same moment (glare).
    fakes.a.onnegotiationneeded!();
    fakes.b.onnegotiationneeded!();
    await flush();
    expect(fakes.a.signalingState).toBe('have-local-offer');
    expect(fakes.b.signalingState).toBe('have-local-offer');

    await deliver();
    // a is impolite: its offer wins. b (polite) rolled back and answered it.
    expect(fakes.a.signalingState).toBe('stable');
    expect(fakes.b.signalingState).toBe('stable');
    expect(fakes.b.remoteDescription?.sdp).toBe('offer 1 from a');
    expect(fakes.a.remoteDescription?.type).toBe('answer');
  });

  it('holds candidates that arrive before the description, then applies them', async () => {
    const { links, fakes } = pair();
    const candidate = { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 };
    await links.b.receive({ candidate });
    expect(fakes.b.candidates).toEqual([]);
    await links.b.receive({ description: { type: 'offer', sdp: 'offer from a' } });
    expect(fakes.b.candidates).toEqual([candidate]);
  });

  it('sends its candidates to the other side', () => {
    const { fakes, queues } = pair();
    const candidate = { toJSON: () => ({ candidate: 'candidate:9' }) };
    fakes.a.onicecandidate!({ candidate });
    fakes.a.onicecandidate!({ candidate: null });
    expect(queues.b).toEqual([{ candidate: { candidate: 'candidate:9' } }]);
  });

  it('asks to receive audio and video when it has nothing to send', () => {
    const { fakes } = pair([null, stream('audio')]);
    expect(fakes.a.tracks).toEqual([]);
    expect(fakes.a.transceivers).toEqual(['audio', 'video']);
    expect(fakes.b.tracks).toEqual(['audio']);
    expect(fakes.b.transceivers).toEqual(['video']);
  });

  it('restarts ICE when the connection fails, and reports the state', () => {
    const onState = vi.fn();
    const fake = new FakeConnection('x');
    new PeerLink({
      peerId: 'y',
      polite: false,
      stream: null,
      iceServers: [],
      send: () => {},
      onStream: () => {},
      onState,
      createConnection: () => fake as unknown as RTCPeerConnection,
    });
    fake.connectionState = 'failed';
    fake.onconnectionstatechange!();
    expect(fake.restarts).toBe(1);
    expect(onState).toHaveBeenCalledWith('failed');
  });

  it('ignores messages after closing', async () => {
    const { links, fakes } = pair();
    links.b.close();
    await links.b.receive({ description: { type: 'offer', sdp: 'late' } });
    expect(fakes.b.remoteDescription).toBeNull();
  });
});
