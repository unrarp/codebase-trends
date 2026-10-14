import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
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
      await expect(page.locator('#stats .stat')).toHaveCount(4);
      const bars = await page.evaluate(() => __chart.getDatasetMeta(0).data.length);
      expect(bars).toBeGreaterThan(0);
      await expect(page.getByText('Model release dates are reference markers; proximity does not establish causation.')).toBeVisible();
      expect(errors).toEqual([]);
    });

    test('clicking a bar opens the drill-down table', async ({ page }) => {
      await open(page, 'claude-code/');
      await page.locator('#chart').scrollIntoViewIfNeeded();
      const { x, y } = await page.evaluate(() => {
        const rows = __chart.data.datasets.map((d) => d.data);
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
      await page.getByRole('button', { name: 'Per day' }).click();
      const { width } = await page.evaluate(() => __chart.$hatch);
      expect(Math.abs(width - 3 * (await slot(page)))).toBeLessThan(1);
    });

    test('fresh data has no hatched region beyond the current day', async ({ page }) => {
      await open(page, 'claude-code/');
      await page.getByRole('button', { name: 'Per day' }).click();
      expect((await page.evaluate(() => __chart.$hatch)).width).toBeLessThan(await slot(page));
    });

    test('model markers days apart do not collide', async ({ page }) => {
      await open(page, 'claude-code/');
      const m = await page.evaluate(() => __chart.$markers);
      expect(m.map((k) => k.n)).toEqual([1, 2]);
      if (mobile) return expect(m.every((k) => k.y === null)).toBe(true); // lines only below 720px
      expect(Math.hypot(m[0].x - m[1].x, m[0].y - m[1].y)).toBeGreaterThanOrEqual(18);
      await page.getByRole('button', { name: 'Per day' }).click();
      const d = await page.evaluate(() => __chart.$markers);
      expect(Math.hypot(d[0].x - d[1].x, d[0].y - d[1].y)).toBeGreaterThanOrEqual(18);
      await expect(page.locator('#chips .chip')).toHaveCount(2);
    });

    test('period entries draw as a context band', async ({ page }) => {
      await open(page, 'sparse/');
      expect(await page.evaluate(() => __chart.$periods.length)).toBe(1);
      await expect(page.locator('#chips')).toContainText('Quiet week');
      await expect(page.locator('#legend')).toContainText('Context period');
    });

    test('index lists the fixture projects', async ({ page }) => {
      const errors = await open(page, '');
      await expect(page.locator('#projects a')).toHaveCount(2);
      await expect(page.locator('#projects a[href="./claude-code/"]')).toContainText('Claude Code');
      await expect(page.locator('#projects a[href="./sparse/"]')).toContainText('Sparse');
      expect(errors).toEqual([]);
    });
  });
}
