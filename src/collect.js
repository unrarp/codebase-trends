import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { retry } from './net.js';
import { appendJsonl, readJsonl } from './store.js';
import { classifyByRule } from './classify.js';
import { parseChangelog } from './adapters/changelog-md.js';
import { fetchNpmTimes } from './adapters/npm-times.js';
import { collectGitLog, fetchGitLog } from './adapters/git-log.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RETRY = { attempts: 3, delays: [2000, 5000] };

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

/** pending.jsonl: one line per distinct textHash with no rule category and no classification. */
function derivePending(project, dir) {
  const classified = new Set(readJsonl(join(dir, 'classifications.jsonl')).map((c) => c.textHash));
  const pending = new Map();
  for (const e of readJsonl(join(dir, 'events.jsonl'))) {
    if (classifyByRule(e, project) === null && !classified.has(e.textHash) && !pending.has(e.textHash)) {
      pending.set(e.textHash, { textHash: e.textHash, text: e.text });
    }
  }
  writeFileSync(join(dir, 'pending.jsonl'), [...pending.values()].map((p) => JSON.stringify(p) + '\n').join(''));
  return pending.size;
}

/** Runs collection for every project. Paths and network are injectable for tests. */
export async function collect(projects, { dataRoot = join(ROOT, 'data'), seedDir = join(ROOT, 'seed'), net = { fetchText, fetchJson, gitLog: fetchGitLog } } = {}) {
  for (const project of projects) {
    const dir = join(dataRoot, project.id);
    await BASES[project.basis](project, { dir, seedDir, net });
    derivePending(project, dir);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await collect(JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8')));
}
