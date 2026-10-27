import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route, test } from '@playwright/test';
import { PREFIX, siteServer } from '../scripts/dev.ts';
import { build } from '../src/build.ts';
import type { Annotation, CountRow, Counts, MonthEvent } from '../src/types.ts';

const ROOT = fileURLToPath(new URL('./fixtures/build', import.meta.url));
const NOW = Date.parse('2026-10-14T12:00:00.000Z'); // fixture generatedAt

type Marker = { n: number; x: number; y: number | null };
type Element2D = { x: number; options: { borderColor: string } };
/** The slice of the Chart.js instance that the site exposes as `window.__chart` and these tests read. */
type ChartHook = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  currentDevicePixelRatio: number;
  chartArea: { left: number; right: number; bottom: number };
  scales: {
    x: { top: number; getPixelForValue(value: number): number; options: { grid: { tickLength: number } } };
    y: { position: string };
  };
  data: { labels: string[]; datasets: { type?: string; label: string; yAxisID?: string; data: (number | null)[] }[] };
  options: { plugins: { tooltip: { callbacks: { title(items: { dataIndex: number }[]): string } } } };
  tooltip: { opacity: number; title: string[]; footer: string[] };
  getDatasetMeta(index: number): { data: Element2D[]; dataset: { options: { borderColor: string } } };
  getActiveElements(): unknown[];
  $selected: { width: number } | null;
  $hatch: { width: number };
  $markers: Marker[];
};
declare global {
  var __chart: ChartHook;
}

