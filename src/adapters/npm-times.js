/** npm packument `time` map → { version: ISO ts } (drops the `created`/`modified` keys). */
export function parseNpmTimes(packument) {
  const { created, modified, ...times } = packument.time;
  return times;
}

/** Fetches the registry packument for `pkg` via fetchJson(url) and returns its version → ts map. */
export async function fetchNpmTimes(pkg, fetchJson) {
  return parseNpmTimes(await fetchJson(`https://registry.npmjs.org/${pkg}`));
}
