// Chart.js is loaded as a classic script (docs/vendor/chart.umd.js) and exposes the global `Chart`; the chart.js
// devDependency supplies only its types and is never imported at runtime.
import type { Chart as ChartJs } from 'chart.js';

declare global {
  const Chart: typeof ChartJs;
  /** The project page's chart, a test hook that test/browser.spec.ts types and reads. */
  var __chart: unknown;
}
