# codebase-trends

- **Every tracked file is public** — the repo is public and `docs/` is served at
  `unrarp.github.io/codebase-trends/`. No tokens, no `.env`, nothing private.
- **Zero runtime dependencies, ESM TypeScript run directly by Node ≥ 22.18, `node --test`.**
  Types are only stripped, by Node and by `build.ts` for the site: erasable syntax
  only (no `enum`, `namespace`, parameter properties; `tsc` enforces it).
  Playwright, Biome, TypeScript, `@types/node` and `chart.js` (types only) are the
  only devDependencies. No bundler, Bun (cloud sessions cannot `bun install`) or
  GitHub Actions.
- **`data/` and `docs/` (except `docs/vendor/`) are machine-written** by
  `src/collect.ts`, `src/build.ts`, `scripts/classify-local.sh` and the routine.
  Never hand-edit them.
- **`npm run check` must pass before every push from a dev machine**
  (`hooks/pre-push` enforces it). The routine has no browser, so it
  runs `npm run check:core` before every commit instead.
- **Never `git add -A` or `git add .`** — add paths explicitly.
- **Tests must be seen failing** before they count: bug fixes fail before the
  fix; other new tests are broken deliberately, watched failing, then restored.
- **The routine commits to `master` every six hours whenever data changed** —
  `git pull --rebase` before you push. Change its behaviour through tracked
  files (`ROUTINE.md`, `src/routine.ts`), never the saved prompt on claude.ai.
- **Categories are derived at build, never stored on events** — fix a
  mislabel with a rule in `src/classify.ts`; `events.jsonl` holds raw facts.
- **A new project lands with its backfill** — see README "Adding a project";
  pushing config alone makes the routine classify the whole history.
- **No root-absolute URLs in `docs/`** — the site lives at `/codebase-trends/`.
