import { describe, expect, it } from 'vitest';
import { formatDuration, timeAgo } from './format';

describe('timeAgo', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');

  it('picks the largest sensible unit', () => {
    expect(timeAgo('2026-10-10T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(timeAgo('2026-10-09T12:00:00Z', now)).toMatch(/yesterday/);
    expect(timeAgo('2026-10-10T11:59:30Z', now)).toMatch(/this minute/);
  });
});

describe('formatDuration', () => {
  it('uses milliseconds under a second and seconds above', () => {
    expect(formatDuration(42)).toMatch(/^42\sms$/);
    expect(formatDuration(1250)).toMatch(/^1\.25\ssec$/);
  });
});
