const SYNONYMS = {
  fix: 'fixed', fixes: 'fixed', fixed: 'fixed',
  add: 'added', adds: 'added', added: 'added', new: 'added',
  improve: 'improved', improves: 'improved', improved: 'improved', reduced: 'improved', faster: 'improved',
  change: 'changed', changed: 'changed', update: 'changed', updated: 'changed',
  remove: 'removed', removes: 'removed', removed: 'removed', deprecated: 'removed',
};

function changelogRule(event, project) {
  const word = event.text.split(/\s+/)[0].toLowerCase().replace(/[:,]+$/, '');
  const map = { ...SYNONYMS, ...project?.rules?.synonyms };
  return Object.hasOwn(map, word) ? map[word] : null;
}

/** Rule-based category for an event, or null (residual → model). Applied at build, never stored. */
export function classifyByRule(event, project) {
  switch (event.kind) {
    case 'changelog': return changelogRule(event, project);
    default: return null; // commit rules arrive in Phase 5
  }
}
