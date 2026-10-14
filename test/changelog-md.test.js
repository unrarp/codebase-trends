import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChangelog } from '../src/adapters/changelog-md.js';
import { textHash } from '../src/hash.js';

const md = readFileSync(new URL('./fixtures/changelog-slice.md', import.meta.url), 'utf8');
const events = parseChangelog(md, 'claude-code');
const byVersion = (v) => events.filter((e) => e.version === v);

test('header date is stripped and ids are version#index', () => {
  const e = byVersion('2.1.0');
  assert.equal(e.length, 4);
  assert.deepEqual(e.map((x) => x.id), ['2.1.0#0', '2.1.0#1', '2.1.0#2', '2.1.0#3']);
  assert.ok(events.every((x) => x.kind === 'changelog' && x.project === 'claude-code'));
});

test('[Tag] groups become lowercase tags and are stripped', () => {
  const e = events.find((x) => x.text.startsWith('Enabled session forking'));
  assert.deepEqual(e.tags, ['vscode']);
  assert.equal(e.id, '2.1.19#13');
});

test('**Bold:** lead-in is stripped', () => {
  const e = byVersion('2.1.126')[0];
  assert.ok(e.text.startsWith('Fixed `allowManagedDomainsOnly`'));
});

test('same text under two versions: two events, two ids, one textHash', () => {
  const text = 'Fixed crashes on processors without AVX instruction support';
  const dup = events.filter((e) => e.text === text);
  assert.equal(dup.length, 2);
  assert.notEqual(dup[0].id, dup[1].id);
  assert.equal(dup[0].textHash, dup[1].textHash);
  assert.equal(dup[0].textHash, textHash('claude-code', text));
});

test('regression: and pr: tags are extracted', () => {
  const reg = byVersion('2.1.299').find((e) => e.text.includes('(regression in 2.1.296)'));
  assert.deepEqual(reg.tags, ['regression:2.1.296']);
  const pr = byVersion('2.1.49')[0];
  assert.deepEqual(pr.tags, ['pr:26637']);
});

test('regression tag accepts the v-prefixed, "since" and "introduced in" forms', () => {
  // Real bullets from CHANGELOG.md.
  const slice = [
    '## 9.9.9',
    '- Fixed plugins enabled via the `--settings` CLI flag not loading (regression since v2.1.181)',
    '- Fixed stateful MCP servers without the optional GET SSE stream reconnect-looping on `tools/list` (regression in v2.1.147)',
    '- Fixed Claude Code failing to launch on macOS 12 (Monterey), a regression introduced in 2.1.255',
  ].join('\n');
  const tags = parseChangelog(slice, 'claude-code').map((e) => e.tags);
  assert.deepEqual(tags, [['regression:2.1.181'], ['regression:2.1.147'], ['regression:2.1.255']]);
});
