// Fetching the build's JSON output.
import type { Annotation, CountRow, MonthEvent, ProjectEntry, Release, Summary } from '../types.ts';

/** Everything a project page reads up front; the drill-down fetches month files on demand. */
export type ProjectData = {
  projects: ProjectEntry[];
  annotations: Annotation[];
  summary: Summary;
  daily: CountRow[];
  weekly: CountRow[];
  /** Changelog basis only; empty for the commits basis. */
  releases: Release[];
};

/** A project page's data directory, relative to the page. */
const D = '../data/';

/** The JSON at `path`, typed as the build writes it; throws on an HTTP error. */
export const get = <T>(path: string): Promise<T> =>
  fetch(path).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json() as Promise<T>;
  });

export async function loadProject(id: string, changelog: boolean): Promise<ProjectData> {
  const [projects, annotations, summary, daily, weekly, releases] = await Promise.all([
    get<ProjectEntry[]>(`${D}projects.json`),
    get<Annotation[]>(`${D}annotations.json`),
    get<Summary>(`${D}${id}/summary.json`),
    get<CountRow[]>(`${D}${id}/daily.json`),
    get<CountRow[]>(`${D}${id}/weekly.json`),
    changelog ? get<Release[]>(`${D}${id}/releases.json`) : [],
  ]);
  return { projects, annotations, summary, daily, weekly, releases };
}

/** One month's events of project `id`; `month` is `YYYY-MM`. */
export const loadMonth = (id: string, month: string): Promise<MonthEvent[]> =>
  get<MonthEvent[]>(`${D}${id}/months/${month}.json`);