// Built in beforeAll, not at load: Playwright also loads this file in its main process, which runs no hooks.
let out = '';
let server: Server | undefined;
let base = '';
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-browser-'));
  out = dir;
  build({ root: ROOT, out: dir, now: new Date(NOW) });
  const s = siteServer(dir);
  server = s;
  await new Promise<void>((r) => s.listen(0, r));
  const addr = s.address();
  if (!addr || typeof addr === 'string') throw new Error('site server has no port');
  base = `http://localhost:${addr.port}${PREFIX}`;
});
test.afterAll(() => {
  // also after a failed beforeAll, which may leave server unset
  server?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(page: Page, path: string, at = NOW) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.setFixedTime(at);
  await page.goto(base + path);
  if (path !== '') await page.waitForFunction(() => window.__chart);
  return errors;
}
const slot = (page: Page) =>
  page.evaluate(() => {
    const s = __chart.scales.x;
    return s.getPixelForValue(1) - s.getPixelForValue(0);
  });
// Chart.js handles canvas events once per animation frame, so two synthetic clicks in one frame collapse into the last.
const frame = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// The fixture spans too few weeks to overflow 375px at 12px a week, so pad 40 empty weeks before it.
const padWeeks = async (route: Route) => {
  const res = await route.fetch();
  const w = await res.json();
  const pad = Array.from({ length: 40 }, (_, k) => ({
    d: new Date(Date.parse(w[0].d) - (40 - k) * 7 * 86_400_000).toISOString().slice(0, 10),
    counts: {},
    total: 0,
  }));
  await route.fulfill({ response: res, json: [...pad, ...w] });
};
// Each pin sits on its edge of the scroller, as wide as its axis, and shows the axis the chart drew there: tick labels
// (a colour off the panel) and the same pixels as that strip of the chart canvas, wherever the scroller is. Below the
// y-axis it shows only panel: the first date label spills into the left strip and must not stay pinned. Touches on a
// pin fall through to the chart, so a swipe that starts on an axis still scrolls it.
async function expectPinned(page: Page) {
  await page.locator('.chart-frame').scrollIntoViewIfNeeded(); // elementFromPoint sees only the viewport, and the chart sits below the fold on a phone
  const pins = await page.evaluate(() => {
    const must = <T>(x: T | null): T => {
      if (x === null) throw new Error('missing element or context');
      return x;
    };
    const s = must(document.querySelector('.chart-scroll')).getBoundingClientRect();
    const c = __chart.canvas;
    const dpr = __chart.currentDevicePixelRatio;
    const a = __chart.chartArea;
    const cut = Math.round((__chart.scales.x.top + __chart.scales.x.options.grid.tickLength) * dpr) * 4; // in bytes per column
    const strip = (x0: number, x1: number) =>
      must(c.getContext('2d')).getImageData(Math.round(x0 * dpr), 0, Math.round((x1 - x0) * dpr), c.height).data;
    const strips: [side: string, x0: number, x1: number][] = [
      ['left', 0, a.left],
      ['right', a.right, __chart.width],
    ];
    return strips.map(([side, x0, x1]) => {
      const p = must(document.querySelector<HTMLCanvasElement>(`.axis-pin.${side}`));
      const r = p.getBoundingClientRect();
      const ink = strip(x0, x1);
      const own = must(p.getContext('2d')).getImageData(0, 0, p.width, p.height).data;
      const below = cut * p.width; // bytes before the first row under the y-axis
      let inked = 0;
      let differ = 0;
      const under = new Set();
      for (let i = 3; i < ink.length; i += 4) {
        if (i > below) {
          under.add(own.slice(i - 3, i + 1).join());
          continue;
        }
        if (ink[i] > 0) inked++;
        if (ink[i] === 255 && (ink[i - 3] !== own[i - 3] || ink[i - 2] !== own[i - 2] || ink[i - 1] !== own[i - 1]))
          differ++; // opaque chart pixels copy over exactly
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        side,
        through: hit === c,
        x: r.left - s.left,
        right: s.right - r.right,
        w: r.width,
        axisW: x1 - x0,
        inked,
        differ,
        under: under.size,
        sizes: own.length === ink.length,
      };
    });
  });
  for (const p of pins) {
    expect(p.sizes, p.side).toBe(true);
    expect(Math.abs(p.w - p.axisW), p.side).toBeLessThanOrEqual(1);
    expect(Math.abs(p.side === 'left' ? p.x : p.right), p.side).toBeLessThanOrEqual(1);
    expect(p.inked, p.side).toBeGreaterThan(0);
    expect(p.differ, p.side).toBe(0);
    expect(p.under, p.side).toBe(1); // one colour: the panel
    expect(p.through, p.side).toBe(true);
  }
}

const viewports: [name: string, viewport: { width: number; height: number }][] = [
  ['desktop 1280x800', { width: 1280, height: 800 }],
  ['mobile 375x812', { width: 375, height: 812 }],
];
for (const [name, viewport] of viewports) {
  test.describe(name, () => {
    test.use({ viewport });
    const mobile = viewport.width < 720;

    test('loads with no console errors, bars drawn', async ({ page }) => {
      const errors = await open(page, 'claude-code/');
      await expect(page.locator('#kpis .kpi')).toHaveCount(4);
      const bars = await page.evaluate(() => __chart.getDatasetMeta(0).data.length);
      expect(bars).toBeGreaterThan(0);
      await expect(page.locator('#fn-window')).toContainText('Weeks start Monday 00:00 UTC');
      expect(errors).toEqual([]);
    });

    test('with a pointer, one click highlights the week and opens its list, changelog items grouped under their version', async ({
      page,
    }) => {
      await open(page, 'claude-code/');
      await page.locator('#chart').scrollIntoViewIfNeeded();
      const { x, y } = await page.evaluate(() => {
        const rows = __chart.data.datasets.filter((d) => d.type !== 'line').map((d) => d.data);
        const totals = rows[0].map((_, i) => rows.reduce((s, r) => s + (r[i] ?? 0), 0));
        const i = totals.indexOf(Math.max(...totals));
        const box = __chart.canvas.getBoundingClientRect();
        return { x: box.left + __chart.getDatasetMeta(0).data[i].x, y: box.top + __chart.chartArea.bottom - 3 };
      });
      await page.mouse.move(x, y);
      await frame(page);
      await expect(page.locator('#drill')).toBeHidden(); // hovering only reads
      expect(await page.evaluate(() => __chart.tooltip.footer)).toEqual(['Click to list']); // the hint is there before any click
      expect(await page.evaluate(() => __chart.tooltip.title[0])).toMatch(/^\w+ \d+ – (\w+ )?\d+ · \d+ items$/); // short enough for a phone-width tooltip
      await page.mouse.click(x, y);
      await frame(page);
      await expect(page.locator('#drill')).toBeVisible();
      expect(await page.evaluate(() => __chart.$selected)).toEqual(
        expect.objectContaining({ width: expect.any(Number) }),
      ); // the listed week is highlighted
      expect(await page.locator('#drill li.ev').count()).toBeGreaterThan(0);
      await expect(page.locator('#drill-list h3 a').first()).toHaveText(/^\d+\.\d+\.\d+$/); // the version heads its group
      await expect(page.locator('#drill li.ev .ref')).toHaveCount(0); // and is not repeated per item
    });

    test('commits basis: each item links its sha, the day view has no group header', async ({ page }) => {
      await open(page, 'sparse/#2026-08-21');
      await expect(page.locator('#drill')).toBeVisible();
      await expect(page.locator('#drill li.ev .ref').first()).toHaveText(/^[0-9a-f]{1,7}$/);
      await expect(page.locator('#drill-list h3')).toHaveCount(0);
    });

    test('#YYYY-MM-DD opens the list on load, no horizontal overflow', async ({ page }) => {
      const errors = await open(page, 'claude-code/#2026-08-31');
      await expect(page.locator('#drill')).toBeVisible();
      await expect(page.locator('#drill li.ev')).toHaveCount(4);
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

    test('only major model releases get a marker and a chip', async ({ page }) => {
      await open(page, 'claude-code/');
      const m = await page.evaluate(() => __chart.$markers);
      expect(m.map((k) => k.n)).toEqual([1]);
      // only major annotations get a chip; the fixture's Model B is minor
      expect(await page.locator('#chips .chip').count()).toBe(1);
      expect(await page.locator('#chips .chip .date').first().isVisible()).toBe(!mobile); // dates only on wide screens
      await expect(page.locator('#legend')).toContainText('Major model release');
      expect(m[0].y).not.toBeNull(); // badges are drawn in both viewports
    });

    test('model markers a day apart stack instead of colliding', async ({ page }) => {
      await page.route('**/data/annotations.json', async (route) => {
        const res = await route.fetch();
        await route.fulfill({
          response: res,
          json: (await res.json()).map((a: Annotation) => ({ ...a, major: true })),
        }); // Model B, a day after A
      });
      await open(page, 'claude-code/');
      const m = await page.evaluate(() => __chart.$markers);
      expect(m.map((k) => k.n)).toEqual([1, 2]);
      expect(Math.abs(m[1].x - m[0].x)).toBeLessThan(20); // closer than a badge is wide: on one row they would overlap
      expect(m[1].y).not.toBe(m[0].y);
    });

    test('sparse commits project shows four KPI tiles, the last one commit size with its own note', async ({
      page,
    }) => {
      await open(page, 'sparse/');
      await expect(page.locator('#kpis .kpi')).toHaveCount(4);
      await expect(page.locator('#kpis .kpi').last().locator('.k')).toContainText('Commit size');
      await page.locator('#info').click();
      if (mobile)
        expect(await page.locator('#help').evaluate((d) => Math.round(d.getBoundingClientRect().width))).toBe(375); // a full-width sheet, past the browser's default dialog margin
      await page.locator('#fn-lines').scrollIntoViewIfNeeded();
      await expect(page.locator('#help-close')).toBeInViewport(); // the head stays put while the body scrolls
      await expect(page.locator('#fn-lines')).toBeVisible();
      await expect(page.locator('#fn-lines')).toContainText('added + deleted');
      await open(page, 'claude-code/');
      await expect(page.locator('#fn-lines')).toHaveCount(0); // changelog items have no size
    });

    test('KPI tiles name the window and compare with the prior period', async ({ page }) => {
      await open(page, 'claude-code/');
      await expect(page.locator('#fn-window')).toContainText('last 4 complete weeks');
      await expect(page.locator('#fn-fix')).toContainText('Fixes %');
      const refs = page.locator('#kpis .kpi .ref');
      expect(await refs.count()).toBe(4);
      for (const t of await refs.allTextContents()) expect(t).toContain('vs prior period');
    });

    // sparse: its revert counts as a fix, which the changelog project cannot show
    for (const id of ['claude-code', 'sparse'])
      test(`fix share line is the 4-week pooled share of the weekly rows: ${id}`, async ({ page }) => {
        await open(page, `${id}/`);
        const fix = await page.evaluate(() => {
          const d = __chart.data.datasets.find((x) => x.label === 'Fixes %');
          if (!d) throw new Error('no Fixes % line');
          return { axis: d.yAxisID, v: d.data };
        });
        expect(fix.axis).toBe('y1');
        const vals = fix.v.filter((v) => v !== null);
        expect(vals.length).toBeGreaterThan(0);
        expect(vals.every((v) => v >= 0 && v <= 1)).toBe(true);
        const weekly: CountRow[] = JSON.parse(readFileSync(join(out, `data/${id}/weekly.json`), 'utf8'));
        const c = (r: CountRow, k: keyof Counts) => r.counts[k] ?? 0;
        const pooled = (rows: CountRow[]) => {
          const den = rows.reduce(
            (s, r) =>
              s +
              (['added', 'fixed', 'changed', 'improved', 'removed', 'revert'] as const).reduce(
                (a, k) => a + c(r, k),
                0,
              ),
            0,
          ); // the four counted buckets
          return den === 0 ? null : rows.reduce((s, r) => s + c(r, 'fixed') + c(r, 'revert'), 0) / den;
        };
        const want = weekly.map((_, i) => pooled(weekly.slice(Math.max(0, i - 3), i + 1)));
        expect(fix.v.length).toBe(want.length);
        expect(want.filter((v) => v !== null && v !== 0).length).toBeGreaterThan(0); // the fixture has weeks where the denominator matters
        want.forEach((w, i) => {
          if (w === null) expect(fix.v[i]).toBeNull();
          else expect(fix.v[i]).toBeCloseTo(w, 10);
        });
      });

    test('narrow screens scroll the chart to the latest week with both axes pinned in view', async ({ page }) => {
      test.skip(!mobile, 'mobile only');
      await page.route('**/data/claude-code/weekly.json', padWeeks);
      await open(page, 'claude-code/');
      const m = await page.locator('.chart-scroll').evaluate((s) => ({
        sw: s.scrollWidth,
        cw: s.clientWidth,
        left: s.scrollLeft,
        pos: __chart.scales.y.position,
      }));
      expect(m.sw).toBeGreaterThan(m.cw);
      expect(Math.abs(m.left - (m.sw - m.cw))).toBeLessThanOrEqual(2);
      expect(m.pos).toBe('left');
      await expectPinned(page);
      await page.locator('.chart-scroll').evaluate((s) => {
        s.scrollLeft = 0;
      });
      await expectPinned(page);
    });

    test('wide screens fit the chart to the page with the count axis on the left', async ({ page }) => {
      test.skip(mobile, 'desktop only');
      await open(page, 'claude-code/');
      expect(await page.locator('.chart-wrap').evaluate((w) => (w as HTMLElement).style.width)).toBe('');
      expect(await page.evaluate(() => __chart.scales.y.position)).toBe('left');
      await expect(page.locator('.axis-pin')).toHaveCount(2);
      for (const pin of await page.locator('.axis-pin').all()) await expect(pin).toBeHidden();
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
      await page.addInitScript(() =>
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        }),
      );
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
    s.totals.byCategory.mystery = 5;
    s.totals.events += 5;
    await route.fulfill({ response: res, json: s });
  });
  await page.route('**/data/claude-code/weekly.json', async (route) => {
    const res = await route.fetch();
    const w = await res.json();
    w[0].counts.mystery = 5;
    w[0].total += 5; // first week carries the unknown category
    await route.fulfill({ response: res, json: w });
  });
  const errors = await open(page, 'claude-code/');
  await expect(page.locator('#legend')).toHaveText(/^ChangedFixedAddedRemoved/);
  const first = JSON.parse(readFileSync(join(out, 'data/claude-code/weekly.json'), 'utf8'))[0].counts;
  const counted = ['added', 'fixed', 'changed', 'improved', 'removed'].reduce((s, k) => s + (first[k] ?? 0), 0);
  expect(
    await page.evaluate(() => __chart.data.datasets.filter((d) => !d.type).reduce((s, d) => s + (d.data[0] ?? 0), 0)),
  ).toBe(counted); // mystery and other excluded
  const other = JSON.parse(readFileSync(join(out, 'data/claude-code/summary.json'), 'utf8')).totals.byCategory.other;
  await expect(page.locator('#fn-counted')).toContainText(
    `Not counted: ${5 + other} items that announce rather than change something`,
  ); // 5 mystery + the fixture's other
  const events = JSON.parse(readFileSync(join(out, 'data/claude-code/summary.json'), 'utf8')).totals.events;
  await expect(page.locator('#meta')).toContainText(`${events + 5 - other - 5} changelog items`); // header counts only the four buckets
  expect(errors).toEqual([]);
});

test('the week list and tooltip total exclude set-aside items and label rows by stored category', async ({ page }) => {
  const months: MonthEvent[] = readdirSync(join(out, 'data/claude-code/months')).flatMap((f) =>
    JSON.parse(readFileSync(join(out, 'data/claude-code/months', f), 'utf8')),
  );
  const monday = (d: string) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  };
  const byWeek = Map.groupBy(months, (e) => monday(e.ts.slice(0, 10)));
  const found = [...byWeek].find(
    ([, es]) => es.some((e) => e.category === 'other') && es.some((e) => e.category !== 'other'),
  ); // a week with both kinds
  if (!found) throw new Error('the fixture has no week with both kinds');
  const [week, evs] = found;
  const counted = evs.filter((e) => e.category !== 'other').length;
  await open(page, 'claude-code/');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const { x, y, total } = await page.evaluate((week) => {
    const i = __chart.data.labels.indexOf(week);
    const box = __chart.canvas.getBoundingClientRect();
    return {
      x: box.left + __chart.getDatasetMeta(0).data[i].x,
      y: box.top + __chart.chartArea.bottom - 3,
      total: __chart.options.plugins.tooltip.callbacks.title([{ dataIndex: i }]),
    };
  }, week);
  expect(total).toContain(` · ${counted} items`); // tooltip total matches the stack, not the stored row total
  await page.mouse.click(x, y);
  await expect(page.locator('#drill')).toBeVisible();
  await expect(page.locator('#drill-title')).toContainText(`${counted} changelog items`);
  expect(await page.locator('#drill li.ev').count()).toBe(counted);
  await expect(page.locator('#drill li .tag', { hasText: 'other' })).toHaveCount(0);
});

test('a finger drag over the chart does not move the tooltip; a tap picks the week, a second tap lists it', async ({
  browser,
}) => {
  const page = await (await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } })).newPage();
  await open(page, 'claude-code/');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const active = await page.evaluate(async () => {
    const c = __chart.canvas;
    const box = c.getBoundingClientRect();
    const at = (i: number) => ({
      clientX: box.left + __chart.getDatasetMeta(0).data[i].x,
      clientY: box.top + __chart.chartArea.bottom - 3,
    });
    const moves: [type: string, i: number][] = [
      ['touchstart', 1],
      ['touchmove', 2],
      ['touchmove', 3],
    ];
    for (const [type, i] of moves) {
      const touch = new Touch({ identifier: 1, target: c, ...at(i) });
      c.dispatchEvent(
        new TouchEvent(type, { touches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }),
      );
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20))); // Chart.js handles moves on the next frame
    }
    return { n: __chart.getActiveElements().length, opacity: __chart.tooltip.opacity };
  });
  expect(active).toEqual({ n: 0, opacity: 0 });
  await expect(page.locator('#drill')).toBeHidden();
  const { x, y } = await page.evaluate(() => {
    const box = __chart.canvas.getBoundingClientRect();
    return { x: box.left + __chart.getDatasetMeta(0).data[2].x, y: box.top + __chart.chartArea.bottom - 3 };
  });
  await page.touchscreen.tap(x, y);
  await frame(page);
  await expect(page.locator('#drill')).toBeHidden(); // no hover: the first tap only shows the popover
  expect(await page.evaluate(() => [__chart.tooltip.opacity, __chart.tooltip.footer])).toEqual([
    1,
    ['Tap again to list'],
  ]);
  await page.touchscreen.tap(x, y);
  await expect(page.locator('#drill')).toBeVisible();
  await page.locator('#drill-close').tap();
  await frame(page); // closing forgets the pick: the next tap reads again
  expect(await page.evaluate(() => __chart.$selected)).toBeNull();
  await page.touchscreen.tap(x, y);
  await frame(page);
  await expect(page.locator('#drill')).toBeHidden();
});

