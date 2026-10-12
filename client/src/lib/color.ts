/** A stable, readable colour per user, so the same person always gets the same cursor colour. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  // Fixed saturation and lightness keep every hue legible on both light and dark backgrounds.
  return `hsl(${Math.abs(hash) % 360} 70% 50%)`;
}
