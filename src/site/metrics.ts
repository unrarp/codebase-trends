// The measures over weekly rows that the KPI tiles and the chart share.
import type { CountRow } from '../types.ts';
import { categoriesOf, groupOf } from './groups.ts';

export const ROLL = 4; // weeks in the rolling fix share window and in each KPI window

export const sum = <T>(rows: readonly T[], f: (r: T) => number): number => rows.reduce((s, r) => s + f(r), 0);
export const fixes = (r: CountRow): number => (r.counts.fixed ?? 0) + (r.counts.revert ?? 0);
/** Product changes in a row: every category that belongs to a group. */
export const shown = (r: CountRow): number => sum(categoriesOf(r.counts), (c) => (groupOf(c) ? (r.counts[c] ?? 0) : 0));
/** Pooled fix share over rows; null when no product change landed. */
export const pooledFix = (rows: CountRow[]): number | null => {
  const d = sum(rows, shown);
  return d === 0 ? null : sum(rows, fixes) / d;
};
/** Median of a list of sizes (not assumed sorted); null when empty. */
export const median = (xs: number[]): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null;
};
