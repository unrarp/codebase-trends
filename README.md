# codebase-trends

How much of the work landing in a codebase is new capability, and how much is
correction? <https://unrarp.github.io/codebase-trends/> charts that per week
for each tracked project, with major model releases marked. Tracked so far:
Claude Code (from its changelog) and Codex (from its commits).

A Claude Code routine collects every six hours and commits the result here;
GitHub Pages serves `docs/`.

## What the site shows

Every project page has the same layout, so projects compare on one footing.

- **KPI tiles** over the last 4 complete weeks, each with its change against
  the 4 weeks before: items per week, new features per week, Fixes %
  (`(fixed + revert) ÷ counted items`), and either versions released per week
  (changelog basis) or median commit size (commits basis: lines added +
  deleted, as GitHub reports a diff).
- **One chart**: counted items per week as stacked bars in four buckets, Added,
  Fixed, Changed (`changed` + `improved`) and Removed (`removed` + `revert`),
  with the 4-week rolling Fixes % drawn over them on a right-hand 0–100% axis.
  Numbered markers are the model releases flagged `major` in
  `annotations.json`, each linking its announcement. The span since the data
  last changed is hatched "Not yet collected".
- **Drill-down**: click a week (tap twice on touch screens) to list its items;
  `#YYYY-MM-DD` deep-links a day.
- **Numbered notes** under the chart define every term, window and formula;
  tiles and legend link to them.

Each item is counted in the UTC week it shipped and gets one category:
`added`, `fixed`, `changed`, `improved`, `removed` or `other`, plus `revert`,
`chore`, `test`, `docs`, `ci` for commits. `other`, `chore`, `test`, `docs` and
`ci` are not product changes and are not counted; the page says how many were
set aside.

The site root opens the project last viewed in that browser, else the first in
`projects.json`; a switcher on each page changes project.

## How the data is made

Two bases, set per project in `projects.json`:

- **changelog**: one item per CHANGELOG.md bullet, dated by the version's npm
  publish time (`seed/<project>-dates.json` covers versions npm never listed).
  Each run collects the versions not yet stored; a bullet edited under a
  stored version is ignored.
- **commits**: one item per first-parent commit on the default branch since
  `sources.git.since`, sized against its first parent (`stats`: lines added,
  deleted, files). Each run re-reads that history from a blobless clone and
  keeps the shas not yet stored. A commit whose author or co-author is in the
  project's `bots` list, or ends in `[bot]`, is flagged in the drill-down.

```
projects.json ─► src/collect.js ─► data/<project>/events.jsonl   raw facts, append-only
                                   data/<project>/dates.json     changelog basis
pending = events with no rule category and no label (derived, never stored)
        ─► model (the routine agent, or scripts/classify-local.sh)
        ─► src/apply-labels.js ─► data/<project>/classifications.jsonl
events + rules (src/classify.js) + classifications + annotations.json
        ─► src/build.js ─► docs/data/** + docs/<project>/index.html
        ─► src/validate.js   shape and invariants
```

Categories are derived on every build, never stored on events: a rule in
`src/classify.js` first, else the model's cached label for that text, else
`other`. Changing a rule relabels all history on the next build. `data/` and
`docs/` (except `docs/vendor/`) are machine-written; never edit them by hand.

### Routine

Every six hours (`0 */6 * * *`) a Claude Code routine runs `node src/routine.js`.
Its saved prompt only points to [`ROUTINE.md`](ROUTINE.md), so behaviour
changes are commits. The script collects every project and builds the site. If nothing
under `data/` or `docs/` changed it stops; otherwise it runs
`npm run check:core`, commits `data/` and `docs/` and pushes to `master`.
Either way a successful run pings healthchecks.io.

- **Classify hand-off:** new events with no rule category are written as
  batches to `.routine/batches/` and the script exits 3. The agent labels them
  with `src/model/prompt.md` into `.routine/answers/` and runs
  `node src/routine.js --labels .routine/answers/`, which validates every
  answer before appending any. Unanswered items stay pending for the next run.
- **Only what changed is committed.** The first build is stamped with the
  published `generatedAt`; if `data/` and `docs/` then match the committed
  tree, nothing is committed. Otherwise it rebuilds stamped now, so
  `generatedAt` is the last time the published data changed and the hatch
  starts there. A rule, template or annotation change counts as a change.
- **Failure visibility:** any error pings `$HEALTHCHECK_URL/fail`; a run that
  never starts is a missed ping. Pages keeps serving the last successful commit.
- **Cloud environment:** the session runs on a `claude/…` branch with no local
  `master`, so the script pushes `HEAD:master` and `ROUTINE.md` tells the agent
  not to push the session branch. `hc-ping.com` must be on the environment's
  network allowlist.

## Developing

```sh
npm install
npx playwright install chromium   # once, for the browser test
git config core.hooksPath hooks   # runs `npm run check` before every push
```

Zero runtime dependencies, plain ESM, Node ≥ 22; Playwright is the only
devDependency.

| script | runs | where |
|---|---|---|
| `npm test` | `node --test 'test/**/*.test.js'` | everywhere |
| `npm run check:syntax` | `node --check` over `src/` and `scripts/` | everywhere |
| `npm run check:data` | `node src/validate.js` over `docs/` | everywhere |
| `npm run check:browser` | Playwright smoke test at 1280×800 and 375×812 | local only |
| `npm run check:core` | test + check:syntax + check:data | routine, before every commit |
| `npm run check` | check:core + check:browser | `hooks/pre-push` |

The browser test builds the fixtures into a temp dir and serves them at
`/codebase-trends/`, so a root-absolute URL fails it.

The site is hand-written browser JS (`src/site/app.js`, `app.css`) plus
Chart.js 4.5.1 (MIT), vendored unmodified at `docs/vendor/chart.umd.js`.
`build.js` copies the site files into `docs/` and stamps each asset URL with
its content hash, so a changed script loads with the page instead of after the
Pages and browser caches expire.

**Local backfill:** `scripts/classify-local.sh <project>` collects, then labels
pending events with local `claude -p` (`JOBS` parallel batches, default 4;
`LIMIT` runs only the first N). A failed batch is reported and the rest kept;
re-run to re-ask what is still pending.

## Adding a project

1. Add an entry to `projects.json` (`id`, `name`, `basis`, `sources`, `links`,
   `annotations`, and `bots` for the commits basis). Don't push yet: pushing
   config before the backfill makes the next routine run classify the whole
   history in one session.
2. Run `scripts/classify-local.sh <id>` until nothing is pending.
3. Run `npm run build && npm run check`, then commit `projects.json`, `data/`
   and `docs/` together (collect runs every project, so others may have new
   data too) and push.

Pages and the project switcher are generated from config; a new project needs
no code. Commits are sized as they are collected; `scripts/backfill-stats.js`
adds `stats` to commit events stored without them, from a full clone.
