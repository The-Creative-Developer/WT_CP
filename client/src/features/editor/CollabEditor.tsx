import { LANGUAGES, type Language } from '@devverse/shared';
import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme';
import { getAccessToken, refreshSession } from '../../lib/api';
import { colorFor } from '../../lib/color';
import { monaco } from './monaco';

/** Must match TEXT_NAME on the server. */
const TEXT_NAME = 'content';
const CLOSE_UNAUTHORIZED = 4401;

type Connection =
  | { state: 'connecting' | 'syncing' | 'live' | 'reconnecting' }
  | { state: 'denied'; message: string };

const STATUS_LABEL: Record<Connection['state'], string> = {
  connecting: 'Connecting…',
  syncing: 'Loading the latest version…',
  live: 'Live',
  reconnecting: 'Reconnecting… your edits are kept and will sync',
  denied: '',
};

export interface CollabEditorProps {
  slug: string;
  fileId: string;
  path: string;
  language: Language;
  readOnly: boolean;
  username: string;
}

function collabUrl(): string {
  // Same origin in development (Vite proxies /yjs); the API's origin in production if it differs.
  const base = import.meta.env.VITE_API_URL || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/yjs`;
}

// The default export lets the room page load this (and the ~3 MB Monaco bundle) with React.lazy.
export default function CollabEditor({
  slug,
  fileId,
  path,
  language,
  readOnly,
  username,
}: CollabEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useEffectiveTheme();
  const [connection, setConnection] = useState<Connection>({ state: 'connecting' });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const doc = new Y.Doc();
    // [CONCEPT: WebSockets] One long-lived, two-way connection carries every keystroke both ways, instead of an
    // HTTP request per change. y-websocket speaks the Yjs sync protocol over it and reconnects with backoff.
    const provider = new WebsocketProvider(collabUrl(), `${slug}/${fileId}`, doc, {
      params: { token: getAccessToken() ?? '' },
    });
    // [CONCEPT: Awareness] Ephemeral per-user state (name, colour, cursor) shared with the room but never saved.
    provider.awareness.setLocalStateField('user', { name: username, color: colorFor(username) });

    const model = monaco.editor.createModel(
      '',
      LANGUAGES[language].monaco,
      monaco.Uri.parse(`file:///${fileId}/${path}`),
    );
    const editor = monaco.editor.create(container, {
      model,
      readOnly,
      automaticLayout: true, // re-measures when the container resizes
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      scrollBeyondLastLine: false,
      ariaLabel: `${path}, code editor${readOnly ? ', read only' : ''}`,
    });
    // [CONCEPT: Data Binding] Keeps the Monaco model and the shared Y.Text in step, in both directions.
    const binding = new MonacoBinding(
      doc.getText(TEXT_NAME),
      model,
      new Set([editor]),
      provider.awareness,
    );

    provider.on('status', ({ status }: { status: string }) => {
      setConnection((current) => {
        if (current.state === 'denied') return current;
        if (status === 'connected') return { state: 'syncing' };
        if (status === 'disconnected') return { state: 'reconnecting' };
        return current;
      });
    });
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) setConnection({ state: 'live' });
    });
    // Every reconnect attempt reads provider.params, so keep it pointing at the newest access token.
    provider.on('connection-close', () => {
      provider.params = { token: getAccessToken() ?? '' };
    });
    // The server closed with a code that stops automatic reconnects (4400–4499).
    provider.on('closed', ({ code, reason }: { code: number; reason: string }) => {
      if (code === CLOSE_UNAUTHORIZED) {
        // The access token expired while we were connected: get a new one and carry on.
        void refreshSession().then((session) => {
          if (session) {
            provider.params = { token: session.accessToken };
            provider.connect();
          } else {
            setConnection({
              state: 'denied',
              message: 'Your session ended. Log in again to keep editing.',
            });
          }
        });
        return;
      }
      setConnection({
        state: 'denied',
        message: reason || 'You no longer have access to this file.',
      });
    });

    return () => {
      binding.destroy();
      provider.destroy();
      editor.dispose();
      model.dispose();
      doc.destroy();
    };
  }, [slug, fileId, path, language, readOnly, username]);

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
  }, [theme]);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="font-mono">
          {path}
          {readOnly && (
            <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 font-sans text-xs">
              Read only
            </span>
          )}
        </span>
        {/* [CONCEPT: Live Regions] Connection changes are announced without stealing focus from the editor. */}
        <span role="status" className="flex items-center gap-2 text-muted">
          {connection.state !== 'denied' && (
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${connection.state === 'live' ? 'bg-green-500' : 'bg-amber-500'}`}
            />
          )}
          {connection.state === 'denied' ? '' : STATUS_LABEL[connection.state]}
        </span>
      </div>
      {connection.state === 'denied' ? (
        <p role="alert" className="p-6 text-center text-danger">
          {connection.message}
        </p>
      ) : null}
      <div
        ref={containerRef}
        className={`h-[60vh] min-h-80 ${connection.state === 'denied' ? 'hidden' : ''}`}
      />
      <p className="border-t border-border px-4 py-1.5 text-xs text-muted">
        {/* Monaco captures Tab for indentation; this is its built-in way out for keyboard users. */}
        Tab indents. Press <kbd>Ctrl</kbd>+<kbd>M</kbd> (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
        <kbd>M</kbd> on Mac) to make Tab move focus instead.
      </p>
    </div>
  );
}
