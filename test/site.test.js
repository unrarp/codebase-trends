import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = new URL('../src/site/app.js', import.meta.url);

test('app.js paints no colour of its own outside GROUPS: the rest are light-dark() pairs in app.css, read with css()', () => {
  const code = readFileSync(APP, 'utf8')
    .replace(/const GROUPS = \[[\s\S]*?\];/, '') // the bucket colours serve both schemes
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // comments may quote colours
  assert.deepEqual(code.match(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/gi) ?? [], []);
});
