# Contributing

Thanks for wanting to make Silkscope better. It is deliberately small: zero runtime dependencies,
no build step, plain ES modules, Canvas2D. Please keep it that way.

## Develop

```bash
npm start          # http://127.0.0.1:7777, tails your real transcripts
npm run demo       # synthetic sessions, no agent needed
npm test           # node:test, < 1 s
```

Edit files in `public/` and reload the page; edit `server/` and restart. The debug handle
`window.__swarm` (store, scene, hud, perf, feed, bus, watch, setView, ingest, step) is available in the
console. `?intro=0` skips the intro screen while you iterate.

## Add an agent

One file in `server/sources/` (see `claude.mjs` / `codex.mjs` and the comment in `index.mjs`), plus
a crawler style in `AGENTS` (`public/js/core/config.js`) and an option in the `agents` setting
(`public/js/core/settings.js`). The full walkthrough is [docs/ADDING-A-SOURCE.md](docs/ADDING-A-SOURCE.md). Add parser tests to `test/sources.test.mjs` with a
few real (anonymised) transcript lines.

## Pull requests

- One focused change per PR; describe what you saw before and after.
- `npm test` must pass, and `node --check` every file you touched.
- Visual changes: attach a screenshot or short clip, and check the PERF panel (`P`) so frame time
  does not regress.
- Match the surrounding style: short functions, comments that explain *why*.
- Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Releasing

`npm run release -- patch|minor|major` bumps `package.json` (the only place the version lives;
the CLI and the UI read it from there) and moves the Unreleased entries under the new version.
Then commit, tag `vX.Y.Z` and push. CI fails if the current version has no CHANGELOG entry.

By contributing you agree that your contributions are licensed under the MIT license.
Be kind; we follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
