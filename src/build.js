import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readJsonl } from './store.js';
import { classifyByRule, CATEGORIES, COUNTED } from './classify.js';

/*
 * Output under docs/data/ (validate.js checks the invariants):
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
export function mondayOf(d) {
  const t = Date.parse(`${d}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `from` to `to` inclusive, stepping `step` days. */
export function eachDay(from, to, step = 1) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += step * DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Commits basis: author or any co-author is in project.bots or ends with "[bot]". */
export function isBot(event, project) {
  return [event.author, ...(event.coauthors ?? [])].some((n) => n && (project.bots?.includes(n) || /\[bot\]$/.test(n)));
}

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const rows = (arr) => (arr.length ? `[\n${arr.map((r) => JSON.stringify(r)).join(',\n')}\n]\n` : '[]\n');
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const json = (path, v) => write(path, `${JSON.stringify(v, null, 2)}\n`);
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);

/** Raw events + config + labels → derived, ts-sorted events (events without a ts are skipped). */
function deriveEvents(project, root) {
  const dir = join(root, 'data', project.id);
  const dates = readJson(join(dir, 'dates.json'), {});
  const labels = new Map(readJsonl(join(dir, 'classifications.jsonl')).map((c) => [c.textHash, c]));
  const out = [];
  for (const e of readJsonl(join(dir, 'events.jsonl'))) {
    const rawTs = e.ts ?? dates[e.version];
    if (!rawTs) continue;
    const ruleCategory = classifyByRule(e, project);
    const label = labels.get(e.textHash);
    const ev = { id: e.id, ts: new Date(rawTs).toISOString() };
    if (e.version) ev.version = e.version;
    if (e.sha) ev.sha = e.sha;
    ev.category = ruleCategory ?? label?.category ?? 'other';
    ev.source = ruleCategory ? 'rule' : label ? 'model' : 'pending';
    ev.text = e.text;
    ev.tags = e.tags;
    if (e.author) ev.author = e.author;
    if (project.basis === 'commits') ev.bot = isBot(e, project);
    if (e.stats) ev.stats = e.stats;
    const tpl = project.basis === 'commits' ? project.links?.commit : project.links?.release;
    if (tpl) ev.url = fill(tpl, { version: e.version, sha: e.sha });
    out.push(ev);
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); // stable: ties keep file order
}

function aggregate(events, project, keyOf, keys, { lines = false } = {}) {
  const cats = CATEGORIES[project.basis];
  const by = new Map(keys.map((k) => [k, { d: k, counts: Object.fromEntries(cats.map((c) => [c, 0])), total: 0, ...(lines ? { lines: [] } : {}) }]));
  for (const e of events) {
    const r = by.get(keyOf(e.ts.slice(0, 10)));
    r.counts[e.category]++;
    r.total++;
    if (lines && e.stats && COUNTED.includes(e.category)) r.lines.push(e.stats.add + e.stats.del);
  }
  if (lines) for (const r of by.values()) r.lines.sort((a, b) => a - b);
  return [...by.values()];
}

function buildProject(project, root, out, generatedAt) {
  const events = deriveEvents(project, root);
  const od = join(out, 'data', project.id);
  const today = generatedAt.slice(0, 10);
  const firstDate = events.length ? events[0].ts.slice(0, 10) : null;
  const lastDate = events.length && events.at(-1).ts.slice(0, 10) > today ? events.at(-1).ts.slice(0, 10) : today;
  const days = firstDate ? eachDay(firstDate, lastDate) : [];
  const weeks = firstDate ? eachDay(mondayOf(firstDate), mondayOf(lastDate), 7) : [];
  const daily = aggregate(events, project, (d) => d, days);
  const weekly = aggregate(events, project, mondayOf, weeks, { lines: project.basis === 'commits' });

  const cats = CATEGORIES[project.basis];
  const totals = {
    events: events.length,
    byCategory: Object.fromEntries(cats.map((c) => [c, events.filter((e) => e.category === c).length])),
    bySource: Object.fromEntries(['rule', 'model', 'pending'].map((s) => [s, events.filter((e) => e.source === s).length])),
  };
  const releases = [];
  if (project.basis === 'changelog') {
    const byVersion = new Map();
    for (const e of events) byVersion.set(e.version, { version: e.version, ts: e.ts, count: (byVersion.get(e.version)?.count ?? 0) + 1 });
    releases.push(...byVersion.values());
    totals.versions = releases.length;
  }
  json(join(od, 'summary.json'), { project: project.id, name: project.name, basis: project.basis, generatedAt, firstDate, lastDate, totals });
  write(join(od, 'daily.json'), rows(daily));
  write(join(od, 'weekly.json'), rows(weekly));
  if (project.basis === 'changelog') write(join(od, 'releases.json'), rows(releases));
  rmSync(join(od, 'months'), { recursive: true, force: true }); // an event can change month when its date changes
  const months = Map.groupBy(events, (e) => e.ts.slice(0, 7));
  for (const [m, evs] of [...months].sort()) write(join(od, 'months', `${m}.json`), rows(evs));
}

/** Builds the whole site from `root` into `out`. */
export function build({ root = REPO, out = join(root, 'docs'), now = new Date() } = {}) {
  const generatedAt = new Date(now).toISOString();
  const projects = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8'));
  json(join(out, 'data', 'projects.json'), projects.map((p) => {
    const source = p.sources?.changelog ?? p.sources?.git?.repo;
    return { id: p.id, name: p.name, basis: p.basis, annotations: p.annotations ?? [], links: p.links ?? {}, ...(source ? { source } : {}) };
  }));
  write(join(out, 'data', 'annotations.json'), rows(readJson(join(root, 'annotations.json'), [])));
  for (const f of ['app.js', 'app.css']) if (existsSync(join(SITE, f))) copyFileSync(join(SITE, f), join(out, f));
  if (resolve(out) !== resolve(REPO, 'docs')) write(join(out, 'vendor', 'chart.umd.js'), readFileSync(join(REPO, 'docs', 'vendor', 'chart.umd.js')));
  // Pages caches assets for ten minutes and browsers longer, while the HTML is fetched fresh: an asset URL that
  // carries its content hash makes a changed script or stylesheet load with the page instead of after the cache.
  const hashes = new Map(['app.js', 'app.css', 'vendor/chart.umd.js'].filter((f) => existsSync(join(out, f)))
    .map((f) => [f, createHash('sha256').update(readFileSync(join(out, f))).digest('hex').slice(0, 8)]));
  const assets = new RegExp(`(href|src)="(\\.{1,2}/)(${[...hashes.keys()].map((f) => f.replace(/\./g, '\\.')).join('|')})"`, 'g');
  const stamp = (html) => html.replace(assets, (m, attr, rel, f) => `${attr}="${rel}${f}?v=${hashes.get(f)}"`);
  write(join(out, 'index.html'), stamp(readFileSync(join(SITE, 'index.html'), 'utf8')));
  const page = stamp(readFileSync(join(SITE, 'page.html'), 'utf8'));
  for (const p of projects) {
    buildProject(p, root, out, generatedAt);
    write(join(out, p.id, 'index.html'), page.replace(/\{\{(\w+)\}\}/g, (m, k) => p[k] ?? m));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (k) => args[args.indexOf(k) + 1];
  const root = args.includes('--root') ? arg('--root') : REPO;
  build({ root, out: args.includes('--out') ? arg('--out') : join(root, 'docs') });
}
