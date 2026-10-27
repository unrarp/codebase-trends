// ---- one chart: stacked weekly bars by group, the rolling fix share drawn over them on a 0–100% axis ----
// The second y-axis is the owner's call against the dataviz one-axis rule: a separate fix-share chart above the
// bars with a synced crosshair was built and rejected as harder to read together. Keep the overlay; the halo
// dataset keeps the line legible over tall bars.
import { $, css, el, hover, narrow, query } from './dom.ts';
import { cap, fmt, pct, weekSpan } from './format.ts';
import { catsOf } from './groups.ts';
import { FIX } from './help.ts';
import { pooledFix, ROLL, shown, sum } from './metrics.ts';
import { required } from './required.ts';
import { DAY, WEEK } from './time.ts';
const PX_PER_WEEK = 12; // narrow screens: the chart scrolls sideways at this width per week
export function chartView() {
    const canvas = $('chart', HTMLCanvasElement);
    const [pinL, pinR] = [
        'left',
        'right'
    ].map((side)=>query(`.axis-pin.${side}`, HTMLCanvasElement));
    return {
        canvas,
        scroll: required(canvas.closest('.chart-scroll'), '.chart-scroll'),
        wrap: required(canvas.parentElement, 'the chart wrapper'),
        pinL,
        pinR
    };
}
const context2d = (c)=>required(c.getContext('2d'), 'a 2D context');
const patterns = new Map(); // one hatch tile per stroke colour, so a hover redraw reuses it
const pattern = (stroke)=>{
    if (!patterns.has(stroke)) {
        const c = el('canvas', {
            width: 8,
            height: 8
        });
        const g = context2d(c);
        g.strokeStyle = stroke;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, 8);
        g.lineTo(8, 0);
        g.stroke();
        patterns.set(stroke, c);
    }
    return required(patterns.get(stroke), 'hatch tile');
};
/** Chart.js types a scale's options as the core set; the x scale is cartesian, so it has a grid. */ const isCartesian = (s)=>'grid' in s.options;
const cartesian = (s)=>{
    if (!isCartesian(s)) throw new Error(`scale ${s.id} is not cartesian`);
    return s;
};
/** The x pixel of time `t` (epoch ms) on a chart whose first week starts at `anchor`. */ const toX = (chart, anchor, t)=>{
    const sx = chart.scales.x;
    const slot = sx.getPixelForValue(1) - sx.getPixelForValue(0);
    return sx.getPixelForValue(0) - slot / 2 + (t - anchor) / WEEK * slot;
};
/** Draws the picked week's column and the not-yet-collected hatch behind the bars, and the model markers on top. */ function furniture({ anchor, generatedAt, now, major }, sel) {
    return {
        id: 'furniture',
        beforeDatasetsDraw (chart) {
            const { ctx, chartArea: a } = chart;
            ctx.save();
            let picked = null;
            if (sel.week >= 0) {
                // a lighter column behind the picked week's bars
                const x0 = Math.max(a.left, toX(chart, anchor, anchor + sel.week * WEEK));
                const x1 = Math.min(a.right, toX(chart, anchor, anchor + (sel.week + 1) * WEEK));
                picked = {
                    x0,
                    x1,
                    width: Math.max(0, x1 - x0)
                };
                ctx.fillStyle = css('pick');
                ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
            }
            const x0 = Math.max(a.left, toX(chart, anchor, generatedAt));
            const x1 = Math.min(a.right, toX(chart, anchor, now));
            const hatch = {
                x0,
                x1,
                width: Math.max(0, x1 - x0)
            };
            Object.assign(chart, {
                $selected: picked,
                $hatch: hatch
            });
            if (x1 > x0) {
                const tile = ctx.createPattern(pattern(css('hatch')), 'repeat');
                if (tile) ctx.fillStyle = tile;
                ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
            }
            const entry = document.getElementById('legend-hatch'); // the legend only explains a hatch that is on screen
            if (entry) entry.hidden = x1 - x0 < 1; // a sub-pixel hatch right after a sync is not on screen
            ctx.restore();
        },
        afterDraw (chart) {
            const { ctx, chartArea: a } = chart;
            const rowEnd = [];
            const [marker, panel] = [
                css('marker'),
                css('panel')
            ];
            const markers = [];
            Object.assign(chart, {
                $markers: markers
            });
            ctx.save();
            major.forEach((m, i)=>{
                const x = Math.round(toX(chart, anchor, Date.parse(m.date) + DAY / 2)) + 0.5; // on the pixel grid: a 1px line off it blurs to gray
                if (x < a.left || x > a.right) return;
                let r = rowEnd.findIndex((e)=>x - e >= 20); // badges are 18px wide; closer than that, go up a row
                if (r < 0) r = Math.min(rowEnd.length, 2);
                rowEnd[r] = x;
                const y = a.top - 14 - r * 22;
                ctx.strokeStyle = marker;
                ctx.lineWidth = 1;
                ctx.setLineDash([
                    3,
                    3
                ]);
                ctx.beginPath();
                ctx.moveTo(x, y + 9);
                ctx.lineTo(x, a.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = panel;
                ctx.beginPath();
                ctx.arc(x, y, 9, 0, 7);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = marker;
                ctx.font = '600 11px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(i + 1), x, y + 0.5);
                markers.push({
                    n: i + 1,
                    x,
                    y
                });
            });
            ctx.restore();
        }
    };
}
// Narrow screens get a fixed width per week inside a sideways-scrolling wrapper, opened at the latest week.
// `layout` re-applies this whenever the viewport changes.
export function layout({ scroll, wrap }, weeks, ch) {
    const small = narrow();
    wrap.style.width = small ? `${Math.max(scroll.clientWidth, weeks * PX_PER_WEEK)}px` : '';
    if (ch) {
        const ticks = ch.options.scales?.x?.ticks;
        if (ticks) ticks.maxTicksLimit = small ? 8 : 10;
        ch.update();
    }
    if (small) scroll.scrollLeft = scroll.scrollWidth;
}
// While the chart scrolls, each axis stays in view as a copy of its strip of the chart canvas, repainted on every
// draw, in a canvas pinned over that edge of the scroller. The panel fill hides the bars scrolling underneath.
// Copied before the markers and tooltip are drawn, and only down to where the date labels start (under the x-axis
// tick space), so no fragment of them stays pinned over other weeks.
function pins({ scroll, pinL, pinR }) {
    return {
        id: 'pins',
        afterDatasetsDraw (chart) {
            const { canvas, chartArea: a, currentDevicePixelRatio: dpr, scales: { x } } = chart;
            const fill = css('panel');
            const tickLength = required(cartesian(x).options.grid.tickLength, 'the x tick length');
            const cut = Math.round((x.top + tickLength) * dpr);
            const strips = [
                [
                    pinL,
                    0,
                    a.left
                ],
                [
                    pinR,
                    a.right,
                    chart.width
                ]
            ];
            for (const [p, x0, x1] of strips){
                p.hidden = scroll.scrollWidth <= scroll.clientWidth;
                if (p.hidden) continue;
                const [sx, sw, sh] = [
                    Math.round(x0 * dpr),
                    Math.round((x1 - x0) * dpr),
                    canvas.height
                ];
                if (p.width !== sw || p.height !== sh) {
                    // resizing clears the bitmap, so only when the axis size changed
                    Object.assign(p, {
                        width: sw,
                        height: sh
                    });
                    Object.assign(p.style, {
                        width: `${sw / dpr}px`,
                        height: `${sh / dpr}px`
                    });
                }
                const g = context2d(p);
                g.fillStyle = fill;
                g.fillRect(0, 0, sw, sh);
                g.drawImage(canvas, sx, 0, sw, cut, 0, 0, sw, cut);
            }
        }
    };
}
/** The tooltip title of week `i`. */ const weekTitle = ({ rows, changelog, curIdx }, i)=>`${weekSpan(rows[i].d, true)} · ${shown(rows[i])} ${changelog ? 'items' : 'commits'}${i === curIdx ? ' so far' : ''}`; // short: it must fit a phone-width tooltip
/**
 * Draws the chart into `view` and returns it. A click picks a week into `sel`; on a pointer, or a second tap on the
 * same week, it also calls `openWeek` with the week's Monday.
 */ export function createChart(m, view, sel, openWeek) {
    const { rows, curIdx, groups, summary } = m;
    const onClick = (e, _els, ch)=>{
        if (!e.native) return; // a click always carries its DOM event
        const hit = ch.getElementsAtEventForMode(e.native, 'index', {
            intersect: false
        }, true)[0];
        if (!hit) return;
        const again = hit.index === sel.week;
        sel.week = hit.index;
        ch.update();
        if (hover() || again) openWeek(rows[sel.week].d);
    };
    // ---- fix share: rolling window over the preceding weeks, nothing past the current week ----
    const rolling = rows.map((_, i)=>curIdx >= 0 && i > curIdx ? null : pooledFix(rows.slice(Math.max(0, i - ROLL + 1), i + 1)));
    layout(view, rows.length);
    const fade = (hex)=>(c)=>c.dataIndex === curIdx ? `${hex}73` : hex;
    const line = (label, color, width, order)=>({
            type: 'line',
            label,
            data: rolling,
            yAxisID: 'y1',
            borderColor: color,
            backgroundColor: color,
            borderWidth: width,
            pointRadius: 0,
            pointHitRadius: 8,
            tension: 0.2,
            spanGaps: false,
            order
        });
    return new Chart(view.canvas, {
        type: 'bar',
        data: {
            labels: rows.map((r)=>r.d),
            datasets: [
                ...groups.map((g)=>({
                        label: cap(g.key),
                        data: rows.map((r)=>sum(catsOf(summary.totals.byCategory, g), (c)=>r.counts[c] ?? 0)),
                        backgroundColor: fade(g.color),
                        stack: 's',
                        borderColor: ()=>css('panel'),
                        borderWidth: {
                            top: 1
                        },
                        borderSkipped: false,
                        categoryPercentage: 1,
                        barPercentage: 0.85,
                        order: 2
                    })),
                line('halo', ()=>css('panel'), 5, 1),
                line(FIX, ()=>css('accent'), 2, 0)
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: {
                padding: {
                    top: 70
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            events: [
                'mousemove',
                'mouseout',
                'click'
            ],
            onClick,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    // the week and its total in the title, the buckets that landed, the line last, the hint muted
                    filter: (it)=>it.dataset.label !== 'halo' && (it.dataset.type === 'line' || (it.parsed.y ?? 0) > 0 || shown(rows[it.dataIndex]) === 0),
                    itemSort: (a, b)=>Number(a.dataset.type === 'line') - Number(b.dataset.type === 'line'),
                    backgroundColor: ()=>css('tip-bg'),
                    borderColor: ()=>css('tip-line'),
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    caretSize: 6,
                    titleColor: ()=>css('tip-text'),
                    bodyColor: ()=>css('tip-text'),
                    titleFont: {
                        weight: 600
                    },
                    titleMarginBottom: 8,
                    bodySpacing: 4,
                    boxWidth: 8,
                    boxHeight: 8,
                    boxPadding: 4,
                    footerFont: {
                        weight: 'normal'
                    },
                    footerColor: ()=>css('muted'),
                    footerMarginTop: 8,
                    callbacks: {
                        title: (items)=>weekTitle(m, items[0].dataIndex),
                        label: (it)=>`${it.dataset.label}  ${it.dataset.label === FIX ? pct(it.parsed.y ?? 0) : it.parsed.y}`,
                        footer: ()=>[
                                hover() ? 'Click to list' : 'Tap again to list'
                            ]
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: narrow() ? 8 : 10,
                        callback (v) {
                            return fmt(this.getLabelForValue(Number(v)));
                        }
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: {
                        color: ()=>css('grid')
                    },
                    ticks: {
                        maxTicksLimit: 6
                    }
                },
                y1: {
                    position: 'right',
                    min: 0,
                    max: 1,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        stepSize: 0.25,
                        callback: (v)=>pct(Number(v)),
                        color: ()=>css('accent')
                    }
                }
            }
        },
        plugins: [
            furniture(m, sel),
            pins(view)
        ]
    });
}
//# sourceMappingURL=chart.js.map
