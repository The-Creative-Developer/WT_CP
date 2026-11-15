/** What a PeerLink sends to the other side, through the app's signalling channel (Socket.IO). */
export type Signal =
  { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

export interface PeerLinkOptions {
  /** The other side's id (its socket id). */
  peerId: string;
  /**
   * In a collision (both sides offer at once) the polite peer gives way and the impolite one carries on. Both sides
   * must agree, so it's decided by comparing ids: see `isPolite`.
   */
  polite: boolean;
  /** Our microphone and camera tracks, or none for someone who joined without devices. */
  stream: MediaStream | null;
  iceServers: RTCIceServer[];
  send: (signal: Signal) => void;
  /** The other side's media arrived (or changed). */
  onStream: (stream: MediaStream) => void;
  onState?: (state: RTCPeerConnectionState) => void;
  /** Tests pass a fake; browsers use the real one. */
  createConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

/** Of two peers, the one with the larger id is polite. Both sides compute the same answer without talking. */
export const isPolite = (myId: string, theirId: string) => myId > theirId;

/**
 * One WebRTC connection to one other person in the call.
 *
 * [CONCEPT: Perfect Negotiation] Either side may need to (re)negotiate at any time: when it joins, adds a track, or
 * restarts ICE. If both send an offer at the same moment ("glare"), the polite peer drops its own offer (an implicit
 * rollback) and answers theirs, while the impolite peer ignores the incoming offer and waits for an answer to its
 * own. The same code runs on both sides; only the `polite` flag differs. This is the pattern from the WebRTC spec.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  /** Candidates that arrived before the description they belong to. */
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;

  constructor(private readonly options: PeerLinkOptions) {
    const create = options.createConnection ?? ((config) => new RTCPeerConnection(config));
    this.pc = create({ iceServers: options.iceServers });
    const { pc } = this;

    if (options.stream && options.stream.getTracks().length > 0) {
      for (const track of options.stream.getTracks()) pc.addTrack(track, options.stream);
    }
    // Someone without a camera or microphone still wants to see and hear the others: ask to receive both.
    const kinds = new Set(options.stream?.getTracks().map((t) => t.kind) ?? []);
    for (const kind of ['audio', 'video'] as const) {
      if (!kinds.has(kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
    }

    // Fired whenever the connection needs a new offer: at the start, and after adding tracks or restarting ICE.
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        // With no argument, setLocalDescription creates the right description (an offer here) by itself.
        await pc.setLocalDescription();
        if (pc.localDescription) options.send({ description: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn('Could not create an offer', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      // A null candidate means "no more candidates"; nothing to send.
      if (candidate) options.send({ candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      options.onStream(stream);
    };

    pc.onconnectionstatechange = () => {
      options.onState?.(pc.connectionState);
      // [CONCEPT: ICE Restart] A network change (Wi-Fi to mobile data) can break the chosen path. Restarting ICE
      // gathers new candidates and renegotiates, without tearing down the call.
      if (pc.connectionState === 'failed') pc.restartIce();
    };
  }

  /** Handles a description or candidate from the other side. */
  async receive(signal: Signal): Promise<void> {
    if (this.closed) return;
    const { pc } = this;
    try {
      if ('description' in signal) {
        const { description } = signal;
        const collision =
          description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.options.polite && collision;
        if (this.ignoreOffer) return;

        // A polite peer in a collision rolls back its own offer implicitly here.
        await pc.setRemoteDescription(description);
        await this.flushCandidates();
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) this.options.send({ description: pc.localDescription.toJSON() });
        }
      } else if (!pc.remoteDescription) {
        this.pendingCandidates.push(signal.candidate);
      } else {
        await this.addCandidate(signal.candidate);
      }
    } catch (err) {
      console.warn('Could not apply a signalling message', err);
    }
  }

  close() {
    this.closed = true;
    this.pc.close();
  }

  private async flushCandidates() {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) await this.addCandidate(candidate);
  }

  private async addCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      // Candidates for an offer we ignored are expected to fail; anything else is worth knowing about.
      if (!this.ignoreOffer) throw err;
    }
  }
}
