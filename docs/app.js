(() => {
  // The four product-change buckets, in stack and legend order (dataviz reference dark-palette steps; every adjacent
  // pair passes the CVD and normal-vision checks on the panel surface). Any category outside them — maintenance
  // (chore, test, docs, ci), other, or one the build adds later — is not a product change and is not counted.
  // Changing a colour or the order: re-run the dataviz skill's validate_palette.js with the new hex list in this
  // order against both panel surfaces, `--mode dark --surface '#12151a'` and `--mode light --surface '#ffffff'`, and keep
  // only an order that passes both (stack gaps cover a CVD WARN). The same hexes serve both schemes.
  const GROUPS = [
    { key: 'changed', color: '#c98500', cats: ['changed', 'improved'] },
    { key: 'fixed', color: '#3987e5', cats: ['fixed'] },
    { key: 'added', color: '#008300', cats: ['added'] },
    { key: 'removed', color: '#e66767', cats: ['removed', 'revert'] },
  ];
  const groupOf = (cat) => GROUPS.find((g) => g.cats.includes(cat)) ?? null;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const ROLL = 4; // weeks in the rolling fix share window and in each KPI window
  const PX_PER_WEEK = 12; // narrow screens: the chart scrolls sideways at this width per week

  const $ = (id) => document.getElementById(id);
  // The canvas cannot use CSS variables, so the chart asks for them at paint time: setting one as a hidden element's
  // colour resolves its light-dark() pair for the current scheme. Nothing is cached, so a scheme change needs only a redraw.
  const ink = Object.assign(document.createElement('i'), { hidden: true });
  const css = (name) => {
    ink.style.color = `var(--${name})`;
    return getComputedStyle(ink).color;
  };
  const el = (tag, { dataset, ...props } = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    Object.assign(n.dataset, dataset);
    n.append(...kids);
    return n;
  };
  const ext = (href, text, className) =>
    el('a', { className, href, target: '_blank', rel: 'noopener', textContent: text });
  const get = (path) =>
    fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    });
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
  const mondayOf = (d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
  };
  /** Within the last year a date needs no year; `year` asks for one on older dates. */
  const recent = (d) => Date.parse(`${d}T00:00:00Z`) > Date.now() - 365 * DAY;
  const fmt = (d, year) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(year && !recent(d) ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  const weekEnd = (d) => dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY);
  const span = (ws) => `${fmt(ws[0].d)} – ${fmt(weekEnd(ws.at(-1).d))}`;
  /** One week as "Oct 5 – 11" or "Sep 28 – Oct 4"; with `year`, an older week reads "Oct 6 – 12, 2025" or "Dec 30, 2024 – Jan 5, 2025". */
  const weekSpan = (d, year) => {
    const e = weekEnd(d);
    const [a, b] = [d, e].map((x) => new Date(`${x}T00:00:00Z`));
    const withYear = year && !recent(d);
    const start = withYear && a.getUTCFullYear() !== b.getUTCFullYear() ? `${fmt(d)}, ${a.getUTCFullYear()}` : fmt(d);
    const end = a.getUTCMonth() === b.getUTCMonth() ? b.getUTCDate() : fmt(e);
    return `${start} – ${end}${withYear ? `, ${b.getUTCFullYear()}` : ''}`;
  };
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const LAST = 'codebase-trends:project';
  const THEME = 'codebase-trends:theme'; // the head of page.html and index.html reads it too, to apply a picked theme before the first paint
  // Storage throws when the browser blocks it; remembering is optional. A null value forgets.
  const remembered = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const remember = (key, value) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  };
  // The button cycles through these; the current one is the root's data-theme, absent for auto (the OS decides).
  // Icons are SVG in the text colour: font glyphs for them render tiny or as emoji, depending on the platform.
  const icon = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
  const THEMES = [
    {
      key: 'auto',
      icon: icon(
        '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/>',
      ),
    },
    {
      key: 'light',
      icon: icon(
        '<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
      ),
    },
    {
      key: 'dark',
      icon: icon('<path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" fill="currentColor"/>'),
    },
  ];
  const narrow = () => matchMedia('(max-width: 719px)').matches;
  // A pointer reads the tooltip by hovering, so one click acts; touch needs a tap to read first, then a second to act.
  // Rejected: a button inside the tooltip (needs an HTML tooltip pinned on click) and a "show list" line under the chart
  // (repeated what the tooltip already said); a hint line in the tooltip footer is the whole affordance.
  const hover = () => matchMedia('(hover: hover)').matches;

  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const fixes = (r) => (r.counts.fixed ?? 0) + (r.counts.revert ?? 0);
  /** Product changes in a row: every category that belongs to a group. */
  const shown = (r) => sum(Object.keys(r.counts), (c) => (groupOf(c) ? r.counts[c] : 0));
  /** Pooled fix share over rows; null when no product change landed. */
  const pooledFix = (rows) => {
    const d = sum(rows, shown);
    return d === 0 ? null : sum(rows, fixes) / d;
  };
  /** Median of a list of sizes (not assumed sorted); null when empty. */
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null;
  };

  async function projectPage() {
    const id = document.body.dataset.project;
    const changelog = document.body.dataset.basis === 'changelog';
    const D = '../data/';
    const [projects, annotations, summary, dailyRaw, weeklyRaw, releases] = await Promise.all([
      get(`${D}projects.json`),
      get(`${D}annotations.json`),
      get(`${D}${id}/summary.json`),
      get(`${D}${id}/daily.json`),
      get(`${D}${id}/weekly.json`),
      changelog ? get(`${D}${id}/releases.json`) : [],
    ]);
    const project = projects.find((p) => p.id === id);
    const vendors = project.annotations;
    remember(LAST, id);
    document.body.append(ink);
    $('switch').replaceChildren(
      ...projects.map((p) => el('option', { value: p.id, textContent: p.name, selected: p.id === id })),
    );
    $('switch').addEventListener('change', (e) => {
      location.href = `../${e.target.value}/`;
    });
    const now = Date.now();
    const generatedAt = Date.parse(summary.generatedAt);
    const noun = changelog ? 'Changelog items' : 'Commits';

    // Weekly rows extended with empty rows up to the current week so the not-yet-collected span is on the axis.
    const rows = [...weeklyRaw];
    for (let t = Date.parse(`${rows.at(-1).d}T00:00:00Z`) + WEEK; dayOf(t) <= mondayOf(dayOf(now)); t += WEEK) {
      rows.push({ d: dayOf(t), counts: {}, total: 0 });
    }
    const anchor = Date.parse(`${rows[0].d}T00:00:00Z`);
    const end = anchor + rows.length * WEEK;
    const curIdx = rows.findIndex((r) => {
      const t = Date.parse(`${r.d}T00:00:00Z`);
      return t <= now && now < t + WEEK;
    });
    const catsOf = (g) => Object.keys(summary.totals.byCategory).filter((c) => groupOf(c) === g);
    const groups = GROUPS.filter((g) => catsOf(g).length);
    const counted = sum(Object.entries(summary.totals.byCategory), ([c, n]) => (groupOf(c) ? n : 0));
    const setAside = summary.totals.events - counted;

    // ---- KPIs: the last ROLL complete weeks (fewer when the history is shorter), against the ROLL weeks before ----
    const kpiEnd = curIdx < 0 ? rows.length : curIdx;
    const last = rows.slice(Math.max(0, kpiEnd - ROLL), kpiEnd);
    const ref = kpiEnd >= 2 * ROLL ? rows.slice(kpiEnd - 2 * ROLL, kpiEnd - ROLL) : []; // the ROLL weeks right before
    const inWeeks = (ws) =>
      releases.filter((r) => r.ts.slice(0, 10) >= ws[0].d && r.ts.slice(0, 10) <= weekEnd(ws.at(-1).d)).length;
    const perWeek = (f) => (ws) => (ws.length ? f(ws) / ws.length : null);
    const what = noun.toLowerCase();
    const FIX = 'Fixes %';
    const SIZE = 'Commit size';
    // ---- three layers of explanation: one question on the page; a definition as the hover gloss of every label that uses
    // it; and the help panel at the foot, listing the definitions and the data's provenance, opened by any jump into it ----
    $('lede').textContent =
      `How much of ${summary.name}'s work each week is new capability, and how much is correction?`;
    const aside = changelog
      ? 'items that announce rather than change something'
      : 'maintenance commits (chores, tests, docs, CI) and unreadable subjects';
    const one = changelog ? 'A changelog item' : 'A commit';
    const DEFS = {
      // id → [name, definition]; each is the gloss of its term links and one entry of the help dialog
      counted: [
        noun,
        `${one} counts when it added, fixed, changed (including improved) or removed something (including reverts). ` +
          `Not counted: ${setAside.toLocaleString('en-US')} ${aside}.`,
      ],
      added: ['New features / week', `${noun} that added something, per week.`],
      fix: [
        FIX,
        `(fixed + reverts) ÷ ${what}. On the chart, each week is pooled with the ${ROLL - 1} before it, so one quiet week does not swing the line.`,
      ],
      ...(changelog
        ? { versions: ['Versions released / week', 'npm releases of the package, per week.'] }
        : {
            lines: [
              SIZE,
              'Median lines added + deleted per commit, against its first parent. A median ignores one sweeping commit. Commits with no recorded size are left out.',
            ],
          }),
      window: [
        'Window and prior period',
        `Each tile covers the last ${last.length} complete week${last.length === 1 ? '' : 's'}${last.length ? ` (${span(last)})` : ''}; ` +
          `the line under it compares with the ${ROLL} weeks before${ref.length ? ` (${span(ref)})` : ''}. Weeks start Monday 00:00 UTC.`,
      ],
    };
    const term = (id, text) =>
      el('a', { className: 'term', href: `#fn-${id}`, title: `${DEFS[id][0]}: ${DEFS[id][1]}`, textContent: text });
    $('defs').replaceChildren(
      ...Object.entries(DEFS).map(([id, [name, text]]) =>
        el('div', { id: `fn-${id}` }, el('dt', { textContent: name }), el('dd', { textContent: text })),
      ),
    );
    const help = $('help');
    const openHelp = (id) => {
      // at the entry `id`, marked and scrolled to; without one, from the top
      if (!help.open) help.showModal();
      for (const d of $('defs').children) d.classList.toggle('current', d.id === `fn-${id}`);
      if (id) $(`fn-${id}`).scrollIntoView({ block: 'center' });
      else help.scrollTop = 0;
    };
    // A term link opens the dialog itself rather than jumping to its hash, so a day deep link (#YYYY-MM-DD) in the URL survives.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a.term');
      if (a) {
        e.preventDefault();
        openHelp(a.hash.slice(4));
      }
    });
    $('info').addEventListener('click', () => openHelp());
    $('help-close').addEventListener('click', () => help.close());
    help.addEventListener('click', (e) => {
      if (e.target === help) help.close();
    }); // the backdrop; the body fills the dialog, so only it is the target there
    help.addEventListener('close', () => {
      if (/^#fn-/.test(location.hash)) history.replaceState(null, '', location.pathname);
    }); // a shared #fn-… link, once read, should not reopen on reload
    const fromHelpHash = () => {
      const m = /^#fn-(\w+)$/.exec(location.hash);
      if (m && DEFS[m[1]]) openHelp(m[1]);
    };
    fromHelpHash(); // a shared #fn-… link: the entries exist only now
    addEventListener('hashchange', fromHelpHash);
    $('meta').replaceChildren(
      `updated ${new Date(generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', ...(recent(dayOf(generatedAt)) ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })} · ${counted.toLocaleString('en-US')} `,
      term('counted', what),
    );

    const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±');
    const change = (a, b, share) => {
      // rounded first, so a change that rounds to 0 reads ±0
      if (!share && b === 0) return '–';
      const d = Math.round(share ? (a - b) * 100 : (a / b - 1) * 100);
      return `${sign(d)}${Math.abs(d)}${share ? ' pts' : '%'}`;
    };
    const kpis = [
      // id: the definition the label links
      { k: `${noun} / week`, id: 'counted', f: perWeek((ws) => sum(ws, shown)), show: (v) => v.toFixed(0) },
      {
        k: 'New features / week',
        id: 'added',
        f: perWeek((ws) => sum(ws, (r) => r.counts.added ?? 0)),
        show: (v) => v.toFixed(0),
      },
      { k: FIX, id: 'fix', f: pooledFix, show: pct, share: true },
      ...(changelog
        ? [{ k: 'Versions released / week', id: 'versions', f: perWeek(inWeeks), show: (v) => v.toFixed(1) }]
        : [{ k: SIZE, id: 'lines', f: (ws) => median(ws.flatMap((r) => r.lines ?? [])), show: (v) => v.toFixed(0) }]),
    ];
    $('kpis').replaceChildren(
      ...kpis.map(({ k, id, f, show, share }) => {
        const a = last.length ? f(last) : null;
        const b = ref.length ? f(ref) : null;
        const vs =
          a == null || b == null
            ? ['no prior period']
            : [el('b', { textContent: change(a, b, share) }), ' vs ', term('window', 'prior period'), ` (${show(b)})`];
        return el(
          'div',
          { className: 'kpi' },
          el('div', { className: 'k' }, term(id, k)),
          el('div', { className: 'v', textContent: a == null ? '–' : show(a) }),
          el('div', { className: 'ref' }, ...vs),
        );
      }),
    );

    // ---- provenance, the second half of the help panel ----
    const repoName = (url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '');
    const source = project.source; // the one public URL the build publishes per project
    const lead = (text) => el('b', { textContent: `${text} ` });
    $('about-body').replaceChildren(
      el(
        'p',
        {},
        lead('Source.'),
        ...(changelog
          ? [
              'One item per bullet of ',
              source ? ext(source, 'CHANGELOG.md') : 'the changelog',
              ", dated by the version's npm publish time.",
            ]
          : [
              'One item per commit on the main branch of ',
              source ? ext(source, repoName(source)) : 'the repository',
              ', dated by commit time.',
            ]),
      ),
      el(
        'p',
        {},
        lead('Categories.'),
        `Each ${what.replace(/s$/, '')} gets one category from its wording: added, fixed, changed or removed. A language model decides when the wording does not say.`,
      ),
      el('p', {}, lead('Updates.'), 'Collected every six hours. The header shows when the data last changed.'),
    );

    // ---- shared chart furniture: not-yet-collected hatch, model markers ----
    const inRange = (a) => vendors.includes(a.vendor) && Date.parse(a.date) < end && Date.parse(a.date) + DAY > anchor;
    const major = annotations
      .filter((a) => a.kind === 'model' && a.major && inRange(a))
      .sort((a, b) => (a.date + a.label < b.date + b.label ? -1 : 1));
    const patterns = new Map(); // one hatch tile per stroke colour, so a hover redraw reuses it
    const pattern = (stroke) => {
      if (!patterns.has(stroke)) {
        const c = el('canvas', { width: 8, height: 8 });
        const g = c.getContext('2d');
        g.strokeStyle = stroke;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, 8);
        g.lineTo(8, 0);
        g.stroke();
        patterns.set(stroke, c);
      }
      return patterns.get(stroke);
    };
    const toX = (chart, t) => {
      const sx = chart.scales.x;
      const slot = sx.getPixelForValue(1) - sx.getPixelForValue(0);
      return sx.getPixelForValue(0) - slot / 2 + ((t - anchor) / WEEK) * slot;
    };
    let selected = -1; // index of the week last clicked: highlighted; on touch, a second tap on it opens its list
    const furniture = {
      id: 'furniture',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a } = chart;
        ctx.save();
        chart.$selected = null;
        if (selected >= 0) {
          // a lighter column behind the picked week's bars
          const x0 = Math.max(a.left, toX(chart, anchor + selected * WEEK));
          const x1 = Math.min(a.right, toX(chart, anchor + (selected + 1) * WEEK));
          chart.$selected = { x0, x1, width: Math.max(0, x1 - x0) };
          ctx.fillStyle = css('pick');
          ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        }
        const x0 = Math.max(a.left, toX(chart, generatedAt));
        const x1 = Math.min(a.right, toX(chart, now));
        chart.$hatch = { x0, x1, width: Math.max(0, x1 - x0) };
        if (x1 > x0) {
          ctx.fillStyle = ctx.createPattern(pattern(css('hatch')), 'repeat');
          ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        }
        const entry = $('legend-hatch'); // the legend only explains a hatch that is on screen
        if (entry) entry.hidden = x1 - x0 < 1; // a sub-pixel hatch right after a sync is not on screen
        ctx.restore();
      },
      afterDraw(chart) {
        const { ctx, chartArea: a } = chart;
        const rowEnd = [];
        const [marker, panel] = [css('marker'), css('panel')];
        chart.$markers = [];
        ctx.save();
        major.forEach((m, i) => {
          const x = Math.round(toX(chart, Date.parse(m.date) + DAY / 2)) + 0.5; // on the pixel grid: a 1px line off it blurs to gray
          if (x < a.left || x > a.right) return;
          let r = rowEnd.findIndex((e) => x - e >= 20); // badges are 18px wide; closer than that, go up a row
          if (r < 0) r = Math.min(rowEnd.length, 2);
          rowEnd[r] = x;
          const y = a.top - 14 - r * 22;
          ctx.strokeStyle = marker;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(x, y + 9);
          ctx.lineTo(x, a.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = panel;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, 7);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = marker;
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), x, y + 0.5);
          chart.$markers.push({ n: i + 1, x, y });
        });
        ctx.restore();
      },
    };
    const weekTitle = (i) =>
      `${weekSpan(rows[i].d, true)} · ${shown(rows[i])} ${changelog ? 'items' : 'commits'}${i === curIdx ? ' so far' : ''}`; // short: it must fit a phone-width tooltip
    const onClick = (e, _els, ch) => {
      const hit = ch.getElementsAtEventForMode(e, 'index', { intersect: false }, true)[0];
      if (!hit) return;
      const again = hit.index === selected;
      selected = hit.index;
      chart.update();
      if (hover() || again) openDrill(rows[selected].d, 'week');
    };

    // ---- fix share: rolling window over the preceding weeks, nothing past the current week ----
    const rolling = rows.map((_, i) =>
      curIdx >= 0 && i > curIdx ? null : pooledFix(rows.slice(Math.max(0, i - ROLL + 1), i + 1)),
    );
    $('title').textContent = `${noun} per week`;
    $('subtitle').textContent = `${hover() ? 'Click' : 'Tap twice on'} a week to list its ${what}.`;

    // ---- one chart: stacked weekly bars by group, the rolling fix share drawn over them on a 0–100% axis ----
    // The second y-axis is the owner's call against the dataviz one-axis rule: a separate fix-share chart above the
    // bars with a synced crosshair was built and rejected as harder to read together. Keep the overlay; the halo
    // dataset keeps the line legible over tall bars.
    // Narrow screens get a fixed width per week inside a sideways-scrolling wrapper, opened at the latest week.
    // `layout` re-applies this whenever the viewport changes.
    const scroll = $('chart').closest('.chart-scroll');
    const wrap = $('chart').parentElement;
    const layout = (ch) => {
      const small = narrow();
      wrap.style.width = small ? `${Math.max(scroll.clientWidth, rows.length * PX_PER_WEEK)}px` : '';
      if (ch) {
        ch.options.scales.x.ticks.maxTicksLimit = small ? 8 : 10;
        ch.update();
      }
      if (small) scroll.scrollLeft = scroll.scrollWidth;
    };
    // While the chart scrolls, each axis stays in view as a copy of its strip of the chart canvas, repainted on every
    // draw, in a canvas pinned over that edge of the scroller. The panel fill hides the bars scrolling underneath.
    // Copied before the markers and tooltip are drawn, and only down to where the date labels start (under the x-axis
    // tick space), so no fragment of them stays pinned over other weeks.
    const [pinL, pinR] = ['left', 'right'].map((side) => document.querySelector(`.axis-pin.${side}`));
    const pins = {
      id: 'pins',
      afterDatasetsDraw(chart) {
        const {
          canvas,
          chartArea: a,
          currentDevicePixelRatio: dpr,
          scales: { x },
        } = chart;
        const fill = css('panel');
        const cut = Math.round((x.top + x.options.grid.tickLength) * dpr);
        for (const [p, x0, x1] of [
          [pinL, 0, a.left],
          [pinR, a.right, chart.width],
        ]) {
          p.hidden = scroll.scrollWidth <= scroll.clientWidth;
          if (p.hidden) continue;
          const [sx, sw, sh] = [Math.round(x0 * dpr), Math.round((x1 - x0) * dpr), canvas.height];
          if (p.width !== sw || p.height !== sh) {
            // resizing clears the bitmap, so only when the axis size changed
            Object.assign(p, { width: sw, height: sh });
            Object.assign(p.style, { width: `${sw / dpr}px`, height: `${sh / dpr}px` });
          }
          const g = p.getContext('2d');
          g.fillStyle = fill;
          g.fillRect(0, 0, sw, sh);
          g.drawImage(canvas, sx, 0, sw, cut, 0, 0, sw, cut);
        }
      },
    };
    layout();
    const fade = (hex) => (c) => (c.dataIndex === curIdx ? `${hex}73` : hex);
    const line = (label, color, width, order) => ({
      type: 'line',
      label,
      data: rolling,
      yAxisID: 'y1',
      borderColor: color,
      backgroundColor: color,
      borderWidth: width,
      pointRadius: 0,
      pointHitRadius: 8,
      tension: 0.2,
      spanGaps: false,
      order,
    });
    const chart = new Chart($('chart'), {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.d),
        datasets: [
          ...groups.map((g) => ({
            label: cap(g.key),
            data: rows.map((r) => sum(catsOf(g), (c) => r.counts[c] ?? 0)),
            backgroundColor: fade(g.color),
            stack: 's',
            borderColor: () => css('panel'),
            borderWidth: { top: 1 },
            borderSkipped: false,
            categoryPercentage: 1,
            barPercentage: 0.85,
            order: 2,
          })),
          line('halo', () => css('panel'), 5, 1), // an outline in the panel colour keeps the line legible over bars of any colour
          line(FIX, () => css('accent'), 2, 0),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 70 } },
        interaction: { mode: 'index', intersect: false },
        events: ['mousemove', 'mouseout', 'click'], // not touchstart/touchmove: a finger drag scrolls, a tap (click) shows the week and opens its list
        onClick,
        plugins: {
          legend: { display: false },
          tooltip: {
            // the week and its total in the title, the buckets that landed, the line last, the hint muted
            filter: (it) =>
              it.dataset.label !== 'halo' &&
              (it.dataset.type === 'line' || it.parsed.y > 0 || shown(rows[it.dataIndex]) === 0), // zero buckets drop out, unless the week is empty: the title needs an item
            itemSort: (a, b) => (a.dataset.type === 'line') - (b.dataset.type === 'line'),
            backgroundColor: () => css('tip-bg'),
            borderColor: () => css('tip-line'),
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            caretSize: 6,
            titleColor: () => css('tip-text'),
            bodyColor: () => css('tip-text'),
            titleFont: { weight: '600' },
            titleMarginBottom: 8,
            bodySpacing: 4,
            boxWidth: 8,
            boxHeight: 8,
            boxPadding: 4,
            footerFont: { weight: 'normal' },
            footerColor: () => css('muted'),
            footerMarginTop: 8,
            callbacks: {
              title: (items) => weekTitle(items[0].dataIndex),
              label: (it) => `${it.dataset.label}  ${it.dataset.label === FIX ? pct(it.parsed.y) : it.parsed.y}`,
              footer: () => [hover() ? 'Click to list' : 'Tap again to list'],
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: narrow() ? 8 : 10,
              callback(v) {
                return fmt(this.getLabelForValue(v));
              },
            },
          }, // layout() keeps this in step
          y: { stacked: true, beginAtZero: true, grid: { color: () => css('grid') }, ticks: { maxTicksLimit: 6 } },
          y1: {
            position: 'right',
            min: 0,
            max: 1,
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 0.25, callback: (v) => pct(v), color: () => css('accent') },
          },
        },
      },
      plugins: [furniture, pins],
    });
    window.__chart = chart; // test hook read by test/browser.spec.js

    const item = (cls, text, props = {}) => el('span', props, el('span', { className: `sw ${cls}` }), text);
    $('legend').replaceChildren(
      ...groups.map((g) => el('span', {}, el('span', { className: 'sw', style: `background:${g.color}` }), cap(g.key))),
      el('span', {}, el('span', { className: 'sw line' }), el('span', {}, term('fix', FIX), ' (right axis)')),
      ...(major.length ? [el('span', {}, el('span', { className: 'sw marker' }), 'Major model release')] : []),
      item('hatch', 'Not yet collected', { id: 'legend-hatch', hidden: true }),
    );
    chart.update(); // the hatch legend entry is decided inside the draw, which ran before the entry existed
    const link = (a, ...kids) =>
      el(
        'a',
        {
          className: 'chip',
          href: a.source,
          target: '_blank',
          rel: 'noopener',
          title: `${a.label} · ${fmt(a.date, true)} · ${a.source}`,
          style: 'text-decoration:none;color:inherit',
        },
        ...kids,
      );
    // Dates are hidden on narrow screens (the marker on the chart gives them) and always in the chip's title.
    $('chips').replaceChildren(
      ...major.map((m, i) =>
        link(
          m,
          el('span', { className: 'dot' }),
          el('span', { className: 'n', textContent: String(i + 1) }),
          m.label,
          el('span', { className: 'date', textContent: ` · ${fmt(m.date)}` }),
        ),
      ),
    );

    // ---- drill-down ----
    async function openDrill(d, view) {
      const to = view === 'week' ? dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY) : d;
      const months = [
        ...new Set(dailyRaw.filter((r) => r.d >= d && r.d <= to && r.total > 0).map((r) => r.d.slice(0, 7))),
      ];
      const events = (await Promise.all(months.map((m) => get(`${D}${id}/months/${m}.json`))))
        .flat()
        .filter((e) => e.ts.slice(0, 10) >= d && e.ts.slice(0, 10) <= to && groupOf(e.category)); // the list matches the bar
      $('drill-title').textContent = `${view === 'week' ? weekSpan(d, true) : fmt(d, true)} · ${events.length} ${what}`;
      // One line per item under group headers: changelog items by version (the version is the reference, named once
      // in its header); commits by day in the week view, each with its sha. The day view of commits needs no header.
      const keyOf = changelog ? (e) => e.version : view === 'week' ? (e) => e.ts.slice(0, 10) : () => '';
      const groups = [];
      for (const e of events) {
        if (!groups.length || keyOf(e) !== groups.at(-1).key) groups.push({ key: keyOf(e), items: [] });
        groups.at(-1).items.push(e);
      }
      const list = $('drill-list');
      list.replaceChildren(
        ...groups.flatMap(({ key, items }) => {
          const [e] = items;
          const n = `${items.length} ${what}`;
          const head = changelog
            ? el('h3', {}, e.url ? ext(e.url, e.version) : e.version, ` · ${fmt(e.ts.slice(0, 10), true)} · ${n}`)
            : key
              ? el('h3', { textContent: `${fmt(key, true)} · ${n}` })
              : null;
          const ul = el(
            'ul',
            {},
            ...items.map((e) => {
              const group = groupOf(e.category); // never null: the filter above kept only grouped events
              return el(
                'li',
                { className: 'ev' },
                el('span', { className: 'tag', style: `--c:${group.color}`, textContent: e.category }), // stored label, bucket colour
                el(
                  'span',
                  { className: 'text', textContent: e.text },
                  ...(e.bot ? [el('span', { className: 'badge', textContent: 'bot' })] : []),
                ),
                ...(changelog
                  ? []
                  : [
                      e.url
                        ? ext(e.url, e.sha.slice(0, 7), 'ref')
                        : el('span', { className: 'ref', textContent: e.sha.slice(0, 7) }),
                    ]),
              );
            }),
          );
          return head ? [head, ul] : [ul];
        }),
      );
      list.scrollTop = 0;
      $('drill-empty').textContent = `No ${what}.`;
      $('drill-empty').hidden = events.length > 0;
      list.hidden = events.length === 0;
      $('drill').hidden = false;
      if (view === 'day') history.replaceState(null, '', `#${d}`);
      $('drill').scrollIntoView({ block: 'nearest' });
    }
    $('drill-close').onclick = () => {
      $('drill').hidden = true;
      selected = -1;
      chart.update();
      history.replaceState(null, '', location.pathname);
    };

    const fromHash = () => {
      const m = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
      if (!m) return;
      selected = rows.findIndex((r) => r.d === mondayOf(m[1]));
      chart.update();
      return openDrill(m[1], 'day');
    };
    await fromHash();
    addEventListener('hashchange', fromHash);
    addEventListener('resize', () => layout(chart));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => chart.update()); // repaint in the new scheme
    const root = document.documentElement;
    const current = () => THEMES.findIndex((t) => t.key === (root.dataset.theme ?? 'auto'));
    const nextTheme = () => THEMES[(current() + 1) % THEMES.length];
    const showTheme = () => {
      const t = THEMES[current()];
      const label = `Theme: ${t.key}. Click for ${nextTheme().key}.`;
      Object.assign($('theme'), { innerHTML: t.icon, title: label, ariaLabel: label });
    };
    showTheme();
    $('theme').addEventListener('click', () => {
      const { key } = nextTheme();
      if (key === 'auto') delete root.dataset.theme;
      else root.dataset.theme = key;
      remember(THEME, key === 'auto' ? null : key);
      showTheme();
      chart.update(); // the canvas reads the new colours on redraw
    });
  }

  // The root has no content of its own: it opens the last project viewed, else the first configured.
  async function indexPage() {
    const ids = (await get('./data/projects.json')).map((p) => p.id);
    const last = remembered(LAST);
    location.replace(`./${ids.includes(last) ? last : ids[0]}/`);
  }

  (document.body.dataset.project ? projectPage : indexPage)();
})();
