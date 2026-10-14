import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGitLog, shallowSince, collectGitLog } from '../src/adapters/git-log.js';
import { textHash } from '../src/hash.js';

// Real `git log --first-parent --format=GIT_LOG_FORMAT` output from oven-sh/bun (6 commits).
const raw = readFileSync(new URL('./fixtures/git-log-bun.txt', import.meta.url), 'utf8');
const events = parseGitLog(raw, 'bun');
const bySubject = (s) => events.filter((e) => e.text === s);

test('parses every record with sha id and UTC ts', () => {
  assert.equal(events.length, 6);
  const e = events.find((x) => x.sha.startsWith('d578f57'));
  assert.equal(e.id, e.sha);
  assert.equal(e.kind, 'commit');
  assert.equal(e.project, 'bun');
  assert.equal(e.ts, '2026-04-26T10:33:54.000Z'); // committer date 03:33:54-07:00
  assert.equal(e.author, 'github-actions[bot]');
  assert.equal(e.text, 'deps: update sqlite to 3.53.0 (#27912)'); // subject only, not the multi-paragraph body
});

test('Co-authored-by trailers become coauthor names', () => {
  const e = bySubject('esm bytecode (#26402)')[0];
  assert.deepEqual(e.coauthors, ['autofix-ci[bot]', 'Claude', 'Claude Bot', 'claude[bot]']);
  assert.deepEqual(events.find((x) => x.sha.startsWith('d578f57')).coauthors, ['Jarred-Sumner']);
  assert.deepEqual(bySubject('Update CLAUDE.md')[0].coauthors, []);
});

test('trailing (#n) becomes a pr tag', () => {
  assert.deepEqual(bySubject('esm bytecode (#26402)')[0].tags, ['pr:26402']);
  assert.deepEqual(bySubject('Update CLAUDE.md')[0].tags, []);
});

test('regression tag per rule 4', () => {
  const [e] = parseGitLog('abc\x1f2026-01-01T00:00:00Z\x1fa\x1fa@b\x1ffix crash, a regression introduced in v1.2.3 (#9)\x1f\x1e', 'bun');
  assert.deepEqual(e.tags, ['regression:1.2.3', 'pr:9']);
});

test('two commits sharing a subject: distinct ids, same textHash', () => {
  const [a, b] = bySubject('Update CLAUDE.md');
  assert.notEqual(a.id, b.id);
  assert.equal(a.textHash, b.textHash);
  assert.notEqual(a.textHash, bySubject('esm bytecode (#26402)')[0].textHash);
});

test('shallowSince is one day before from', () => {
  assert.equal(shallowSince('2025-01-01'), '2024-12-31T00:00:00.000Z');
  assert.equal(shallowSince('2026-06-04T16:11:01.000Z'), '2026-06-03T16:11:01.000Z');
});

const project = { id: 'bun', sources: { git: { repo: 'r', branch: 'main', since: '2026-04-26' } } };
const spy = () => {
  const calls = [];
  return { calls, fetchRaw: async (git, from) => { calls.push({ git, from }); return raw; } };
};

test('collect fetches from `since` when no events exist', async () => {
  const s = spy();
  await collectGitLog(project, [], s.fetchRaw);
  assert.equal(s.calls[0].from, '2026-04-26T00:00:00.000Z');
});

test('collect fetches from `since` even when events exist', async () => {
  // Resuming from the newest stored ts can cut off a first-parent commit whose committer date is older.
  const s = spy();
  const existing = [{ sha: 'x', ts: '2026-05-01T00:00:00.000Z' }, { sha: 'y', ts: '2026-06-01T12:00:00.000Z' }];
  await collectGitLog(project, existing, s.fetchRaw);
  assert.equal(s.calls[0].from, '2026-04-26T00:00:00.000Z');
});

test('commits with ts < since are dropped; the rest come back oldest first', async () => {
  const out = await collectGitLog(project, [], spy().fetchRaw);
  // since 2026-04-26 keeps d578f57 (04-26T10:33Z) and the two Update CLAUDE.md commits; drops the 4 older ones
  assert.equal(out.length, 3);
  assert.ok(out.every((e) => e.ts >= '2026-04-26T00:00:00.000Z'));
  assert.deepEqual(out.map((e) => e.ts), [...out.map((e) => e.ts)].sort());
});

test('shas already collected are dropped', async () => {
  const all = await collectGitLog(project, [], spy().fetchRaw);
  const out = await collectGitLog(project, [{ sha: all[0].sha, ts: all[0].ts }], spy().fetchRaw);
  assert.equal(out.length, all.length - 1);
  assert.ok(out.every((e) => e.sha !== all[0].sha));
});

test('leading [Tag] groups are stripped from the subject into lowercase tags', () => {
  const raw = readFileSync(new URL('./fixtures/git-log-codex.txt', import.meta.url), 'utf8');
  const [e] = parseGitLog(raw, 'codex');
  assert.ok(e.text.startsWith('stop printing error message'), e.text);
  assert.equal(e.textHash, textHash('codex', e.text));
  assert.ok(e.tags.includes('codex'));
});
