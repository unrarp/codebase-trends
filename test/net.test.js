import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/net.js';

const opts = { attempts: 3, delays: [1, 1] };

test('retry returns the first success after transient failures', async () => {
  let calls = 0;
  const v = await retry(async () => {
    if (++calls < 3) throw new Error('flaky');
    return 'ok';
  }, opts);
  assert.equal(v, 'ok');
  assert.equal(calls, 3);
});

test('retry rethrows the last error after `attempts` tries', async () => {
  let calls = 0;
  await assert.rejects(retry(async () => { throw new Error(`fail ${++calls}`); }, opts), /fail 3/);
  assert.equal(calls, 3);
});
