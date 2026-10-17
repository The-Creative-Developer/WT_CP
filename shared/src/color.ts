/** A stable, readable colour per user, so the same person always gets the same cursor colour. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  // Fixed saturation and lightness keep every hue legible on both light and dark backgrounds.
  return `hsl(${Math.abs(hash) % 360} 70% 50%)`;
}

/** Our colours look like "hsl(210 70% 50%)" (as made by colorFor); legacy comma syntax is accepted too. */
const HSL =
  /^hsl\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%\s*\)$/;

/** Whether a colour is one of ours. Colours from other clients are checked before they reach any CSS. */
export function isPersonColor(color: unknown): color is string {
  return typeof color === 'string' && HSL.test(color);
}

/**
 * Black or white, whichever is easier to read on `color`.
 * [CONCEPT: Colour Contrast] Uses WCAG relative luminance: yellow and cyan need dark text, blue and red need white.
 */
export function readableTextOn(color: string): '#000000' | '#ffffff' {
  const match = HSL.exec(color);
  if (!match) return '#ffffff';
  const [h, s, l] = [Number(match[1]) % 360, Number(match[2]) / 100, Number(match[3]) / 100];
  // HSL → sRGB (CSS Color 4 algorithm).
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance =
    0.2126 * linear(channel(0)) + 0.7152 * linear(channel(8)) + 0.0722 * linear(channel(4));
  // Contrast with black is (L + 0.05) / 0.05, with white 1.05 / (L + 0.05); pick the larger.
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
