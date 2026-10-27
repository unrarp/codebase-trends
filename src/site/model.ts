// The project page's derived values: the weeks on the axis, the KPI windows, the counted totals and the model
// releases to mark. Computed once from the fetched data; every view reads them from here.
import type { Annotation, CountRow, ProjectEntry, Release, Summary } from '../types.ts';
import type { ProjectData } from './data.ts';
import { categoriesOf, catsOf, GROUPS, type Group, groupOf } from './groups.ts';
import { ROLL, sum } from './metrics.ts';
import { required } from './required.ts';
import { DAY, dayOf, mondayOf, WEEK } from './time.ts';

export type Model = {
  id: string;
  /** Changelog basis (items per release-notes bullet), else commits. */
  changelog: boolean;
  project: ProjectEntry;
  summary: Summary;
  daily: CountRow[];
  releases: Release[];
  now: number;
  generatedAt: number;
  /** What the page counts, capitalised: "Changelog items" or "Commits". */
  noun: string;
  /** `noun` in running text. */
  what: string;
  /** Weekly rows, through the current week. */
  rows: CountRow[];
  /** Monday 00:00 UTC of the first week, and the end of the last, in epoch ms. */
  anchor: number;
  end: number;
  /** Index of the week containing `now`; -1 when it is off the axis. */
  curIdx: number;
  /** The GROUPS this project has any events in. */
  groups: Group[];
  /** Product changes in the whole history, and the events set aside. */
  counted: number;
  setAside: number;
  /** The KPI window, and the ROLL weeks before it (empty when the history is too short). */
  last: CountRow[];
  ref: CountRow[];
  /** Major model releases on the axis, by date: the numbered chart markers and chips. */
  major: Annotation[];
};

export function buildModel(
  id: string,
  changelog: boolean,
  { projects, annotations, summary, daily, weekly, releases }: ProjectData,
): Model {
  const project = required(
    projects.find((p) => p.id === id),
    `project ${id}`,
  );
  const vendors = project.annotations;
  const now = Date.now();
  const generatedAt = Date.parse(summary.generatedAt);
  const noun = changelog ? 'Changelog items' : 'Commits';

  // Weekly rows extended with empty rows up to the current week so the not-yet-collected span is on the axis.
  const rows = [...weekly];
  for (
    let t = Date.parse(`${required(rows.at(-1), 'a weekly row').d}T00:00:00Z`) + WEEK;
    dayOf(t) <= mondayOf(dayOf(now));
    t += WEEK
  ) {
    rows.push({ d: dayOf(t), counts: {}, total: 0 });
  }
  const anchor = Date.parse(`${rows[0].d}T00:00:00Z`);
  const end = anchor + rows.length * WEEK;
  const curIdx = rows.findIndex((r) => {
    const t = Date.parse(`${r.d}T00:00:00Z`);
    return t <= now && now < t + WEEK;
  });
  const { byCategory } = summary.totals;
  const groups = GROUPS.filter((g) => catsOf(byCategory, g).length);
  const counted = sum(categoriesOf(byCategory), (c) => (groupOf(c) ? (byCategory[c] ?? 0) : 0));
  const setAside = summary.totals.events - counted;

  // ---- KPIs: the last ROLL complete weeks (fewer when the history is shorter), against the ROLL weeks before ----
  const kpiEnd = curIdx < 0 ? rows.length : curIdx;
  const last = rows.slice(Math.max(0, kpiEnd - ROLL), kpiEnd);
  const ref = kpiEnd >= 2 * ROLL ? rows.slice(kpiEnd - 2 * ROLL, kpiEnd - ROLL) : []; // the ROLL weeks right before

  // ---- shared chart furniture: not-yet-collected hatch, model markers ----
  const inRange = (a: Annotation): boolean =>
    vendors.includes(a.vendor) && Date.parse(a.date) < end && Date.parse(a.date) + DAY > anchor;
  const major = annotations
    .filter((a) => a.kind === 'model' && a.major && inRange(a))
    .sort((a, b) => (a.date + a.label < b.date + b.label ? -1 : 1));

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
    major,
  };
}
