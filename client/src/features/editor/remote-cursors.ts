import { colorFor, isPersonColor, readableTextOn } from '@devverse/shared';

/** What another person shares through Yjs Awareness (see CollabEditor). */
export interface RemoteCursor {
  clientId: number;
  name: string;
  color: string;
}

const MAX_LABEL_LENGTH = 24;

/**
 * Text as a quoted CSS string. Everything but plain letters, digits and a few safe symbols becomes a CSS escape
 * (\HEX followed by a space), so a name can never close the string and start a rule of its own.
 */
export function cssString(text: string): string {
  const escaped = [...text.slice(0, MAX_LABEL_LENGTH)]
    .map((char) => (/^[\w .-]$/.test(char) ? char : `\\${char.codePointAt(0)!.toString(16)} `))
    .join('');
  return `"${escaped}"`;
}

/** Reads the awareness states other clients sent, keeping only well-formed ones. */
export function remoteCursors(
  states: Map<number, Record<string, unknown>>,
  ownClientId: number,
): RemoteCursor[] {
  const cursors: RemoteCursor[] = [];
  for (const [clientId, state] of states) {
    if (clientId === ownClientId) continue;
    const user = state.user as { name?: unknown; color?: unknown } | undefined;
    if (!user || typeof user.name !== 'string' || !user.name) continue;
    // [CONCEPT: Untrusted Client Data] Awareness states come straight from other browsers. Only colours in our own
    // format reach the stylesheet; anything else falls back to the colour their name would have had.
    const color = isPersonColor(user.color) ? user.color : colorFor(user.name);
    cursors.push({ clientId, name: user.name, color });
  }
  return cursors;
}

/**
 * CSS for each person's caret, selection and name label. y-monaco tags their decorations with the client id, e.g.
 * `yRemoteSelectionHead-123`; the shared layout of those classes is in styles/index.css.
 */
export function cursorStyles(cursors: RemoteCursor[]): string {
  return cursors
    .map(({ clientId, name, color }) =>
      [
        `.yRemoteSelection-${clientId} { background-color: color-mix(in srgb, ${color} 28%, transparent); }`,
        `.yRemoteSelectionHead-${clientId} { border-color: ${color}; }`,
        `.yRemoteSelectionHead-${clientId}::after { content: ${cssString(name)}; background-color: ${color}; color: ${readableTextOn(color)}; }`,
      ].join('\n'),
    )
    .join('\n');
}
