# codebase-trends

- **Every tracked file is public** — served at `unrarp.github.io/codebase-trends/`
  from `docs/`, and the repo is public. No tokens, no `.env`, nothing private.
- **Zero runtime dependencies, plain ESM JavaScript, Node ≥ 22, `node --test`.**
  Playwright is the only devDependency. No TypeScript, bundler, Bun (cloud
  sessions cannot `bun install`) or GitHub Actions.
- **`data/` and `docs/` (except `docs/vendor/`) are machine-written** by
  `src/collect.js`, `src/build.js`, `scripts/classify-local.sh` and the six-hourly
  routine. Never hand-edit them.
- **`npm run check` must pass before every push from a dev machine**
  (`hooks/pre-push` enforces it). The routine has no browser, so it
  runs `npm run check:core` before every commit instead.
- **Never `git add -A` or `git add .`** — add paths explicitly.
- **Tests must be seen failing** before they count: bug fixes fail before the
  fix; other new tests are broken deliberately, watched failing, then restored.
- **The routine runs every six hours and commits to `master` whenever data changed** —
  `git pull --rebase` before pushing. Change what it does through tracked files (`ROUTINE.md`,
  `src/routine.js`), never the saved prompt on claude.ai.
- **Categories are derived at build, never stored on events** — fix a
  mislabel with a rule in `src/classify.js`; `events.jsonl` holds raw facts.
- **A new project lands with its backfill** — see README "Adding a project";
  pushing config alone makes the routine classify the whole history.
- **No root-absolute URLs in `docs/`** — the site lives at `/codebase-trends/`.
