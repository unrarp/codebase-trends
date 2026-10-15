import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyLabels, pendingOf, writeBatches, MODEL } from '../src/apply-labels.js';
import { CATEGORIES } from '../src/classify.js';
import { tmp } from './tmp.js';

const projects = [{ id: 'p', basis: 'changelog' }, { id: 'q', basis: 'changelog' }];
const H = (n) => String(n).padStart(16, '0');

function setup(pendingByProject = { p: [1, 2, 3], q: [4] }) {
  const root = tmp('labels-');
  const dataRoot = join(root, 'data');
  for (const [id, hs] of Object.entries(pendingByProject)) {
    mkdirSync(join(dataRoot, id), { recursive: true });
    writeFileSync(join(dataRoot, id, 'events.jsonl'), hs.map((h) => JSON.stringify({ id: `v#${h}`, textHash: H(h), kind: 'changelog', text: `t${h}` }) + '\n').join('')); // 't1' has no rule
  }
  const answer = (name, text) => { const f = join(root, name); writeFileSync(f, text); return f; };
  const labels = (id) => join(dataRoot, id, 'classifications.jsonl');
  return { dataRoot, answer, labels, apply: (files, o = {}) => applyLabels(files, { dataRoot, projects, ...o }) };
}

test('appends labels stamped with model and ts', () => {
  const t = setup();
  const counts = t.apply([t.answer('p-1.txt', `${H(1)}: fixed\n\n${H(2)}: added\n`)], { now: () => 'NOW' });
  assert.deepEqual(counts, { p: 2 });
  const rows = readFileSync(t.labels('p'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows, [
    { textHash: H(1), category: 'fixed', model: MODEL, ts: 'NOW' },
    { textHash: H(2), category: 'added', model: MODEL, ts: 'NOW' },
  ]);
  assert.equal(MODEL, 'claude-sonnet-5-5');
});

for (const [name, line, reason] of [
  ['an unknown hash', `${H(9)}: fixed`, /hash not pending/],
  ['an out-of-set category', `${H(1)}: revert`, /category not in changelog set/],
  ['a malformed line', `${H(1)} fixed`, /malformed line/],
]) {
  test(`rejects ${name}, appending nothing`, () => {
    const t = setup();
    assert.throws(() => t.apply([t.answer('p-1.txt', `${H(2)}: fixed\n${line}\n`)]), (e) => reason.test(e.message) && /p-1\.txt:2/.test(e.message));
    assert.equal(existsSync(t.labels('p')), false);
  });

  test(`rejects ${name} in the second file, appending nothing from the first`, () => {
    const t = setup();
    const good = t.answer('p-1.txt', `${H(2)}: fixed\n`);
    const bad = t.answer('q-1.txt', `${line.replace(H(1), H(4))}\n`);
    assert.throws(() => t.apply([good, bad]), (e) => reason.test(e.message) && /q-1\.txt:1/.test(e.message));
    assert.equal(existsSync(t.labels('p')), false);
    assert.equal(existsSync(t.labels('q')), false);
  });
}

test('an already-labelled hash is no longer pending, so an answer for it is rejected; duplicate answers count once', () => {
  const t = setup();
  writeFileSync(t.labels('p'), JSON.stringify({ textHash: H(1), category: 'added', model: 'x', ts: 'old' }) + '\n');
  assert.throws(() => t.apply([t.answer('p-1.txt', `${H(1)}: fixed\n`)]), /hash not pending/);
  const counts = t.apply([t.answer('p-1.txt', `${H(2)}: fixed\n`), t.answer('p-2.txt', `${H(2)}: changed\n`)]);
  assert.deepEqual(counts, { p: 1 });
  const rows = readFileSync(t.labels('p'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.textHash, r.category]), [[H(1), 'added'], [H(2), 'fixed']]);
});

test('commits basis allows the extra categories', () => {
  assert.ok(CATEGORIES.commits.includes('revert') && !CATEGORIES.changelog.includes('revert'));
});

test('writeBatches: ≤50 per file, header, every pending hash exactly once', () => {
  const hs = Array.from({ length: 120 }, (_, i) => i + 1);
  const t = setup({ p: hs });
  const dir = join(t.dataRoot, '..', 'batches');
  const paths = writeBatches({ id: 'p', basis: 'changelog' }, dir, { dataRoot: t.dataRoot });
  assert.deepEqual(readdirSync(dir).sort(), ['p-1.txt', 'p-2.txt', 'p-3.txt']);
  assert.equal(paths.length, 3);
  const seen = [];
  for (const p of paths) {
    const [header, ...lines] = readFileSync(p, 'utf8').trim().split('\n');
    assert.equal(header, `# project: p basis: changelog categories: ${CATEGORIES.changelog.join(' ')}`);
    assert.ok(lines.length <= 50);
    for (const l of lines) seen.push(l.split('\t')[0]);
  }
  assert.deepEqual(seen.sort(), hs.map(H));
});

test('pendingOf = rule-null events without a classification, one per textHash, through the changelog parser', async () => {
  const { collect } = await import('../src/collect.js');
  const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
  const project = JSON.parse(fx('../../projects.json'))[0];
  const dataRoot = join(tmp('pending-'), 'data');
  const net = { fetchText: async () => fx('changelog-slice.md') + fx('changelog-extra.md'), fetchJson: async () => JSON.parse(fx('npm-time.json')) };
  await collect([project], { dataRoot, seedDir: new URL('../seed/', import.meta.url).pathname, net });
  // 2.1.19#13 and the "Internal infrastructure" bullet (under two versions) have no rule category.
  const p = pendingOf(project, { dataRoot });
  assert.deepEqual(p.map((x) => x.text).sort(), [
    'Enabled session forking and rewind functionality for all users',
    'Internal infrastructure improvements (no user-facing changes)',
  ]);
  const hash = p.find((x) => x.text.startsWith('Enabled')).textHash;
  writeFileSync(join(dataRoot, 'claude-code', 'classifications.jsonl'), JSON.stringify({ textHash: hash, category: 'added', model: 'm', ts: '2026-10-14T00:00:00Z' }) + '\n');
  assert.deepEqual(pendingOf(project, { dataRoot }).map((x) => x.text), ['Internal infrastructure improvements (no user-facing changes)']);
});
