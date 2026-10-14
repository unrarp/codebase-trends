// Phase 0 cloud-environment probe: checks the network and git access the
// routine needs and records the results in data/heartbeat.json. A failing
// probe is recorded, not thrown.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function httpGet(url) {
  if (!url) throw new Error('URL unset');
  let res, body;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    body = await res.arrayBuffer();
  } catch (err) {
    // fetch messages can echo the URL; the healthcheck URL must stay private.
    throw new Error(err.cause?.code ?? err.name);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `HTTP ${res.status}, ${body.byteLength} bytes`;
}

async function gitClone() {
  const dir = await mkdtemp(join(tmpdir(), 'probe-'));
  try {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await run('git', ['clone', '--filter=blob:none', '--no-checkout', '--single-branch',
      `--shallow-since=${yesterday}`, 'https://github.com/oven-sh/bun', dir], { timeout: 120_000 });
    const { stdout } = await run('git', ['-C', dir, 'rev-list', '--count', 'HEAD']);
    return `${stdout.trim()} commits since ${yesterday}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const probes = {
  npm: () => httpGet('https://registry.npmjs.org/@anthropic-ai/claude-code'),
  changelog: () => httpGet('https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md'),
  // The ping URL is private; only the status reaches heartbeat.json.
  healthcheck: () => httpGet(process.env.HEALTHCHECK_URL),
  gitClone,
};

const results = {};
for (const [name, fn] of Object.entries(probes)) {
  const start = Date.now();
  try {
    const detail = await fn();
    results[name] = { ok: true, ms: Date.now() - start, detail };
  } catch (err) {
    results[name] = { ok: false, ms: Date.now() - start, detail: String(err.message ?? err) };
  }
}

const heartbeat = { ts: new Date().toISOString(), probes: results };
await mkdir('data', { recursive: true });
await writeFile('data/heartbeat.json', JSON.stringify(heartbeat, null, 2) + '\n');
console.log(JSON.stringify(heartbeat, null, 2));
