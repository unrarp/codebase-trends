// A project page: fetches its data, derives the model, and wires the header, KPI tiles, chart, drill-down and theme.
import { chartView, createChart, layout, type Selection } from './chart.ts';
import { loadProject } from './data.ts';
import { $, el, hover, ink } from './dom.ts';
import { openDrill } from './drill.ts';
import { recent } from './format.ts';
import { buildDefs, renderLede, renderProvenance, setUpHelp, type Term, termLink } from './help.ts';
import { renderKpis } from './kpis.ts';
import { renderChips, renderLegend } from './legend.ts';
import { buildModel } from './model.ts';
import { LAST, remember } from './storage.ts';
import { setUpThemeButton } from './theme.ts';
import { dayOf, mondayOf } from './time.ts';

export async function projectPage(): Promise<void> {
  const id = document.body.dataset.project ?? '';
  const changelog = document.body.dataset.basis === 'changelog';
  const data = await loadProject(id, changelog);
  const m = buildModel(id, changelog, data);
  const { generatedAt, counted, noun, what, rows, groups, major } = m;
  remember(LAST, id);
  document.body.append(ink);
  const select = $('switch', HTMLSelectElement);
  select.replaceChildren(
    ...data.projects.map((p) => el('option', { value: p.id, textContent: p.name, selected: p.id === id })),
  );
  select.addEventListener('change', () => {
    location.href = `../${select.value}/`;
  });

  renderLede(m);
  const defs = buildDefs(m);
  const term: Term = (id, text) => termLink(defs, id, text);
  setUpHelp(defs);
  $('meta').replaceChildren(
    `updated ${new Date(generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', ...(recent(dayOf(generatedAt)) ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })} · ${counted.toLocaleString('en-US')} `,
    term('counted', what),
  );
  renderKpis(m, term);
  renderProvenance(m);

  $('title').textContent = `${noun} per week`;
  $('subtitle').textContent = `${hover() ? 'Click' : 'Tap twice on'} a week to list its ${what}.`;
  const sel: Selection = { week: -1 };
  const view = chartView();
  const chart = createChart(m, view, sel, (d) => openDrill(m, d, 'week'));
  window.__chart = chart; // test hook read by test/browser.spec.ts

  renderLegend(groups, major, term);
  chart.update(); // the hatch legend entry is decided inside the draw, which ran before the entry existed
  renderChips(major);

  $('drill-close').onclick = () => {
    $('drill').hidden = true;
    sel.week = -1;
    chart.update();
    history.replaceState(null, '', location.pathname);
  };

  const fromHash = () => {
    const h = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
    if (!h) return;
    sel.week = rows.findIndex((r) => r.d === mondayOf(h[1]));
    chart.update();
    return openDrill(m, h[1], 'day');
  };
  await fromHash();
  addEventListener('hashchange', fromHash);
  addEventListener('resize', () => layout(view, rows.length, chart));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => chart.update()); // repaint in the new scheme
  setUpThemeButton(() => chart.update()); // the canvas reads the new colours on redraw
}
