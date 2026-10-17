import { colorFor } from '@devverse/shared';
import { describe, expect, it } from 'vitest';
import { cssString, cursorStyles, remoteCursors } from './remote-cursors';

describe('cssString', () => {
  it('quotes plain names as they are', () => {
    expect(cssString('alice_99')).toBe('"alice_99"');
  });

  it('escapes anything that could end the string or start a new rule', () => {
    const css = cssString('x"; } body { display: none } .y { content: "');
    expect(css.slice(1, -1)).not.toContain('"');
    expect(css).not.toContain('}');
    expect(css).toContain('\\22 '); // the quote, as a CSS escape
  });

  it('caps the length of a label', () => {
    expect(cssString('a'.repeat(100))).toBe(`"${'a'.repeat(24)}"`);
  });
});

describe('remoteCursors', () => {
  const states = new Map<number, Record<string, unknown>>([
    [1, { user: { name: 'me', color: colorFor('me') } }],
    [2, { user: { name: 'alice', color: 'hsl(120 70% 50%)' } }],
    [3, { user: { name: 'mallory', color: 'red; } * { display: none' } }],
    [4, { cursor: {} }], // no user field yet
    [5, { user: { name: 42 } }],
  ]);

  it('skips our own state and malformed ones, and replaces colours that are not ours', () => {
    expect(remoteCursors(states, 1)).toEqual([
      { clientId: 2, name: 'alice', color: 'hsl(120 70% 50%)' },
      { clientId: 3, name: 'mallory', color: colorFor('mallory') },
    ]);
  });
});

describe('cursorStyles', () => {
  it('gives each person a coloured caret, selection and readable name label', () => {
    const css = cursorStyles([{ clientId: 7, name: 'alice', color: 'hsl(240 70% 50%)' }]);
    expect(css).toContain(
      '.yRemoteSelection-7 { background-color: color-mix(in srgb, hsl(240 70% 50%) 28%',
    );
    expect(css).toContain('.yRemoteSelectionHead-7 { border-color: hsl(240 70% 50%); }');
    expect(css).toContain(
      '.yRemoteSelectionHead-7::after { content: "alice"; background-color: hsl(240 70% 50%); color: #ffffff; }',
    );
  });

  it('parses as valid CSS with one rule per selector, even for hostile names', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      cursorStyles([
        { clientId: 9, name: '"; } body { display: none } x { a: "', color: colorFor('m') },
      ]),
    );
    expect([...sheet.cssRules].map((r) => (r as CSSStyleRule).selectorText)).toEqual([
      '.yRemoteSelection-9',
      '.yRemoteSelectionHead-9',
      '.yRemoteSelectionHead-9::after',
    ]);
  });
});