test('hovering a week with no items and no rolling share shows a tooltip without throwing', async ({ page }) => {
  const errors = await open(page, 'sparse/');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const { x, y, title } = await page.evaluate(() => {
    const i = __chart.data.labels.length - 1; // the fixture's last weeks are empty, so the rolling share is null there
    const box = __chart.canvas.getBoundingClientRect();
    return {
      x: box.left + __chart.getDatasetMeta(0).data[i].x,
      y: box.top + __chart.chartArea.bottom - 3,
      title: __chart.options.plugins.tooltip.callbacks.title([{ dataIndex: i }]),
    };
  });
  expect(title).toMatch(/ · 0 commits so far$/);
  await page.mouse.move(x, y);
  await frame(page);
  expect(await page.evaluate(() => [__chart.tooltip.opacity, __chart.tooltip.title[0]])).toEqual([1, title]);
  expect(errors).toEqual([]);
});

test('dates show the year only when more than a year old', async ({ page }) => {
  await open(page, 'claude-code/#2026-08-31'); // NOW is 2026-10-14
  await expect(page.locator('#drill-title')).toHaveText(/^Aug 31 · /);
  await expect(page.locator('#drill-list h3').first()).toContainText(' · Aug 31 · ');
  await page.clock.setFixedTime(NOW + 400 * 86_400_000); // a year on: same URL, so reload rather than navigate
  await page.reload();
  await expect(page.locator('#drill-title')).toHaveText(/^Aug 31, 2026 · /);
});

