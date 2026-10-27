import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, COUNTED, classifyByRule } from './classify.ts';
import { readJsonl } from './store.ts';
import type {
  Annotation,
  Classification,
  CountRow,
  Dates,
  Event,
  MonthEvent,
  ProjectConfig,
  ProjectEntry,
  Release,
  Summary,
} from './types.ts';

/*
 * Output under docs/data/ (validate.ts checks the invariants):
 *   projects.json            [{ id, name, basis, annotations: [vendor], links, source? }]   source: the one URL the page's
 *                            help dialog links (the changelog, or the git repo); the rest of the config's sources is not published
 *   annotations.json         copy of annotations.json
 *   <project>/summary.json   { project, name, basis, generatedAt, firstDate, lastDate,
 *                              totals: { events, byCategory, bySource: { rule, model, pending }, versions? } }   versions: changelog
 *   <project>/daily.json     [{ d, counts, total }]  every calendar day firstDate..lastDate
 *   <project>/weekly.json    same rows, d = ISO-week Monday, every week; commits basis adds lines: add+del of each
 *                            COUNTED commit that has stats, as a list (ascending, canonical) rather than a median, so
 *                            the browser can pool weeks into any window and take an exact median
 *   <project>/releases.json  [{ version, ts, count }]                    changelog basis only
 *   <project>/months/YYYY-MM.json  [{ id, ts, version?, sha?, category, source, text, tags, author?, bot?, stats?, url? }]
 * Ratios such as the site's Fixes % are derived in the browser from counts, never stored.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(REPO, 'src', 'site');
const DAY = 86_400_000;

/** Monday (YYYY-MM-DD) of the ISO week containing day d. */
export function mondayOf(d: string): string {
  const t = Date.parse(`${d}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `from` to `to` inclusive, stepping `step` days. */
export function eachDay(from: string, to: string, step = 1): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += step * DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Commits basis: author or any co-author is in project.bots or ends with "[bot]". */
export function isBot(event: Event, project: ProjectConfig): boolean {
  return [event.author, ...(event.coauthors ?? [])].some((n) => n && (project.bots?.includes(n) || /\[bot\]$/.test(n)));
}

const fill = (tpl: string, vars: Record<string, string | undefined>): string =>
  tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
const rows = (arr: unknown[]): string =>
  arr.length ? `[\n${arr.map((r) => JSON.stringify(r)).join(',\n')}\n]\n` : '[]\n';
const write = (path: string, text: string | Buffer): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const json = (path: string, v: unknown): void => write(path, `${JSON.stringify(v, null, 2)}\n`);
const shortHash = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex').slice(0, 8);

const INLINE_MAP = '//# sourceMappingURL=data:application/json;base64,';

/**
 * Turns each src/site module into browser JS under out/app/ by erasing its types (Node's own stripper, so there is no
 * compiler to install), beside a source map that carries the .ts, so DevTools and VS Code step through the source.
 * out/app/ is rebuilt whole, so a renamed module leaves nothing behind. Returns the module names.
 */
function buildModules(out: string): string[] {
  const dir = join(out, 'app');
  rmSync(dir, { recursive: true, force: true });
  const names = readdirSync(SITE)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.slice(0, -'.ts'.length));
  for (const name of names) {
    const ts = readFileSync(join(SITE, `${name}.ts`), 'utf8');
    const [code = '', map = ''] = stripTypeScriptTypes(ts, {
      mode: 'transform',
      sourceMap: true,
      sourceUrl: `${name}.ts`,
    }).split(INLINE_MAP);
    write(join(dir, `${name}.js`), `${code.trimEnd()}\n//# sourceMappingURL=${name}.js.map\n`);
    json(join(dir, `${name}.js.map`), { ...JSON.parse(Buffer.from(map, 'base64').toString()), sourcesContent: [ts] });
  }
  return names;
}
const readJson = <T>(path: string, fallback: T): T =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;

