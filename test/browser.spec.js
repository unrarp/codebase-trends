import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.js';

const ROOT = fileURLToPath(new URL('./fixtures/build', import.meta.url));
const NOW = Date.parse('2026-10-14T12:00:00.000Z'); // fixture generatedAt
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PREFIX = '/codebase-trends/';

const out = mkdtempSync(join(tmpdir(), 'ct-browser-'));
build({ root: ROOT, out, now: new Date(NOW) });

let server;
let base;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    let file = url.startsWith(PREFIX) ? join(out, normalize(url.slice(PREFIX.length))) : null;
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}${PREFIX}`;
});
test.afterAll(() => server.close());

async function open(page, path, at = NOW) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.setFixedTime(at);
  await page.goto(base + path);
  if (path !== '') await page.waitForFunction(() => window.__chart);
  return errors;
}
const slot = (page) => page.evaluate(() => { const s = __chart.scales.x; return s.getPixelForValue(1) - s.getPixelForValue(0); });

for (const [name, viewport] of [['desktop 1280x800', { width: 1280, height: 800 }], ['mobile 375x812', { width: 375, height: 812 }]]) {
  test.describe(name, () => {
    test.use({ viewport });
    const mobile = viewport.width < 720;

    test('loads with no console errors, bars drawn, causation footnote', async ({ page }) => {
      const errors = await open(page, 'claude-code/');
      await expect(page.locator('#kpis .kpi')).toHaveCount(4);
      const bars = await page.evaluate(() => __chart.getDatasetMeta(0).data.length);
      expect(bars).toBeGreaterThan(0);
      await expect(page.locator('#fn-markers')).toContainText('proximity does not establish causation');
      await expect(page.locator('#fn-window')).toContainText('Weeks start Monday 00:00 UTC');
      expect(errors).toEqual([]);
    });

    test('clicking a bar opens the drill-down table', async ({ page }) => {
      await open(page, 'claude-code/');
      await page.locator('#chart').scrollIntoViewIfNeeded();
      const { x, y } = await page.evaluate(() => {
        const rows = __chart.data.datasets.filter((d) => d.type !== 'line').map((d) => d.data);
        const totals = rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0));
        const i = totals.indexOf(Math.max(...totals));
        const box = __chart.canvas.getBoundingClientRect();
        return { x: box.left + __chart.getDatasetMeta(0).data[i].x, y: box.top + __chart.chartArea.bottom - 3 };
      });
      await page.mouse.click(x, y);
      await expect(page.locator('#drill')).toBeVisible();
      expect(await page.locator('#drill tbody tr.ev').count()).toBeGreaterThan(0);
    });

    test('#YYYY-MM-DD opens the table on load, no horizontal overflow', async ({ page }) => {
      const errors = await open(page, 'claude-code/#2026-08-31');
      await expect(page.locator('#drill')).toBeVisible();
      await expect(page.locator('#drill tbody tr.ev')).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });

    test('3-day-old generatedAt renders a hatched region covering those days', async ({ page }) => {
      await open(page, 'claude-code/', NOW + 3 * 86_400_000);
      const { width } = await page.evaluate(() => __chart.$hatch);
      expect(Math.abs(width - (3 / 7) * (await slot(page)))).toBeLessThan(1);
      await expect(page.locator('#legend-hatch')).toBeVisible();
    });

    test('fresh data has no hatched region beyond the current day', async ({ page }) => {
      await open(page, 'claude-code/');
      expect((await page.evaluate(() => __chart.$hatch)).width).toBeLessThan(await slot(page));
      await expect(page.locator('#legend-hatch')).toBeHidden();
    });

    test('model markers days apart do not collide', async ({ page }) => {
      await open(page, 'claude-code/');
      const m = await page.evaluate(() => __chart.$markers);
      expect(m.map((k) => k.n)).toEqual([1]);
      // only major annotations get a chip; the fixture's Model B is minor and openai's period is not in view
      expect(await page.locator('#chips .chip').count()).toBe(1);
      expect(await page.locator('#chips .chip .date').first().isVisible()).toBe(!mobile); // dates only on wide screens
      await expect(page.locator('#legend')).toContainText('Major model release');
      expect(m[0].y).not.toBeNull(); // badges are drawn in both viewports
    });

    test('sparse commits project shows four KPI tiles, the last one commit size with its own note', async ({ page }) => {
      await open(page, 'sparse/');
      await expect(page.locator('#kpis .kpi')).toHaveCount(4);
      await expect(page.locator('#kpis .kpi').last().locator('.k')).toContainText('Commit size');
      await expect(page.locator('#fn-lines')).toBeVisible();
      await expect(page.locator('#fn-lines')).toContainText('added + deleted');
      await open(page, 'claude-code/');
      await expect(page.locator('#fn-lines')).toBeHidden(); // changelog items have no size; the note is not numbered
    });

    test('KPI tiles name the window and compare with the prior period', async ({ page }) => {
      await open(page, 'claude-code/');
      await expect(page.locator('#fn-window')).toContainText('last 4 complete weeks');
      await expect(page.locator('#fn-fix')).toContainText('Fixes %');
      const refs = page.locator('#kpis .kpi .ref');
      expect(await refs.count()).toBe(4);
      for (const t of await refs.allTextContents()) expect(t).toContain('vs prior period');
    });

    test('fix share line is the 4-week pooled share of the weekly rows', async ({ page }) => {
      await open(page, 'claude-code/');
      const fix = await page.evaluate(() => { const d = __chart.data.datasets.find((x) => x.label === 'Fixes %'); return { axis: d.yAxisID, v: d.data }; });
      expect(fix.axis).toBe('y1');
      const vals = fix.v.filter((v) => v !== null);
      expect(vals.length).toBeGreaterThan(0);
      expect(vals.every((v) => v >= 0 && v <= 1)).toBe(true);
      const weekly = JSON.parse(readFileSync(join(out, 'data/claude-code/weekly.json'), 'utf8'));
      const c = (r, k) => r.counts[k] ?? 0;
      const pooled = (rows) => {
        const den = rows.reduce((s, r) => s + ['added', 'fixed', 'changed', 'improved', 'removed', 'revert'].reduce((a, k) => a + c(r, k), 0), 0); // the four counted buckets
        return den === 0 ? null : rows.reduce((s, r) => s + c(r, 'fixed') + c(r, 'revert'), 0) / den;
      };
      const want = weekly.map((_, i) => pooled(weekly.slice(Math.max(0, i - 3), i + 1)));
      expect(fix.v.length).toBe(want.length);
      expect(want.filter((v) => v !== null && v !== 0).length).toBeGreaterThan(0); // the fixture has weeks where the denominator matters
      want.forEach((w, i) => (w === null ? expect(fix.v[i]).toBeNull() : expect(fix.v[i]).toBeCloseTo(w, 10)));
    });

    test('narrow screens scroll the chart to the latest week with the count axis on the right', async ({ page }) => {
      test.skip(!mobile, 'mobile only');
      // the fixture spans too few weeks to overflow 375px at 12px a week, so pad 40 empty weeks before it
      await page.route('**/data/claude-code/weekly.json', async (route) => {
        const res = await route.fetch();
        const w = await res.json();
        const pad = Array.from({ length: 40 }, (_, k) => ({ d: new Date(Date.parse(w[0].d) - (40 - k) * 7 * 86_400_000).toISOString().slice(0, 10), counts: {}, total: 0 }));
        await route.fulfill({ response: res, json: [...pad, ...w] });
      });
      await open(page, 'claude-code/');
      const m = await page.evaluate(() => { const s = document.querySelector('.chart-scroll'); return { sw: s.scrollWidth, cw: s.clientWidth, left: s.scrollLeft, pos: __chart.scales.y.position }; });
      expect(m.sw).toBeGreaterThan(m.cw);
      expect(Math.abs(m.left - (m.sw - m.cw))).toBeLessThanOrEqual(2);
      expect(m.pos).toBe('right');
    });

    test('wide screens fit the chart to the page with the count axis on the left', async ({ page }) => {
      test.skip(mobile, 'desktop only');
      await open(page, 'claude-code/');
      expect(await page.evaluate(() => document.querySelector('.chart-wrap').style.width)).toBe('');
      expect(await page.evaluate(() => __chart.scales.y.position)).toBe('left');
    });

    test('period entries draw as a context band', async ({ page }) => {
      await open(page, 'sparse/');
      expect(await page.evaluate(() => __chart.$periods.length)).toBe(1);
      await expect(page.locator('#chips')).toContainText('Quiet week');
      await expect(page.locator('#legend')).toContainText('Context period');
    });

    test('root opens the first project, then the last one viewed', async ({ page }) => {
      const errors = await open(page, '');
      await page.waitForURL(`${base}claude-code/`);
      await open(page, 'sparse/');
      await page.goto(base);
      await page.waitForURL(`${base}sparse/`);
      expect(errors).toEqual([]);
    });

    test('switcher lists every project and navigates to the chosen one', async ({ page }) => {
      await open(page, 'claude-code/');
      await expect(page.locator('#switch option')).toHaveText(['Claude Code', 'Sparse']);
      await expect(page.locator('#switch')).toHaveValue('claude-code');
      await page.locator('#switch').selectOption('sparse');
      await page.waitForURL(`${base}sparse/`);
      await expect(page.locator('#switch')).toHaveValue('sparse');
    });

    test('blocked storage still renders the page and redirects the root', async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }));
      const errors = await open(page, 'sparse/');
      await page.goto(base);
      await page.waitForURL(`${base}claude-code/`);
      await page.waitForFunction(() => window.__chart);
      expect(errors).toEqual([]);
    });
  });
}

test('a category outside the four buckets is not drawn and not counted, and the note says so', async ({ page }) => {
  await page.route('**/data/claude-code/summary.json', async (route) => {
    const res = await route.fetch();
    const s = await res.json();
    s.totals.byCategory.mystery = 5; s.totals.events += 5;
    await route.fulfill({ response: res, json: s });
  });
  await page.route('**/data/claude-code/weekly.json', async (route) => {
    const res = await route.fetch();
    const w = await res.json();
    w[0].counts.mystery = 5; w[0].total += 5; // first week carries the unknown category
    await route.fulfill({ response: res, json: w });
  });
  const errors = await open(page, 'claude-code/');
  await expect(page.locator('#legend')).toHaveText(/^ChangedFixedAddedRemoved/);
  const first = JSON.parse(readFileSync(join(out, 'data/claude-code/weekly.json'), 'utf8'))[0].counts;
  const counted = ['added', 'fixed', 'changed', 'improved', 'removed'].reduce((s, k) => s + (first[k] ?? 0), 0);
  expect(await page.evaluate(() => __chart.data.datasets.filter((d) => !d.type).reduce((s, d) => s + d.data[0], 0))).toBe(counted); // mystery and other excluded
  const other = JSON.parse(readFileSync(join(out, 'data/claude-code/summary.json'), 'utf8')).totals.byCategory.other;
  await expect(page.locator('#fn-counted')).toContainText(`Not counted: ${5 + other} items that announce rather than change something`); // 5 mystery + the fixture's other
  const events = JSON.parse(readFileSync(join(out, 'data/claude-code/summary.json'), 'utf8')).totals.events;
  await expect(page.locator('#meta')).toContainText(`${events + 5 - other - 5} changelog items`); // header counts only the four buckets
  expect(errors).toEqual([]);
});

test('the week list and tooltip total exclude set-aside items and label rows by stored category', async ({ page }) => {
  const months = readdirSync(join(out, 'data/claude-code/months')).map((f) => JSON.parse(readFileSync(join(out, 'data/claude-code/months', f), 'utf8'))).flat();
  const monday = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10); };
  const byWeek = Map.groupBy(months, (e) => monday(e.ts.slice(0, 10)));
  const [week, evs] = [...byWeek].find(([, es]) => es.some((e) => e.category === 'other') && es.some((e) => e.category !== 'other')); // a week with both kinds
  const counted = evs.filter((e) => e.category !== 'other').length;
  await open(page, 'claude-code/');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const { x, y, total } = await page.evaluate((week) => {
    const i = __chart.data.labels.indexOf(week);
    const box = __chart.canvas.getBoundingClientRect();
    return { x: box.left + __chart.getDatasetMeta(0).data[i].x, y: box.top + __chart.chartArea.bottom - 3, total: __chart.options.plugins.tooltip.callbacks.footer([{ dataIndex: i }]) };
  }, week);
  expect(total).toBe(`Total: ${counted}`); // tooltip total matches the stack, not the stored row total
  await page.mouse.click(x, y);
  await expect(page.locator('#drill')).toBeVisible();
  await expect(page.locator('#drill-title')).toContainText(`${counted} changelog items`);
  expect(await page.locator('#drill tbody tr.ev').count()).toBe(counted);
  await expect(page.locator('#drill tbody .tag', { hasText: 'other' })).toHaveCount(0);
});

test('fewer than four complete weeks: the note names the shorter window', async ({ page }) => {
  await page.route('**/data/claude-code/weekly.json', async (route) => {
    const res = await route.fetch();
    const w = await res.json();
    await route.fulfill({ response: res, json: w.slice(-3) }); // 2 complete weeks + the current one
  });
  await open(page, 'claude-code/');
  await expect(page.locator('#fn-window')).toContainText('last 2 complete weeks');
  await expect(page.locator('#fn-window')).not.toContainText('4 complete weeks');
});

test('resizing across the breakpoint moves the count axis and scrolls to the latest week', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/data/claude-code/weekly.json', async (route) => {
    const res = await route.fetch();
    const w = await res.json();
    const pad = Array.from({ length: 40 }, (_, k) => ({ d: new Date(Date.parse(w[0].d) - (40 - k) * 7 * 86_400_000).toISOString().slice(0, 10), counts: {}, total: 0 }));
    await route.fulfill({ response: res, json: [...pad, ...w] });
  });
  await open(page, 'claude-code/');
  expect(await page.evaluate(() => __chart.scales.y.position)).toBe('left');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => __chart.scales.y.position === 'right');
  const m = await page.evaluate(() => { const s = document.querySelector('.chart-scroll'); return { sw: s.scrollWidth, cw: s.clientWidth, left: s.scrollLeft }; });
  expect(m.sw).toBeGreaterThan(m.cw);
  expect(Math.abs(m.left - (m.sw - m.cw))).toBeLessThanOrEqual(2);
});

test('commit size is the median over the window\'s sizes, compared with the prior window', async ({ page }) => {
  await page.route('**/data/sparse/weekly.json', async (route) => {
    const rows = JSON.parse(readFileSync(join(out, 'data/sparse/weekly.json'), 'utf8'));
    for (const r of rows) {
      if (r.d === '2026-09-28') r.lines = [10, 30];
      if (r.d === '2026-10-05') r.lines = [20];
    }
    await route.fulfill({ json: rows });
  });
  await open(page, 'sparse/');
  const tile = page.locator('#kpis .kpi').last();
  await expect(tile.locator('.v')).toHaveText('20'); // median of 10, 20, 30 in the last 4 complete weeks
  await expect(tile.locator('.ref')).toHaveText('−50% vs prior period (40)'); // the revert d4 (40 lines) in the 4 weeks before
});
