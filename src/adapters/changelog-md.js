import { textHash } from '../hash.js';

/** Raw CHANGELOG.md text → Event[] (one per bullet, in file order). */
export function parseChangelog(md, project) {
  const events = [];
  let version = null;
  let index = 0;
  for (const line of md.split('\n')) {
    const h = line.match(/^## (\S+)/);
    if (h) {
      version = h[1];
      index = 0;
      continue;
    }
    if (!version || !line.startsWith('- ')) continue;
    let text = line.slice(2).trim();
    const tags = [];
    for (let m; (m = text.match(/^\[([^\]]+)\]\s*/)); text = text.slice(m[0].length)) {
      tags.push(m[1].toLowerCase());
    }
    text = text.replace(/^\*\*[^*]+:\*\*\s*/, '');
    const reg = text.match(/regression (?:introduced )?(?:in|since) v?(\d+\.\d+\.\d+)/i);
    if (reg) tags.push(`regression:${reg[1]}`);
    const pr = text.match(/\(#(\d+)\)\s*$/);
    if (pr) tags.push(`pr:${pr[1]}`);
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
