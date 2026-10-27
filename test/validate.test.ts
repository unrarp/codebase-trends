import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.ts';
import type { Annotation, CountRow, MonthEvent, ProjectEntry, Release, Summary } from '../src/types.ts';
import { validate } from '../src/validate.ts';
import { tmp } from './tmp.ts';

const ROOT = fileURLToPath(new URL('./fixtures/build', import.meta.url));
const good = tmp('ct-val-');
build({ root: ROOT, out: good, now: new Date('2026-10-14T12:00:00Z') });

/** Copies the good build, applies `change(dir)` to the copy, returns the violations. */
function violationsIn(change: (dir: string) => void) {
  const out = tmp('ct-bad-');
  cpSync(good, out, { recursive: true });
  change(out);
  return validate(out);
}

/** A change that applies `edit(json)` to one data file of the copy. */
const json =
  <T>(rel: string, edit: (data: T) => unknown) =>
  (out: string) => {
    const f = join(out, rel);
    writeFileSync(f, JSON.stringify(edit(JSON.parse(readFileSync(f, 'utf8')))));
  };

/** Copies the good build, applies `edit(json)` to one data file, returns the violations. */
const violationsAfter = <T>(rel: string, edit: (data: T) => unknown) => violationsIn(json(rel, edit));

test('a good build passes', () => assert.deepEqual(validate(good), []));

test('rejects an event without a ts', () => {
  const errs = violationsAfter('data/claude-code/months/2026-08.json', (evs: MonthEvent[]) => {
    Reflect.deleteProperty(evs[0], 'ts');
    return evs;
  });
  assert.ok(
    errs.some((e) => /without a valid ts/.test(e)),
    errs.join('\n'),
  );
});

test('rejects Σ daily.total != summary.totals.events', () => {
  const errs = violationsAfter('data/claude-code/summary.json', (s: Summary) => {
    s.totals.events += 1;
    return s;
  });
  assert.ok(
    errs.some((e) => /daily\.json: Σ total/.test(e)),
    errs.join('\n'),
  );
});

test('rejects a missing calendar day and a missing ISO week', () => {
  const day = violationsAfter('data/claude-code/daily.json', (rows: CountRow[]) =>
    rows.filter((r) => r.d !== '2026-07-10'),
  );
  assert.ok(
    day.some((e) => /every calendar day/.test(e)),
    day.join('\n'),
  );
  const week = violationsAfter('data/sparse/weekly.json', (rows: CountRow[]) =>
    rows.filter((r) => r.d !== '2026-08-10'),
  );
  assert.ok(
    week.some((e) => /every ISO week/.test(e)),
    week.join('\n'),
  );
});

test('rejects an annotation whose major flag is not a boolean', () => {
  const errs = violationsAfter('data/annotations.json', (ann: Annotation[]) => {
    Object.assign(ann[0], { major: 'yes' });
    return ann;
  });
  assert.ok(
    errs.some((e) => /annotations\.json: bad entry/.test(e)),
    errs.join('\n'),
  );
});

test('commits basis: weekly lines are ascending non-negative integers, no more than the row has counted commits', () => {
  const unsorted = violationsAfter('data/sparse/weekly.json', (rows: CountRow[]) => {
    rows[0].lines = [15, 3];
    rows[0].counts.fixed = 2;
    return rows;
  });
  assert.ok(
    unsorted.some((e) => /lines/.test(e)),
    unsorted.join('\n'),
  );
  const negative = violationsAfter('data/sparse/weekly.json', (rows: CountRow[]) => {
    rows[0].lines = [-1];
    return rows;
  });
  assert.ok(
    negative.some((e) => /lines/.test(e)),
    negative.join('\n'),
  );
  const tooMany = violationsAfter('data/sparse/weekly.json', (rows: CountRow[]) => {
    rows[0].lines = [15, 15, 15];
    return rows;
  }); // two counted commits in the row
  assert.ok(
    tooMany.some((e) => /lines/.test(e)),
    tooMany.join('\n'),
  );
  const notArray = violationsAfter('data/sparse/weekly.json', (rows: CountRow[]) => {
    Object.assign(rows[0], { lines: { all: [15] } });
    return rows;
  });
  assert.ok(
    notArray.some((e) => /lines/.test(e)),
    notArray.join('\n'),
  );
  const missing = violationsAfter('data/sparse/weekly.json', (rows: CountRow[]) => {
    Reflect.deleteProperty(rows[0], 'lines');
    return rows;
  });
  assert.ok(
    missing.some((e) => /lines/.test(e)),
    missing.join('\n'),
  );
  const onChangelog = violationsAfter('data/claude-code/weekly.json', (rows: CountRow[]) => {
    rows[0].lines = [];
    return rows;
  });
  assert.ok(
    onChangelog.some((e) => /lines/.test(e)),
    onChangelog.join('\n'),
  );
  const badStats = violationsAfter('data/sparse/months/2026-08.json', (evs: MonthEvent[]) => {
    Object.assign(evs[0], { stats: { add: 1 } });
    return evs;
  });
  assert.ok(
    badStats.some((e) => /stats/.test(e)),
    badStats.join('\n'),
  );
});

// One case per remaining check: each edit breaks exactly the invariant it names, and the check must say so.
const set =
  <T>(fn: (x: T) => void) =>
  (x: T) => {
    fn(x);
    return x;
  };