test('an old week across New Year names both years', async ({ page }) => {
  await page.route('**/data/claude-code/weekly.json', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: [{ d: '2024-12-30', counts: {}, total: 0 }, ...(await res.json())] });
  });
  await open(page, 'claude-code/');
  expect(await page.evaluate(() => __chart.options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]))).toBe(
    'Dec 30, 2024 – Jan 5, 2025 · 0 items',
  );
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

test('resizing across the breakpoint pins the axes and scrolls to the latest week, and back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/data/claude-code/weekly.json', padWeeks);
  await open(page, 'claude-code/');
  await expect(page.locator('.axis-pin.left')).toBeHidden();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.axis-pin.left')).toBeVisible();
  const m = await page
    .locator('.chart-scroll')
    .evaluate((s) => ({ sw: s.scrollWidth, cw: s.clientWidth, left: s.scrollLeft }));
  expect(m.sw).toBeGreaterThan(m.cw);
  expect(Math.abs(m.left - (m.sw - m.cw))).toBeLessThanOrEqual(2);
  await expectPinned(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const pin of await page.locator('.axis-pin').all()) await expect(pin).toBeHidden();
});

test("commit size is the median over the window's sizes, compared with the prior window", async ({ page }) => {
  await page.route('**/data/sparse/weekly.json', async (route) => {
    const rows = JSON.parse(readFileSync(join(out, 'data/sparse/weekly.json'), 'utf8'));
    for (const r of rows) {
      if (r.d === '2026-09-28') r.lines = [10, 40];
      if (r.d === '2026-10-05') r.lines = [20, 60];
    }
    await route.fulfill({ json: rows });
  });
  await open(page, 'sparse/');
  const tile = page.locator('#kpis .kpi').last();
  await expect(tile.locator('.v')).toHaveText('30'); // 10, 20, 40, 60 in the last 4 complete weeks: an even count takes the mean of the middle two
  await expect(tile.locator('.ref')).toHaveText('−25% vs prior period (40)'); // the revert d4 (40 lines), alone in the 4 weeks before
});

