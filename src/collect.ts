import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from './adapters/changelog-md.ts';
import { collectGitLog, fetchGitLog } from './adapters/git-log.ts';
import { fetchNpmTimes } from './adapters/npm-times.ts';
import { RETRY, retry } from './net.ts';
import { appendJsonl, readJsonl } from './store.ts';
import type { Basis, Dates, Event, ProjectConfig } from './types.ts';

// data/<project>/events.jsonl holds `Event`s; dates.json (changelog basis) holds `Dates`. See types.ts.

export type Net = {
  fetchText: (url: string) => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
  gitLog: typeof fetchGitLog;
};
type CollectDirs = { dir: string; seedDir: string; net: Net };

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const fetchText = (url: string): Promise<string> =>
  retry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  }, RETRY);
const fetchJson = async (url: string): Promise<unknown> => JSON.parse(await fetchText(url));

const sourceOf = (project: ProjectConfig, key: 'changelog' | 'npm'): string => {
  const url = project.sources?.[key];
  if (!url) throw new Error(`${project.id}: no sources.${key}`);
  return url;
};

/** Changelog basis: appends events for versions not yet in events.jsonl; rewrites dates.json (npm ∪ seed). */
async function collectChangelog(project: ProjectConfig, { dir, seedDir, net }: CollectDirs): Promise<void> {
  const eventsPath = join(dir, 'events.jsonl');
  const known = new Set(readJsonl<Event>(eventsPath).map((e) => e.version));
  const parsed = parseChangelog(await net.fetchText(sourceOf(project, 'changelog')), project.id);
  appendJsonl(
    eventsPath,
    parsed.filter((e) => !known.has(e.version)),
  );

  let seed: Dates = {};
  try {
    seed = JSON.parse(readFileSync(join(seedDir, `${project.id}-dates.json`), 'utf8')) as Dates;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const npm = await fetchNpmTimes(sourceOf(project, 'npm'), net.fetchJson);
  writeFileSync(join(dir, 'dates.json'), `${JSON.stringify({ ...seed, ...npm }, null, 2)}\n`);
}

/** Commits basis: appends first-parent commits since `sources.git.since` not already in events.jsonl. */
async function collectCommits(project: ProjectConfig, { dir, net }: CollectDirs): Promise<void> {
  const eventsPath = join(dir, 'events.jsonl');
  appendJsonl(eventsPath, await collectGitLog(project, readJsonl<Event>(eventsPath), net.gitLog));
}

// Dispatch by basis.
const BASES: Record<Basis, (project: ProjectConfig, dirs: CollectDirs) => Promise<void>> = {
  changelog: collectChangelog,
  commits: collectCommits,
};

/** Runs collection for every project. Paths and network are injectable for tests. */
export async function collect(
  projects: ProjectConfig[],
  {
    dataRoot = join(ROOT, 'data'),
    seedDir = join(ROOT, 'seed'),
    net = { fetchText, fetchJson, gitLog: fetchGitLog },
  }: { dataRoot?: string; seedDir?: string; net?: Net } = {},
): Promise<void> {
  for (const project of projects) {
    const dir = join(dataRoot, project.id);
    await BASES[project.basis](project, { dir, seedDir, net });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await collect(JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8')) as ProjectConfig[]);
}
