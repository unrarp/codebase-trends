import { textHash } from '../hash.ts';
import type { Event } from '../types.ts';

const TAG = /^\[([^\]]+)\]\s*/;

/** Strips leading `[Tag]` groups from text, pushing each as a lowercase tag; returns the rest. */
export function stripTags(text: string, tags: string[]): string {
  for (let m = text.match(TAG); m; m = text.match(TAG)) {
    tags.push(m[1].toLowerCase());
    text = text.slice(m[0].length);
  }
  return text;
}

/** `regression:<version>` and `pr:<n>` tags found in tag-stripped text, in that order. */
export function textTags(text: string): string[] {
  const tags: string[] = [];
  const reg = text.match(/regression (?:introduced )?(?:in|since) v?(\d+\.\d+\.\d+)/i);
  if (reg) tags.push(`regression:${reg[1]}`);
  const pr = text.match(/\(#(\d+)\)\s*$/);
  if (pr) tags.push(`pr:${pr[1]}`);
  return tags;
}

/** Raw CHANGELOG.md text → Event[] (one per bullet, in file order). */
export function parseChangelog(md: string, project: string): Event[] {
  const events: Event[] = [];
  let version: string | null = null;
  let index = 0;
  for (const line of md.split('\n')) {
    const h = line.match(/^## (\S+)/);
    if (h) {
      version = h[1];
      index = 0;
      continue;
    }
    if (!version || !line.startsWith('- ')) continue;
    const tags: string[] = [];
    let text = stripTags(line.slice(2).trim(), tags);
    text = text.replace(/^\*\*[^*]+:\*\*\s*/, '');
    tags.push(...textTags(text));
    events.push({
      id: `${version}#${index++}`,
      textHash: textHash(project, text),
      project,
      kind: 'changelog',
      version,
      text,
      tags,
    });
  }
  return events;
}