// The panel's background as the canvas sees it, beside what the chart drew: the line's halo, a bar's gap edge and
// the inside of a model-marker badge (left of its digit) should all be that colour.
const colours = (page: Page) =>
  page.evaluate(() => {
    const must = <T>(x: T | null): T => {
      if (x === null) throw new Error('missing element or context');
      return x;
    };
    const hex = (c: string) => {
      const g = must(document.createElement('canvas').getContext('2d'));
      g.fillStyle = c;
      return g.fillStyle;
    };
    const halo = __chart.data.datasets.findIndex((d) => d.label === 'halo');
    const [m] = __chart.$markers;
    const r = __chart.currentDevicePixelRatio;
    const px = __chart.ctx.getImageData(Math.round((m.x - 5) * r), Math.round((m.y ?? 0) * r), 1, 1).data;
    return {
      panel: hex(getComputedStyle(must(document.querySelector('.panel'))).backgroundColor),
      drawn: [
        hex(__chart.getDatasetMeta(halo).dataset.options.borderColor),
        hex(__chart.getDatasetMeta(0).data[0].options.borderColor),
        hex(`rgb(${px[0]},${px[1]},${px[2]})`),
      ],
    };
  });
const LIGHT = '#ffffff';
const DARK = '#12151a';
const painted = (panel: string) => ({ panel, drawn: [panel, panel, panel] });

