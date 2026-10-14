const SYNONYMS = {
  fix: 'fixed', fixes: 'fixed', fixed: 'fixed',
  add: 'added', adds: 'added', added: 'added', new: 'added',
  improve: 'improved', improves: 'improved', improved: 'improved', reduced: 'improved', faster: 'improved',
  change: 'changed', changed: 'changed', update: 'changed', updated: 'changed',
  remove: 'removed', removes: 'removed', removed: 'removed', deprecated: 'removed',
};

function firstWordCategory(text, map) {
  const word = text.split(/\s+/)[0].toLowerCase().replace(/[:,]+$/, '');
  return Object.hasOwn(map, word) ? map[word] : null;
}

// A short "Scope:" lead-in, e.g. "Windows: Fixed …", "Self-hosted runner: Added …".
const SCOPE = /^[A-Za-z][\w .\/-]{0,30}:\s+/;

function changelogRule(event, project) {
  const map = { ...SYNONYMS, ...project?.rules?.synonyms };
  return firstWordCategory(event.text, map) ?? firstWordCategory(event.text.replace(SCOPE, ''), map);
}

/** Rule-based category for an event, or null (residual → model). Applied at build, never stored. */
export function classifyByRule(event, project) {
  switch (event.kind) {
    case 'changelog': return changelogRule(event, project);
    default: return null; // commit rules arrive in Phase 5
  }
}

const CHANGELOG_CATEGORIES = ['added', 'fixed', 'changed', 'improved', 'removed', 'other'];

/** Allowed categories per project basis. */
export const CATEGORIES = {
  changelog: CHANGELOG_CATEGORIES,
  commits: [...CHANGELOG_CATEGORIES, 'revert', 'chore', 'test', 'docs', 'ci'],
};
