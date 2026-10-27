import type { Dates } from '../types.ts';

/** The part of an npm packument the collector reads. */
export type Packument = { time: Record<string, string> };

/** npm packument `time` map → { version: ISO ts } (drops the `created`/`modified` keys). */
export function parseNpmTimes(packument: Packument): Dates {
  const { created, modified, ...times } = packument.time;
  return times;
}

/** Fetches the registry packument for `pkg` via fetchJson(url) and returns its version → ts map. */
export async function fetchNpmTimes(pkg: string, fetchJson: (url: string) => Promise<unknown>): Promise<Dates> {
  return parseNpmTimes((await fetchJson(`https://registry.npmjs.org/${pkg}`)) as Packument);
}
