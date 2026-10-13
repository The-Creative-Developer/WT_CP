/**
 * A small ANSI escape-code parser for program output.
 *
 * [CONCEPT: ANSI Escape Codes] Terminals colour text when a program prints control sequences such as
 * "\x1b[31m" (red) and "\x1b[0m" (reset). We turn them into styled segments that React renders as <span>s, so
 * program output never reaches the page as HTML (no XSS), and strip every other control sequence.
 *
 * Supported: the 16 standard colours (foreground and background, including the first 16 of the 256-colour
 * palette), bold, dim, italic and underline. True colour and the rest of the 256-colour palette fall back to the
 * default colour.
 */

export interface AnsiStyle {
  /** 0–7 standard, 8–15 bright. */
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

// CSI sequences (ESC [ params final), OSC sequences (ESC ] … BEL or ESC \) and two-character escapes.
// eslint-disable-next-line no-control-regex
const ESCAPE = /\x1b(?:\[([0-9;?]*)([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// A sequence cut off at the end of the text so far; the rest arrives with the next chunk.
// eslint-disable-next-line no-control-regex
const INCOMPLETE_TAIL = /\x1b(?:\[[0-9;?]*|\][^\x07\x1b]*)?$/;
// eslint-disable-next-line no-control-regex
const STRAY_ESC = /\x1b/g;

export function parseAnsi(
  input: string,
  initial: AnsiStyle = {},
): { segments: AnsiSegment[]; style: AnsiStyle } {
  const text = input.replace(INCOMPLETE_TAIL, '');
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = { ...initial };
  let last = 0;

  const pushText = (chunk: string) => {
    const clean = chunk.replace(STRAY_ESC, '');
    if (!clean) return;
    const previous = segments.at(-1);
    // Merge with the previous segment when nothing changed in between (keeps the DOM small).
    if (previous && sameStyle(previous.style, style)) previous.text += clean;
    else segments.push({ text: clean, style });
  };

  for (const match of text.matchAll(ESCAPE)) {
    pushText(text.slice(last, match.index));
    last = match.index + match[0].length;
    // Only SGR ("Select Graphic Rendition", final byte "m") changes how text looks; cursor moves etc. are dropped.
    if (match[2] === 'm') style = applySgr(style, match[1] ?? '');
  }
  pushText(text.slice(last));
  return { segments, style };
}

/** The text a user would expect to copy: what's visible, without the control sequences. */
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .segments.map((s) => s.text)
    .join('');
}

function applySgr(current: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(';').map((p) => (p === '' ? 0 : Number(p)));
  const style = { ...current };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) {
      for (const key of Object.keys(style)) delete style[key as keyof AnsiStyle];
    } else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 22) style.bold = style.dim = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code >= 30 && code <= 37) style.fg = code - 30;
    else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
    else if (code === 39) delete style.fg;
    else if (code >= 40 && code <= 47) style.bg = code - 40;
    else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
    else if (code === 49) delete style.bg;
    else if (code === 38 || code === 48) {
      // Extended colour: 38;5;n (256 colours) or 38;2;r;g;b (true colour). Skip its parameters either way.
      const key = code === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5) {
        const n = codes[i + 2];
        if (n !== undefined && n < 16) style[key] = n;
        else delete style[key];
        i += 2;
      } else if (codes[i + 1] === 2) {
        delete style[key];
        i += 4;
      }
    }
  }
  return style;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline
  );
}
