import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, appendFileSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { prepareBatches, countsFromNumstat, commitMessage, stageAndCount, buildIfChanged, main } from '../src/routine.js';
import { build } from '../src/build.js';
import { tmp } from './tmp.js';

const projects = [{ id: 'p', basis: 'changelog' }, { id: 'q', basis: 'changelog' }, { id: 'r', basis: 'changelog' }];
const H = (n) => String(n).padStart(16, '0');
const eventLines = (hs) => hs.map((h) => JSON.stringify({ id: `v#${h}`, textHash: H(h), kind: 'changelog', text: `t${h}` }) + '\n').join(''); // 't1' has no rule

function dataTree(pendingByProject) {
  const root = tmp('routine-');
  const dataRoot = join(root, 'data');
  for (const [id, hs] of Object.entries(pendingByProject)) {
    mkdirSync(join(dataRoot, id), { recursive: true });
    writeFileSync(join(dataRoot, id, 'events.jsonl'), eventLines(hs));
  }
  return { root, dataRoot };
}

test('only projects with pending get batch files', () => {
  const { root, dataRoot } = dataTree({ p: [1, 2], q: [], /* r: no file */ });
  const dir = join(root, 'batches');
  mkdirSync(dir);
  writeFileSync(join(dir, 'stale-1.txt'), 'old');
  const paths = prepareBatches(projects, dir, { dataRoot });
  assert.deepEqual(readdirSync(dir), ['p-1.txt']);
  assert.equal(paths.length, 1);
});

test('batches across two projects, split at 50', () => {
  const { root, dataRoot } = dataTree({ p: Array.from({ length: 51 }, (_, i) => i + 1), q: [100] });
  const dir = join(root, 'batches');
  prepareBatches(projects, dir, { dataRoot });
  assert.deepEqual(readdirSync(dir).sort(), ['p-1.txt', 'p-2.txt', 'q-1.txt']);
});

test('no pending anywhere writes no batches', () => {
  const { root, dataRoot } = dataTree({ p: [], q: [] });
  assert.deepEqual(prepareBatches(projects, join(root, 'batches'), { dataRoot }), []);
});

const NUMSTAT = [
  '12\t0\tdata/p/events.jsonl',
  '3\t1\tdata/p/dates.json',
  '5\t0\tdata/p/classifications.jsonl',
  '0\t0\tdata/q/events.jsonl',
  '2\t0\tdata/r/classifications.jsonl',
  '-\t-\tdocs/vendor/x.bin',
  '40\t2\tdocs/data/p/summary.json',
  '',
].join('\n');

test('counts and message derive from numstat text', () => {
  const c = countsFromNumstat(NUMSTAT);
  assert.deepEqual(c, { events: 12, labels: 7, projects: ['p', 'r'] });
  assert.equal(commitMessage(c), 'data: p, r +12 events, +7 labels');
  assert.equal(commitMessage(countsFromNumstat('')), 'data: no changes +0 events, +0 labels');
});

test('change detection on a temp git repo', () => {
  const root = tmp('routine-git-');
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, encoding: 'utf8' });
  mkdirSync(join(root, 'data', 'p'), { recursive: true });
  writeFileSync(join(root, 'data', 'p', 'events.jsonl'), '{"a":1}\n{"a":2}\n');
  writeFileSync(join(root, 'data', 'p', 'classifications.jsonl'), '{"c":1}\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  assert.deepEqual(stageAndCount(root), { events: 0, labels: 0, projects: [] }); // no docs dir: must not fail
  appendFileSync(join(root, 'data', 'p', 'events.jsonl'), '{"a":3}\n{"a":4}\n{"a":5}\n');
  appendFileSync(join(root, 'data', 'p', 'classifications.jsonl'), '{"c":2}\n');
  mkdirSync(join(root, 'data', 'q'));
  writeFileSync(join(root, 'data', 'q', 'events.jsonl'), '{"b":1}\n'); // new untracked file counts too
  const c = stageAndCount(root);
  assert.deepEqual(c, { events: 4, labels: 1, projects: ['p', 'q'] });
  assert.equal(commitMessage(c), 'data: p, q +4 events, +1 labels');
});

test('buildIfChanged: an unchanged build keeps the committed generatedAt and reports false; new data rebuilds stamped now', () => {
  const root = tmp('routine-build-');
  cpSync(new URL('./fixtures/build/', import.meta.url), root, { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, encoding: 'utf8' });
  const generatedAt = () => JSON.parse(readFileSync(join(root, 'docs', 'data', 'claude-code', 'summary.json'), 'utf8')).generatedAt;
  const T0 = '2026-10-14T12:00:00.000Z';
  const T1 = '2026-10-14T13:00:00.000Z';
  build({ root, now: new Date(T0) });
  git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'init');
  assert.equal(buildIfChanged({ root, now: new Date(T1) }), false);
  assert.equal(generatedAt(), T0); // the site still says T0: nothing new to publish
  assert.equal(git('status', '--porcelain', '--', 'data', 'docs').trim(), '');
  appendFileSync(join(root, 'data', 'sparse', 'events.jsonl'), JSON.stringify({ id: 'x', textHash: '0000000000000000', project: 'sparse', kind: 'commit', sha: 'x', ts: '2026-10-13T10:00:00Z', text: 'feat: x', tags: [] }) + '\n');
  assert.equal(buildIfChanged({ root, now: new Date(T1) }), true);
  assert.equal(generatedAt(), T1);
});