test('the page and the chart follow the colour scheme, live, without a reload', async ({ browser }) => {
  const page = await (await browser.newContext({ colorScheme: 'light' })).newPage();
  await open(page, 'claude-code/');
  expect(await colours(page)).toEqual(painted(LIGHT));
  // The change event comes some frames later; a listener made after the site's runs after it (creation order), so its
  // firing means the chart has already repainted.
  const changed = page.evaluate(
    () => new Promise((r) => matchMedia('(prefers-color-scheme: dark)').addEventListener('change', r, { once: true })),
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await changed;
  expect(await colours(page)).toEqual(painted(DARK));
});

test('the theme button cycles auto, light, dark; a forced theme beats the OS and survives a reload', async ({
  browser,
}) => {
  const page = await (await browser.newContext({ colorScheme: 'light' })).newPage();
  await open(page, 'claude-code/');
  const button = page.locator('#theme');
  await expect(button).toHaveAccessibleName(/^Theme: auto/i);
  expect(await colours(page)).toEqual(painted(LIGHT));
  await button.click();
  await frame(page);
  await expect(button).toHaveAccessibleName(/^Theme: light/i);
  expect(await colours(page)).toEqual(painted(LIGHT));
  await button.click();
  await frame(page);
  await expect(button).toHaveAccessibleName(/^Theme: dark/i);
  expect(await colours(page)).toEqual(painted(DARK)); // forced dark on a light OS
  await page.reload();
  await page.waitForFunction(() => window.__chart);
  await expect(button).toHaveAccessibleName(/^Theme: dark/i);
  expect(await colours(page)).toEqual(painted(DARK));
  await button.click();
  await frame(page); // back to auto: the OS (light) decides again, and nothing is stored
  await expect(button).toHaveAccessibleName(/^Theme: auto/i);
  expect(await colours(page)).toEqual(painted(LIGHT));
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /theme/.test(k)))).toEqual([]);
});

