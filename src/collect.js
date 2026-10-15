import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { retry, RETRY } from './net.js';
import { appendJsonl, readJsonl } from './store.js';
import { parseChangelog } from './adapters/changelog-md.js';
import { fetchNpmTimes } from './adapters/npm-times.js';
import { collectGitLog, fetchGitLog } from './adapters/git-log.js';

/**
 * One line of data/<project>/events.jsonl: raw facts only, never a category.
 * @typedef {Object} Event
 * @property {string} id         changelog `<version>#<index>` (0-based bullet position under its header); commits `<sha>`
 * @property {string} textHash   hash.js over project + text; the label cache key; not unique per event
 * @property {string} project
 * @property {'changelog'|'commit'} kind
 * @property {string} [version]  changelog basis
 * @property {string} [sha]      commits basis
 * @property {string} [ts]       commits basis (committer date, ISO UTC); changelog ts comes from dates.json
 * @property {string} text       bullet or commit subject with leading [Tag] groups stripped
 * @property {string[]} tags     e.g. 'vscode' from [VSCode], 'regression:2.1.296', 'pr:53969'
 * @property {string} [author]   commits basis
 * @property {string[]} [coauthors] commits basis: Co-authored-by names
 * @property {{add: number, del: number, files: number}} [stats] commits basis: lines added/deleted and files touched vs the
 *                              first parent; absent when the commit was collected before stats were recorded
 *
 * data/<project>/dates.json (changelog basis): { [version]: ISO ts }, npm publish times ∪ seed/<project>-dates.json.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const fetchText = (url) => retry(async () => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}, RETRY);
const fetchJson = async (url) => JSON.parse(await fetchText(url));

/** Changelog basis: appends events for versions not yet in events.jsonl; rewrites dates.json (npm ∪ seed). */
async function collectChangelog(project, { dir, seedDir, net }) {
  const eventsPath = join(dir, 'events.jsonl');
  const known = new Set(readJsonl(eventsPath).map((e) => e.version));
  const parsed = parseChangelog(await net.fetchText(project.sources.changelog), project.id);
  appendJsonl(eventsPath, parsed.filter((e) => !known.has(e.version)));

  let seed = {};
  try {
    seed = JSON.parse(readFileSync(join(seedDir, `${project.id}-dates.json`), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const npm = await fetchNpmTimes(project.sources.npm, net.fetchJson);
  writeFileSync(join(dir, 'dates.json'), JSON.stringify({ ...seed, ...npm }, null, 2) + '\n');
}

/** Commits basis: appends first-parent commits since `sources.git.since` not already in events.jsonl. */
async function collectCommits(project, { dir, net }) {
  const eventsPath = join(dir, 'events.jsonl');
  appendJsonl(eventsPath, await collectGitLog(project, readJsonl(eventsPath), net.gitLog));
}

// Dispatch by basis.
const BASES = { changelog: collectChangelog, commits: collectCommits };

/** Runs collection for every project. Paths and network are injectable for tests. */
export async function collect(projects, { dataRoot = join(ROOT, 'data'), seedDir = join(ROOT, 'seed'), net = { fetchText, fetchJson, gitLog: fetchGitLog } } = {}) {
  for (const project of projects) {
    const dir = join(dataRoot, project.id);
    await BASES[project.basis](project, { dir, seedDir, net });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await collect(JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8')));
}
