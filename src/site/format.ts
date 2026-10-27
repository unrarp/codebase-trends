// Text for dates, weeks and numbers as the page shows them.
import type { CountRow } from '../types.ts';
import { required } from './required.ts';
import { DAY, weekEnd } from './time.ts';

/** Within the last year a date needs no year; `year` asks for one on older dates. */
export const recent = (d: string): boolean => Date.parse(`${d}T00:00:00Z`) > Date.now() - 365 * DAY;
export const fmt = (d: string, year?: boolean): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year && !recent(d) ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
/** The dates a run of weekly rows covers, Monday of the first to Sunday of the last. */
export const span = (ws: CountRow[]): string => `${fmt(ws[0].d)} – ${fmt(weekEnd(required(ws.at(-1), 'a week').d))}`;
/** One week as "Oct 5 – 11" or "Sep 28 – Oct 4"; with `year`, an older week reads "Oct 6 – 12, 2025" or "Dec 30, 2024 – Jan 5, 2025". */
export const weekSpan = (d: string, year?: boolean): string => {
  const e = weekEnd(d);
  const [a, b] = [d, e].map((x) => new Date(`${x}T00:00:00Z`));
  const withYear = year && !recent(d);
  const start = withYear && a.getUTCFullYear() !== b.getUTCFullYear() ? `${fmt(d)}, ${a.getUTCFullYear()}` : fmt(d);
  const end = a.getUTCMonth() === b.getUTCMonth() ? b.getUTCDate() : fmt(e);
  return `${start} – ${end}${withYear ? `, ${b.getUTCFullYear()}` : ''}`;
};
export const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
export const pct = (x: number): string => `${Math.round(x * 100)}%`;
