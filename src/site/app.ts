// The entry: a page with a project renders it; the root redirects to one.
import type { ProjectEntry } from '../types.ts';
import { get } from './data.ts';
import { projectPage } from './project.ts';
import { LAST, remembered } from './storage.ts';

// The root has no content of its own: it opens the last project viewed, else the first configured.
async function indexPage(): Promise<void> {
  const ids = (await get<ProjectEntry[]>('./data/projects.json')).map((p) => p.id);
  const last = remembered(LAST);
  location.replace(`./${last !== null && ids.includes(last) ? last : ids[0]}/`);
}

(document.body.dataset.project ? projectPage : indexPage)();
