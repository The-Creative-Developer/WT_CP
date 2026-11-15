import type { MediaState } from '@devverse/shared';

/**
 * [CONCEPT: STUN] A STUN server tells a browser its public address, so two peers behind home routers (NAT) can find
 * a direct path to each other. It never carries media. The API normally supplies STUN and TURN servers (see ice.ts);
 * these are the fallback when it can't be reached.
 */
export function stunServers(): RTCIceServer[] {
  const urls = (import.meta.env.VITE_STUN_URLS ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length ? [{ urls }] : [];
}

export interface DeviceChoice {
  audioId: string | null;
  videoId: string | null;
}

export interface Devices {
  audio: MediaDeviceInfo[];
  video: MediaDeviceInfo[];
}

/**
 * [CONCEPT: MediaDevices] The microphones and cameras the browser can see. Their names (labels) stay empty until the
 * page has been allowed to use a device once, which is why this runs again after getUserMedia succeeds.
 */
export async function listDevices(): Promise<Devices> {
  if (!navigator.mediaDevices?.enumerateDevices) return { audio: [], video: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    audio: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
    video: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
  };
}

const constraint = (id: string | null): MediaTrackConstraints | boolean =>
  id ? { deviceId: { exact: id } } : true;

/** Why devices couldn't be opened, in words people can act on. */
export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera and microphone are blocked for this site. Allow them from the icon in the address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera or microphone is in use by another app, or failed to start.';
    default:
      return 'Could not open the camera or microphone.';
  }
}

/**
 * Opens the chosen microphone and camera. If only one kind exists (a desktop with a mic but no webcam), it settles
 * for that one rather than failing. Throws if neither can be opened.
 *
 * [CONCEPT: getUserMedia] Asks for permission the first time; needs a secure context (HTTPS or localhost).
 */
export async function openMedia(choice: DeviceChoice): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException('getUserMedia is not available', 'SecurityError');
  }
  const get = (constraints: MediaStreamConstraints) =>
    navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await get({
      audio: constraint(choice.audioId),
      video: {
        ...(constraint(choice.videoId) as object),
        width: { ideal: 640 },
        height: { ideal: 360 },
      },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name !== 'NotFoundError' && name !== 'OverconstrainedError' && name !== 'NotReadableError')
      throw err;
    // One of the two is missing or busy: try each alone.
    for (const constraints of [
      { audio: constraint(choice.audioId) },
      { video: constraint(choice.videoId) },
    ]) {
      try {
        return await get(constraints);
      } catch {
        // try the next
      }
    }
    throw err;
  }
}

/** Turns the stream's tracks on or off. A disabled track sends silence or black frames: no renegotiation needed. */
export function applyMediaState(stream: MediaStream | null, media: MediaState) {
  stream?.getAudioTracks().forEach((t) => (t.enabled = media.audio));
  stream?.getVideoTracks().forEach((t) => (t.enabled = media.video));
}

export const stopStream = (stream: MediaStream | null) =>
  stream?.getTracks().forEach((t) => t.stop());
