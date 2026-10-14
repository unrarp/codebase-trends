import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './classify.js';
import { eachDay, mondayOf, fixShare } from './build.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Returns a list of violation strings for the site built into `out` (empty = valid). */
export function validate(out) {
  const errs = [];
  const bad = (where, msg) => errs.push(`${where}: ${msg}`);
  const read = (rel) => {
    try { return JSON.parse(readFileSync(join(out, rel), 'utf8')); } catch (e) { bad(rel, `unreadable (${e.message})`); return null; }
  };

  const projects = read('data/projects.json');
  if (!Array.isArray(projects)) return [...errs, 'data/projects.json: not an array'];
  for (const p of projects) {
    for (const k of ['id', 'name', 'basis']) if (typeof p[k] !== 'string') bad('data/projects.json', `${p.id}: missing string ${k}`);
    if (!CATEGORIES[p.basis]) bad('data/projects.json', `${p.id}: unknown basis ${p.basis}`);
    if (!Array.isArray(p.annotations) || typeof p.links !== 'object') bad('data/projects.json', `${p.id}: bad annotations/links`);
    for (const f of [`${p.id}/index.html`]) if (!existsSync(join(out, f))) bad(f, 'missing page');
  }
  const ann = read('data/annotations.json');
  if (!Array.isArray(ann)) bad('data/annotations.json', 'not an array');
  else for (const a of ann) if (!DATE.test(a.date) || !a.label || !a.vendor || !a.kind || !a.source || ('major' in a && typeof a.major !== 'boolean')) bad('data/annotations.json', `bad entry ${JSON.stringify(a)}`);
  if (!existsSync(join(out, 'index.html'))) bad('index.html', 'missing');

  for (const p of projects.filter((q) => CATEGORIES[q.basis])) {
    const cats = CATEGORIES[p.basis];
    const dir = `data/${p.id}`;
    const summary = read(`${dir}/summary.json`);
    const daily = read(`${dir}/daily.json`);
    const weekly = read(`${dir}/weekly.json`);
    if (!summary || !Array.isArray(daily) || !Array.isArray(weekly)) continue;
    const { totals } = summary;
    if (summary.project !== p.id || !summary.generatedAt || !totals || !totals.byCategory || !totals.bySource) {
      bad(`${dir}/summary.json`, 'bad shape');
      continue;
    }
    if (sum(Object.values(totals.byCategory)) !== totals.events) bad(`${dir}/summary.json`, 'byCategory does not sum to events');
    if (sum(Object.values(totals.bySource)) !== totals.events) bad(`${dir}/summary.json`, 'bySource does not sum to events');

    for (const [name, rows] of [['daily', daily], ['weekly', weekly]]) {
      const f = `${dir}/${name}.json`;
      for (const r of rows) {
        const w = `${f} ${r.d}`;
        if (!DATE.test(r.d) || !r.counts || typeof r.total !== 'number') { bad(w, 'bad row shape'); continue; }
        if (sum(Object.values(r.counts)) !== r.total) bad(w, 'counts do not sum to total');
        if (Object.keys(r.counts).some((c) => !cats.includes(c))) bad(w, 'category outside basis set');
        const want = fixShare(r.counts, r.total);
        if (r.fixShare !== want) bad(w, `fixShare ${r.fixShare} != recomputed ${want} (must be null iff denominator is 0)`);
      }
      if (sum(rows.map((r) => r.total)) !== totals.events) bad(f, `Σ total ${sum(rows.map((r) => r.total))} != summary.totals.events ${totals.events}`);
    }
    const wantDays = summary.firstDate ? eachDay(summary.firstDate, summary.lastDate) : [];
    const wantWeeks = summary.firstDate ? eachDay(mondayOf(summary.firstDate), mondayOf(summary.lastDate), 7) : [];
    if (daily.map((r) => r.d).join() !== wantDays.join()) bad(`${dir}/daily.json`, 'not every calendar day firstDate..lastDate');
    if (weekly.map((r) => r.d).join() !== wantWeeks.join()) bad(`${dir}/weekly.json`, 'not every ISO week');

    let emitted = 0;
    const monthsDir = join(out, dir, 'months');
    for (const f of existsSync(monthsDir) ? readdirSync(monthsDir).sort() : []) {
      const events = read(`${dir}/months/${f}`) ?? [];
      emitted += events.length;
      for (const e of events) {
        const w = `${dir}/months/${f} ${e.id}`;
        if (!e.ts || Number.isNaN(Date.parse(e.ts))) bad(w, 'event without a valid ts');
        else if (!e.ts.startsWith(f.replace('.json', ''))) bad(w, 'event in wrong month shard');
        if (!cats.includes(e.category)) bad(w, `category ${e.category} outside basis set`);
        if (!['rule', 'model', 'pending'].includes(e.source)) bad(w, `bad source ${e.source}`);
        if (typeof e.text !== 'string' || !Array.isArray(e.tags) || !e.id) bad(w, 'bad shape');
      }
    }
    if (emitted !== totals.events) bad(`${dir}/months`, `${emitted} events != summary.totals.events ${totals.events}`);

    if (p.basis === 'changelog') {
      const rel = read(`${dir}/releases.json`);
      if (Array.isArray(rel) && sum(rel.map((r) => r.count)) !== totals.events) bad(`${dir}/releases.json`, 'counts do not sum to events');
    }
  }
  return errs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = i >= 0 ? process.argv[i + 1] : fileURLToPath(new URL('../docs', import.meta.url));
  const errs = validate(out);
  if (errs.length) {
    console.error(`${errs.length} violation(s):\n${errs.join('\n')}`);
    process.exit(1);
  }
  console.log(`valid: ${out}`);
}
