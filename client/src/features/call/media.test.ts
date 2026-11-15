import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMediaState, describeMediaError, openMedia, stunServers } from './media';

const track = (kind: string) => ({ kind, enabled: true, stop: vi.fn() });
const stream = (...kinds: string[]) => {
  const tracks = kinds.map(track);
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream;
};

function stubDevices(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  const spy = vi.fn(getUserMedia);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: spy } });
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('openMedia', () => {
  it('asks for both, with the chosen devices', async () => {
    const get = stubDevices(async () => stream('audio', 'video'));
    await openMedia({ audioId: 'mic-2', videoId: null });
    expect(get).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-2' } },
      video: { width: { ideal: 640 }, height: { ideal: 360 } },
    });
  });

  it('settles for the microphone alone when there is no camera', async () => {
    const get = stubDevices(async (c) => {
      if (c.video) throw new DOMException('none', 'NotFoundError');
      return stream('audio');
    });
    const s = await openMedia({ audioId: null, videoId: null });
    expect(s.getAudioTracks()).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry when permission is refused", async () => {
    const get = stubDevices(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    await expect(openMedia({ audioId: null, videoId: null })).rejects.toThrow('no');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('describeMediaError', () => {
  it.each([
    ['NotAllowedError', /blocked for this site/],
    ['NotFoundError', /No camera or microphone/],
    ['NotReadableError', /in use by another app/],
    ['Weird', /Could not open/],
  ])('explains %s', (name, message) => {
    expect(describeMediaError(new DOMException('x', name))).toMatch(message);
  });
});

describe('applyMediaState', () => {
  it('enables and disables tracks without removing them', () => {
    const s = stream('audio', 'video');
    applyMediaState(s, { audio: false, video: true });
    expect(s.getAudioTracks()[0]!.enabled).toBe(false);
    expect(s.getVideoTracks()[0]!.enabled).toBe(true);
  });
});

describe('stunServers', () => {
  it('reads a comma-separated list, with a public default', () => {
    expect(stunServers()).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
    vi.stubEnv('VITE_STUN_URLS', 'stun:a.example:3478, stun:b.example:3478');
    expect(stunServers()).toEqual([{ urls: ['stun:a.example:3478', 'stun:b.example:3478'] }]);
  });
});
