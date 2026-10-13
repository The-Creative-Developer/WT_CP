const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// [CONCEPT: Intl API] "3 hours ago" / "il y a 3 heures" in the user's own locale, with no date library.
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(0, 'minute'); // "this minute"
}

const milliseconds = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'millisecond',
  unitDisplay: 'short',
});
const seconds = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'second',
  unitDisplay: 'short',
  maximumFractionDigits: 2,
});

/** "42 ms" under a second, "1.25 sec" above, in the user's locale. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? milliseconds.format(Math.round(ms)) : seconds.format(ms / 1000);
}
