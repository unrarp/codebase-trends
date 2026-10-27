// What sits around the chart: the legend above it and the numbered model-release chips below.
import type { Annotation } from '../types.ts';
import { $, el, type Props } from './dom.ts';
import { cap, fmt } from './format.ts';
import type { Group } from './groups.ts';
import { FIX, type Term } from './help.ts';

const item = (cls: string, text: string, props: Props<'span'> = {}): HTMLSpanElement =>
  el('span', props, el('span', { className: `sw ${cls}` }), text);

export function renderLegend(groups: Group[], major: Annotation[], term: Term): void {
  $('legend').replaceChildren(
    ...groups.map((g) => el('span', {}, el('span', { className: 'sw', style: `background:${g.color}` }), cap(g.key))),
    el('span', {}, el('span', { className: 'sw line' }), el('span', {}, term('fix', FIX), ' (right axis)')),
    ...(major.length ? [el('span', {}, el('span', { className: 'sw marker' }), 'Major model release')] : []),
    item('hatch', 'Not yet collected', { id: 'legend-hatch', hidden: true }),
  );
}

const link = (a: Annotation, ...kids: (Node | string)[]): HTMLAnchorElement =>
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

export function renderChips(major: Annotation[]): void {
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
}
