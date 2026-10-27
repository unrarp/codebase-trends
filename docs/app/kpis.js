// The KPI tiles: each measure over the last ROLL complete weeks, against the ROLL weeks before.
import { $, el } from './dom.ts';
import { pct } from './format.ts';
import { FIX, SIZE } from './help.ts';
import { median, pooledFix, shown, sum } from './metrics.ts';
import { required } from './required.ts';
import { weekEnd } from './time.ts';
/** Releases published within a run of weeks. */ const inWeeks = (releases, ws)=>releases.filter((r)=>r.ts.slice(0, 10) >= ws[0].d && r.ts.slice(0, 10) <= weekEnd(required(ws.at(-1), 'a week').d)).length;
const perWeek = (f)=>(ws)=>ws.length ? f(ws) / ws.length : null;
const sign = (x)=>x > 0 ? '+' : x < 0 ? '−' : '±';
const change = (a, b, share)=>{
    // rounded first, so a change that rounds to 0 reads ±0
    if (!share && b === 0) return '–';
    const d = Math.round(share ? (a - b) * 100 : (a / b - 1) * 100);
    return `${sign(d)}${Math.abs(d)}${share ? ' pts' : '%'}`;
};
export function renderKpis({ noun, changelog, releases, last, ref }, term) {
    const kpis = [
        // id: the definition the label links
        {
            k: `${noun} / week`,
            id: 'counted',
            f: perWeek((ws)=>sum(ws, shown)),
            show: (v)=>v.toFixed(0)
        },
        {
            k: 'New features / week',
            id: 'added',
            f: perWeek((ws)=>sum(ws, (r)=>r.counts.added ?? 0)),
            show: (v)=>v.toFixed(0)
        },
        {
            k: FIX,
            id: 'fix',
            f: pooledFix,
            show: pct,
            share: true
        },
        changelog ? {
            k: 'Versions released / week',
            id: 'versions',
            f: perWeek((ws)=>inWeeks(releases, ws)),
            show: (v)=>v.toFixed(1)
        } : {
            k: SIZE,
            id: 'lines',
            f: (ws)=>median(ws.flatMap((r)=>r.lines ?? [])),
            show: (v)=>v.toFixed(0)
        }
    ];
    $('kpis').replaceChildren(...kpis.map(({ k, id, f, show, share })=>{
        const a = last.length ? f(last) : null;
        const b = ref.length ? f(ref) : null;
        const vs = a == null || b == null ? [
            'no prior period'
        ] : [
            el('b', {
                textContent: change(a, b, share)
            }),
            ' vs ',
            term('window', 'prior period'),
            ` (${show(b)})`
        ];
        return el('div', {
            className: 'kpi'
        }, el('div', {
            className: 'k'
        }, term(id, k)), el('div', {
            className: 'v',
            textContent: a == null ? '–' : show(a)
        }), el('div', {
            className: 'ref'
        }, ...vs));
    }));
}
//# sourceMappingURL=kpis.js.map