test("a stored theme applies from the page's own head, before app.ts: on the root and on a project page", async ({
  browser,
}) => {
  for (const path of ['', 'claude-code/']) {
    const page = await (await browser.newContext({ colorScheme: 'light' })).newPage();
    await page.goto(`${base}claude-code/`);
    await page.evaluate(() => localStorage.setItem('codebase-trends:theme', 'dark'));
    await page.route('**/app/app.js*', (r) => r.abort()); // hold the page: no redirect, only its own head runs
    await page.goto(base + path);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path || 'root').toBe(
      'rgb(13, 15, 18)',
    );
    await page.context().close();
  }
});

test('category tags in the week list keep their text readable (4.5:1) in both schemes', async ({ browser }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await (await browser.newContext({ colorScheme })).newPage();
    const ratios: Record<string, number> = {};
    for (const path of ['claude-code/#2026-08-19', 'claude-code/#2026-09-19', 'sparse/#2026-08-21']) {
      // between them, one tag per bucket
      await open(page, path);
      await expect(page.locator('#drill li.ev .tag').first()).toBeVisible();
      Object.assign(
        ratios,
        await page.evaluate(() => {
          // Computed colours may serialise as color(srgb …); painting one pixel turns any form into rgb.
          const rgb = (c: string) => {
            const g = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
            if (!g) throw new Error('no 2d context');
            g.fillStyle = c;
            g.fillRect(0, 0, 1, 1);
            return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const lum = (c: string) =>
            rgb(c)
              .map((v) => v / 255)
              .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
              .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
          return Object.fromEntries(
            [...document.querySelectorAll('#drill .tag')].map((t) => {
              const s = getComputedStyle(t);
              const [a, b] = [lum(s.backgroundColor), lum(s.color)].sort((x, y) => y - x);
              return [t.textContent, Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100];
            }),
          );
        }),
      );
    }
    expect(Object.keys(ratios).sort()).toEqual(['added', 'changed', 'fixed', 'revert']);
    for (const [tag, ratio] of Object.entries(ratios))
      expect(ratio, `${colorScheme} ${tag}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('each KPI tile is its measure over the last 4 complete weeks against the 4 before', async ({ page }) => {
  // Exactly 8 complete weeks and the current one: both windows full, the shortest history that has a prior period.
  const rows: CountRow[] = JSON.parse(readFileSync(join(out, 'data/claude-code/weekly.json'), 'utf8')).slice(-9);
  const counts = (i: number): Counts =>
    i < 4 ? { fixed: 1, changed: 1 } : i < 8 ? { added: 2, fixed: 1, changed: 1 } : {};
  const weekly = rows.map((r, i) => ({
    d: r.d,
    counts: counts(i),
    total: Object.values(counts(i)).reduce((a, b) => a + b, 0),
  }));
  // Versions: 2 in the prior weeks (08-17 – 09-13), 6 in the last (09-14 – 10-11), 1 in the current week (not in either).
  const releases = [
    '2026-08-18',
    '2026-09-13',
    '2026-09-14',
    '2026-09-15',
    '2026-09-22',
    '2026-09-29',
    '2026-10-06',
    '2026-10-11',
    '2026-10-13',
  ].map((d, i) => ({ version: `9.9.${i}`, ts: `${d}T12:00:00.000Z`, count: 1 }));
  await page.route('**/data/claude-code/weekly.json', (route) => route.fulfill({ json: weekly }));
  await page.route('**/data/claude-code/releases.json', (route) => route.fulfill({ json: releases }));
  await open(page, 'claude-code/');
  expect(weekly[0].d).toBe('2026-08-17');
  await expect(page.locator('#kpis .kpi .v')).toHaveText(['4', '2', '25%', '1.5']);
  await expect(page.locator('#kpis .kpi .ref')).toHaveText([
    '+100% vs prior period (2)', // items: 4 a week vs 2
    '– vs prior period (0)', // new features: none before, so no ratio
    '−25 pts vs prior period (50%)', // fixes: 4 of 16 vs 4 of 8
    '+200% vs prior period (0.5)', // versions: 6 in 4 weeks vs 2
  ]);
});

test('a first visit sees one question; the (i) button and every label open the help dialog, labels at their definition', async ({
  page,
}) => {
  await open(page, 'claude-code/');
  await expect(page.locator('#lede')).toHaveText(
    "How much of Claude Code's work each week is new capability, and how much is correction?",
  );
  await expect(page.locator('.notes, sup.fn, .kpi .cap')).toHaveCount(0); // no footnotes, superscripts or captions in the default view
  const help = page.locator('#help');
  await expect(help).toHaveJSProperty('open', false);
  const label = page.locator('#kpis .kpi .k a.term').nth(2); // Fixes %
  await expect(label).toHaveAttribute('title', /fixed \+ reverts/); // the hover gloss is the definition itself
  await expect(label).toHaveAttribute('href', '#fn-fix');
  await label.click();
  await expect(help).toHaveJSProperty('open', true);
  await expect(page.locator('#fn-fix')).toBeInViewport();
  expect(await page.locator('#fn-fix').evaluate((d) => getComputedStyle(d).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  ); // the jumped-to entry is tinted, not just renamed
  await page.keyboard.press('Escape');
  await expect(help).toHaveJSProperty('open', false);
  await expect.poll(() => new URL(page.url()).hash).toBe(''); // closing forgets the entry (the dialog's close event is a task after it closes), so the next open starts at the top
  await page.locator('#info').click(); // the button beside the theme toggle opens it too
  await expect(help).toHaveJSProperty('open', true);
  await expect(help.locator('h2')).toHaveText('How to read this page');
  await help.locator('#help-close').click();
  await expect(help).toHaveJSProperty('open', false);
  await page.locator('#info').click();
  await page.mouse.click(8, 8); // the backdrop
  await expect(help).toHaveJSProperty('open', false);
  await expect(help.locator('a[href^="http"]')).toHaveCount(1); // the source; the repo link is the GitHub icon beside the (i)
  await expect(page.locator('#repo')).toHaveAttribute('href', 'https://github.com/unrarp/codebase-trends');
  await expect(
    help.locator('a[href="https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md"]'),
  ).toHaveText('CHANGELOG.md');
  await open(page, 'sparse/#fn-lines'); // a deep link: the entry is built after the page's own fragment jump
  await expect(page.locator('#help')).toHaveJSProperty('open', true);
  await expect(page.locator('#fn-lines')).toBeInViewport();
  expect(await page.locator('#fn-lines').evaluate((d) => getComputedStyle(d).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  await expect(page.locator('#lede')).toContainText("Sparse's work");
  await expect(page.locator('#help a[href^="http"]')).toHaveCount(0); // no source configured
});

test('a term link leaves a day deep link alone: the list stays open and the URL keeps the day after the dialog closes', async ({
  page,
}) => {
  await open(page, 'sparse/#2026-08-21');
  await page.locator('#kpis .kpi .k a.term').first().click();
  await expect(page.locator('#help')).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toHaveJSProperty('open', false);
  expect(new URL(page.url()).hash).toBe('#2026-08-21');
  await expect(page.locator('#drill')).toBeVisible();
});

test("a bot commit carries a bot badge in the list, a person's does not", async ({ page }) => {
  await open(page, 'sparse/#2026-08-21'); // d4: carol, co-authored by ci[bot]
  await expect(page.locator('#drill li.ev')).toHaveCount(1);
  await expect(page.locator('#drill li.ev .badge')).toHaveText('bot');
  await open(page, 'sparse/#2026-08-03'); // a1: alice
  await expect(page.locator('#drill li.ev')).toHaveCount(1);
  await expect(page.locator('#drill li.ev .badge')).toHaveCount(0);
});
