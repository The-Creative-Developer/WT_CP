import { describe, expect, it } from 'vitest';
import { colorFor } from './color';

describe('colorFor', () => {
  it('gives the same person the same colour every time', () => {
    expect(colorFor('alice')).toBe(colorFor('alice'));
    expect(colorFor('alice')).not.toBe(colorFor('bob'));
    expect(colorFor('alice')).toMatch(/^hsl\(\d{1,3} 70% 50%\)$/);
  });
});
