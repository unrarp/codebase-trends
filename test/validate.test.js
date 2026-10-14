import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.js';
import { validate } from '../src/validate.js';

const ROOT = fileURLToPath(new URL('./fixtures/build', import.meta.url));
const good = mkdtempSync(join(tmpdir(), 'ct-val-'));
build({ root: ROOT, out: good, now: new Date('2026-10-14T12:00:00Z') });

/** Copies the good build, applies `edit(json)` to one data file, returns the violations. */
function violationsAfter(rel, edit) {
  const out = mkdtempSync(join(tmpdir(), 'ct-bad-'));
  cpSync(good, out, { recursive: true });
  const f = join(out, rel);
  writeFileSync(f, JSON.stringify(edit(JSON.parse(readFileSync(f, 'utf8')))));
  return validate(out);
}

test('a good build passes', () => assert.deepEqual(validate(good), []));

test('rejects an event without a ts', () => {
  const errs = violationsAfter('data/claude-code/months/2026-08.json', (evs) => { delete evs[0].ts; return evs; });
  assert.ok(errs.some((e) => /without a valid ts/.test(e)), errs.join('\n'));
});

test('rejects Σ daily.total != summary.totals.events', () => {
  const errs = violationsAfter('data/claude-code/summary.json', (s) => { s.totals.events += 1; return s; });
  assert.ok(errs.some((e) => /daily\.json: Σ total/.test(e)), errs.join('\n'));
});

test('rejects a missing calendar day and a missing ISO week', () => {
  const day = violationsAfter('data/claude-code/daily.json', (rows) => rows.filter((r) => r.d !== '2026-07-10'));
  assert.ok(day.some((e) => /every calendar day/.test(e)), day.join('\n'));
  const week = violationsAfter('data/sparse/weekly.json', (rows) => rows.filter((r) => r.d !== '2026-08-10'));
  assert.ok(week.some((e) => /every ISO week/.test(e)), week.join('\n'));
});

test('rejects an annotation whose major flag is not a boolean', () => {
  const errs = violationsAfter('data/annotations.json', (ann) => { ann[0].major = 'yes'; return ann; });
  assert.ok(errs.some((e) => /annotations\.json: bad entry/.test(e)), errs.join('\n'));
});

test('commits basis: weekly lines.fixed must be sorted non-negative integers, no more than the row has fixes', () => {
  const unsorted = violationsAfter('data/sparse/weekly.json', (rows) => { rows[0].lines.fixed = [15, 3]; rows[0].counts.fixed = 2; return rows; });
  assert.ok(unsorted.some((e) => /lines/.test(e)), unsorted.join('\n'));
  const extraKey = violationsAfter('data/sparse/weekly.json', (rows) => { rows[0].lines.all = [15]; return rows; });
  assert.ok(extraKey.some((e) => /lines/.test(e)), extraKey.join('\n'));
  assert.ok(unsorted.some((e) => /lines/.test(e)), unsorted.join('\n'));
  const negative = violationsAfter('data/sparse/weekly.json', (rows) => { rows[0].lines.fixed = [-1]; return rows; });
  assert.ok(negative.some((e) => /lines/.test(e)), negative.join('\n'));
  const tooMany = violationsAfter('data/sparse/weekly.json', (rows) => { rows[0].lines.fixed = [15, 15]; return rows; });
  assert.ok(tooMany.some((e) => /lines/.test(e)), tooMany.join('\n'));
  const missing = violationsAfter('data/sparse/weekly.json', (rows) => { delete rows[0].lines; return rows; });
  assert.ok(missing.some((e) => /lines/.test(e)), missing.join('\n'));
  const onChangelog = violationsAfter('data/claude-code/weekly.json', (rows) => { rows[0].lines = { fixed: [] }; return rows; });
  assert.ok(onChangelog.some((e) => /lines/.test(e)), onChangelog.join('\n'));
  const badStats = violationsAfter('data/sparse/months/2026-08.json', (evs) => { evs[0].stats = { add: 1 }; return evs; });
  assert.ok(badStats.some((e) => /stats/.test(e)), badStats.join('\n'));
});
