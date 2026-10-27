import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const SITE = new URL('../src/site/', import.meta.url);
const modules = readdirSync(SITE).filter((f) => f.endsWith('.ts'));

test('the site modules paint no colour of their own outside GROUPS: the rest are light-dark() pairs in app.css, read with css()', () => {
  const found = modules.flatMap((f) => {
    const code = readFileSync(new URL(f, SITE), 'utf8')
      .replace(/const GROUPS\b[^=]*= \[[\s\S]*?\];/, '') // the bucket colours serve both schemes
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, ''); // comments may quote colours
    return (code.match(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/gi) ?? []).map((c) => `${f}: ${c}`);
  });
  assert.ok(modules.includes('groups.ts') && modules.includes('chart.ts'), modules.join(', '));
  assert.deepEqual(found, []);
});
