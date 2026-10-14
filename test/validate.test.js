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

test('rejects fixShare null with a non-zero denominator', () => {
  const errs = violationsAfter('data/claude-code/daily.json', (rows) => { rows.find((r) => r.total > 0).fixShare = null; return rows; });
  assert.ok(errs.some((e) => /fixShare null != recomputed/.test(e)), errs.join('\n'));
});

test('rejects a numeric fixShare with a zero denominator', () => {
  const errs = violationsAfter('data/sparse/daily.json', (rows) => { rows.find((r) => r.total === 0).fixShare = 0; return rows; });
  assert.ok(errs.some((e) => /fixShare 0 != recomputed null/.test(e)), errs.join('\n'));
});

test('rejects a missing calendar day and a missing ISO week', () => {
  const day = violationsAfter('data/claude-code/daily.json', (rows) => rows.filter((r) => r.d !== '2026-07-10'));
  assert.ok(day.some((e) => /every calendar day/.test(e)), day.join('\n'));
  const week = violationsAfter('data/sparse/weekly.json', (rows) => rows.filter((r) => r.d !== '2026-08-10'));
  assert.ok(week.some((e) => /every ISO week/.test(e)), week.join('\n'));
});