const AUG = 'data/claude-code/months/2026-08.json';
type Case = [name: string, change: (out: string) => void, want: RegExp];
const cases: Case[] = [
  [
    'a project without a name',
    json(
      'data/projects.json',
      set((ps: ProjectEntry[]) => {
        Reflect.deleteProperty(ps[0], 'name');
      }),
    ),
    /^data\/projects\.json: claude-code: missing string name$/,
  ],
  [
    'a project with an unknown basis',
    json(
      'data/projects.json',
      set((ps: ProjectEntry[]) => {
        Object.assign(ps[1], { basis: 'nope' });
      }),
    ),
    /^data\/projects\.json: sparse: unknown basis nope$/,
  ],
  [
    'a project whose annotations are not a list',
    json(
      'data/projects.json',
      set((ps: ProjectEntry[]) => {
        Object.assign(ps[0], { annotations: 'anthropic' });
      }),
    ),
    /^data\/projects\.json: claude-code: bad annotations\/links$/,
  ],
  [
    'a project whose source is not a URL',
    json(
      'data/projects.json',
      set((ps: ProjectEntry[]) => {
        ps[0].source = 'CHANGELOG.md';
      }),
    ),
    /^data\/projects\.json: claude-code: source is not a URL$/,
  ],
  [
    'a project without its page',
    (out: string) => rmSync(join(out, 'claude-code', 'index.html')),
    /^claude-code\/index\.html: missing page$/,
  ],
  [
    'annotations that are not a list',
    json('data/annotations.json', () => ({})),
    /^data\/annotations\.json: not an array$/,
  ],
  ...['date', 'label', 'vendor', 'kind', 'source'].map(
    (k): Case => [
      `an annotation without a ${k}`,
      json(
        'data/annotations.json',
        set((a: Annotation[]) => {
          Reflect.deleteProperty(a[0], k);
        }),
      ),
      /^data\/annotations\.json: bad entry /,
    ],
  ),
  ['a site without its root page', (out: string) => rmSync(join(out, 'index.html')), /^index\.html: missing$/],
  [
    'a summary for another project',
    json(
      'data/claude-code/summary.json',
      set((s: Summary) => {
        s.project = 'other';
      }),
    ),
    /^data\/claude-code\/summary\.json: bad shape$/,
  ],
  [
    'byCategory that does not sum to events',
    json(
      'data/claude-code/summary.json',
      set((s: Summary) => {
        s.totals.byCategory.fixed = (s.totals.byCategory.fixed ?? 0) + 1;
      }),
    ),
    /^data\/claude-code\/summary\.json: byCategory does not sum to events$/,
  ],
  [
    'bySource that does not sum to events',
    json(
      'data/claude-code/summary.json',
      set((s: Summary) => {
        s.totals.bySource.rule += 1;
      }),
    ),
    /^data\/claude-code\/summary\.json: bySource does not sum to events$/,
  ],
  [
    'a row whose total is not a number',
    json(
      'data/claude-code/daily.json',
      set((rows: CountRow[]) => {
        Object.assign(rows[0], { total: '1' });
      }),
    ),
    /^data\/claude-code\/daily\.json 2026-07-03: bad row shape$/,
  ],
  [
    'a row whose counts do not sum to its total',
    json(
      'data/claude-code/daily.json',
      set((rows: CountRow[]) => {
        rows[0].counts.fixed = (rows[0].counts.fixed ?? 0) + 1;
      }),
    ),
    /^data\/claude-code\/daily\.json 2026-07-03: counts do not sum to total$/,
  ],
  [
    'a row category outside the basis set',
    json(
      'data/claude-code/weekly.json',
      set((rows: CountRow[]) => {
        rows[0].counts.revert = 0;
      }),
    ),
    /^data\/claude-code\/weekly\.json 2026-06-29: category outside basis set$/,
  ],
  [
    'an event in the wrong month shard',
    json(
      AUG,
      set((evs: MonthEvent[]) => {
        evs[0].ts = '2026-07-31T00:00:00.000Z';
      }),
    ),
    /^data\/claude-code\/months\/2026-08\.json \S+: event in wrong month shard$/,
  ],
  [
    'an event category outside the basis set',
    json(
      AUG,
      set((evs: MonthEvent[]) => {
        evs[0].category = 'revert';
      }),
    ),
    /^data\/claude-code\/months\/2026-08\.json \S+: category revert outside basis set$/,
  ],
  [
    'an event with an unknown source',
    json(
      AUG,
      set((evs: MonthEvent[]) => {
        Object.assign(evs[0], { source: 'guess' });
      }),
    ),
    /^data\/claude-code\/months\/2026-08\.json \S+: bad source guess$/,
  ],
  [
    'an event whose tags are not a list',
    json(
      AUG,
      set((evs: MonthEvent[]) => {
        Object.assign(evs[0], { tags: 'x' });
      }),
    ),
    /^data\/claude-code\/months\/2026-08\.json \S+: bad shape$/,
  ],
  [
    'month shards that miss an event',
    json(AUG, (evs: MonthEvent[]) => evs.slice(1)),
    /^data\/claude-code\/months: 16 events != summary\.totals\.events 17$/,
  ],
  [
    'release counts that do not sum to events',
    json(
      'data/claude-code/releases.json',
      set((rel: Release[]) => {
        rel[0].count += 1;
      }),
    ),
    /^data\/claude-code\/releases\.json: counts do not sum to events$/,
  ],
];
for (const [name, change, want] of cases) {
  test(`rejects ${name}`, () => {
    const errs = violationsIn(change);
    assert.ok(
      errs.some((e) => want.test(e)),
      errs.join('\n'),
    );
  });
}
