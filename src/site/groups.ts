import type { Category, Counts } from '../types.ts';

/** A product-change bucket: one stack segment and legend entry, drawn in `color`, counting the categories in `cats`. */
export type Group = { key: string; color: string; cats: Category[] };

// The four product-change buckets, in stack and legend order (dataviz reference dark-palette steps; every adjacent
// pair passes the CVD and normal-vision checks on the panel surface). Any category outside them — maintenance
// (chore, test, docs, ci), other, or one the build adds later — is not a product change and is not counted.
// Changing a colour or the order: re-run the dataviz skill's validate_palette.js with the new hex list in this
// order against both panel surfaces, `--mode dark --surface '#12151a'` and `--mode light --surface '#ffffff'`, and keep
// only an order that passes both (stack gaps cover a CVD WARN). The same hexes serve both schemes.
export const GROUPS: Group[] = [
  { key: 'changed', color: '#c98500', cats: ['changed', 'improved'] },
  { key: 'fixed', color: '#3987e5', cats: ['fixed'] },
  { key: 'added', color: '#008300', cats: ['added'] },
  { key: 'removed', color: '#e66767', cats: ['removed', 'revert'] },
];

export const groupOf = (cat: Category): Group | null => GROUPS.find((g) => g.cats.includes(cat)) ?? null;

/** The categories a tally carries. Its keys are categories by construction (build output); `Object.keys` types them as strings. */
export const categoriesOf = (counts: Counts): Category[] => Object.keys(counts) as Category[];

/** The categories of `g` that occur in `byCategory` (a project's totals). */
export const catsOf = (byCategory: Counts, g: Group): Category[] =>
  categoriesOf(byCategory).filter((c) => groupOf(c) === g);
