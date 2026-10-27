import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, eachDay, mondayOf } from '../src/build.ts';
import type { Annotation, CountRow, MonthEvent, ProjectConfig, ProjectEntry, Release, Summary } from '../src/types.ts';
import { tmp } from './tmp.ts';

const ROOT = fileURLToPath(new URL('./fixtures/build', import.meta.url));
const NOW = '2026-10-14T12:00:00.000Z'; // a Wednesday

const buildFixture = () => {
  const out = tmp('ct-build-');
  build({ root: ROOT, out, now: new Date(NOW) });
  return out;
};
const out = buildFixture();
const j = <T>(rel: string) => JSON.parse(readFileSync(join(out, rel), 'utf8')) as T;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Every key any of the objects carries, sorted: the stored shape is exactly what the site reads, nothing more. */
const keys = (...objs: (object | object[])[]) => [...new Set(objs.flat().flatMap((o) => Object.keys(o)))].sort();

test('summary: totals, versions, bySource has rule, model and pending; undated version skipped', () => {
  const s = j<Summary>('data/claude-code/summary.json');
  assert.equal(s.generatedAt, NOW);
  assert.equal(s.firstDate, '2026-07-03');
  assert.equal(s.lastDate, '2026-10-14');
  assert.equal(s.totals.events, 17); // 18 raw events, 2.1.226 has no date
  assert.equal(s.totals.versions, 11);
  assert.deepEqual(s.totals.bySource, { rule: 10, model: 6, pending: 1 });
  assert.equal(s.totals.byCategory.fixed, 7);
  assert.equal(sum(Object.values(s.totals.byCategory)), 17);
  assert.deepEqual(keys(s), ['basis', 'firstDate', 'generatedAt', 'lastDate', 'name', 'project', 'totals']);
  assert.deepEqual(keys(s.totals), ['byCategory', 'bySource', 'events', 'versions']);
  const releases = j<Release[]>('data/claude-code/releases.json');
  assert.equal(releases.length, 11);
  assert.equal(
    releases.some((r) => r.version === '2.1.226'),
    false,
  );
});

test('daily: every calendar day to today, totals add up, no derived ratios stored', () => {
  const daily = j<CountRow[]>('data/claude-code/daily.json');
  assert.deepEqual(
    daily.map((r) => r.d),
    eachDay('2026-07-03', '2026-10-14'),
  );
  assert.equal(sum(daily.map((r) => r.total)), 17);
  const d = Object.fromEntries(daily.map((r) => [r.d, r]));
  assert.equal(d['2026-08-31'].total, 4);
  assert.deepEqual(d['2026-08-31'].counts, { added: 0, fixed: 4, changed: 0, improved: 0, removed: 0, other: 0 });
  assert.equal(d['2026-10-14'].total, 0); // zero row up to today
  assert.deepEqual(keys(daily), ['counts', 'd', 'total']); // counts only: ratios are derived in the browser
});

test('weekly: every ISO week keyed by Monday, totals add up', () => {
  const weekly = j<CountRow[]>('data/claude-code/weekly.json');
  assert.equal(weekly[0].d, '2026-06-29');
  assert.equal(weekly.at(-1)?.d, '2026-10-12');
  assert.deepEqual(
    weekly.map((r) => r.d),
    eachDay('2026-06-29', '2026-10-12', 7),
  );
  assert.ok(weekly.every((r) => mondayOf(r.d) === r.d));
  assert.equal(sum(weekly.map((r) => r.total)), 17);
  assert.equal(weekly.find((r) => r.d === '2026-08-31')?.total, 7); // Mon 08-31 (4) + 09-01 (2) + Sun 09-06 (1)
  assert.deepEqual(keys(weekly), ['counts', 'd', 'total']); // changelog items have no size
});

test('sparse commits project: zero rows for gap days and weeks, UTC day shift', () => {
  const daily = j<CountRow[]>('data/sparse/daily.json');
  const weekly = j<CountRow[]>('data/sparse/weekly.json');
  assert.deepEqual(
    daily.map((r) => r.d),
    eachDay('2026-08-03', '2026-10-14'),
  );
  assert.deepEqual(
    weekly.map((r) => r.d),
    eachDay('2026-08-03', '2026-10-12', 7),
  );
  assert.equal(daily.filter((r) => r.total === 0).length, daily.length - 5); // events on 08-03, 08-04, 08-05, 08-21, 09-14
  const d = Object.fromEntries(daily.map((r) => [r.d, r]));
  assert.equal(d['2026-08-03'].total, 1); // 23:30-02:00 on the 3rd is 01:30Z on the 4th
  assert.equal(d['2026-08-04'].total, 2);
  assert.equal((d['2026-08-04'].counts.chore ?? 0) + (d['2026-08-04'].counts.docs ?? 0), 2); // maintenance only
  assert.equal(d['2026-08-21'].counts.revert, 1);
  assert.deepEqual(keys(daily), ['counts', 'd', 'total']); // sizes are weekly only
  assert.deepEqual(keys(weekly), ['counts', 'd', 'lines', 'total']);
  assert.equal(weekly.find((r) => r.d === '2026-08-10')?.total, 0);
  const s = j<Summary>('data/sparse/summary.json');
  assert.deepEqual(s.totals.bySource, { rule: 4, model: 1, pending: 1 }); // f6 by the feat: rule
  assert.deepEqual(keys(s.totals), ['byCategory', 'bySource', 'events']); // no versions on the commits basis
  assert.equal(existsSync(join(out, 'data/sparse/releases.json')), false);
});

