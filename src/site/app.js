(() => {
const PAL = { fixed: '#3b8ff5', changed: '#f0b429', improved: '#b474ff', added: '#2fbf4a', other: '#8a8f98', removed: '#e5484d',
  revert: '#ec6f9b', chore: '#5c6670', test: '#2bb8b0', docs: '#6c7ae0', ci: '#c97a3a' };
const ACCENT = '#e8702a';
const MARKER = '#f0932b';
const DAY = 86_400_000;
const DAY_WINDOW = 120; // day view shows the most recent days only
const VENDORS = { anthropic: 'Anthropic', openai: 'OpenAI' };

const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); Object.assign(n.dataset, dataset); n.append(...kids); return n; };
const get = (path) => fetch(path).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const mondayOf = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY); };
const fmt = (d, year) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const narrow = () => matchMedia('(max-width: 719px)').matches;

async function projectPage() {
  const id = document.body.dataset.project;
  const basis = document.body.dataset.basis;
  const changelog = basis === 'changelog';
  const D = '../data/';
  const [projects, annotations, summary, dailyRaw, weeklyRaw, releases] = await Promise.all([
    get(`${D}projects.json`), get(`${D}annotations.json`), get(`${D}${id}/summary.json`),
    get(`${D}${id}/daily.json`), get(`${D}${id}/weekly.json`), changelog ? get(`${D}${id}/releases.json`) : [],
  ]);
  const vendors = projects.find((p) => p.id === id).annotations;
  const now = Date.now();
  const generatedAt = Date.parse(summary.generatedAt);
  const noun = changelog ? 'Changelog items' : 'Commits';

  // Rows extended with empty rows up to today (UTC) so the not-yet-collected span is on the axis.
  const extend = (rows, step, last) => {
    const out = [...rows];
    for (let t = Date.parse(`${rows.at(-1).d}T00:00:00Z`) + step * DAY; dayOf(t) <= last; t += step * DAY) {
      out.push({ d: dayOf(t), counts: {}, total: 0, fixShare: null, botShare: null });
    }
    return out;
  };
  const relBy = (key) => releases.reduce((m, r) => m.set(key(r.ts.slice(0, 10)), (m.get(key(r.ts.slice(0, 10))) ?? 0) + 1), new Map());
  const tag = (rows, relMap) => rows.map((r) => ({ ...r, rel: relMap.get(r.d) ?? 0 }));
  const today = dayOf(now);
  const daily = tag(extend(dailyRaw, 1, today), relBy((d) => d));
  const weekly = tag(extend(weeklyRaw, 7, mondayOf(today)), relBy(mondayOf));
  const metric = (r) => (state.tab === 'releases' ? r.rel : r.total);
  const state = { tab: 'type', view: 'week', hidden: new Set(), vendors: new Set(vendors), overlays: new Set(['avg']) };
  let chart;

  const cats = ORDER_CATS(Object.keys(summary.totals.byCategory));

  // ---- header, stats ----
  const tabs = [['type', 'By type'], ['changes', changelog ? 'Changes' : 'Commits'], ...(changelog ? [['releases', 'Releases']] : [])];
  const stat = (k, v) => el('div', { className: 'stat' }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: String(v) }));
  const stats = [stat(changelog ? 'Bullets' : 'Commits', summary.totals.events.toLocaleString('en-US'))];
  if (changelog) stats.push(stat('Versions', summary.totals.versions));
  stats.push(stat(changelog ? 'Median release day' : 'Median active day', summary.medianPerReleaseDay ?? '–'));
  if (summary.busiestDay) stats.push(stat(`Busiest day (${fmt(summary.busiestDay.d)})`, summary.busiestDay.n));
  if (!changelog && summary.totals.events) {
    const bots = dailyRaw.reduce((s, r) => s + Math.round((r.botShare ?? 0) * r.total), 0);
    stats.push(stat('Bot-authored', `${Math.round((bots / summary.totals.events) * 100)}%`));
  }
  $('stats').replaceChildren(...stats);
  $('meta').textContent = `${fmt(summary.firstDate, true)} – ${fmt(summary.lastDate, true)} · UTC days · median counts ${changelog ? 'bullets on days with at least one release' : 'commits on days with at least one commit'}`;
  $('updated').textContent = `Data updated ${summary.generatedAt.slice(0, 16).replace('T', ' ')} UTC`;

  function renderControls() {
    $('tabs').replaceChildren(...tabs.map(([k, label]) => el('button', {
      type: 'button', textContent: label, role: 'tab', ariaSelected: String(state.tab === k),
      onclick: () => { state.tab = k; render(); },
    })));
    const view = el('div', { className: 'seg' }, ...['week', 'day'].map((v) => el('button', {
      type: 'button', textContent: v === 'week' ? 'Per week' : 'Per day', ariaPressed: String(state.view === v),
      onclick: () => { state.view = v; render(); },
    })));
    const check = (label, on, set, key) => el('label', {}, el('input', {
      type: 'checkbox', checked: on, onchange: (e) => { e.target.checked ? set.add(key) : set.delete(key); render(); },
    }), label);
    const overlays = [];
    if (state.view === 'day') overlays.push(check('7-day average', state.overlays.has('avg'), state.overlays, 'avg'));
    if (state.tab !== 'releases') overlays.push(check('Fix share', state.overlays.has('fix'), state.overlays, 'fix'));
    if (!changelog && state.tab !== 'releases') overlays.push(check('Bot share', state.overlays.has('bot'), state.overlays, 'bot'));
    $('controls').replaceChildren(view, ...overlays, ...vendors.map((v) => check(`${VENDORS[v] ?? v} releases`, state.vendors.has(v), state.vendors, v)));
  }

  // ---- chart ----
  function render() {
    renderControls();
    const view = state.view;
    const unit = view === 'week' ? 7 : 1;
    let rows = view === 'week' ? weekly : daily;
    const avg = daily.map((_, i) => daily.slice(Math.max(0, i - 6), i + 1).reduce((s, r) => s + metric(r), 0) / 7);
    const from = rows.length - (view === 'day' ? DAY_WINDOW : rows.length);
    const avgSeries = view === 'day' ? avg.slice(Math.max(0, from)) : [];
    rows = rows.slice(Math.max(0, from));
    const anchor = Date.parse(`${rows[0].d}T00:00:00Z`);
    const end = anchor + rows.length * unit * DAY;
    const curIdx = rows.findIndex((r) => Date.parse(`${r.d}T00:00:00Z`) <= now && now < Date.parse(`${r.d}T00:00:00Z`) + unit * DAY);
    const fade = (hex) => (c) => (c.dataIndex === curIdx ? `${hex}73` : hex);

    $('subtitle').textContent = state.tab === 'releases' ? `Versions released per ${view}.`
      : changelog ? `Changes count every changelog line item in the period's releases. Per ${view}${view === 'day' ? `, last ${DAY_WINDOW} days` : ''}.`
        : `Commits on the default branch (first-parent). Per ${view}${view === 'day' ? `, last ${DAY_WINDOW} days` : ''}.`;
    $('title').textContent = state.tab === 'type' ? `${noun} by type, per ${view}` : state.tab === 'releases' ? `Releases per ${view}` : `${noun} per ${view}`;

    const bar = { stack: 's', borderWidth: 0, categoryPercentage: 1, barPercentage: 0.9, order: 2 };
    const datasets = state.tab === 'type'
      ? cats.map((c) => ({ ...bar, label: cap(c), data: rows.map((r) => r.counts[c] ?? 0), backgroundColor: fade(PAL[c]), hidden: state.hidden.has(c) }))
      : [{ ...bar, label: state.tab === 'releases' ? 'Versions' : noun, data: rows.map(metric), backgroundColor: fade(state.tab === 'releases' ? ACCENT : PAL.fixed) }];
    const line = (label, data, color, yAxisID) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHitRadius: 0, tension: 0.2, yAxisID, order: 1, spanGaps: false });
    if (state.overlays.has('avg') && view === 'day') datasets.push(line('7-day average', avgSeries, '#ffffff', 'y'));
    if (state.overlays.has('fix') && state.tab !== 'releases') datasets.push(line('Fix share', rows.map((r) => r.fixShare), ACCENT, 'y1'));
    if (state.overlays.has('bot') && !changelog && state.tab !== 'releases') datasets.push(line('Bot share', rows.map((r) => r.botShare), '#ec6f9b', 'y1'));
    const pct = datasets.some((d) => d.yAxisID === 'y1');

    // Marker numbers are assigned in date order over the visible model entries.
    const inRange = (a) => state.vendors.has(a.vendor) && vendors.includes(a.vendor) && Date.parse(a.date) < end && Date.parse(a.end ?? a.date) + DAY > anchor;
    const models = annotations.filter((a) => a.kind === 'model' && inRange(a)).sort((a, b) => (a.date + a.label < b.date + b.label ? -1 : 1));
    const periods = annotations.filter((a) => a.kind === 'period' && inRange(a));

    renderLegend(models.length, periods.length);
    renderChips(models, periods);

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
      return sx.getPixelForValue(0) - slot / 2 + ((t - anchor) / (unit * DAY)) * slot;
    };
    const overlay = {
      id: 'overlay',
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
        ctx.restore();
      },
      afterDraw(chart) {
        const { ctx, chartArea: a } = chart;
        const small = narrow();
        const rowEnd = [];
        chart.$markers = [];
        ctx.save();
        models.forEach((m, i) => {
          const x = toX(chart, Date.parse(m.date) + DAY / 2);
          if (x < a.left || x > a.right) return;
          let r = rowEnd.findIndex((e) => x - e >= 24);
          if (r < 0) r = Math.min(rowEnd.length, 2);
          rowEnd[r] = x;
          const y = a.top - 14 - r * 22;
          ctx.strokeStyle = MARKER; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x, small ? a.top : y + 9); ctx.lineTo(x, a.bottom); ctx.stroke();
          ctx.setLineDash([]);
          if (!small) {
            ctx.fillStyle = '#12151a'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); ctx.stroke();
            ctx.fillStyle = MARKER; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), x, y + 0.5);
          }
          chart.$markers.push({ n: i + 1, x, y: small ? null : y });
        });
        ctx.restore();
      },
    };

    chart?.destroy();
    chart = new Chart($('chart'), {
      type: 'bar',
      data: { labels: rows.map((r) => r.d), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: narrow() ? 6 : 70 } },
        interaction: { mode: 'index', intersect: false },
        onClick: (e, _els, ch) => {
          const hit = ch.getElementsAtEventForMode(e, 'index', { intersect: false }, true)[0];
          if (hit) openDrill(rows[hit.index].d, view);
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (items) => (view === 'week' ? `Week of ${fmt(items[0].label, true)}` : fmt(items[0].label, true)),
            footer: (items) => (state.tab === 'type' ? `Total: ${rows[items[0].dataIndex].total}` : ''),
          } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: narrow() ? 5 : 10, callback(v) { return fmt(this.getLabelForValue(v)); } } },
          y: { stacked: true, beginAtZero: true, grid: { color: '#1b1f25' }, ticks: { maxTicksLimit: 6 } },
          y1: { display: pct, position: 'right', min: 0, max: 1, grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${Math.round(v * 100)}%` } },
        },
      },
      plugins: [overlay],
    });
    // Test hooks read by test/browser.spec.js.
    chart.$periods = periods;
    window.__chart = chart;
  }

  function renderLegend(nMarkers, nPeriods) {
    const item = (cls, text) => el('span', {}, el('span', { className: `sw ${cls}` }), text);
    const cat = (c) => el('button', {
      type: 'button', ariaPressed: String(!state.hidden.has(c)),
      onclick: () => { state.hidden.has(c) ? state.hidden.delete(c) : state.hidden.add(c); render(); },
    }, el('span', { className: 'sw', style: `background:${PAL[c]}` }), cap(c));
    $('legend').replaceChildren(
      ...(state.tab === 'type' ? cats.map(cat) : []),
      ...(nMarkers ? [item('marker', 'Public model release')] : []),
      ...(nPeriods ? [item('period', 'Context period (approx.)')] : []),
      item('fade', 'Faded bar: incomplete period'), item('hatch', 'Not yet collected'));
  }

  function renderChips(models, periods) {
    $('chips').replaceChildren(
      ...models.map((m, i) => el('a', { className: 'chip', href: m.source, target: '_blank', rel: 'noopener', title: m.source, style: 'text-decoration:none;color:inherit' },
        el('span', { className: 'dot' }), el('span', { className: 'n', textContent: String(i + 1) }), `${m.label} · ${fmt(m.date)}`)),
      ...periods.map((p) => el('a', { className: 'chip', href: p.source, target: '_blank', rel: 'noopener', title: p.source, style: 'text-decoration:none;color:inherit' },
        el('span', { className: 'sq' }), `${p.label} · ${fmt(p.date)}–${fmt(p.end ?? p.date)}`)));
  }

  // ---- drill-down ----
  async function openDrill(d, view) {
    const to = view === 'week' ? dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY) : d;
    const months = [...new Set(dailyRaw.filter((r) => r.d >= d && r.d <= to && r.total > 0).map((r) => r.d.slice(0, 7)))];
    const events = (await Promise.all(months.map((m) => get(`${D}${id}/months/${m}.json`)))).flat()
      .filter((e) => e.ts.slice(0, 10) >= d && e.ts.slice(0, 10) <= to);
    $('drill-title').textContent = view === 'week' ? `Week of ${fmt(d, true)} · ${events.length} events` : `${fmt(d, true)} · ${events.length} events`;
    const body = $('drill-table').tBodies[0];
    body.replaceChildren();
    let last;
    for (const e of events) {
      const day = e.ts.slice(0, 10);
      if (view === 'week' && day !== last) {
        body.append(el('tr', { className: 'day' }, el('th', { colSpan: 4, textContent: `${fmt(day, true)} · ${events.filter((x) => x.ts.startsWith(day)).length} events` })));
        last = day;
      }
      const ref = e.version ?? e.sha.slice(0, 7);
      body.append(el('tr', { className: 'ev' },
        el('td', { dataset: { label: changelog ? 'Version' : 'Commit' } }, e.url ? el('a', { href: e.url, target: '_blank', rel: 'noopener', textContent: ref }) : ref),
        el('td', { dataset: { label: 'Type' } }, el('span', { className: 'tag', style: `background:${PAL[e.category]}`, textContent: e.category })),
        el('td', { dataset: { label: 'Source' }, textContent: e.source }, ...(e.bot ? [el('span', { className: 'badge', textContent: 'bot' })] : [])),
        el('td', { dataset: { label: 'Change' }, textContent: e.text })));
    }
    $('drill-empty').hidden = events.length > 0;
    $('drill-table').hidden = events.length === 0;
    $('drill').hidden = false;
    if (view === 'day') history.replaceState(null, '', `#${d}`);
    $('drill').scrollIntoView({ block: 'nearest' });
  }
  $('drill-close').onclick = () => { $('drill').hidden = true; history.replaceState(null, '', location.pathname); };

  const fromHash = () => {
    const m = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
    if (m) { state.view = 'day'; render(); return openDrill(m[1], 'day'); }
  };
  render();
  await fromHash();
  addEventListener('hashchange', fromHash);
  addEventListener('resize', () => chart.update());
}

function ORDER_CATS(keys) {
  const order = Object.keys(PAL);
  return order.filter((c) => keys.includes(c));
}

async function indexPage() {
  const projects = await get('./data/projects.json');
  const items = await Promise.all(projects.map(async (p) => {
    const s = await get(`./data/${p.id}/summary.json`);
    return el('li', {}, el('a', { href: `./${p.id}/` },
      el('div', { className: 'name', textContent: p.name }),
      el('div', { className: 'info', textContent: `${s.basis === 'changelog' ? 'Changelog bullets' : 'Commits'} · ${s.totals.events.toLocaleString('en-US')} · updated ${s.generatedAt.slice(0, 10)}` })));
  }));
  $('projects').replaceChildren(...items);
}

(document.body.dataset.project ? projectPage : indexPage)();
})();
