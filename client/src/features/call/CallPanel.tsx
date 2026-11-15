import { MAX_CALL_PEERS } from '@devverse/shared';
import { useId } from 'react';
import type { Call } from './useCall';
import { VideoTile } from './VideoTile';

const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60';
const primaryClass =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast disabled:opacity-60';
const selectClass =
  'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg disabled:opacity-60';

/** "@ada and @lin", "@ada, @lin and @kim". */
function listNames(names: string[]): string {
  const at = names.map((n) => `@${n}`);
  return at.length <= 1 ? (at[0] ?? '') : `${at.slice(0, -1).join(', ')} and ${at.at(-1)}`;
}

/** The room's voice and video call: who's in it, the device preview before joining, and the video grid. */
export function CallPanel({ call, username }: { call: Call; username: string }) {
  const titleId = useId();
  const micId = useId();
  const camId = useId();
  const { phase, roster } = call;
  const names = [...new Set(roster.map((p) => p.user.username))];
  const full = roster.length >= MAX_CALL_PEERS;

  if (phase === 'idle') {
    return (
      <section
        aria-labelledby={titleId}
        className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
      >
        <h2 id={titleId} className="font-semibold">
          Call
        </h2>
        <p className="text-sm text-muted">
          {roster.length === 0
            ? 'Nobody is in the call.'
            : `${listNames(names)} ${roster.length === 1 ? 'is' : 'are'} in the call.`}
        </p>
        <button
          type="button"
          disabled={full}
          onClick={call.startPreview}
          className={`ml-auto ${primaryClass}`}
        >
          {full
            ? `Call full (${MAX_CALL_PEERS} people)`
            : roster.length === 0
              ? 'Start a call'
              : 'Join call'}
        </button>
      </section>
    );
  }

  if (phase === 'preview' || phase === 'joining') {
    const joining = phase === 'joining';
    return (
      <section
        aria-labelledby={titleId}
        className="grid gap-4 rounded-xl border border-border bg-surface p-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
      >
        <VideoTile username={username} stream={call.local} media={call.media} self />
        <div className="flex flex-col gap-3">
          <h2 id={titleId} className="font-semibold">
            Ready to join?
          </h2>
          <p className="text-sm text-muted">
            {roster.length === 0
              ? "You'll be the first in the call."
              : `${listNames(names)} ${roster.length === 1 ? 'is' : 'are'} already there.`}{' '}
            Calls hold up to {MAX_CALL_PEERS} people.
          </p>
          <div role="alert" className="empty:hidden">
            {call.mediaError && (
              <div className="flex flex-col gap-2 rounded-md border border-warning bg-warning/10 p-3 text-sm">
                <p>{call.mediaError}</p>
                <p className="text-muted">You can still join to listen and watch.</p>
                <button
                  type="button"
                  onClick={call.retryDevices}
                  className={`self-start ${buttonClass}`}
                >
                  Try again
                </button>
              </div>
            )}
            {call.joinError && <p className="text-sm text-danger">{call.joinError}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={micId} className="text-sm font-medium">
                Microphone
              </label>
              <select
                id={micId}
                value={call.choice.audioId ?? ''}
                disabled={call.devices.audio.length === 0 || joining}
                onChange={(e) => call.changeDevice('audio', e.target.value)}
                className={selectClass}
              >
                <option value="">Default</option>
                {call.devices.audio.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={camId} className="text-sm font-medium">
                Camera
              </label>
              <select
                id={camId}
                value={call.choice.videoId ?? ''}
                disabled={call.devices.video.length === 0 || joining}
                onChange={(e) => call.changeDevice('video', e.target.value)}
                className={selectClass}
              >
                <option value="">Default</option>
                {call.devices.video.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <MediaToggles call={call} />
          <div className="mt-auto flex flex-wrap justify-end gap-2">
            <button type="button" onClick={call.cancelPreview} className={buttonClass}>
              Cancel
            </button>
            <button type="button" disabled={joining} onClick={call.join} className={primaryClass}>
              {joining ? 'Joining…' : 'Join call'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const tiles = 1 + call.remotes.length;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={titleId} className="font-semibold">
          Call{' '}
          <span className="font-normal text-muted">
            ({tiles} of {MAX_CALL_PEERS})
          </span>
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <MediaToggles call={call} />
          <button
            type="button"
            onClick={call.leave}
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white"
          >
            Leave call
          </button>
        </div>
      </div>
      {/* [CONCEPT: CSS Grid auto-fit] As many columns as fit at 14rem or more each: one tile fills the row, four
          make a 2×2 grid on a laptop and a single column on a phone, with no media queries. */}
      <ul
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${tiles <= 2 ? '18rem' : '14rem'}), 1fr))`,
          // One or two tiles would otherwise stretch across the page and push the editor out of view.
          maxWidth: tiles === 1 ? '32rem' : tiles === 2 ? '56rem' : undefined,
        }}
      >
        <li>
          <VideoTile username={username} stream={call.local} media={call.media} self />
        </li>
        {call.remotes.map((peer) => (
          <li key={peer.peerId}>
            <VideoTile
              username={peer.user.username}
              stream={peer.stream}
              media={peer.media}
              connection={peer.connection === 'connected' ? undefined : peer.connection}
            />
          </li>
        ))}
      </ul>
      {call.remotes.length === 0 && (
        <p className="text-sm text-muted">Waiting for others to join…</p>
      )}
    </section>
  );
}

function MediaToggles({ call }: { call: Call }) {
  const { media, hasTrack } = call;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={!hasTrack.audio}
        onClick={() => call.toggle('audio')}
        className={buttonClass}
        title={hasTrack.audio ? undefined : 'No microphone'}
      >
        {media.audio ? 'Mute' : 'Unmute'}
      </button>
      <button
        type="button"
        disabled={!hasTrack.video}
        onClick={() => call.toggle('video')}
        className={buttonClass}
        title={hasTrack.video ? undefined : 'No camera'}
      >
        {media.video ? 'Turn camera off' : 'Turn camera on'}
      </button>
    </div>
  );
}
