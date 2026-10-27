import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Reads a JSONL file; a missing file is []. */
export function readJsonl<T>(path: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

/** Appends rows as JSONL lines, creating the directory if needed. */
export function appendJsonl(path: string, rows: unknown[]): void {
  if (!rows.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
}
