import type { CallPeer } from '@devverse/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CallPanel } from './CallPanel';
import type { Call } from './useCall';

const peer = (n: number, username: string): CallPeer => ({
  peerId: `p${n}`,
  user: { id: `u${n}`, username },
  media: { audio: true, video: true },
});

function fakeCall(over: Partial<Call> = {}): Call {
  return {
    phase: 'idle',
    roster: [],
    myPeerId: null,
    local: null,
    media: { audio: true, video: true },
    devices: { audio: [], video: [] },
    choice: { audioId: null, videoId: null },
    mediaError: null,
    joinError: null,
    remotes: [],
    hasTrack: { audio: true, video: true },
    startPreview: vi.fn(),
    changeDevice: vi.fn(),
    retryDevices: vi.fn(),
    cancelPreview: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    toggle: vi.fn(),
    ...over,
  };
}

describe('CallPanel', () => {
  it('says who is in the call and offers to join', async () => {
    const call = fakeCall({ roster: [peer(1, 'ada'), peer(2, 'lin')] });
    render(<CallPanel call={call} username="me" />);
    expect(screen.getByText('@ada and @lin are in the call.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(call.startPreview).toHaveBeenCalled();
  });

  it('offers to start an empty call, and refuses a full one', () => {
    const { rerender } = render(<CallPanel call={fakeCall()} username="me" />);
    expect(screen.getByText('Nobody is in the call.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a call' })).toBeEnabled();

    const full = [1, 2, 3, 4].map((n) => peer(n, `user${n}`));
    rerender(<CallPanel call={fakeCall({ roster: full })} username="me" />);
    expect(screen.getByRole('button', { name: 'Call full (4 people)' })).toBeDisabled();
  });

  it('previews devices before joining', async () => {
    const call = fakeCall({
      phase: 'preview',
      devices: {
        audio: [{ deviceId: 'm1', label: 'Headset', kind: 'audioinput' } as MediaDeviceInfo],
        video: [{ deviceId: 'c1', label: '', kind: 'videoinput' } as MediaDeviceInfo],
      },
    });
    render(<CallPanel call={call} username="me" />);
    expect(screen.getByRole('heading', { name: 'Ready to join?' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Microphone'), 'Headset');
    expect(call.changeDevice).toHaveBeenCalledWith('audio', 'm1');
    // Unnamed devices (no permission yet) get a numbered name.
    expect(within(screen.getByLabelText('Camera')).getByText('Camera 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(call.toggle).toHaveBeenCalledWith('audio');
    await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(call.join).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(call.cancelPreview).toHaveBeenCalled();
  });

  it('explains blocked devices and still allows joining', async () => {
    const call = fakeCall({
      phase: 'preview',
      mediaError: 'Camera and microphone are blocked for this site.',
      media: { audio: false, video: false },
      hasTrack: { audio: false, video: false },
    });
    render(<CallPanel call={call} username="me" />);
    expect(screen.getByRole('alert')).toHaveTextContent('You can still join to listen and watch.');
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(call.retryDevices).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Join call' })).toBeEnabled();
  });

  it('shows a tile per person in the call, with their media state', async () => {
    const call = fakeCall({
      phase: 'in-call',
      myPeerId: 'p0',
      media: { audio: false, video: true },
      remotes: [
        { ...peer(1, 'ada'), stream: null, connection: 'connected' },
        {
          ...peer(2, 'lin'),
          media: { audio: true, video: false },
          stream: null,
          connection: 'connecting',
        },
      ],
    });
    render(<CallPanel call={call} username="me" />);
    expect(screen.getByRole('heading', { name: 'Call (3 of 4)' })).toBeInTheDocument();
    const tiles = screen.getAllByRole('figure');
    expect(tiles.map((t) => t.querySelector('figcaption')?.textContent)).toEqual([
      'me (you)· muted',
      'ada',
      'lin· camera off',
    ]);
    expect(within(tiles[2]!).getByText('Connecting…')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(call.toggle).toHaveBeenCalledWith('audio');
    await userEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(call.leave).toHaveBeenCalled();
  });
});
