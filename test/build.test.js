import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, eachDay, mondayOf } from '../src/build.js';

const ROOT = fileURLToPath(new URL('./fixtures/build', import.meta.url));
const NOW = '2026-10-14T12:00:00.000Z'; // a Wednesday

const buildFixture = () => {
  const out = mkdtempSync(join(tmpdir(), 'ct-build-'));
  build({ root: ROOT, out, now: new Date(NOW) });
  return out;
};
const out = buildFixture();
const j = (rel) => JSON.parse(readFileSync(join(out, rel), 'utf8'));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test('summary: totals, versions, bySource has rule, model and pending; undated version skipped', () => {
  const s = j('data/claude-code/summary.json');
  assert.equal(s.generatedAt, NOW);
  assert.equal(s.firstDate, '2026-07-03');
  assert.equal(s.lastDate, '2026-10-14');
  assert.equal(s.totals.events, 17); // 18 raw events, 2.1.226 has no date
  assert.equal(s.totals.versions, 11);
  assert.deepEqual(s.totals.bySource, { rule: 10, model: 6, pending: 1 });
  assert.equal(s.totals.byCategory.fixed, 7);
  assert.equal(sum(Object.values(s.totals.byCategory)), 17);
  assert.deepEqual(s.busiestDay, { d: '2026-08-31', n: 4 });
  assert.equal(s.medianPerReleaseDay, 1.5); // 10 release days: 1,1,1,1,1,2,2,2,2,4
  const releases = j('data/claude-code/releases.json');
  assert.equal(releases.length, 11);
  assert.equal(releases.some((r) => r.version === '2.1.226'), false);
});

test('daily: every calendar day to today, totals add up, fixShare', () => {
  const daily = j('data/claude-code/daily.json');
  assert.deepEqual(daily.map((r) => r.d), eachDay('2026-07-03', '2026-10-14'));
  assert.equal(sum(daily.map((r) => r.total)), 17);
  const d = Object.fromEntries(daily.map((r) => [r.d, r]));
  assert.equal(d['2026-08-31'].total, 4);
  assert.equal(d['2026-08-31'].fixShare, 1);
  assert.equal(d['2026-08-19'].fixShare, 0.5); // fixed + added
  assert.equal(d['2026-10-14'].total, 0); // zero row up to today
  assert.equal(d['2026-10-14'].fixShare, null);
});

test('weekly: every ISO week keyed by Monday, totals add up', () => {
  const weekly = j('data/claude-code/weekly.json');
  assert.equal(weekly[0].d, '2026-06-29');
  assert.equal(weekly.at(-1).d, '2026-10-12');
  assert.deepEqual(weekly.map((r) => r.d), eachDay('2026-06-29', '2026-10-12', 7));
  assert.ok(weekly.every((r) => mondayOf(r.d) === r.d));
  assert.equal(sum(weekly.map((r) => r.total)), 17);
  assert.equal(weekly.find((r) => r.d === '2026-08-31').total, 7); // Mon 08-31 (4) + 09-01 (2) + Sun 09-06 (1)
});

test('sparse commits project: zero rows for gap days and weeks, UTC day shift, fixShare null and botShare', () => {
  const daily = j('data/sparse/daily.json');
  const weekly = j('data/sparse/weekly.json');
  assert.deepEqual(daily.map((r) => r.d), eachDay('2026-08-03', '2026-10-14'));
  assert.deepEqual(weekly.map((r) => r.d), eachDay('2026-08-03', '2026-10-12', 7));
  assert.equal(daily.filter((r) => r.total === 0).length, daily.length - 4); // events on 08-03, 08-04, 08-21, 09-14
  const d = Object.fromEntries(daily.map((r) => [r.d, r]));
  assert.equal(d['2026-08-03'].total, 1); // 23:30-02:00 on the 3rd is 01:30Z on the 4th
  assert.equal(d['2026-08-04'].total, 2);
  assert.equal(d['2026-08-04'].fixShare, null); // chore + docs only → denominator 0
  assert.equal(d['2026-08-05'].fixShare, null);
  assert.equal(d['2026-08-21'].fixShare, 1); // revert counts as a fix
  assert.equal(d['2026-08-21'].botShare, 1); // co-author ci[bot]
  assert.equal(d['2026-08-04'].botShare, 0.5); // robobun from config.bots
  assert.equal(d['2026-08-05'].botShare, null);
  assert.equal(weekly.find((r) => r.d === '2026-08-10').total, 0);
  const s = j('data/sparse/summary.json');
  assert.deepEqual(s.totals.bySource, { rule: 0, model: 4, pending: 1 });
  assert.equal('versions' in s.totals, false);
  assert.equal(existsSync(join(out, 'data/sparse/releases.json')), false);
});

test('month sharding: events land in their UTC month, ts-ordered, with derived fields', () => {
  const dir = join(out, 'data/claude-code/months');
  assert.deepEqual(readdirSync(dir), ['2026-07.json', '2026-08.json', '2026-09.json']);
  const aug = j('data/claude-code/months/2026-08.json');
  assert.equal(aug.length, 2 + 2 + 1 + 4); // 08-19, 08-22 (two versions), 08-27, 08-31; 2.1.226 is undated
  assert.deepEqual(aug.map((e) => e.ts), [...aug.map((e) => e.ts)].sort());
  const e = aug.find((x) => x.id === '2.1.252#0');
  assert.equal(e.category, 'fixed');
  assert.equal(e.source, 'rule');
  assert.equal(e.url, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.252');
  assert.equal('bot' in e, false);
  const sep = j('data/claude-code/months/2026-09.json');
  assert.equal(sep.find((x) => x.id === '2.1.272#0').source, 'model');
  assert.equal(j('data/claude-code/months/2026-07.json').find((x) => x.version === '2.1.201').source, 'pending');
  const c = j('data/sparse/months/2026-08.json').find((x) => x.id === 'b2');
  assert.equal(c.ts, '2026-08-04T01:30:00.000Z');
  assert.equal(c.bot, true);
  assert.equal(c.url, 'https://example.test/commit/b2');
});

test('pages for every project in config, public projects.json, annotations passthrough', () => {
  const config = JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8'));
  assert.equal(config.length, 2);
  for (const p of config) {
    const html = readFileSync(join(out, p.id, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`data-project="${p.id}"`));
    assert.match(html, new RegExp(`data-basis="${p.basis}"`));
    assert.doesNotMatch(html, /\{\{/);
    assert.doesNotMatch(html, /(?:href|src)="\//); // relative paths only
  }
  assert.ok(existsSync(join(out, 'index.html')));
  const pub = j('data/projects.json');
  assert.deepEqual(pub.map((p) => p.id), ['claude-code', 'sparse']);
  assert.equal('sources' in pub[0], false);
  assert.deepEqual(pub[1].annotations, ['openai']);
  assert.equal(j('data/annotations.json').length, 3);
});

test('a rebuild with the same now is byte-identical', () => {
  const again = buildFixture();
  for (const f of ['data/claude-code/summary.json', 'data/claude-code/daily.json', 'data/sparse/weekly.json', 'data/claude-code/months/2026-08.json']) {
    assert.equal(readFileSync(join(again, f), 'utf8'), readFileSync(join(out, f), 'utf8'));
  }
});

test('a rebuild drops month shards that no longer have events', () => {
  const again = buildFixture();
  const stale = join(again, 'data', 'claude-code', 'months', '1999-01.json');
  writeFileSync(stale, '[]\n');
  build({ root: ROOT, out: again, now: new Date(NOW) });
  assert.equal(existsSync(stale), false);
});
