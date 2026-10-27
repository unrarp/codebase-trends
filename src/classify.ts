import type { Basis, Category, Event, ProjectConfig } from './types.ts';

// biome-ignore format: one line per category
const SYNONYMS: Record<string, Category> = {
  fix: 'fixed', fixes: 'fixed', fixed: 'fixed',
  add: 'added', adds: 'added', added: 'added', new: 'added',
  improve: 'improved', improves: 'improved', improved: 'improved', reduced: 'improved', faster: 'improved',
  change: 'changed', changed: 'changed', update: 'changed', updated: 'changed',
  remove: 'removed', removes: 'removed', removed: 'removed', deprecated: 'removed',
};

function firstWordCategory(text: string, map: Record<string, Category>): Category | null {
  const word = text
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[:,]+$/, '');
  return Object.hasOwn(map, word) ? map[word] : null;
}

// A short "Scope:" lead-in, e.g. "Windows: Fixed …", "Self-hosted runner: Added …".
const SCOPE = /^[A-Za-z][\w ./-]{0,30}:\s+/;

function changelogRule(event: Event, _project?: ProjectConfig): Category | null {
  return firstWordCategory(event.text, SYNONYMS) ?? firstWordCategory(event.text.replace(SCOPE, ''), SYNONYMS);
}

const CONVENTIONAL = /^(feat|fix|perf|refactor|chore|build|test|docs|ci|style)(\(.*\))?!?:/;
// biome-ignore format: one line per category
const PREFIX_CATEGORY: Record<string, Category> = {
  feat: 'added', fix: 'fixed', perf: 'improved', refactor: 'changed',
  chore: 'chore', build: 'chore', style: 'chore', test: 'test', docs: 'docs', ci: 'ci',
};

function commitRule(event: Event, project?: ProjectConfig): Category | null {
  if (/^(Revert |revert)/.test(event.text)) return 'revert';
  const m = event.text.match(CONVENTIONAL);
  return m ? PREFIX_CATEGORY[m[1]] : changelogRule(event, project);
}

/** Rule-based category for an event, or null (residual → model). Applied at build, never stored. */
export function classifyByRule(event: Event, project?: ProjectConfig): Category | null {
  switch (event.kind) {
    case 'changelog':
      return changelogRule(event, project);
    case 'commit':
      return commitRule(event, project);
    default:
      return null;
  }
}

const CHANGELOG_CATEGORIES: Category[] = ['added', 'fixed', 'changed', 'improved', 'removed', 'other'];

/** Allowed categories per project basis. */
export const CATEGORIES: Record<Basis, Category[]> = {
  changelog: CHANGELOG_CATEGORIES,
  commits: [...CHANGELOG_CATEGORIES, 'revert', 'chore', 'test', 'docs', 'ci'],
};

/** Whether `value` is one of the categories allowed for `basis`. */
export function isCategory(basis: Basis, value: string): value is Category {
  return (CATEGORIES[basis] as string[]).includes(value);
}

/** Product changes — the categories the site counts and draws; the rest (other, chore, test, docs, ci) is set aside.
 *  Must match GROUPS in src/site/groups.ts (test/classify.test.ts pins the two together). */
export const COUNTED: Category[] = ['added', 'fixed', 'changed', 'improved', 'removed', 'revert'];
