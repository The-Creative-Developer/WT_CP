import { colorFor, type MediaState } from '@devverse/shared';
import { useEffect, useRef } from 'react';

interface VideoTileProps {
  username: string;
  stream: MediaStream | null;
  media: MediaState;
  /** Our own tile: never played back (no echo), and mirrored like a mirror. */
  self?: boolean;
  /** For other people: how their connection is doing. */
  connection?: RTCPeerConnectionState;
}

const CONNECTION_NOTE: Partial<Record<RTCPeerConnectionState, string>> = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  failed: 'Connection lost. Retrying…',
};

/** One person's video, or their initial when the camera is off. Their audio plays through the same element. */
export function VideoTile({ username, stream, media, self, connection }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // [CONCEPT: srcObject] A live MediaStream can't be a URL; it's attached to the element directly.
    video.srcObject = stream;
  }, [stream]);

  const showVideo = Boolean(stream) && media.video;
  const note = connection ? CONNECTION_NOTE[connection] : undefined;
  const color = colorFor(username);

  return (
    <figure className="relative m-0 aspect-video overflow-hidden rounded-lg bg-black">
      {/* Always mounted, even with the camera off, so the person can still be heard. A live call has no caption
          file to attach, so the captions rule can't apply here. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={self}
        className={`h-full w-full object-cover ${self ? '-scale-x-100' : ''} ${showVideo ? '' : 'invisible'}`}
      />
      {!showVideo && (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {username.slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}
      <figcaption className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
        {username}
        {self && ' (you)'}
        {!media.audio && <span className="text-red-300">· muted</span>}
        {!media.video && <span className="text-white/70">· camera off</span>}
      </figcaption>
      {note && (
        <p className="absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
          {note}
        </p>
      )}
    </figure>
  );
}
