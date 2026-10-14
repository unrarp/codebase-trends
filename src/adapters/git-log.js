import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textHash } from '../hash.js';
import { retry } from '../net.js';
import { stripTags, textTags } from './changelog-md.js';

const RETRY = { attempts: 3, delays: [2000, 5000] };
export const GIT_LOG_FORMAT = '%H%x1f%cI%x1f%an%x1f%ae%x1f%s%x1f%b%x1e';

/** `--shallow-since` value: one day before `from` (a commit ts or a `since` date), ISO UTC. */
export const shallowSince = (from) => new Date(Date.parse(from) - 86_400_000).toISOString();

/** Raw `git log --format=GIT_LOG_FORMAT` output → Event[] (git's order, newest first). */
export function parseGitLog(raw, project) {
  const events = [];
  for (const rec of raw.split('\x1e')) {
    if (!rec.trim()) continue;
    const [sha, cI, author, , subject, body = ''] = rec.replace(/^\n/, '').split('\x1f');
    const tags = [];
    const text = stripTags(subject, tags);
    tags.push(...textTags(text));
    const coauthors = [...body.matchAll(/^Co-authored-by:\s*(.+?)\s*(?:<[^>]*>)?\s*$/gim)].map((m) => m[1]);
    events.push({
      id: sha,
      textHash: textHash(project, text),
      project,
      kind: 'commit',
      sha,
      ts: new Date(cI).toISOString(),
      text,
      tags,
      author,
      coauthors,
    });
  }
  return events;
}

/** `git log --no-walk --numstat --diff-merges=first-parent --format=%x1e%H` output → Map sha → { add, del, files }.
 *  A binary row ("-\t-\tpath") counts as a file with no lines. */
export function parseNumstat(raw) {
  const stats = new Map();
  for (const rec of raw.split('\x1e')) {
    const lines = rec.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    const s = { add: 0, del: 0, files: 0 };
    for (const l of lines.slice(1)) {
      const [a, d] = l.split('\t');
      s.add += a === '-' ? 0 : Number(a);
      s.del += d === '-' ? 0 : Number(d);
      s.files++;
    }
    stats.set(lines[0].trim(), s);
  }
  return stats;
}

/** A clone on disk: the first-parent log, and per-commit numstat for given shas (any number; batched for the command line). */
export function openRepo(dir) {
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
  return {
    log: () => git(['log', '--first-parent', `--format=${GIT_LOG_FORMAT}`]),
    numstat: (shas) => {
      const stats = new Map();
      // A commit at a shallow clone's boundary has its parent cut off and would be sized against an empty tree.
      const shallowFile = git(['rev-parse', '--git-path', 'shallow']).trim();
      const boundary = new Set(existsSync(join(dir, shallowFile)) ? readFileSync(join(dir, shallowFile), 'utf8').split('\n') : []);
      shas = shas.filter((s) => !boundary.has(s));
      for (let i = 0; i < shas.length; i += 500) {
        // A merge is measured against its first parent, like the history it sits in. Blobs fetch on demand in a blobless clone.
        const raw = git(['log', '--no-walk', '--numstat', '--diff-merges=first-parent', '--format=%x1e%H', ...shas.slice(i, i + 500)]);
        for (const [sha, s] of parseNumstat(raw)) stats.set(sha, s);
      }
      return stats;
    },
  };
}

/** Clones the branch since `shallowSince(from)` into a temp dir, runs `use(openRepo(dir))`, removes the clone. */
export async function fetchGitLog(git, from, use) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-git-'));
  try {
    await retry(async () => {
      rmSync(dir, { recursive: true, force: true });
      execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', '--single-branch', '--branch', git.branch,
        `--shallow-since=${shallowSince(from)}`, git.repo, dir], { stdio: 'pipe' });
    }, RETRY);
    return await use(openRepo(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** New events for a project: the history since `since`, minus known shas, each with its diff `stats` when the repo
 *  reports them. `existing` = events already stored; `fetchRaw(git, since, use)` hands `use` an openRepo-like object. */
export async function collectGitLog(project, existing, fetchRaw = fetchGitLog) {
  const { git } = project.sources;
  const known = new Set(existing.map((e) => e.sha));
  const since = new Date(git.since).toISOString();
  return fetchRaw(git, since, async (repo) => {
    // Always from `since`: resuming from the newest stored ts could cut off a first-parent commit with an older committer date.
    const fresh = parseGitLog(repo.log(), project.id).filter((e) => !known.has(e.sha) && e.ts >= since).reverse(); // oldest first
    const stats = await retry(async () => repo.numstat(fresh.map((e) => e.sha)), RETRY); // a blobless clone fetches blobs here
    for (const e of fresh) if (stats.has(e.sha)) e.stats = stats.get(e.sha);
    return fresh;
  });
}
