import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from '../src/hash.js';

test('textHash is the key of every stored label: a known event keeps its hash', () => {
  // A model-labelled codex event in data/: any change to the hash orphans every classification.
  assert.equal(textHash('codex', 'show feedback message after /Compact command (#2162)'), '53e2845843b627f8');
  assert.notEqual(textHash('bun', 'show feedback message after /Compact command (#2162)'), '53e2845843b627f8'); // scoped by project
});
