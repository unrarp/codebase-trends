import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, classifyByRule } from './classify.js';
import { appendJsonl, readJsonl } from './store.js';

/**
 * One line of data/<project>/classifications.jsonl: a model's label for every event sharing a textHash.
 * @typedef {{ textHash: string, category: string, model: string, ts: string }} Classification
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL = 'claude-sonnet-5-5';
export const BATCH_SIZE = 50;

/** Pending: one { textHash, text } per distinct textHash with no rule category and no classification; derived, never stored. */
export function pendingOf(project, { dataRoot = join(ROOT, 'data') } = {}) {
  const dir = join(dataRoot, project.id);
  const classified = new Set(readJsonl(join(dir, 'classifications.jsonl')).map((c) => c.textHash));
  const pending = new Map();
  for (const e of readJsonl(join(dir, 'events.jsonl'))) {
    if (classifyByRule(e, project) === null && !classified.has(e.textHash) && !pending.has(e.textHash)) pending.set(e.textHash, { textHash: e.textHash, text: e.text });
  }
  return [...pending.values()];
}

/** Writes `<project>-<n>.txt` batch files (≤ BATCH_SIZE pending entries each, n from 1) into dir; returns their paths. */
export function writeBatches(project, dir, { dataRoot = join(ROOT, 'data') } = {}) {
  const pending = pendingOf(project, { dataRoot });
  const header = `# project: ${project.id} basis: ${project.basis} categories: ${CATEGORIES[project.basis].join(' ')}\n`;
  mkdirSync(dir, { recursive: true });
  const paths = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const body = pending.slice(i, i + BATCH_SIZE).map((p) => `${p.textHash}\t${p.text.replace(/\s+/g, ' ')}\n`).join('');
    const path = join(dir, `${project.id}-${i / BATCH_SIZE + 1}.txt`);
    writeFileSync(path, header + body);
    paths.push(path);
  }
  return paths;
}

/**
 * Validates every answer file, then appends labels. Throws (appending nothing) on the first violation.
 * Returns { [project]: appendedCount }.
 */
export function applyLabels(files, { dataRoot = join(ROOT, 'data'), projects = JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8')), now = () => new Date().toISOString() } = {}) {
  const byProject = new Map(); // id -> Map(textHash -> category)
  const state = new Map();
  for (const file of files) {
    const name = basename(file);
    const m = /^(.+)-\d+\.txt$/.exec(name);
    const project = m && projects.find((p) => p.id === m[1]);
    if (!project) throw new Error(`${file}: not named <project>-<n>.txt for a known project`);
    if (!state.has(project.id)) {
      state.set(project.id, new Set(pendingOf(project, { dataRoot }).map((p) => p.textHash)));
      byProject.set(project.id, new Map());
    }
    const pending = state.get(project.id);
    const found = byProject.get(project.id);
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const fail = (why) => { throw new Error(`${file}:${i + 1}: ${why}: ${line}`); };
      const lm = /^([0-9a-f]{16}): (\S+)$/.exec(line.trim());
      if (!lm) fail('malformed line');
      const [, hash, category] = lm;
      if (!pending.has(hash)) fail('hash not pending');
      if (!CATEGORIES[project.basis].includes(category)) fail(`category not in ${project.basis} set`);
      if (!found.has(hash)) found.set(hash, category);
    });
  }
  const ts = now();
  const counts = {};
  for (const [id, found] of byProject) {
    const rows = [...found].map(([textHash, category]) => ({ textHash, category, model: MODEL, ts }));
    appendJsonl(join(dataRoot, id, 'classifications.jsonl'), rows);
    counts[id] = rows.length;
  }
  return counts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [first, ...rest] = process.argv.slice(2);
  try {
    if (first === '--write-batches') { // --write-batches <project> <dir>
      const projects = JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8'));
      const project = projects.find((p) => p.id === rest[0]);
      if (!project) throw new Error(`unknown project ${rest[0]}`);
      for (const p of writeBatches(project, rest[1])) console.log(p);
    } else {
      for (const [id, n] of Object.entries(applyLabels(process.argv.slice(2)))) console.log(`${id}: appended ${n} labels`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
