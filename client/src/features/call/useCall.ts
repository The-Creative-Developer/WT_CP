import type { CallPeer, MediaState, ServerToClientEvents } from '@devverse/shared';
import { useEffect, useRef, useState } from 'react';
import type { RoomChannel } from '../rooms/useRoomChannel';
import {
  applyMediaState,
  describeMediaError,
  listDevices,
  openMedia,
  stopStream,
  stunServers,
  type DeviceChoice,
  type Devices,
} from './media';
import { loadIceServers } from './ice';
import { isPolite, PeerLink, type Signal } from './peer-link';

/** idle: not in the call. preview: choosing devices before joining. joining: waiting for the server. */
export type CallPhase = 'idle' | 'preview' | 'joining' | 'in-call';

export interface RemotePeer extends CallPeer {
  stream: MediaStream | null;
  connection: RTCPeerConnectionState;
}

export type Call = ReturnType<typeof useCall>;

/**
 * A room's voice and video call: device preview, joining, one PeerLink per other person (a full mesh), and
 * mute/camera toggles. Uses the room's existing socket for signalling.
 */
export function useCall(slug: string, channel: RoomChannel) {
  const { socket, joins } = channel;
  const [roster, setRoster] = useState<CallPeer[]>([]);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [media, setMedia] = useState<MediaState>({ audio: true, video: true });
  const [devices, setDevices] = useState<Devices>({ audio: [], video: [] });
  const [choice, setChoice] = useState<DeviceChoice>({ audioId: null, videoId: null });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [streams, setStreams] = useState<ReadonlyMap<string, MediaStream>>(new Map());
  const [connections, setConnections] = useState<ReadonlyMap<string, RTCPeerConnectionState>>(
    new Map(),
  );

  // Read from socket callbacks, which outlive any one render.
  const links = useRef(new Map<string, PeerLink>());
  const localRef = useRef<MediaStream | null>(null);
  const mediaRef = useRef(media);
  const inCall = useRef(false);
  const myId = useRef<string | null>(null);
  const openRequest = useRef(0);
  const iceServers = useRef<RTCIceServer[]>(stunServers());

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  const setMap = <T>(
    set: (fn: (m: ReadonlyMap<string, T>) => ReadonlyMap<string, T>) => void,
    id: string,
    value: T | undefined,
  ) =>
    set((m) => {
      const next = new Map(m);
      if (value === undefined) next.delete(id);
      else next.set(id, value);
      return next;
    });

  function ensureLink(peerId: string): PeerLink {
    const existing = links.current.get(peerId);
    if (existing) return existing;
    const link = new PeerLink({
      peerId,
      polite: isPolite(myId.current ?? '', peerId),
      stream: localRef.current,
      iceServers: iceServers.current,
      send: (signal: Signal) => {
        if ('description' in signal) {
          const { type, sdp } = signal.description;
          if ((type === 'offer' || type === 'answer') && sdp) {
            socket.emit('rtc:description', { to: peerId, description: { type, sdp } });
          }
        } else {
          socket.emit('rtc:ice', { to: peerId, candidate: signal.candidate });
        }
      },
      onStream: (stream) => setMap(setStreams, peerId, stream),
      onState: (state) => setMap(setConnections, peerId, state),
    });
    links.current.set(peerId, link);
    setMap(setConnections, peerId, 'new');
    return link;
  }

  function dropLink(peerId: string) {
    links.current.get(peerId)?.close();
    links.current.delete(peerId);
    setMap(setStreams, peerId, undefined);
    setMap(setConnections, peerId, undefined);
  }

  function dropAllLinks() {
    for (const id of [...links.current.keys()]) dropLink(id);
  }

  // Who is in the call, for everyone in the room. While in the call it also drives the mesh: a link for every
  // newcomer, and none for anyone who left.
  useEffect(() => {
    const onRoster: ServerToClientEvents['call:roster'] = ({ slug: s, peers }) => {
      if (s !== slug) return;
      setRoster(peers);
      if (!inCall.current) return;
      const ids = new Set(peers.map((p) => p.peerId));
      for (const id of ids) if (id !== myId.current) ensureLink(id);
      for (const id of [...links.current.keys()]) if (!ids.has(id)) dropLink(id);
    };
    // A signal can arrive before the roster that announces its sender: create the link on demand.
    const onDescription: ServerToClientEvents['rtc:description'] = ({ from, description }) => {
      if (inCall.current) void ensureLink(from).receive({ description });
    };
    const onIce: ServerToClientEvents['rtc:ice'] = ({ from, candidate }) => {
      if (inCall.current) void ensureLink(from).receive({ candidate });
    };
    // The server forgets a dropped socket's call; the links are useless without signalling. Rejoined below.
    const onDisconnect = () => {
      dropAllLinks();
      setRoster([]);
    };
    socket.on('call:roster', onRoster);
    socket.on('rtc:description', onDescription);
    socket.on('rtc:ice', onIce);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('call:roster', onRoster);
      socket.off('rtc:description', onDescription);
      socket.off('rtc:ice', onIce);
      socket.off('disconnect', onDisconnect);
    };
    // ensureLink/dropLink only touch refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, slug]);

  async function sendJoin(): Promise<void> {
    // Fetched before joining, so every link starts with the TURN relay in its configuration.
    iceServers.current = await loadIceServers();
    const res = await socket
      .timeout(5_000)
      .emitWithAck('call:join', { slug, media: mediaRef.current })
      .catch(() => ({ ok: false as const, error: 'The server did not answer. Try again.' }));
    if (!res.ok) {
      inCall.current = false;
      setJoinError(res.error);
      setPhase('preview');
      return;
    }
    myId.current = res.data.peerId;
    setMyPeerId(res.data.peerId);
    inCall.current = true;
    setPhase('in-call');
    for (const peer of res.data.peers) ensureLink(peer.peerId);
  }

  // After a reconnect the room channel joins the room again (joins goes up); a call in progress rejoins too. The
  // socket id is new, so every link is rebuilt.
  const lastJoins = useRef(joins);
  useEffect(() => {
    if (joins === lastJoins.current) return;
    lastJoins.current = joins;
    if (!inCall.current) return;
    dropAllLinks();
    void sendJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joins]);

  // Device names appear once permission is granted, and devices come and go (a headset plugged in).
  useEffect(() => {
    if (phase === 'idle' || !navigator.mediaDevices) return;
    const refresh = () => void listDevices().then(setDevices);
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
  }, [phase]);

  // Leaving the room page ends the call and releases the camera.
  useEffect(
    () => () => {
      if (inCall.current) socket.emit('call:leave', { slug });
      inCall.current = false;
      for (const link of links.current.values()) link.close();
      links.current.clear();
      stopStream(localRef.current);
      localRef.current = null;
    },
    [socket, slug],
  );

  /** Opens (or reopens, with other devices) the microphone and camera for the preview. */
  async function open(next: DeviceChoice) {
    const request = ++openRequest.current;
    setMediaError(null);
    stopStream(localRef.current);
    localRef.current = null;
    setLocal(null);
    try {
      const stream = await openMedia(next);
      // A newer request (the person picked another camera meanwhile) wins.
      if (request !== openRequest.current) return stopStream(stream);
      const has = {
        audio: stream.getAudioTracks().length > 0,
        video: stream.getVideoTracks().length > 0,
      };
      const nextMedia = {
        audio: has.audio && mediaRef.current.audio,
        video: has.video && mediaRef.current.video,
      };
      applyMediaState(stream, nextMedia);
      localRef.current = stream;
      setLocal(stream);
      setMedia(nextMedia);
      setDevices(await listDevices());
    } catch (err) {
      if (request !== openRequest.current) return;
      setMediaError(describeMediaError(err));
      setMedia({ audio: false, video: false });
      setDevices(await listDevices().catch(() => ({ audio: [], video: [] })));
    }
  }

  return {
    phase,
    roster,
    myPeerId,
    local,
    media,
    devices,
    choice,
    mediaError,
    joinError,
    /** Everyone else in the call, with their media as it arrives. */
    remotes: roster
      .filter((p) => p.peerId !== myPeerId)
      .map((p): RemotePeer => ({
        ...p,
        stream: streams.get(p.peerId) ?? null,
        connection: connections.get(p.peerId) ?? 'new',
      })),
    hasTrack: {
      audio: (local?.getAudioTracks().length ?? 0) > 0,
      video: (local?.getVideoTracks().length ?? 0) > 0,
    },

    /** Shows the preview: opens the default devices. */
    startPreview() {
      setJoinError(null);
      setPhase('preview');
      void open(choice);
    },
    changeDevice(kind: 'audio' | 'video', deviceId: string) {
      const next = { ...choice, [kind === 'audio' ? 'audioId' : 'videoId']: deviceId || null };
      setChoice(next);
      void open(next);
    },
    retryDevices() {
      void open(choice);
    },
    cancelPreview() {
      openRequest.current++;
      stopStream(localRef.current);
      localRef.current = null;
      setLocal(null);
      setPhase('idle');
    },
    join() {
      setJoinError(null);
      setPhase('joining');
      void sendJoin();
    },
    leave() {
      if (inCall.current) socket.emit('call:leave', { slug });
      inCall.current = false;
      myId.current = null;
      setMyPeerId(null);
      dropAllLinks();
      openRequest.current++;
      stopStream(localRef.current);
      localRef.current = null;
      setLocal(null);
      setPhase('idle');
    },
    /** [CONCEPT: MediaStreamTrack.enabled] Mute and camera-off keep the track but send silence or black frames. */
    toggle(kind: 'audio' | 'video') {
      const next = { ...media, [kind]: !media[kind] };
      applyMediaState(localRef.current, next);
      setMedia(next);
      if (inCall.current) socket.emit('call:media', { slug, media: next });
    },
  };
}