/** Raw events + config + labels → derived, ts-sorted events (events without a ts are skipped). */
function deriveEvents(project: ProjectConfig, root: string): MonthEvent[] {
  const dir = join(root, 'data', project.id);
  const dates = readJson<Dates>(join(dir, 'dates.json'), {});
  const labels = new Map(readJsonl<Classification>(join(dir, 'classifications.jsonl')).map((c) => [c.textHash, c]));
  const out: MonthEvent[] = [];
  for (const e of readJsonl<Event>(join(dir, 'events.jsonl'))) {
    const rawTs = e.ts ?? (e.version === undefined ? undefined : dates[e.version]);
    if (!rawTs) continue;
    const ruleCategory = classifyByRule(e, project);
    const label = labels.get(e.textHash);
    const tpl = project.basis === 'commits' ? project.links?.commit : project.links?.release;
    // Key order is the order in the published JSON.
    const ev: MonthEvent = {
      id: e.id,
      ts: new Date(rawTs).toISOString(),
      ...(e.version ? { version: e.version } : {}),
      ...(e.sha ? { sha: e.sha } : {}),
      category: ruleCategory ?? label?.category ?? 'other',
      source: ruleCategory ? 'rule' : label ? 'model' : 'pending',
      text: e.text,
      tags: e.tags,
      ...(e.author ? { author: e.author } : {}),
      ...(project.basis === 'commits' ? { bot: isBot(e, project) } : {}),
      ...(e.stats ? { stats: e.stats } : {}),
      ...(tpl ? { url: fill(tpl, { version: e.version, sha: e.sha }) } : {}),
    };
    out.push(ev);
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); // stable: ties keep file order
}

function aggregate(
  events: MonthEvent[],
  project: ProjectConfig,
  keyOf: (day: string) => string,
  keys: string[],
  { lines = false }: { lines?: boolean } = {},
): CountRow[] {
  const cats = CATEGORIES[project.basis];
  const by = new Map<string, CountRow>(
    keys.map((k) => [
      k,
      { d: k, counts: Object.fromEntries(cats.map((c) => [c, 0])), total: 0, ...(lines ? { lines: [] } : {}) },
    ]),
  );
  for (const e of events) {
    const r = by.get(keyOf(e.ts.slice(0, 10)));
    if (!r) throw new Error(`no row for ${e.ts}`);
    r.counts[e.category] = (r.counts[e.category] ?? 0) + 1;
    r.total++;
    if (lines && r.lines && e.stats && COUNTED.includes(e.category)) r.lines.push(e.stats.add + e.stats.del);
  }
  if (lines) for (const r of by.values()) r.lines?.sort((a, b) => a - b);
  return [...by.values()];
}

function buildProject(project: ProjectConfig, root: string, out: string, generatedAt: string): void {
  const events = deriveEvents(project, root);
  const od = join(out, 'data', project.id);
  const today = generatedAt.slice(0, 10);
  const firstDate = events[0]?.ts.slice(0, 10) ?? null;
  const newest = events.at(-1)?.ts.slice(0, 10);
  const lastDate = newest && newest > today ? newest : today;
  const days = firstDate ? eachDay(firstDate, lastDate) : [];
  const weeks = firstDate ? eachDay(mondayOf(firstDate), mondayOf(lastDate), 7) : [];
  const daily = aggregate(events, project, (d) => d, days);
  const weekly = aggregate(events, project, mondayOf, weeks, { lines: project.basis === 'commits' });

  const cats = CATEGORIES[project.basis];
  const totals: Summary['totals'] = {
    events: events.length,
    byCategory: Object.fromEntries(cats.map((c) => [c, events.filter((e) => e.category === c).length])),
    bySource: {
      rule: events.filter((e) => e.source === 'rule').length,
      model: events.filter((e) => e.source === 'model').length,
      pending: events.filter((e) => e.source === 'pending').length,
    },
  };
  const releases: Release[] = [];
  if (project.basis === 'changelog') {
    const byVersion = new Map<string, Release>();
    for (const e of events) {
      if (e.version === undefined) continue;
      const version = e.version;
      byVersion.set(version, { version, ts: e.ts, count: (byVersion.get(version)?.count ?? 0) + 1 });
    }
    releases.push(...byVersion.values());
    totals.versions = releases.length;
  }
  const summary: Summary = {
    project: project.id,
    name: project.name,
    basis: project.basis,
    generatedAt,
    firstDate,
    lastDate,
    totals,
  };
  json(join(od, 'summary.json'), summary);
  write(join(od, 'daily.json'), rows(daily));
  write(join(od, 'weekly.json'), rows(weekly));
  if (project.basis === 'changelog') write(join(od, 'releases.json'), rows(releases));
  rmSync(join(od, 'months'), { recursive: true, force: true }); // an event can change month when its date changes
  const months = Map.groupBy(events, (e) => e.ts.slice(0, 7));
  for (const [m, evs] of [...months].sort()) write(join(od, 'months', `${m}.json`), rows(evs));
}

