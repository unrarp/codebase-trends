import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eachDay, mondayOf } from './build.ts';
import { CATEGORIES, COUNTED } from './classify.ts';
import type { Annotation, CountRow, MonthEvent, ProjectEntry, Release, Summary } from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Returns a list of violation strings for the site built into `out` (empty = valid). */
export function validate(out: string): string[] {
  const errs: string[] = [];
  const bad = (where: string, msg: string) => errs.push(`${where}: ${msg}`);
  // The files are what is being validated, so T is what they should be, not what they are.
  const read = <T>(rel: string): T | null => {
    try {
      return JSON.parse(readFileSync(join(out, rel), 'utf8')) as T;
    } catch (e) {
      bad(rel, `unreadable (${(e as Error).message})`);
      return null;
    }
  };

  const projects = read<ProjectEntry[]>('data/projects.json');
  if (!Array.isArray(projects)) return [...errs, 'data/projects.json: not an array'];
  for (const p of projects) {
    for (const k of ['id', 'name', 'basis'] as const)
      if (typeof p[k] !== 'string') bad('data/projects.json', `${p.id}: missing string ${k}`);
    if (!CATEGORIES[p.basis]) bad('data/projects.json', `${p.id}: unknown basis ${p.basis}`);
    if (!Array.isArray(p.annotations) || typeof p.links !== 'object')
      bad('data/projects.json', `${p.id}: bad annotations/links`);
    if ('source' in p && !/^https?:\/\//.test(p.source ?? ''))
      bad('data/projects.json', `${p.id}: source is not a URL`);
    for (const f of [`${p.id}/index.html`]) if (!existsSync(join(out, f))) bad(f, 'missing page');
  }
  const ann = read<Annotation[]>('data/annotations.json');
  if (!Array.isArray(ann)) bad('data/annotations.json', 'not an array');
  else
    for (const a of ann)
      if (
        !DATE.test(a.date) ||
        !a.label ||
        !a.vendor ||
        !a.kind ||
        !a.source ||
        ('major' in a && typeof a.major !== 'boolean')
      )
        bad('data/annotations.json', `bad entry ${JSON.stringify(a)}`);
  if (!existsSync(join(out, 'index.html'))) bad('index.html', 'missing');

  for (const p of projects.filter((q) => CATEGORIES[q.basis])) {
    const cats: string[] = CATEGORIES[p.basis];
    const dir = `data/${p.id}`;
    const summary = read<Summary>(`${dir}/summary.json`);
    const daily = read<CountRow[]>(`${dir}/daily.json`);
    const weekly = read<CountRow[]>(`${dir}/weekly.json`);
    if (!summary || !Array.isArray(daily) || !Array.isArray(weekly)) continue;
    const { totals } = summary;
    if (summary.project !== p.id || !summary.generatedAt || !totals || !totals.byCategory || !totals.bySource) {
      bad(`${dir}/summary.json`, 'bad shape');
      continue;
    }
    if (sum(Object.values(totals.byCategory)) !== totals.events)
      bad(`${dir}/summary.json`, 'byCategory does not sum to events');
    if (sum(Object.values(totals.bySource)) !== totals.events)
      bad(`${dir}/summary.json`, 'bySource does not sum to events');

    const tables: [string, CountRow[]][] = [
      ['daily', daily],
      ['weekly', weekly],
    ];
    for (const [name, rows] of tables) {
      const f = `${dir}/${name}.json`;
      for (const r of rows) {
        const w = `${f} ${r.d}`;
        if (!DATE.test(r.d) || !r.counts || typeof r.total !== 'number') {
          bad(w, 'bad row shape');
          continue;
        }
        if (sum(Object.values(r.counts)) !== r.total) bad(w, 'counts do not sum to total');
        if (Object.keys(r.counts).some((c) => !cats.includes(c))) bad(w, 'category outside basis set');
        if (name === 'weekly' && p.basis === 'commits') {
          const sorted = (xs: number[] | undefined): xs is number[] =>
            Array.isArray(xs) && xs.every((x, i) => Number.isInteger(x) && x >= 0 && (i === 0 || xs[i - 1] <= x));
          if (!sorted(r.lines)) bad(w, 'lines must be ascending non-negative integers');
          else if (r.lines.length > sum(COUNTED.map((c) => r.counts[c] ?? 0)))
            bad(w, 'lines has more sizes than the row has counted commits');
        } else if ('lines' in r) bad(w, 'lines only on weekly rows of the commits basis');
      }
      if (sum(rows.map((r) => r.total)) !== totals.events)
        bad(f, `Σ total ${sum(rows.map((r) => r.total))} != summary.totals.events ${totals.events}`);
    }
    const wantDays = summary.firstDate ? eachDay(summary.firstDate, summary.lastDate) : [];
    const wantWeeks = summary.firstDate ? eachDay(mondayOf(summary.firstDate), mondayOf(summary.lastDate), 7) : [];
    if (daily.map((r) => r.d).join() !== wantDays.join())
      bad(`${dir}/daily.json`, 'not every calendar day firstDate..lastDate');
    if (weekly.map((r) => r.d).join() !== wantWeeks.join()) bad(`${dir}/weekly.json`, 'not every ISO week');

    let emitted = 0;
    const monthsDir = join(out, dir, 'months');
    for (const f of existsSync(monthsDir) ? readdirSync(monthsDir).sort() : []) {
      const events = read<MonthEvent[]>(`${dir}/months/${f}`) ?? [];
      emitted += events.length;
      for (const e of events) {
        const w = `${dir}/months/${f} ${e.id}`;
        if (!e.ts || Number.isNaN(Date.parse(e.ts))) bad(w, 'event without a valid ts');
        else if (!e.ts.startsWith(f.replace('.json', ''))) bad(w, 'event in wrong month shard');
        if (!cats.includes(e.category)) bad(w, `category ${e.category} outside basis set`);
        if (!['rule', 'model', 'pending'].includes(e.source)) bad(w, `bad source ${e.source}`);
        if (typeof e.text !== 'string' || !Array.isArray(e.tags) || !e.id) bad(w, 'bad shape');
        if (
          'stats' in e &&
          !(['add', 'del', 'files'] as const).every((k) => Number.isInteger(e.stats?.[k]) && (e.stats?.[k] ?? -1) >= 0)
        )
          bad(w, 'stats must be { add, del, files } non-negative integers');
      }
    }
    if (emitted !== totals.events) bad(`${dir}/months`, `${emitted} events != summary.totals.events ${totals.events}`);

    if (p.basis === 'changelog') {
      const rel = read<Release[]>(`${dir}/releases.json`);
      if (Array.isArray(rel) && sum(rel.map((r) => r.count)) !== totals.events)
        bad(`${dir}/releases.json`, 'counts do not sum to events');
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
