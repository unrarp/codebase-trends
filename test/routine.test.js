import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, appendFileSync, cpSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { prepareBatches, countsFromNumstat, commitMessage, stageAndCount, buildIfChanged } from '../src/routine.js';
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
