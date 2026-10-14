# codebase-trends

Static dashboard at <https://unrarp.github.io/codebase-trends/> showing, per
tracked project, how much of the work landing over time is new capability
versus correction, overlaid with model-release markers.

An hourly Claude Code routine (instructions in [`ROUTINE.md`](ROUTINE.md))
collects data, commits it to this repo, and GitHub Pages serves `docs/`.

Work in progress.

## Development

- Node ≥ 22, no runtime dependencies.
- `npm run check` runs every quality gate; `hooks/pre-push` enforces it.

## Cloud environment notes

Pending the first routine run.
