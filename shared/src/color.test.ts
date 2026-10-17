import { describe, expect, it } from 'vitest';
import { colorFor, isPersonColor, readableTextOn } from './color';

describe('colorFor', () => {
  it('gives the same person the same colour every time', () => {
    expect(colorFor('alice')).toBe(colorFor('alice'));
    expect(colorFor('alice')).not.toBe(colorFor('bob'));
    expect(colorFor('alice')).toMatch(/^hsl\(\d{1,3} 70% 50%\)$/);
  });
});

describe('readableTextOn', () => {
  it('picks dark text on light hues and white text on dark ones', () => {
    expect(readableTextOn('hsl(60 70% 50%)')).toBe('#000000'); // yellow
    expect(readableTextOn('hsl(180 70% 50%)')).toBe('#000000'); // cyan
    expect(readableTextOn('hsl(240 70% 50%)')).toBe('#ffffff'); // blue
    expect(readableTextOn('hsl(0, 70%, 50%)')).toBe('#ffffff'); // red: white gives 4.9:1, black only 4.3:1
  });

  it('meets WCAG AA (4.5:1) for every colour colorFor can produce', () => {
    const toRgb = (h: number) => {
      const s = 0.7;
      const l = 0.5;
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
    };
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (let h = 0; h < 360; h++) {
      const bg = lum(toRgb(h));
      const text = readableTextOn(`hsl(${h} 70% 50%)`) === '#000000' ? 0 : 1;
      const ratio = (Math.max(bg, text) + 0.05) / (Math.min(bg, text) + 0.05);
      expect(ratio, `hue ${h}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('isPersonColor', () => {
  it('accepts only our hsl colours', () => {
    expect(isPersonColor(colorFor('alice'))).toBe(true);
    expect(isPersonColor('red; } body { display: none')).toBe(false);
    expect(isPersonColor('url(https://evil.example/x.png)')).toBe(false);
    expect(isPersonColor(42)).toBe(false);
  });
});
