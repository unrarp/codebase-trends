// Element lookup and construction, colours read from the stylesheet, and the media queries the page adapts to.

/** The element with `id`, checked to be a `type` (default any HTMLElement); throws when the page lacks it. */
export function $<T extends HTMLElement>(id: string, type: abstract new () => T): T;
export function $(id: string): HTMLElement;
export function $(id: string, type: abstract new () => HTMLElement = HTMLElement): HTMLElement {
  const n = document.getElementById(id);
  if (!(n instanceof type)) throw new Error(`#${id}: missing, or not a ${type.name}`);
  return n;
}
/** The first element matching `selector`, checked to be a `type`; throws when the page lacks it. */
export function query<T extends Element>(selector: string, type: abstract new () => T): T {
  const n = document.querySelector(selector);
  if (!(n instanceof type)) throw new Error(`${selector}: missing, or not a ${type.name}`);
  return n;
}

// The canvas cannot use CSS variables, so the chart asks for them at paint time: setting one as a hidden element's
// colour resolves its light-dark() pair for the current scheme. Nothing is cached, so a scheme change needs only a redraw.
/** The probe `css` colours; the page appends it to the body, since a detached element computes no colour. */
export const ink = Object.assign(document.createElement('i'), { hidden: true });
export const css = (name: string): string => {
  ink.style.color = `var(--${name})`;
  return getComputedStyle(ink).color;
};

/** Properties to set on a new element; `style` as a CSS text string, `dataset` as plain entries. */
export type Props<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>
> & { style?: string; dataset?: Record<string, string> };
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { dataset, ...props }: Props<K> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props);
  Object.assign(n.dataset, dataset);
  n.append(...kids);
  return n;
};
/** A link that opens in a new tab. */
export const ext = (href: string, text: string, className?: string): HTMLAnchorElement =>
  el('a', { className, href, target: '_blank', rel: 'noopener', textContent: text });

export const narrow = (): boolean => matchMedia('(max-width: 719px)').matches;
// A pointer reads the tooltip by hovering, so one click acts; touch needs a tap to read first, then a second to act.
// Rejected: a button inside the tooltip (needs an HTML tooltip pinned on click) and a "show list" line under the chart
// (repeated what the tooltip already said); a hint line in the tooltip footer is the whole affordance.
export const hover = (): boolean => matchMedia('(hover: hover)').matches;
