import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textHash } from '../hash.js';
import { retry } from '../net.js';
import { stripTags } from './changelog-md.js';

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
    const reg = text.match(/regression (?:introduced )?(?:in|since) v?(\d+\.\d+\.\d+)/i);
    if (reg) tags.push(`regression:${reg[1]}`);
    const pr = text.match(/\(#(\d+)\)\s*$/);
    if (pr) tags.push(`pr:${pr[1]}`);
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

/** Clones the branch since `shallowSince(from)` into a temp dir, returns raw git log output, removes the clone. */
export async function fetchGitLog(git, from) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-git-'));
  try {
    await retry(async () => {
      rmSync(dir, { recursive: true, force: true });
      execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', '--single-branch', '--branch', git.branch,
        `--shallow-since=${shallowSince(from)}`, git.repo, dir], { stdio: 'pipe' });
    }, RETRY);
    return execFileSync('git', ['-C', dir, 'log', '--first-parent', `--format=${GIT_LOG_FORMAT}`],
      { encoding: 'utf8', maxBuffer: 1 << 30 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** New events for a project: the history since `since`, minus known shas. `existing` = events already stored. */
export async function collectGitLog(project, existing, fetchRaw = fetchGitLog) {
  const { git } = project.sources;
  const known = new Set(existing.map((e) => e.sha));
  const since = new Date(git.since).toISOString();
  // Always from `since`: resuming from the newest stored ts could cut off a first-parent commit with an older committer date.
  return parseGitLog(await fetchRaw(git, since), project.id)
    .filter((e) => !known.has(e.sha) && e.ts >= since)
    .reverse(); // oldest first
}
