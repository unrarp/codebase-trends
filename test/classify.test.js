import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyByRule, CATEGORIES, COUNTED, FIXES } from '../src/classify.js';
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

const cm = (text, project = {}) => classifyByRule({ kind: 'commit', text }, project);

const PREFIXES = { feat: 'added', fix: 'fixed', perf: 'improved', refactor: 'changed', chore: 'chore', build: 'chore', style: 'chore', test: 'test', docs: 'docs', ci: 'ci' };
for (const [prefix, category] of Object.entries(PREFIXES)) {
  for (const form of [`${prefix}: x`, `${prefix}(scope): x`, `${prefix}!: x`, `${prefix}(scope)!: x`]) {
    test(`commit "${form}" -> ${category}`, () => assert.equal(cm(form), category));
  }
}

test('commit Revert/revert -> revert, and beats first-word rules', () => {
  assert.equal(cm('Revert "fix: x"'), 'revert');
  assert.equal(cm('revert the thing'), 'revert');
  assert.equal(cm('reverted x'), 'revert');
});

test('a conventional prefix beats the first-word rule', () => {
  assert.equal(cm('docs: fix typo'), 'docs');
  assert.equal(cm('feat: remove x'), 'added');
});

test('commit first-word fallback, incl. Scope: lead-in and project synonyms', () => {
  assert.equal(cm('Fix crash in parser (#1)'), 'fixed');
  assert.equal(cm('Add --flag'), 'added');
  assert.equal(cm('Remove dead code'), 'removed');
  assert.equal(cm('Windows: Fixed a thing'), 'fixed');
  assert.equal(cm('Bump WebKit'), null);
  assert.equal(cm('bundler: do x'), null);
  assert.equal(cm('Bump WebKit', { rules: { synonyms: { bump: 'chore' } } }), 'chore');
});

test('commit rule categories stay inside CATEGORIES.commits', () => {
  const texts = [...Object.keys(PREFIXES).map((p) => `${p}: x`), 'Revert x', 'Fix x', 'Add x', 'Improve x', 'Change x', 'Remove x'];
  for (const t of texts) assert.ok(CATEGORIES.commits.includes(cm(t)), t);
});

test('COUNTED and FIXES match the site\'s GROUPS (src/site/app.js), which draws and counts the same buckets', () => {
  const app = readFileSync(new URL('../src/site/app.js', import.meta.url), 'utf8');
  const groups = [...app.match(/const GROUPS = \[\n.*?\n\];/s)[0].matchAll(/key: '(\w+)'.*?cats: \[([^\]]*)\]/g)]
    .map((m) => [m[1], [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])]);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.flatMap(([, cats]) => cats).sort(), [...COUNTED].sort());
  assert.deepEqual(groups.find(([k]) => k === 'fixed')[1].concat(['revert']).sort(), [...FIXES].sort());
  assert.ok(COUNTED.every((c) => CATEGORIES.commits.includes(c)));
});
