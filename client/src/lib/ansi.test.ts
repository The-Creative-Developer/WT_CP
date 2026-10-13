import { describe, expect, it } from 'vitest';
import { parseAnsi, stripAnsi } from './ansi';

const ESC = '\x1b';

describe('parseAnsi', () => {
  it('leaves plain text alone', () => {
    expect(parseAnsi('hello\n').segments).toEqual([{ text: 'hello\n', style: {} }]);
  });

  it('colours text and resets', () => {
    expect(parseAnsi(`${ESC}[31mred${ESC}[0m plain ${ESC}[1;92mbold green`).segments).toEqual([
      { text: 'red', style: { fg: 1 } },
      { text: ' plain ', style: {} },
      { text: 'bold green', style: { bold: true, fg: 10 } },
    ]);
  });

  it('treats ESC[m as a reset and handles backgrounds and 256-colour codes', () => {
    expect(parseAnsi(`${ESC}[44;38;5;3mx${ESC}[my`).segments).toEqual([
      { text: 'x', style: { bg: 4, fg: 3 } },
      { text: 'y', style: {} },
    ]);
  });

  it('skips true-colour parameters without misreading them as other codes', () => {
    // Without skipping, "1" would turn bold on and "4" underline.
    expect(parseAnsi(`${ESC}[38;2;1;4;9mz`).segments).toEqual([{ text: 'z', style: {} }]);
  });

  it('drops cursor movement, OSC titles and stray escapes', () => {
    expect(stripAnsi(`a${ESC}[2K${ESC}[1Gb${ESC}]0;title\x07c${ESC}d`)).toBe('abcd');
  });

  it('hides a sequence cut off at the end of a chunk, and carries style across chunks', () => {
    const first = parseAnsi(`${ESC}[32mok ${ESC}[1`);
    expect(first.segments).toEqual([{ text: 'ok ', style: { fg: 2 } }]);
    expect(parseAnsi('next', first.style).segments).toEqual([{ text: 'next', style: { fg: 2 } }]);
  });

  it('never produces markup: tags in output stay text', () => {
    expect(stripAnsi('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});
