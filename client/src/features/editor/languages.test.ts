import { describe, expect, it } from 'vitest';
import { monacoLanguageFor } from './languages';

describe('monacoLanguageFor', () => {
  it('picks highlighting by extension, falling back to plain text', () => {
    expect(monacoLanguageFor('src/app.py')).toBe('python');
    expect(monacoLanguageFor('Main.JAVA')).toBe('java');
    expect(monacoLanguageFor('include/util.h')).toBe('cpp');
    expect(monacoLanguageFor('notes.txt')).toBe('plaintext');
    expect(monacoLanguageFor('Makefile')).toBe('plaintext');
    expect(monacoLanguageFor('.env')).toBe('plaintext');
  });
});
