import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  collectGitLog,
  type fetchGitLog,
  openRepo,
  parseGitLog,
  parseNumstat,
  shallowSince,
} from '../src/adapters/git-log.ts';
import { textHash } from '../src/hash.ts';
import type { Event, GitSource, ProjectConfig } from '../src/types.ts';
import { tmp } from './tmp.ts';

// Real `git log --first-parent --format=GIT_LOG_FORMAT` output from oven-sh/bun (6 commits).
const raw = readFileSync(new URL('./fixtures/git-log-bun.txt', import.meta.url), 'utf8');
const events = parseGitLog(raw, 'bun');
const bySubject = (s: string) => events.filter((e) => e.text === s);

test('parses every record with sha id and UTC ts', () => {
  assert.equal(events.length, 6);
  const e = events.find((x) => x.sha.startsWith('d578f57'));
  assert.ok(e);
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
  assert.deepEqual(events.find((x) => x.sha.startsWith('d578f57'))?.coauthors, ['Jarred-Sumner']);
  assert.deepEqual(bySubject('Update CLAUDE.md')[0].coauthors, []);
});

test('trailing (#n) becomes a pr tag', () => {
  assert.deepEqual(bySubject('esm bytecode (#26402)')[0].tags, ['pr:26402']);
  assert.deepEqual(bySubject('Update CLAUDE.md')[0].tags, []);
});

test('commit subject: regression then pr tag, in that order', () => {
  const [e] = parseGitLog(
    'abc\x1f2026-01-01T00:00:00Z\x1fa\x1fa@b\x1ffix crash, a regression introduced in v1.2.3 (#9)\x1f\x1e',
    'bun',
  );
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

const project: ProjectConfig = {
  id: 'bun',
  name: 'Bun',
  basis: 'commits',
  sources: { git: { repo: 'r', branch: 'main', since: '2026-04-26' } },
};
const spy = () => {
  const calls: { git: GitSource; from: string }[] = [];
  const fetchRaw: typeof fetchGitLog = async (git, from, use) => {
    calls.push({ git, from });
    return use({ log: () => raw, numstat: () => new Map() });
  };
  return { calls, fetchRaw };
};
/** A stored event, reduced to the fields collectGitLog reads. */
const stored = (sha: string, ts?: string): Event => ({
  id: sha,
  textHash: 'hash',
  project: 'bun',
  kind: 'commit',
  text: '',
  tags: [],
  sha,
  ts,
});

test('collect fetches from `since`, with or without stored events', async () => {
  // Resuming from the newest stored ts can cut off a first-parent commit whose committer date is older.
  const s = spy();
  const existing = [stored('x', '2026-05-01T00:00:00.000Z'), stored('y', '2026-06-01T12:00:00.000Z')];
  await collectGitLog(project, existing, s.fetchRaw);
  await collectGitLog(project, [], s.fetchRaw);
  assert.deepEqual(
    s.calls.map((c) => c.from),
    ['2026-04-26T00:00:00.000Z', '2026-04-26T00:00:00.000Z'],
  );
});

test('commits with ts < since are dropped; the rest come back oldest first', async () => {
  const out = await collectGitLog(project, [], spy().fetchRaw);
  // since 2026-04-26 keeps d578f57 (04-26T10:33Z) and the two Update CLAUDE.md commits; drops the 4 older ones
  assert.equal(out.length, 3);
  assert.ok(out.every((e) => e.ts >= '2026-04-26T00:00:00.000Z'));
  assert.deepEqual(
    out.map((e) => e.ts),
    [...out.map((e) => e.ts)].sort(),
  );
});

test('leading [Tag] groups are stripped from the subject into lowercase tags', () => {
  const raw = readFileSync(new URL('./fixtures/git-log-codex.txt', import.meta.url), 'utf8');
  const [e] = parseGitLog(raw, 'codex');
  assert.ok(e);
  assert.ok(e.text.startsWith('stop printing error message'), e.text);
  assert.equal(e.textHash, textHash('codex', e.text));
  assert.ok(e.tags.includes('codex'));
});

// Real `git log --no-walk --numstat --diff-merges=first-parent --format=%x1e%H` output from openai/codex (4 commits).
const numstatRaw = readFileSync(new URL('./fixtures/numstat-codex.txt', import.meta.url), 'utf8');

test('parseNumstat: add, del and file count per sha; a binary file counts as a file with no lines', () => {
  const stats = parseNumstat(numstatRaw);
  assert.equal(stats.size, 4);
  assert.deepEqual(stats.get('1ffa95ee8a02ec68f6ccd758998bcb7d4b32bcdb'), { add: 20, del: 13, files: 1 });
  assert.deepEqual(stats.get('0c5720ea0fd2af84d7b6743a6686750fb8570ab7'), { add: 52, del: 157, files: 15 });
  assert.deepEqual(stats.get('2b21129c6b8120e63f9ac510fe99e8b02ef43292'), { add: 143, del: 54, files: 18 }); // one "-\t-" binary row
});

test('openRepo.numstat runs against a real repo, including a merge measured against its first parent', () => {
  const dir = tmp('ct-numstat-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'a',
        GIT_AUTHOR_EMAIL: 'a@b',
        GIT_COMMITTER_NAME: 'a',
        GIT_COMMITTER_EMAIL: 'a@b',
      },
    }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'root');
  const root = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'side');
  writeFileSync(join(dir, 'b.txt'), '1\n2\n3\n');
  git('add', 'b.txt');
  git('commit', '-q', '-m', 'side');
  git('checkout', '-q', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git('commit', '-q', '-am', 'trim');
  const trim = git('rev-parse', 'HEAD');
  git('merge', '-q', '--no-ff', '-m', 'merge', 'side');
  const merge = git('rev-parse', 'HEAD');
  const stats = openRepo(dir).numstat([root, trim, merge]);
  assert.deepEqual(stats.get(root), { add: 2, del: 0, files: 1 });
  assert.deepEqual(stats.get(trim), { add: 0, del: 1, files: 1 });
  assert.deepEqual(stats.get(merge), { add: 3, del: 0, files: 1 }); // vs first parent: only b.txt arrived
  assert.deepEqual(openRepo(dir).numstat([]), new Map());
});

