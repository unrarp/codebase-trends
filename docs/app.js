(() => {
// The four product-change buckets, in stack and legend order (dataviz reference dark-palette steps; every adjacent
// pair passes the CVD and normal-vision checks on the panel surface). Any category outside them — maintenance
// (chore, test, docs, ci), other, or one the build adds later — is not a product change and is not counted.
// Changing a colour or the order: re-run the dataviz skill's validate_palette.js with the new hex list in this
// order, `--mode dark --surface '#12151a'`, and keep only an order that passes (stack gaps cover a CVD WARN).
const GROUPS = [
  { key: 'changed', color: '#c98500', cats: ['changed', 'improved'] },
  { key: 'fixed', color: '#3987e5', cats: ['fixed'] },
  { key: 'added', color: '#008300', cats: ['added'] },
  { key: 'removed', color: '#e66767', cats: ['removed', 'revert'] },
];
const groupOf = (cat) => GROUPS.find((g) => g.cats.includes(cat)) ?? null;
const ACCENT = '#e8702a';
const MARKER = '#f0932b';
const PANEL = '#12151a';
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const ROLL = 4; // weeks in the rolling fix share window and in each KPI window
const PX_PER_WEEK = 12; // narrow screens: the chart scrolls sideways at this width per week

const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); Object.assign(n.dataset, dataset); n.append(...kids); return n; };
const get = (path) => fetch(path).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const mondayOf = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY); };
const fmt = (d, year) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const weekEnd = (d) => dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY);
const span = (ws) => `${fmt(ws[0].d)} – ${fmt(weekEnd(ws.at(-1).d))}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pct = (x) => `${Math.round(x * 100)}%`;
const LAST = 'codebase-trends:project';
// Storage throws when the browser blocks it; remembering the project is optional.
const remembered = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
const remember = (id) => { try { localStorage.setItem(LAST, id); } catch {} };
const narrow = () => matchMedia('(max-width: 719px)').matches;

const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
const fixes = (r) => (r.counts.fixed ?? 0) + (r.counts.revert ?? 0);
/** Product changes in a row: every category that belongs to a group. */
const shown = (r) => sum(Object.keys(r.counts), (c) => (groupOf(c) ? r.counts[c] : 0));
/** Pooled fix share over rows; null when no product change landed. */
const pooledFix = (rows) => { const d = sum(rows, shown); return d === 0 ? null : sum(rows, fixes) / d; };
/** Median of a list of sizes (not assumed sorted); null when empty. */
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null; };

async function projectPage() {
  const id = document.body.dataset.project;
  const changelog = document.body.dataset.basis === 'changelog';
  const D = '../data/';
  const [projects, annotations, summary, dailyRaw, weeklyRaw, releases] = await Promise.all([
    get(`${D}projects.json`), get(`${D}annotations.json`), get(`${D}${id}/summary.json`),
    get(`${D}${id}/daily.json`), get(`${D}${id}/weekly.json`), changelog ? get(`${D}${id}/releases.json`) : [],
  ]);
  const vendors = projects.find((p) => p.id === id).annotations;
  remember(id);
  $('switch').replaceChildren(...projects.map((p) => el('option', { value: p.id, textContent: p.name, selected: p.id === id })));
  $('switch').addEventListener('change', (e) => { location.href = `../${e.target.value}/`; });
  const now = Date.now();
  const generatedAt = Date.parse(summary.generatedAt);
  const noun = changelog ? 'Changelog items' : 'Commits';

  // Weekly rows extended with empty rows up to the current week so the not-yet-collected span is on the axis.
  const rows = [...weeklyRaw];
  for (let t = Date.parse(`${rows.at(-1).d}T00:00:00Z`) + WEEK; dayOf(t) <= mondayOf(dayOf(now)); t += WEEK) {
    rows.push({ d: dayOf(t), counts: {}, total: 0, fixShare: null });
  }
  const anchor = Date.parse(`${rows[0].d}T00:00:00Z`);
  const end = anchor + rows.length * WEEK;
  const curIdx = rows.findIndex((r) => { const t = Date.parse(`${r.d}T00:00:00Z`); return t <= now && now < t + WEEK; });
  const catsOf = (g) => Object.keys(summary.totals.byCategory).filter((c) => groupOf(c) === g);
  const groups = GROUPS.filter((g) => catsOf(g).length);
  const counted = sum(Object.entries(summary.totals.byCategory), ([c, n]) => (groupOf(c) ? n : 0));
  const setAside = summary.totals.events - counted;

  // ---- KPIs: the last ROLL complete weeks (fewer when the history is shorter), against the ROLL weeks before ----
  const kpiEnd = curIdx < 0 ? rows.length : curIdx;
  const last = rows.slice(Math.max(0, kpiEnd - ROLL), kpiEnd);
  const ref = kpiEnd >= 2 * ROLL ? rows.slice(kpiEnd - 2 * ROLL, kpiEnd - ROLL) : []; // the ROLL weeks right before
  const inWeeks = (ws) => releases.filter((r) => r.ts.slice(0, 10) >= ws[0].d && r.ts.slice(0, 10) <= weekEnd(ws.at(-1).d)).length;
  const perWeek = (f) => (ws) => (ws.length ? f(ws) / ws.length : null);
  const NOTES = ['counted', 'window', 'fix', ...(changelog ? [] : ['lines']), 'markers']; // hidden notes are not numbered
  const fn = (id) => el('sup', { className: 'fn' }, el('a', { href: `#fn-${id}`, textContent: String(NOTES.indexOf(id) + 1), title: `See note ${NOTES.indexOf(id) + 1}` }));
  $('meta').replaceChildren(`updated ${new Date(generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${counted.toLocaleString('en-US')} ${noun.toLowerCase()}`, fn('counted'));
  const FIX = 'Fixes %';
  const SIZE = 'Commit size';
  const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±');
  const change = (a, b, share) => { // rounded first, so a change that rounds to 0 reads ±0
    if (!share && b === 0) return '–';
    const d = Math.round(share ? (a - b) * 100 : (a / b - 1) * 100);
    return `${sign(d)}${Math.abs(d)}${share ? ' pts' : '%'}`;
  };
  const kpis = [
    { k: `${noun} / week`, f: perWeek((ws) => sum(ws, shown)), show: (v) => v.toFixed(0), noteCounted: true },
    { k: 'New features / week', f: perWeek((ws) => sum(ws, (r) => r.counts.added ?? 0)), show: (v) => v.toFixed(0) },
    { k: FIX, f: pooledFix, show: pct, share: true },
    ...(changelog ? [{ k: 'Versions released / week', f: perWeek(inWeeks), show: (v) => v.toFixed(1) }]
      : [{ k: SIZE, f: (ws) => median(ws.flatMap((r) => r.lines ?? [])), show: (v) => v.toFixed(0), note: 'lines' }]),
  ];
  $('kpis').replaceChildren(...kpis.map(({ k, f, show, share, noteCounted, note }) => {
    const a = last.length ? f(last) : null;
    const b = ref.length ? f(ref) : null;
    const vs = a == null || b == null ? ['no prior period to compare'] : [el('b', { textContent: change(a, b, share) }), ` vs prior period (${show(b)})`];
    return el('div', { className: 'kpi' }, el('div', { className: 'k' }, k, ...(noteCounted ? [fn('counted')] : []), fn('window'), ...(share ? [fn('fix')] : []), ...(note ? [fn(note)] : [])),
      el('div', { className: 'v', textContent: a == null ? '–' : show(a) }), el('div', { className: 'ref' }, ...vs));
  }));
  const aside = changelog ? 'items that announce rather than change something' : 'maintenance commits (chores, tests, docs, CI) and unreadable subjects';
  $('fn-counted').textContent = `Counted ${noun.toLowerCase()} are those that added, fixed, changed (incl. improved) or removed something (incl. reverts). `
    + `Not counted: ${setAside.toLocaleString('en-US')} ${aside}.`;
  $('fn-window').textContent = `Tiles cover the last ${last.length} complete week${last.length === 1 ? '' : 's'}${last.length ? ` (${span(last)})` : ''}; the prior period is the ${ROLL} weeks before${ref.length ? ` (${span(ref)})` : ''}. Weeks start Monday 00:00 UTC.`;
  $('fn-fix').textContent = `${FIX}: fixes as a share of changes, (fixed + reverts) ÷ all counted ${noun.toLowerCase()}. The chart line is its trailing ${ROLL}-week average, each week with the ${ROLL - 1} before it.`;
  $('fn-lines').hidden = changelog; // changelog items have no size
  $('fn-lines').textContent = `${SIZE}: lines added + deleted by a commit, against its first parent; the median over the window's counted commits, so one sweeping commit does not move it. Commits with no recorded size are left out.`;

  // ---- shared chart furniture: context periods, not-yet-collected hatch, model markers ----
  const inRange = (a) => vendors.includes(a.vendor) && Date.parse(a.date) < end && Date.parse(a.end ?? a.date) + DAY > anchor;
  const major = annotations.filter((a) => a.kind === 'model' && a.major && inRange(a)).sort((a, b) => (a.date + a.label < b.date + b.label ? -1 : 1));
  const periods = annotations.filter((a) => a.kind === 'period' && inRange(a));
  const pattern = (() => {
    const c = el('canvas', { width: 8, height: 8 });
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke();
    return c;
  })();
  const toX = (chart, t) => {
    const sx = chart.scales.x;
    const slot = sx.getPixelForValue(1) - sx.getPixelForValue(0);
    return sx.getPixelForValue(0) - slot / 2 + ((t - anchor) / WEEK) * slot;
  };
  const furniture = {
    id: 'furniture',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a } = chart;
      ctx.save();
      ctx.fillStyle = 'rgba(138,143,152,.28)';
      for (const p of periods) {
        const x0 = Math.max(a.left, toX(chart, Date.parse(p.date)));
        const x1 = Math.min(a.right, toX(chart, Date.parse(p.end ?? p.date) + DAY));
        if (x1 > x0) ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      }
      const x0 = Math.max(a.left, toX(chart, generatedAt));
      const x1 = Math.min(a.right, toX(chart, now));
      chart.$hatch = { x0, x1, width: Math.max(0, x1 - x0) };
      if (x1 > x0) { ctx.fillStyle = ctx.createPattern(pattern, 'repeat'); ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top); }
      const entry = $('legend-hatch'); // the legend only explains a hatch that is on screen
      if (entry) entry.hidden = x1 - x0 < 1; // a sub-pixel hatch right after a sync is not on screen
      ctx.restore();
    },
    afterDraw(chart) {
      const { ctx, chartArea: a } = chart;
      const rowEnd = [];
      chart.$markers = [];
      ctx.save();
      major.forEach((m, i) => {
        const x = Math.round(toX(chart, Date.parse(m.date) + DAY / 2)) + 0.5; // on the pixel grid: a 1px line off it blurs to gray
        if (x < a.left || x > a.right) return;
        let r = rowEnd.findIndex((e) => x - e >= 20); // badges are 18px wide; closer than that, go up a row
        if (r < 0) r = Math.min(rowEnd.length, 2);
        rowEnd[r] = x;
        const y = a.top - 14 - r * 22;
        ctx.strokeStyle = MARKER; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, y + 9); ctx.lineTo(x, a.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = PANEL; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = MARKER; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y + 0.5);
        chart.$markers.push({ n: i + 1, x, y });
      });
      ctx.restore();
    },
  };
  const onClick = (e, _els, ch) => {
    const hit = ch.getElementsAtEventForMode(e, 'index', { intersect: false }, true)[0];
    if (hit) openDrill(rows[hit.index].d, 'week');
  };
  const weekTitle = (items) => `Week of ${fmt(items[0].label, true)}${items[0].dataIndex === curIdx ? ' (in progress)' : ''}`;

  // ---- fix share: rolling window over the preceding weeks, nothing past the current week ----
  const rolling = rows.map((_, i) => (curIdx >= 0 && i > curIdx ? null : pooledFix(rows.slice(Math.max(0, i - ROLL + 1), i + 1))));
  $('title').textContent = `${noun} per week`;
  $('subtitle').replaceChildren(`${changelog ? 'Every changelog line item, counted in the week its version was published' : 'Commits on the default branch (first-parent), counted in the week they landed'}. `
    + `The line is ${FIX}`, fn('fix'), ' on the right axis. Click a week to list its items.');

  // ---- one chart: stacked weekly bars by group, the rolling fix share drawn over them on a 0–100% axis ----
  // The second y-axis is the owner's call against the dataviz one-axis rule: a separate fix-share chart above the
  // bars with a synced crosshair was built and rejected as harder to read together. Keep the overlay; the halo
  // dataset keeps the line legible over tall bars.
  // Narrow screens get a fixed width per week inside a sideways-scrolling wrapper, opened at the latest week,
  // with the axes on the right so they stay in view there. `layout` re-applies this whenever the viewport changes.
  const scroll = $('chart').closest('.chart-scroll');
  const wrap = $('chart').parentElement;
  const layout = (ch) => {
    const small = narrow();
    wrap.style.width = small ? `${Math.max(scroll.clientWidth, rows.length * PX_PER_WEEK)}px` : '';
    if (ch) {
      ch.options.scales.y.position = small ? 'right' : 'left';
      ch.options.scales.x.ticks.maxTicksLimit = small ? 8 : 10;
      ch.update();
    }
    if (small) scroll.scrollLeft = scroll.scrollWidth;
  };
  layout();
  const fade = (hex) => (c) => (c.dataIndex === curIdx ? `${hex}73` : hex);
  const line = (label, color, width, order) => ({ type: 'line', label, data: rolling, yAxisID: 'y1', borderColor: color, backgroundColor: color, borderWidth: width, pointRadius: 0, pointHitRadius: 8, tension: 0.2, spanGaps: false, order });
  const chart = new Chart($('chart'), {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.d),
      datasets: [
        ...groups.map((g) => ({
          label: cap(g.key), data: rows.map((r) => sum(catsOf(g), (c) => r.counts[c] ?? 0)), backgroundColor: fade(g.color),
          stack: 's', borderColor: PANEL, borderWidth: { top: 1 }, borderSkipped: false, categoryPercentage: 1, barPercentage: 0.85, order: 2,
        })),
        line('halo', PANEL, 5, 1), // a dark outline keeps the line legible over bars of any colour
        line(FIX, ACCENT, 2, 0),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 70 } },
      interaction: { mode: 'index', intersect: false },
      onClick,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (it) => it.dataset.label !== 'halo',
          callbacks: {
            title: weekTitle,
            label: (it) => `${it.dataset.label}: ${it.dataset.label === FIX ? pct(it.parsed.y) : it.parsed.y}`,
            footer: (items) => `Total: ${shown(rows[items[0].dataIndex])}`,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: narrow() ? 8 : 10, callback(v) { return fmt(this.getLabelForValue(v)); } } },
        y: { stacked: true, beginAtZero: true, position: narrow() ? 'right' : 'left', grid: { color: '#1b1f25' }, ticks: { maxTicksLimit: 6 } }, // layout() keeps these in step
        y1: { position: 'right', min: 0, max: 1, grid: { drawOnChartArea: false }, ticks: { stepSize: 0.25, callback: (v) => pct(v), color: ACCENT } },
      },
    },
    plugins: [furniture],
  });
  chart.$periods = periods;
  window.__chart = chart; // test hook read by test/browser.spec.js

  const item = (cls, text, props = {}) => el('span', props, el('span', { className: `sw ${cls}` }), text);
  $('legend').replaceChildren(
    ...groups.map((g) => el('span', {}, el('span', { className: 'sw', style: `background:${g.color}` }), cap(g.key))),
    el('span', {}, el('span', { className: 'sw line' }), el('span', {}, FIX, fn('fix'), ' (right axis)')),
    ...(major.length ? [el('span', {}, el('span', { className: 'sw marker' }), el('span', {}, 'Major model release', fn('markers')))] : []),
    ...(periods.length ? [item('period', 'Context period (approx.)')] : []),
    item('hatch', 'Not yet collected', { id: 'legend-hatch', hidden: true }));
  $('fn-markers').hidden = !major.length; // the note explains markers that are on the chart
  chart.update(); // the hatch legend entry is decided inside the draw, which ran before the entry existed
  const link = (a, ...kids) => el('a', { className: 'chip', href: a.source, target: '_blank', rel: 'noopener', title: `${a.label} · ${fmt(a.date, true)}${a.end ? `–${fmt(a.end, true)}` : ''} · ${a.source}`, style: 'text-decoration:none;color:inherit' }, ...kids);
  // Dates are hidden on narrow screens (the marker on the chart gives them) and always in the chip's title.
  $('chips').replaceChildren(
    ...major.map((m, i) => link(m, el('span', { className: 'dot' }), el('span', { className: 'n', textContent: String(i + 1) }), m.label, el('span', { className: 'date', textContent: ` · ${fmt(m.date)}` }))),
    ...periods.map((p) => link(p, el('span', { className: 'sq' }), p.label, el('span', { className: 'date', textContent: ` · ${fmt(p.date)}–${fmt(p.end ?? p.date)}` }))));

  // ---- drill-down ----
  async function openDrill(d, view) {
    const to = view === 'week' ? dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY) : d;
    const months = [...new Set(dailyRaw.filter((r) => r.d >= d && r.d <= to && r.total > 0).map((r) => r.d.slice(0, 7)))];
    const events = (await Promise.all(months.map((m) => get(`${D}${id}/months/${m}.json`)))).flat()
      .filter((e) => e.ts.slice(0, 10) >= d && e.ts.slice(0, 10) <= to && groupOf(e.category)); // the list matches the bar
    const what = noun.toLowerCase();
    $('drill-title').textContent = `${view === 'week' ? `Week of ${fmt(d, true)}` : fmt(d, true)} · ${events.length} ${what}`;
    const body = $('drill-table').tBodies[0];
    body.replaceChildren();
    let lastDay;
    for (const e of events) {
      const day = e.ts.slice(0, 10);
      if (view === 'week' && day !== lastDay) {
        body.append(el('tr', { className: 'day' }, el('th', { colSpan: 4, textContent: `${fmt(day, true)} · ${events.filter((x) => x.ts.startsWith(day)).length} ${what}` })));
        lastDay = day;
      }
      const ref = e.version ?? e.sha.slice(0, 7);
      const group = groupOf(e.category); // never null: the filter above kept only grouped events
      body.append(el('tr', { className: 'ev' },
        el('td', { dataset: { label: changelog ? 'Version' : 'Commit' } }, e.url ? el('a', { href: e.url, target: '_blank', rel: 'noopener', textContent: ref }) : ref),
        el('td', { dataset: { label: 'Type' } }, el('span', { className: 'tag', style: `background:${group.color}`, textContent: e.category })), // stored label, bucket colour
        el('td', { dataset: { label: 'Source' }, textContent: e.source }, ...(e.bot ? [el('span', { className: 'badge', textContent: 'bot' })] : [])),
        el('td', { dataset: { label: 'Change' }, textContent: e.text })));
    }
    $('drill-empty').textContent = `No counted ${what} in this period.`;
    $('drill-empty').hidden = events.length > 0;
    $('drill-table').hidden = events.length === 0;
    $('drill').hidden = false;
    if (view === 'day') history.replaceState(null, '', `#${d}`);
    $('drill').scrollIntoView({ block: 'nearest' });
  }
  $('drill-close').onclick = () => { $('drill').hidden = true; history.replaceState(null, '', location.pathname); };

  const fromHash = () => {
    const m = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
    if (m) return openDrill(m[1], 'day');
  };
  await fromHash();
  addEventListener('hashchange', fromHash);
  addEventListener('resize', () => layout(chart));
}

// The root has no content of its own: it opens the last project viewed, else the first configured.
async function indexPage() {
  const ids = (await get('./data/projects.json')).map((p) => p.id);
  const last = remembered();
  location.replace(`./${ids.includes(last) ? last : ids[0]}/`);
}

(document.body.dataset.project ? projectPage : indexPage)();
})();
