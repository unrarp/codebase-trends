import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchNpmTimes, parseNpmTimes } from '../src/adapters/npm-times.js';

const packument = JSON.parse(readFileSync(new URL('./fixtures/npm-time.json', import.meta.url), 'utf8'));

test('drops created/modified, keeps version → ts', () => {
  const t = parseNpmTimes(packument);
  assert.equal('created' in t, false);
  assert.equal('modified' in t, false);
  assert.equal(t['2.1.0'], '2026-01-07T02:43:04.533Z');
});

test('fetchNpmTimes requests the registry URL for the package', async () => {
  let url;
  const t = await fetchNpmTimes('@anthropic-ai/claude-code', async (u) => ((url = u), packument));
  assert.equal(url, 'https://registry.npmjs.org/@anthropic-ai/claude-code');
  assert.ok(t['2.1.299']);
});