test('collect asks the repo for the stats of new shas only and stores them on the events', async () => {
  const asked: string[] = [];
  const sizes = new Map([['d578f574e565ca740729abb6c7c1f6a3f02f11b1', { add: 1, del: 2, files: 3 }]]);
  const fetchRaw: typeof fetchGitLog = async (_git, _from, use) =>
    use({
      log: () => raw,
      numstat: (shas) => {
        asked.push(...shas);
        return new Map(
          shas.flatMap((s) => {
            const size = sizes.get(s);
            return size ? [[s, size] as const] : [];
          }),
        );
      },
    });
  const all = await collectGitLog(project, [], fetchRaw);
  assert.equal(all.length, 3);
  assert.deepEqual(asked.sort(), all.map((e) => e.sha).sort());
  const withStats = all.filter((e) => 'stats' in e);
  assert.equal(withStats.length, 1);
  assert.deepEqual(withStats[0]?.stats, { add: 1, del: 2, files: 3 });
  asked.length = 0;
  const out = await collectGitLog(project, [stored(all[0]?.sha ?? '')], fetchRaw);
  assert.equal(asked.length, 2); // the known sha is not measured again
  assert.ok(out.every((e) => e.sha !== all[0]?.sha));
});

test('a commit at the shallow boundary gets no stats: with its parent cut off it would be sized against an empty tree', () => {
  const src = tmp('ct-shallow-src-');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@b',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@b',
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env }).trim();
  git(src, 'init', '-q', '-b', 'main');
  writeFileSync(join(src, 'big.txt'), 'x\n'.repeat(500));
  git(src, 'add', 'big.txt');
  execFileSync('git', ['-C', src, 'commit', '-q', '-m', 'old'], {
    env: { ...env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z' },
  });
  writeFileSync(join(src, 'big.txt'), 'x\n'.repeat(501));
  execFileSync('git', ['-C', src, 'commit', '-q', '-am', 'one line'], {
    env: { ...env, GIT_COMMITTER_DATE: '2026-06-01T00:00:00Z', GIT_AUTHOR_DATE: '2026-06-01T00:00:00Z' },
  });
  writeFileSync(join(src, 'big.txt'), 'x\n'.repeat(502));
  execFileSync('git', ['-C', src, 'commit', '-q', '-am', 'another line'], {
    env: { ...env, GIT_COMMITTER_DATE: '2026-06-02T00:00:00Z', GIT_AUTHOR_DATE: '2026-06-02T00:00:00Z' },
  });
  const [newer, boundary] = git(src, 'log', '--format=%H', '-2').split('\n');
  const clone = tmp('ct-shallow-clone-');
  execFileSync('git', ['clone', '-q', '--no-checkout', '--shallow-since=2026-05-01', `file://${src}`, clone], { env }); // a plain path would not be shallow
  const stats = openRepo(clone).numstat([newer, boundary]);
  assert.deepEqual(stats.get(newer), { add: 1, del: 0, files: 1 });
  assert.equal(stats.has(boundary), false); // not { add: 501, del: 0, files: 1 }
});
