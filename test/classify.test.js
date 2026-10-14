import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByRule } from '../src/classify.js';
import { parseChangelog } from '../src/adapters/changelog-md.js';

const ev = (text) => ({ kind: 'changelog', text });

const table = {
  fix: 'fixed', fixes: 'fixed', fixed: 'fixed',
  add: 'added', adds: 'added', added: 'added', new: 'added',
  improve: 'improved', improves: 'improved', improved: 'improved', reduced: 'improved', faster: 'improved',
  change: 'changed', changed: 'changed', update: 'changed', updated: 'changed',
  remove: 'removed', removes: 'removed', removed: 'removed', deprecated: 'removed',
};

for (const [word, category] of Object.entries(table)) {
  test(`changelog first word "${word}" -> ${category}`, () => {
    assert.equal(classifyByRule(ev(`${word} something`), {}), category);
  });
}

test('case and trailing :, are normalised', () => {
  assert.equal(classifyByRule(ev('Fixed: a thing'), {}), 'fixed');
  assert.equal(classifyByRule(ev('ADDED, a thing'), {}), 'added');
});

test('residual -> null', () => {
  assert.equal(classifyByRule(ev('Bug fixes and reliability improvements'), {}), null);
  assert.equal(classifyByRule(ev('constructor thing'), {}), null);
});

test('per-project synonyms extend the map', () => {
  const project = { rules: { synonyms: { bugfixes: 'fixed' } } };
  assert.equal(classifyByRule(ev('Bugfixes, UI polish'), project), 'fixed');
  assert.equal(classifyByRule(ev('Bugfixes, UI polish'), {}), null);
  assert.equal(classifyByRule(ev('Fixed x'), project), 'fixed');
});

test('a leading "Scope:" lead-in is skipped to find the first word', () => {
  // Real bullets from CHANGELOG.md.
  const md = [
    '## 9.9.9',
    '- Windows: Fixed console windows flashing when spawning child processes',
    '- VSCode: Added effort level indicator on the input border',
    '- Self-hosted runner: Improved startup time',
    '- IDE: Various improvements and bug fixes',
  ].join('\n');
  const got = parseChangelog(md, 'claude-code').map((e) => classifyByRule(e, {}));
  assert.deepEqual(got, ['fixed', 'added', 'improved', null]);
});
