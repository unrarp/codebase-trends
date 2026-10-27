// ---- drill-down ----
import { loadMonth } from './data.ts';
import { $, el, ext } from './dom.ts';
import { fmt, weekSpan } from './format.ts';
import { groupOf } from './groups.ts';
import { DAY, dayOf } from './time.ts';
/** Lists the counted events of the week starting `d`, or of the day `d`, in the drill-down panel and shows it. */ export async function openDrill({ id, changelog, daily, what }, d, view) {
    const to = view === 'week' ? dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY) : d;
    const months = [
        ...new Set(daily.filter((r)=>r.d >= d && r.d <= to && r.total > 0).map((r)=>r.d.slice(0, 7)))
    ];
    const events = (await Promise.all(months.map((m)=>loadMonth(id, m)))).flat().filter((e)=>e.ts.slice(0, 10) >= d && e.ts.slice(0, 10) <= to && groupOf(e.category)); // the list matches the bar
    $('drill-title').textContent = `${view === 'week' ? weekSpan(d, true) : fmt(d, true)} · ${events.length} ${what}`;
    // One line per item under group headers: changelog items by version (the version is the reference, named once
    // in its header); commits by day in the week view, each with its sha. The day view of commits needs no header.
    const keyOf = changelog ? (e)=>e.version : view === 'week' ? (e)=>e.ts.slice(0, 10) : ()=>'';
    const groups = [];
    for (const e of events){
        const open = groups.at(-1);
        if (!open || keyOf(e) !== open.key) groups.push({
            key: keyOf(e),
            items: [
                e
            ]
        });
        else open.items.push(e);
    }
    const list = $('drill-list');
    list.replaceChildren(...groups.flatMap(({ key, items })=>{
        const [e] = items;
        const n = `${items.length} ${what}`;
        const version = e.version ?? ''; // the changelog basis always has one
        const head = changelog ? el('h3', {}, e.url ? ext(e.url, version) : version, ` · ${fmt(e.ts.slice(0, 10), true)} · ${n}`) : key ? el('h3', {
            textContent: `${fmt(key, true)} · ${n}`
        }) : null;
        const ul = el('ul', {}, ...items.map((e)=>{
            const group = groupOf(e.category); // never null: the filter above kept only grouped events
            const sha = (e.sha ?? '').slice(0, 7); // the commits basis always has one
            return el('li', {
                className: 'ev'
            }, el('span', {
                className: 'tag',
                style: `--c:${group?.color}`,
                textContent: e.category
            }), el('span', {
                className: 'text',
                textContent: e.text
            }, ...e.bot ? [
                el('span', {
                    className: 'badge',
                    textContent: 'bot'
                })
            ] : []), ...changelog ? [] : [
                e.url ? ext(e.url, sha, 'ref') : el('span', {
                    className: 'ref',
                    textContent: sha
                })
            ]);
        }));
        return head ? [
            head,
            ul
        ] : [
            ul
        ];
    }));
    list.scrollTop = 0;
    $('drill-empty').textContent = `No ${what}.`;
    $('drill-empty').hidden = events.length > 0;
    list.hidden = events.length === 0;
    $('drill').hidden = false;
    if (view === 'day') history.replaceState(null, '', `#${d}`);
    $('drill').scrollIntoView({
        block: 'nearest'
    });
}
//# sourceMappingURL=drill.js.map
