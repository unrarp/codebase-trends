# codebase-trends

Static dashboard at <https://unrarp.github.io/codebase-trends/> showing, per
tracked project, how much of the work landing over time is new capability
versus correction, overlaid with model-release markers.

An hourly Claude Code routine (instructions in [`ROUTINE.md`](ROUTINE.md))
collects data, commits it to this repo, and GitHub Pages serves `docs/`.

Work in progress.

## Routine

An hourly Claude Code routine runs `node src/routine.js`, which collects every
project, runs `npm run check:core`, commits `data/` and `docs/` and pushes to
`master`, then pings healthchecks.io. Every successful run commits.

- **Classify hand-off:** if new events have no rule category, the script writes
  batches to `.routine/batches/` and exits 3. The agent labels them using
  `src/model/prompt.md` into `.routine/answers/` (same file names) and runs
  `node src/routine.js --labels .routine/answers/`, which validates every
  answer before appending any.
- **Failure visibility:** any error pings `$HEALTHCHECK_URL/fail` (immediate
  email); a run that never starts shows up as a missed ping. Pages keeps
  serving the last successful commit.
- **Saved prompt:** a stub that only says to follow `ROUTINE.md`, so behaviour
  changes are commits.
- **Local backfill:** `scripts/classify-local.sh <project>` collects and labels
  pending events with local `claude -p` (env `JOBS` parallel batches, default 4;
  `LIMIT` only the first N batches). Run it before adding a large project.

## Development

- Node ≥ 22, no runtime dependencies.
- `npm run check` runs every quality gate; `hooks/pre-push` enforces it.

## Cloud environment notes

Measured in the Phase 0 probe runs (2026-10-14):

- The default network allowlist reaches `registry.npmjs.org`,
  `raw.githubusercontent.com` and `github.com` (a `--shallow-since` clone of
  bun takes ~2 s); `hc-ping.com` must be added to the routine's environment.
- A routine session runs on a `claude/…` branch with no local `master`, so
  pushes use `git push -u origin HEAD:master`. Without `-u` the session's stop
  hook sees the branch as unpushed and pushes a stray `claude/…` branch too.
- `master` has no branch protection; the routine's GitHub access pushes to it
  directly.