test('month sharding: events land in their UTC month, ts-ordered, with derived fields', () => {
  const dir = join(out, 'data/claude-code/months');
  assert.deepEqual(readdirSync(dir), ['2026-07.json', '2026-08.json', '2026-09.json']);
  const aug = j<MonthEvent[]>('data/claude-code/months/2026-08.json');
  assert.equal(aug.length, 2 + 2 + 1 + 4); // 08-19, 08-22 (two versions), 08-27, 08-31; 2.1.226 is undated
  assert.deepEqual(
    aug.map((e) => e.ts),
    [...aug.map((e) => e.ts)].sort(),
  );
  const e = aug.find((x) => x.id === '2.1.252#0');
  assert.ok(e);
  assert.equal(e.category, 'fixed');
  assert.equal(e.source, 'rule');
  assert.equal(e.url, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.252');
  assert.equal('bot' in e, false);
  // Bullets of one version share its ts: the sort is stable, so they keep the changelog's order.
  assert.deepEqual(
    aug.filter((x) => x.version === '2.1.237').map((x) => x.id),
    ['2.1.237#0', '2.1.237#1'],
  );
  const sep = j<MonthEvent[]>('data/claude-code/months/2026-09.json');
  assert.equal(sep.find((x) => x.id === '2.1.272#0')?.source, 'model');
  assert.equal(
    j<MonthEvent[]>('data/claude-code/months/2026-07.json').find((x) => x.version === '2.1.201')?.source,
    'pending',
  );
  const sparseAug = j<MonthEvent[]>('data/sparse/months/2026-08.json');
  const c = sparseAug.find((x) => x.id === 'b2');
  assert.ok(c);
  assert.equal(c.ts, '2026-08-04T01:30:00.000Z');
  assert.equal(c.bot, true); // author in project.bots
  assert.equal(c.url, 'https://example.test/commit/b2');
  assert.equal(sparseAug.find((x) => x.id === 'd4')?.bot, true); // a co-author ending in [bot]
  assert.equal(sparseAug.find((x) => x.id === 'a1')?.bot, false);
});

test('pages for every project in config, public projects.json, annotations passthrough', () => {
  const config: ProjectConfig[] = JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8'));
  assert.equal(config.length, 2);
  for (const p of config) {
    const html = readFileSync(join(out, p.id, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`data-project="${p.id}"`));
    assert.match(html, new RegExp(`data-basis="${p.basis}"`));
    assert.doesNotMatch(html, /\{\{/);
    assert.doesNotMatch(html, /(?:href|src)="\//); // relative paths only
  }
  assert.ok(existsSync(join(out, 'index.html')));
  const pub = j<ProjectEntry[]>('data/projects.json');
  assert.deepEqual(
    pub.map((p) => p.id),
    ['claude-code', 'sparse'],
  );
  assert.equal('sources' in pub[0], false);
  assert.equal(pub[0].source, config[0].sources?.changelog); // one public URL per project, not the config's sources
  assert.equal('source' in pub[1], false); // the fixture's sparse project has none
  assert.deepEqual(pub[1].annotations, ['openai']);
  assert.equal(j<Annotation[]>('data/annotations.json').length, 2);
});

test('a rebuild with the same now is byte-identical', () => {
  const again = buildFixture();
  for (const f of [
    'data/claude-code/summary.json',
    'data/claude-code/daily.json',
    'data/sparse/weekly.json',
    'data/claude-code/months/2026-08.json',
  ]) {
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

test('commits basis: weekly rows carry the sorted add+del sizes of the counted commits that have stats', () => {
  const w = Object.fromEntries(j<CountRow[]>('data/sparse/weekly.json').map((r) => [r.d, r]));
  assert.deepEqual(w['2026-08-03'].lines, [15, 120]); // a1 fixed (120) lands before f6 added (15): sorted, not in ts order; b2 chore and c3 docs are not counted
  assert.deepEqual(w['2026-08-17'].lines, [40]); // d4 revert is counted (Removed)
  assert.deepEqual(w['2026-09-14'].lines, []); // e5 is pending → other, not counted
  assert.deepEqual(w['2026-08-10'].lines, []);
  const aug = j<MonthEvent[]>('data/sparse/months/2026-08.json');
  assert.deepEqual(aug.find((e) => e.id === 'a1')?.stats, { add: 100, del: 20, files: 4 });
  const c3 = aug.find((e) => e.id === 'c3');
  assert.ok(c3);
  assert.equal('stats' in c3, false);
});

test('asset URLs carry a content hash, so a changed script or stylesheet is refetched with the page', () => {
  const hash = (f: string) =>
    createHash('sha256')
      .update(readFileSync(join(out, f)))
      .digest('hex')
      .slice(0, 8);
  const page = readFileSync(join(out, 'claude-code/index.html'), 'utf8');
  assert.match(page, new RegExp(`href="\\.\\./app\\.css\\?v=${hash('app.css')}"`));
  assert.match(page, new RegExp(`src="\\.\\./app\\.js\\?v=${hash('app.js')}"`));
  assert.match(page, new RegExp(`src="\\.\\./vendor/chart\\.umd\\.js\\?v=${hash('vendor/chart.umd.js')}"`));
  const root = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(root, new RegExp(`href="\\./app\\.css\\?v=${hash('app.css')}"`));
  assert.match(root, new RegExp(`src="\\./app\\.js\\?v=${hash('app.js')}"`));
});
