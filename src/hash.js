import { createHash } from 'node:crypto';

/** Classification cache key: 16 hex chars over project + text. Not unique per event. */
export function textHash(project, text) {
  return createHash('sha256').update(`${project}\n${text}`).digest('hex').slice(0, 16);
}
