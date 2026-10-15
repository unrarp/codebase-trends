import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collect } from './collect.js';
import { build } from './build.js';
import { applyLabels, writeBatches } from './apply-labels.js';
import { retry, RETRY } from './net.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Empties batchesDir, then writes batch files for every project's pending (none for a project with none); returns the paths. */
export function prepareBatches(projects, batchesDir, { dataRoot = join(ROOT, 'data') } = {}) {
  rmSync(batchesDir, { recursive: true, force: true });
  return projects.flatMap((p) => writeBatches(p, batchesDir, { dataRoot }));
}

/** Added-line counts per project from `git diff --numstat` text: { events, labels, projects }. */
export function countsFromNumstat(text) {
  const byProject = {};
  let events = 0;
  let labels = 0;
  for (const line of text.split('\n')) {
    const m = /^(\d+)\t\d+\tdata\/([^/]+)\/(events|classifications)\.jsonl$/.exec(line);
    if (!m || m[1] === '0') continue;
    byProject[m[2]] = true;
    if (m[3] === 'events') events += Number(m[1]); else labels += Number(m[1]);
  }
  return { events, labels, projects: Object.keys(byProject) };
}

export function commitMessage({ events, labels, projects }) {
  return `data: ${projects.join(', ') || 'no changes'} +${events} events, +${labels} labels`;
}

const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Builds docs/ stamped with the generatedAt already published; when that leaves data/ and docs/ identical to the
 * committed tree there is nothing to publish and the result is false. Otherwise rebuilds stamped `now` and returns true,
 * so generatedAt is the last time the published data changed (the site's hatch starts there).
 */
export function buildIfChanged({ root = ROOT, now = new Date() } = {}) {
  const [first] = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8'));
  const summary = first && join(root, 'docs', 'data', first.id, 'summary.json');
  const prev = summary && existsSync(summary) ? JSON.parse(readFileSync(summary, 'utf8')).generatedAt : null;
  build({ root, now: prev ? new Date(prev) : now });
  if (!run('git', ['status', '--porcelain', '--', 'data', 'docs'], root).trim()) return false;
  build({ root, now });
  return true;
}

/** Stages data/ and docs/ (whichever exist) in the repo at cwd; returns the counts of what is staged. */
export function stageAndCount(cwd = ROOT) {
  run('git', ['add', ...['data', 'docs'].filter((d) => existsSync(join(cwd, d)))], cwd);
  return countsFromNumstat(run('git', ['diff', '--cached', '--numstat'], cwd));
}

async function ping(suffix = '') {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return console.log('HEALTHCHECK_URL not set; skipping ping');
  await retry(async () => {
    const res = await fetch(url + suffix, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`healthcheck ping: HTTP ${res.status}`);
  }, RETRY);
}

/** One routine run in the repo at `root`; returns the exit code. Collection, the check and the ping are injectable for tests. */
export async function main(argv, { root = ROOT, collect: collectAll = collect, check = () => run('npm', ['run', 'check:core'], root), ping: notify = ping } = {}) {
  const projects = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8'));
  const dataRoot = join(root, 'data');
  const labelsAt = argv.indexOf('--labels');
  if (labelsAt >= 0) {
    const dir = argv[labelsAt + 1];
    if (!dir) throw new Error('--labels needs a directory');
    const files = readdirSync(dir).sort().map((f) => join(dir, f));
    for (const [id, n] of Object.entries(applyLabels(files, { dataRoot, projects }))) console.log(`${id}: appended ${n} labels`);
  } else {
    await collectAll(projects, { dataRoot, seedDir: join(root, 'seed') });
    rmSync(join(root, '.routine', 'answers'), { recursive: true, force: true }); // stale answers would fail --labels
    if (prepareBatches(projects, join(root, '.routine', 'batches'), { dataRoot }).length > 0) {
      console.log('RESULT classify .routine/batches/ → .routine/answers/');
      return 3;
    }
  }

  if (!buildIfChanged({ root })) {
    console.log('RESULT unchanged');
    await notify();
    return 0;
  }
  try {
    check();
  } catch (e) {
    throw new Error(`check:core failed\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  }

  const counts = stageAndCount(root);
  run('git', ['commit', '-m', commitMessage(counts)], root);
  // Routine sessions run on a claude/… branch with no local master, so name the source.
  // The stray-branch push the session's stop hook asks for is declined in ROUTINE.md, not here.
  run('git', ['push', '-u', 'origin', 'HEAD:master'], root);
  const sha = run('git', ['rev-parse', 'HEAD'], root).trim();
  console.log(`RESULT committed ${sha} events=${counts.events} labels=${counts.labels}`);
  await notify();
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    try { await ping('/fail'); } catch (pe) { console.error(`fail ping: ${pe.message}`); }
    process.exitCode = 1;
  }
}
