import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from '../src/collect.js';
import { fileURLToPath } from 'node:url';
import { tmp } from './tmp.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const SEED = fileURLToPath(new URL('../seed/', import.meta.url));
const project = JSON.parse(fx('../../projects.json'))[0];
const slice = fx('changelog-slice.md');
const extra = fx('changelog-extra.md');
const packument = JSON.parse(fx('npm-time.json'));

const run = async (md, dataRoot, seedDir = SEED) => {
  const net = { fetchText: async () => md, fetchJson: async () => packument };
  await collect([project], { dataRoot, seedDir, net });
  const f = (n) => { try { return readFileSync(join(dataRoot, 'claude-code', n), 'utf8'); } catch { return ''; } };
  return { events: f('events.jsonl'), dates: JSON.parse(f('dates.json')) };
};
const lines = (s) => s.split('\n').filter(Boolean);

test('dates = npm ∪ seed, without created/modified', async () => {
  const { dates } = await run(slice + extra, tmp('ct-'));
  assert.equal(dates['2.1.299'], packument.time['2.1.299']); // npm
  assert.equal(dates['2.1.43'], '2026-02-16T21:34:15.000Z'); // seed only: not on npm
  assert.equal('created' in dates, false);
  assert.equal('modified' in dates, false);
});

test('a changelog project without a seed file takes its dates from npm alone', async () => {
  const { dates } = await run(slice + extra, tmp('ct-'), tmp('ct-seed-'));
  assert.deepEqual(dates, Object.fromEntries(Object.entries(packument.time).filter(([k]) => k !== 'created' && k !== 'modified')));
});

test('re-running on identical input appends nothing', async () => {
  const root = tmp('ct-');
  const a = await run(slice + extra, root);
  const b = await run(slice + extra, root);
  assert.ok(lines(a.events).length > 0);
  assert.equal(b.events, a.events);
});

test('a bullet edited or inserted under a collected version appends nothing', async () => {
  const root = tmp('ct-');
  const a = await run(slice, root);
  const edited = slice.replace('## 2.1.126\n', '## 2.1.126\n\n- Added a brand new bullet');
  const b = await run(edited, root);
  assert.equal(b.events, a.events);
});

test('a new version at the top is appended, existing ones are not', async () => {
  const root = tmp('ct-');
  const a = await run(slice, root);
  const b = await run(slice.replace('## 2.1.299', '## 2.1.300\n\n- Fixed a thing\n\n## 2.1.299'), root);
  const added = lines(b.events).slice(lines(a.events).length).map((l) => JSON.parse(l));
  assert.deepEqual(added.map((e) => e.id), ['2.1.300#0']);
  assert.ok(b.events.startsWith(a.events));
});

test('commits basis: collect appends parsed commits', async () => {
  const dataRoot = tmp('ct-');
  const bun = { id: 'bun', basis: 'commits', sources: { git: { repo: 'r', branch: 'main', since: '2025-01-01' } } };
  const net = { gitLog: async (git, from, use) => use({ log: () => fx('git-log-bun.txt'), numstat: (shas) => new Map(shas.map((s) => [s, { add: 1, del: 0, files: 1 }])) }) };
  await collect([bun], { dataRoot, net });
  const events = lines(readFileSync(join(dataRoot, 'bun', 'events.jsonl'), 'utf8')).map((l) => JSON.parse(l));
  assert.equal(events.length, 6);
  assert.ok(events.every((e) => e.kind === 'commit' && e.sha === e.id));
  assert.ok(events.every((e) => e.stats.add === 1 && e.stats.files === 1)); // stats stored on the raw event
  await collect([bun], { dataRoot, net });
  assert.equal(lines(readFileSync(join(dataRoot, 'bun', 'events.jsonl'), 'utf8')).length, 6); // known shas skipped
});