/** Builds the whole site from `root` into `out`. */
export function build({
  root = REPO,
  out = join(root, 'docs'),
  now = new Date(),
}: {
  root?: string;
  out?: string;
  now?: Date;
} = {}): void {
  const generatedAt = new Date(now).toISOString();
  const projects = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8')) as ProjectConfig[];
  json(
    join(out, 'data', 'projects.json'),
    projects.map((p): ProjectEntry => {
      const source = p.sources?.changelog ?? p.sources?.git?.repo;
      return {
        id: p.id,
        name: p.name,
        basis: p.basis,
        annotations: p.annotations ?? [],
        links: p.links ?? {},
        ...(source ? { source } : {}),
      };
    }),
  );
  write(join(out, 'data', 'annotations.json'), rows(readJson<Annotation[]>(join(root, 'annotations.json'), [])));
  copyFileSync(join(SITE, 'app.css'), join(out, 'app.css'));
  const modules = buildModules(out);
  if (resolve(out) !== resolve(REPO, 'docs'))
    write(join(out, 'vendor', 'chart.umd.js'), readFileSync(join(REPO, 'docs', 'vendor', 'chart.umd.js')));
  // Pages caches assets for ten minutes and browsers longer, while the HTML is fetched fresh: an asset URL that
  // carries its content hash makes a changed script or stylesheet load with the page instead of after the cache.
  const hashOf = (f: string): string => shortHash(readFileSync(join(out, f)));
  const hashes = new Map(['app.css', 'vendor/chart.umd.js'].map((f) => [f, hashOf(f)]));
  const assets = new RegExp(
    `(href|src)="(\\.{1,2}/)(${[...hashes.keys()].map((f) => f.replace(/\./g, '\\.')).join('|')})"`,
    'g',
  );
  // Modules import each other as `./x.ts`; the page's import map points each such URL at its stamped .js, so the
  // sources need no rewriting. Map keys resolve against the page, hence `rel`.
  const importMap = (rel: string): string =>
    JSON.stringify({
      imports: Object.fromEntries(
        modules.map((m) => [`${rel}app/${m}.ts`, `${rel}app/${m}.js?v=${hashOf(`app/${m}.js`)}`]),
      ),
    });
  const stamp = (html: string, rel: string): string =>
    html
      .replace(assets, (_m, attr: string, r: string, f: string) => `${attr}="${r}${f}?v=${hashes.get(f)}"`)
      .replace('{"imports":{}}', importMap(rel));
  write(join(out, 'index.html'), stamp(readFileSync(join(SITE, 'index.html'), 'utf8'), './'));
  const page = stamp(readFileSync(join(SITE, 'page.html'), 'utf8'), '../');
  for (const p of projects) {
    buildProject(p, root, out, generatedAt);
    write(
      join(out, p.id, 'index.html'),
      page.replace(/\{\{(\w+)\}\}/g, (m, k: string) => String((p as Record<string, unknown>)[k] ?? m)),
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (k: string) => args[args.indexOf(k) + 1];
  const root = args.includes('--root') ? arg('--root') : REPO;
  build({ root, out: args.includes('--out') ? arg('--out') : join(root, 'docs') });
}
