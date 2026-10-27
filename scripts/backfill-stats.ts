// One-off: add diff `stats` to commit events collected before stats were recorded.
//   node scripts/backfill-stats.ts <project-id> <clone-dir>
// <clone-dir> is a clone of the project's repo with every blob (a full `git clone --no-checkout`); the blobless
// clone the routine uses would fetch each blob on demand. Rewrites data/<project-id>/events.jsonl in place, keeping
// line order and leaving events that already have stats untouched.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepo, type Repo } from '../src/adapters/git-log.ts';
import type { CommitEvent, Event } from '../src/types.ts';

/** Adds `stats` from `repo.numstat` to the commit events in `eventsPath` that lack them; returns how many gained stats. */
export function backfillStats(eventsPath: string, repo: Repo): number {
  const lines = readFileSync(eventsPath, 'utf8').split('\n');
  const events = lines.map((l) => (l ? (JSON.parse(l) as Event) : null));
  const todo = events.filter((e): e is CommitEvent => e?.kind === 'commit' && !e.stats).map((e) => e.sha);
  const stats = repo.numstat(todo);
  let n = 0;
  const out = events.map((e, i) => {
    if (!e) return lines[i];
    const found = e.sha === undefined ? undefined : stats.get(e.sha);
    if (e.kind === 'commit' && !e.stats && found) {
      e.stats = found;
      n++;
    }
    return JSON.stringify(e);
  });
  writeFileSync(eventsPath, out.join('\n'));
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, dir] = process.argv.slice(2);
  if (!id || !dir) {
    console.error('usage: node scripts/backfill-stats.ts <project-id> <clone-dir>');
    process.exit(2);
  }
  const path = join(fileURLToPath(new URL('..', import.meta.url)), 'data', id, 'events.jsonl');
  console.log(`${id}: ${backfillStats(path, openRepo(dir))} events gained stats`);
}
