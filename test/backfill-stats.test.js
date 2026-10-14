import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backfillStats } from '../scripts/backfill-stats.js';

test('backfill adds stats to commit events that lack them, keeps order, bytes and existing stats', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ct-backfill-')), 'events.jsonl');
  const before = [
    '{"id":"a","kind":"commit","sha":"a","text":"x"}',
    '{"id":"b","kind":"commit","sha":"b","text":"y","stats":{"add":9,"del":9,"files":9}}',
    '{"id":"c","kind":"commit","sha":"c","text":"z"}',
    '{"id":"v1#0","kind":"changelog","version":"1","text":"w"}',
  ].join('\n') + '\n';
  writeFileSync(path, before);
  const asked = [];
  const repo = { numstat: (shas) => { asked.push(...shas); return new Map([['a', { add: 1, del: 2, files: 1 }]]); } };
  assert.equal(backfillStats(path, repo), 1);
  assert.deepEqual(asked, ['a', 'c']); // b already has stats; the changelog event is not a commit
  const after = readFileSync(path, 'utf8').split('\n');
  assert.equal(after[0], '{"id":"a","kind":"commit","sha":"a","text":"x","stats":{"add":1,"del":2,"files":1}}');
  assert.equal(after[1], before.split('\n')[1]);
  assert.equal(after[2], before.split('\n')[2]); // c: the repo had no stats for it, left as it was
  assert.equal(after[3], before.split('\n')[3]);
  assert.equal(after.length, 5); // trailing newline kept
  assert.equal(backfillStats(path, repo), 0); // idempotent
});
