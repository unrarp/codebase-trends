// The project page's derived values: the weeks on the axis, the KPI windows, the counted totals and the model
// releases to mark. Computed once from the fetched data; every view reads them from here.
import { categoriesOf, catsOf, GROUPS, groupOf } from './groups.ts';
import { ROLL, sum } from './metrics.ts';
import { required } from './required.ts';
import { DAY, dayOf, mondayOf, WEEK } from './time.ts';
export function buildModel(id, changelog, { projects, annotations, summary, daily, weekly, releases }) {
    const project = required(projects.find((p)=>p.id === id), `project ${id}`);
    const vendors = project.annotations;
    const now = Date.now();
    const generatedAt = Date.parse(summary.generatedAt);
    const noun = changelog ? 'Changelog items' : 'Commits';
    // Weekly rows extended with empty rows up to the current week so the not-yet-collected span is on the axis.
    const rows = [
        ...weekly
    ];
    for(let t = Date.parse(`${required(rows.at(-1), 'a weekly row').d}T00:00:00Z`) + WEEK; dayOf(t) <= mondayOf(dayOf(now)); t += WEEK){
        rows.push({
            d: dayOf(t),
            counts: {},
            total: 0
        });
    }
    const anchor = Date.parse(`${rows[0].d}T00:00:00Z`);
    const end = anchor + rows.length * WEEK;
    const curIdx = rows.findIndex((r)=>{
        const t = Date.parse(`${r.d}T00:00:00Z`);
        return t <= now && now < t + WEEK;
    });
    const { byCategory } = summary.totals;
    const groups = GROUPS.filter((g)=>catsOf(byCategory, g).length);
    const counted = sum(categoriesOf(byCategory), (c)=>groupOf(c) ? byCategory[c] ?? 0 : 0);
    const setAside = summary.totals.events - counted;
    // ---- KPIs: the last ROLL complete weeks (fewer when the history is shorter), against the ROLL weeks before ----
    const kpiEnd = curIdx < 0 ? rows.length : curIdx;
    const last = rows.slice(Math.max(0, kpiEnd - ROLL), kpiEnd);
    const ref = kpiEnd >= 2 * ROLL ? rows.slice(kpiEnd - 2 * ROLL, kpiEnd - ROLL) : []; // the ROLL weeks right before
    // ---- shared chart furniture: not-yet-collected hatch, model markers ----
    const inRange = (a)=>vendors.includes(a.vendor) && Date.parse(a.date) < end && Date.parse(a.date) + DAY > anchor;
    const major = annotations.filter((a)=>a.kind === 'model' && a.major && inRange(a)).sort((a, b)=>a.date + a.label < b.date + b.label ? -1 : 1);
    return {
        id,
        changelog,
        project,
        summary,
        daily,
        releases,
        now,
        generatedAt,
        noun,
        what: noun.toLowerCase(),
        rows,
        anchor,
        end,
        curIdx,
        groups,
        counted,
        setAside,
        last,
        ref,
        major
    };
}
//# sourceMappingURL=model.js.map
