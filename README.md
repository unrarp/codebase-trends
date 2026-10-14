# codebase-trends

Static dashboard at <https://unrarp.github.io/codebase-trends/> showing, per
tracked project, how much of the work landing over time is new capability
versus correction, overlaid with model-release markers.

An hourly Claude Code routine (instructions in [`ROUTINE.md`](ROUTINE.md))
collects data, commits it to this repo, and GitHub Pages serves `docs/`.

## What the site shows

Per project, every change item is counted in the UTC week it shipped and
categorised: `added`, `fixed`, `changed`, `improved`, `removed`, `other`, plus
`revert`, `chore`, `test`, `docs`, `ci` for commit-based projects. Every project
page shows the same three things, so projects compare on one footing:

1. **KPI tiles**: items per week, new features (`added`) per week, fixes as a
   percentage of changes ("Fixes %"), and (changelog basis) versions released per
   week, averaged over the last 4 complete weeks, each with its signed change
   vs the 4 weeks before underneath.
   One note under the chart defines the windows and the formula; the tiles
   and the chart legend link to it.
2. **One chart**: items per week by type as stacked bars, with the 4-week
   rolling fix share, `(fixed + revert) / (total − chore − test − docs − ci)`,
   drawn over them on a right-hand 0–100% axis. `improved` is shown as
   `changed`; `chore`, `test`, `docs` and `ci` are one "maintenance" colour.
   Clicking a week lists its items; `#YYYY-MM-DD` deep-links a day's list. On
   narrow screens the chart scrolls sideways and opens at the latest week.

Only model releases flagged `major` in `annotations.json` are drawn, as
numbered markers; the other entries stay in the file unused. The site root opens the
project last viewed in that browser (else the first in `projects.json`); a
switcher on each page changes project. The span after the last sync is hatched
"Not yet collected", so a stalled routine shows as a growing hatch.

Two bases, set per project in `projects.json`:

- **changelog**: one item per CHANGELOG.md bullet, dated by the version's npm
  publish time (`seed/claude-code-dates.json` covers the claude-code versions
  npm never listed).
- **commits** (Codex): one item per first-parent commit on the default
  branch since `sources.git.since`; a commit whose author or co-author is in
  the project's `bots` list or ends in `[bot]` is flagged in the drill-down.

## Data flow

```
projects.json ─► src/collect.js ─► data/<project>/events.jsonl  (append-only raw facts)
                                   data/<project>/dates.json    (changelog basis)
                                   data/<project>/pending.jsonl (gitignored)
pending ─► model (routine agent or scripts/classify-local.sh)
        ─► src/apply-labels.js ─► data/<project>/classifications.jsonl
events + rules (src/classify.js) + classifications + annotations.json
        ─► src/build.js ─► docs/data/** + docs/<project>/index.html
        ─► src/validate.js (shape + invariants)
```

`data/` and `docs/` (except `docs/vendor/`) are machine-written; never edit
them by hand.

## Routine

An hourly Claude Code routine runs `node src/routine.js`, which collects every
project, builds the site, runs `npm run check:core`, commits `data/` and
`docs/` and pushes to `master`, then pings healthchecks.io. Every successful
run commits.

- **Classify hand-off:** if new events have no rule category, the script writes
  batches to `.routine/batches/` and exits 3. The agent labels them using
  `src/model/prompt.md` into `.routine/answers/` (same file names) and runs
  `node src/routine.js --labels .routine/answers/`, which validates every
  answer before appending any. Unanswered items stay pending for the next run.
- **Failure visibility:** any error pings `$HEALTHCHECK_URL/fail` (immediate
  email); a run that never starts shows up as a missed ping. Pages keeps
  serving the last successful commit.
- **Saved prompt:** a stub that only says to follow `ROUTINE.md`, so behaviour
  changes are commits.
- **Cloud environment:** the default network allowlist reaches the npm
  registry and GitHub; `hc-ping.com` must be added to the routine's
  environment. A session runs on a `claude/…` branch with no local `master`,
  so the script pushes `HEAD:master`, and `ROUTINE.md` tells the agent not to
  push the session branch its stop hook reports as unpushed.
- **Local backfill:** `scripts/classify-local.sh <project>` collects and labels
  pending events with local `claude -p` (env `JOBS` parallel batches, default 4;
  `LIMIT` only the first N batches). A failing batch is reported and the rest
  are kept; re-run to re-ask what is still pending.

## Adding a project

1. Add an entry to `projects.json` (`id`, `name`, `basis`, `sources`, `links`,
   `annotations`, and `bots` for commits basis) locally; don't push it yet.
2. Run `scripts/classify-local.sh <id>` until nothing is pending.
3. Run `npm run build && npm run check`, then commit `projects.json`, `data/`
   and `docs/` together (collect runs every project, so other projects may have
   new data too) and push.

Pushing the config before the backfill would make the next hourly run try to
classify the project's whole history in one session. Pages and the project
switcher are generated from config; a new project needs no code.

## Quality gates

| script | runs | where |
|---|---|---|
| `npm test` | `node --test 'test/**/*.test.js'` | everywhere |
| `npm run check:syntax` | `node --check` over `src/` and `scripts/` | everywhere |
| `npm run check:data` | `node src/validate.js` over `docs/` | everywhere |
| `npm run check:browser` | Playwright smoke test at 1280×800 and 375×812 | local only |
| `npm run check:core` | test + check:syntax + check:data | routine, before every commit |
| `npm run check` | check:core + check:browser | `hooks/pre-push` |

The browser test builds the test fixtures into a temp dir and serves them at
`/codebase-trends/`, so a root-absolute path fails it. Install its browser once
with `npx playwright install chromium`.

## Site

Hand-written browser JS (`src/site/app.js`, `app.css`) plus Chart.js
**4.5.1** (MIT), vendored unmodified at `docs/vendor/chart.umd.js` from the npm
tarball. `build.js` copies the site files into `docs/`. `annotations.json` holds
the model-release markers, each with its announcement URL.

## Design notes

- **Every successful run commits.** The build always rewrites
  `summary.json`'s `generatedAt`, so `generatedAt` is the last successful sync
  and the site's hatched region measures staleness with no other state. A
  rule, template or annotation change also takes effect on the next run.
- **Rules are applied at build time, never stored on events.** `events.jsonl`
  holds raw facts only; categories are derived on every build (rule first,
  then the cached model label by `textHash`, else `other`/pending). Changing a
  rule relabels all history on the next build with no migration.
- **Collection state is derived, not stored.** The changelog basis collects
  versions not yet in `events.jsonl`; the commits basis re-reads history since
  `sources.git.since` (a blob-less clone takes seconds) and skips known shas.
  A bullet edited under an already-collected version is ignored.
