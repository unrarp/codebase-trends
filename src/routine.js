import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collect } from './collect.js';
import { applyLabels, writeBatches } from './apply-labels.js';
import { retry } from './net.js';
import { readJsonl } from './store.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RETRY = { attempts: 3, delays: [2000, 5000] };

/** Projects whose pending.jsonl has at least one entry. */
export function projectsWithPending(projects, { dataRoot = join(ROOT, 'data') } = {}) {
  return projects.filter((p) => readJsonl(join(dataRoot, p.id, 'pending.jsonl')).length > 0);
}

/** Empties batchesDir, then writes batch files for every project with pending; returns the paths. */
export function prepareBatches(projects, batchesDir, { dataRoot = join(ROOT, 'data') } = {}) {
  rmSync(batchesDir, { recursive: true, force: true });
  return projectsWithPending(projects, { dataRoot }).flatMap((p) => writeBatches(p, batchesDir, { dataRoot }));
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

async function main(argv) {
  const projects = JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8'));
  const labelsAt = argv.indexOf('--labels');
  if (labelsAt >= 0) {
    const dir = argv[labelsAt + 1];
    if (!dir) throw new Error('--labels needs a directory');
    const files = readdirSync(dir).sort().map((f) => join(dir, f));
    for (const [id, n] of Object.entries(applyLabels(files))) console.log(`${id}: appended ${n} labels`);
  } else {
    await collect(projects);
    rmSync(join(ROOT, '.routine', 'answers'), { recursive: true, force: true }); // stale answers would fail --labels
    if (prepareBatches(projects, join(ROOT, '.routine', 'batches')).length > 0) {
      console.log('RESULT classify .routine/batches/ → .routine/answers/');
      return 3;
    }
  }

  for (const script of ['build', 'check:core']) {
    try {
      run('npm', ['run', script]);
    } catch (e) {
      throw new Error(`${script} failed\n${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  }

  const counts = stageAndCount();
  run('git', ['commit', '--allow-empty', '-m', commitMessage(counts)]);
  run('git', ['push', '-u', 'origin', 'HEAD:master']);
  const sha = run('git', ['rev-parse', 'HEAD']).trim();
  console.log(`RESULT committed ${sha} events=${counts.events} labels=${counts.labels}`);
  await ping();
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