// A committed fixture repo with a bare `origin`, as the routine finds its checkout; its own hooks only.
function routineRepo() {
  const root = tmp('routine-main-');
  cpSync(new URL('./fixtures/build/', import.meta.url), root, { recursive: true });
  build({ root, now: new Date('2026-10-14T12:00:00.000Z') });
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['core.hooksPath', join(root, '.git', 'no-hooks')]]) git('config', k, v);
  git('add', '.'); git('commit', '-q', '-m', 'init');
  const remote = tmp('routine-origin-');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git('remote', 'add', 'origin', remote);
  const calls = [];
  const collected = [];
  const deps = { root, collect: async (projects, opts) => { calls.push('collect'); collected.push(opts); }, check: () => { calls.push('check'); }, ping: async () => { calls.push('ping'); } };
  const origin = (...a) => execFileSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).trim();
  return { root, git, origin, calls, collected, deps };
}
/** Silences console.log for the test; the returned function lists what was logged so far. */
const logs = (t) => { const m = t.mock.method(console, 'log', () => {}); return () => m.mock.calls.map((c) => c.arguments[0]); };
/** Answers every batch line of the last classify hand-off: changelog items `added`, commits `fixed`. */
function answerBatches(root) {
  const answers = join(root, '.routine', 'answers');
  mkdirSync(answers, { recursive: true });
  for (const f of readdirSync(join(root, '.routine', 'batches'))) {
    const hashes = readFileSync(join(root, '.routine', 'batches', f), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]);
    writeFileSync(join(answers, f), hashes.map((h) => `${h}: ${f.startsWith('sparse') ? 'fixed' : 'added'}\n`).join(''));
  }
  return answers;
}

test('main with items to label: writes the batches, clears stale answers, exits 3 and commits nothing', async (t) => {
  const r = routineRepo();
  mkdirSync(join(r.root, '.routine', 'answers'), { recursive: true });
  writeFileSync(join(r.root, '.routine', 'answers', 'claude-code-9.txt'), 'stale');
  const head = r.git('rev-parse', 'HEAD');
  const out = logs(t);
  assert.equal(await main([], r.deps), 3);
  assert.deepEqual(readdirSync(join(r.root, '.routine', 'batches')).sort(), ['claude-code-1.txt', 'sparse-1.txt']); // each fixture project has one pending item
  assert.equal(existsSync(join(r.root, '.routine', 'answers')), false);
  assert.equal(out().at(-1), 'RESULT classify .routine/batches/ → .routine/answers/');
  assert.deepEqual(r.calls, ['collect']);
  assert.deepEqual(r.collected, [{ dataRoot: join(r.root, 'data'), seedDir: join(r.root, 'seed') }]); // the checkout's data, not this repo's
  assert.equal(r.git('rev-parse', 'HEAD'), head);
});

test('main --labels: appends the answers, checks, commits and pushes to master, then pings; the next run is unchanged', async (t) => {
  const r = routineRepo();
  const out = logs(t);
  await main([], r.deps);
  const answers = answerBatches(r.root);
  r.calls.length = 0;
  assert.equal(await main(['--labels', answers], r.deps), 0);
  assert.deepEqual(r.calls, ['check', 'ping']);
  const sha = r.git('rev-parse', 'HEAD');
  assert.equal(r.origin('rev-parse', 'master'), sha); // pushed from a branch that is not master
  assert.equal(r.origin('log', '-1', '--format=%s', 'master'), 'data: claude-code, sparse +0 events, +2 labels');
  assert.equal(out().at(-1), `RESULT committed ${sha} events=0 labels=2`);
  assert.equal(r.git('status', '--porcelain', '--', 'data', 'docs'), '');

  r.calls.length = 0;
  assert.equal(await main([], r.deps), 0); // nothing new: no batches, no build change, no commit
  assert.deepEqual(r.calls, ['collect', 'ping']);
  assert.equal(out().at(-1), 'RESULT unchanged');
  assert.equal(r.origin('rev-parse', 'master'), sha);
});

test('main stops before committing when check:core fails, and reports its output', async (t) => {
  const r = routineRepo();
  logs(t);
  await main([], r.deps);
  const answers = answerBatches(r.root);
  const head = r.git('rev-parse', 'HEAD');
  r.calls.length = 0;
  const check = () => { throw Object.assign(new Error('exit 1'), { stdout: 'not ok 1 - x\n', stderr: '' }); };
  await assert.rejects(main(['--labels', answers], { ...r.deps, check }), /^Error: check:core failed\nnot ok 1 - x/);
  assert.equal(r.git('rev-parse', 'HEAD'), head);
  assert.equal(r.origin('branch', '--list'), ''); // nothing pushed
  assert.deepEqual(r.calls, []); // no success ping: the CLI pings /fail on the throw
});
