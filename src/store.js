import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Reads a JSONL file; a missing file is []. */
export function readJsonl(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Appends rows as JSONL lines, creating the directory if needed. */
export function appendJsonl(path, rows) {
  if (!rows.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => JSON.stringify(r) + '\n').join(''));
}
