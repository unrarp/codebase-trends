// Element lookup and construction, colours read from the stylesheet, and the media queries the page adapts to.
/** The element with `id`, checked to be a `type` (default any HTMLElement); throws when the page lacks it. */ export function $(id, type = HTMLElement) {
    const n = document.getElementById(id);
    if (!(n instanceof type)) throw new Error(`#${id}: missing, or not a ${type.name}`);
    return n;
}
/** The first element matching `selector`, checked to be a `type`; throws when the page lacks it. */ export function query(selector, type) {
    const n = document.querySelector(selector);
    if (!(n instanceof type)) throw new Error(`${selector}: missing, or not a ${type.name}`);
    return n;
}
// The canvas cannot use CSS variables, so the chart asks for them at paint time: setting one as a hidden element's
// colour resolves its light-dark() pair for the current scheme. Nothing is cached, so a scheme change needs only a redraw.
/** The probe `css` colours; the page appends it to the body, since a detached element computes no colour. */ export const ink = Object.assign(document.createElement('i'), {
    hidden: true
});
export const css = (name)=>{
    ink.style.color = `var(--${name})`;
    return getComputedStyle(ink).color;
};
export const el = (tag, { dataset, ...props } = {}, ...kids)=>{
    const n = Object.assign(document.createElement(tag), props);
    Object.assign(n.dataset, dataset);
    n.append(...kids);
    return n;
};
/** A link that opens in a new tab. */ export const ext = (href, text, className)=>el('a', {
        className,
        href,
        target: '_blank',
        rel: 'noopener',
        textContent: text
    });
export const narrow = ()=>matchMedia('(max-width: 719px)').matches;
// A pointer reads the tooltip by hovering, so one click acts; touch needs a tap to read first, then a second to act.
// Rejected: a button inside the tooltip (needs an HTML tooltip pinned on click) and a "show list" line under the chart
// (repeated what the tooltip already said); a hint line in the tooltip footer is the whole affordance.
export const hover = ()=>matchMedia('(hover: hover)').matches;
//# sourceMappingURL=dom.js.map
