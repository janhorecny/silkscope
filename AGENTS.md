# AGENTS.md

Instructions for AI coding agents working on Silkscope. Humans: start with [README.md](README.md)
and [CONTRIBUTING.md](CONTRIBUTING.md).

## Project overview

Silkscope is a local web app that tails the transcripts coding agents write to disk (Claude Code,
Codex, pi, opencode, Gemini CLI, Factory Droid) and visualises their activity live: a crawler per
session walking eight nebula "sections" (crawler view) or an abstract neuron graph (neural view).

- **Zero runtime dependencies, no build step.** Node ≥ 18 server (`http`, `fs`, `node:test`;
  opencode additionally uses the built-in `node:sqlite`, Node ≥ 22.5). Client is plain ES modules +
  Canvas2D served as-is from `public/`. Do not add npm dependencies, a bundler, TypeScript or a
  framework.
- **Data flow:** transcript file or database → source adapter (`server/sources/*.mjs`) → `Watcher`
  (`server/watcher.mjs`) → `EventHub` SSE (`/stream`) → client `Feed` → `Store` + `World` → render
  layers and HUD panels. Full map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Event contract** (server → client), the 8 categories and the SSE protocol:
  [docs/EVENTS.md](docs/EVENTS.md). Changing an event field means changing both sides.

```
bin/silkscope.mjs        CLI (banner, --check, flags)      bin/term.mjs  terminal branding
server/sources/*.mjs     one adapter per agent              server/events.mjs  event typedefs
server/watcher.mjs       JSONL tailing + db polling         server/hub.mjs     SSE fan-out
server/check.mjs         --check report                     server/static.mjs  static files
public/js/core/          bus, store, feed, stream, settings, config (brand + agent styles), demo
public/js/render/        scene, camera, graph (World), nebula, spider, layers/*
public/js/ui/            hud, panel base, panels/*, intro, pause
test/*.test.mjs          node:test suites                   docs/  technical docs   brand/  brand assets
```

## Setup and run

```bash
npm start                 # http://127.0.0.1:7777, tails real transcripts, opens the browser
npm start -- --no-open --port 7799   # CLI flags go after `--`
npm run demo              # real agents plus the scripted demo feed (marked DEMO)
npm run demo:video        # demo feed only, nothing read from disk (docs/DEMO.md)
npm run check             # how well each adapter reads this machine's transcripts (no content shown)
node bin/silkscope.mjs --help
```

There is nothing to install. Server changes need a restart; client changes need a page reload.
Useful URL params: `?intro=0` skips the intro screen, `?demo=1` starts the demo feed,
`?view=neural` opens the neural view.

## Testing

```bash
npm test                                   # all suites (scripts/test.mjs; works on Windows too)
node --test test/agents.test.mjs           # one suite
node --test --test-name-pattern="codex" test/agents.test.mjs
for f in $(find public server bin scripts -name '*.js' -o -name '*.mjs'); do node --check "$f"; done
```

- CI (`.github/workflows/ci.yml`) runs `npm test` and the syntax check on Ubuntu, macOS and Windows
  × Node 18, 20, 22. Keep tests fast (whole suite < 2 s) and platform-neutral (use `path.join`,
  `os.tmpdir()`, no shell globs).
- **Adapters need fixture tests** built from real record shapes (anonymised). Add them to
  `test/agents.test.mjs` or `test/sources.test.mjs`. Never commit real transcript content.
- Tests that need `node:sqlite` must skip cleanly when it is missing (Node 18/20).
- The client has no browser test runner. Verify UI changes in a real browser; the debug handle
  `window.__swarm` (`store, scene, hud, perf, feed, bus, watch, setView, ingest, step(n, dt)`) lets
  you drive frames even in a background tab, where `requestAnimationFrame` is paused.

## Code style

- ES modules, 2-space indent, semicolons, single quotes, LF (`.editorconfig`). Modern JS, no
  transpilation.
- Short functions; comments explain **why**, not what. Match the density and idiom of the file you
  are editing.
- Server files are `.mjs`; client files are `.js` under `public/js/`.
- Brand colours come from `BRAND` / `CATEGORIES` / `AGENTS` in `public/js/core/config.js` (see
  [brand/BRAND.md](brand/BRAND.md)). Never hard-code a colour in a component; Venom `#FF3D7F` is
  reserved for flags (failed tool calls).

## Hot paths (performance rules)

The render loop must hold the display refresh rate (measured: ~1 ms JS per frame, 100 fps).

- No per-frame allocations in layers: reuse buffers, compact arrays in place, use the cached colour
  strings (`rgbaQ`) and cached text widths.
- Batch strokes (silk, synapses, links) instead of one `stroke()` per segment; cull off-screen work.
- Panels write to the DOM only when a value changed (`setText`, `setStyle`, `toggleClass` in
  `ui/panel.js`).
- The render loop schedules `requestAnimationFrame` first and wraps the frame in try/catch; keep it
  that way. Clamp `dt` to ≥ 0.
- Check with the PERF panel (`P`) before and after any rendering change.

## Common tasks

- **Add an agent:** one file in `server/sources/` (JSONL adapter, or `kind: 'db'` for databases),
  register it in `server/sources/index.mjs`, add a crawler style to `AGENTS` in
  `public/js/core/config.js`, add fixture tests. Guide: [docs/ADDING-A-SOURCE.md](docs/ADDING-A-SOURCE.md).
  Then run `npm run check` against real data and aim for 100 % results matched, and update
  [docs/AGENT-SUPPORT.md](docs/AGENT-SUPPORT.md) with what you actually verified.
- **Add a render layer:** one file in `public/js/render/layers/`, one entry in `LAYERS`
  (`render/scene.js`). See [docs/RENDERING.md](docs/RENDERING.md).
- **Add a HUD panel:** one class extending `Panel` in `public/js/ui/panels/`, one `hud.add()` line in
  `public/js/main.js`. See [docs/UI.md](docs/UI.md).
- **Add a setting:** extend `SCHEMA` in `public/js/core/settings.js` and handle it in the consumer
  via the bus `setting` event.

## Versioning and changelog

- `package.json` is the only place the version lives; the CLI and the UI read it from there. Never
  hard-code a version (a test enforces this for `public/index.html`).
- Every user-visible change gets a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md)
  (Keep a Changelog: Added / Changed / Fixed / Removed) in the same commit.
- Releases: `npm run release -- patch|minor|major`, then commit, tag `vX.Y.Z`, push.

## Security and privacy

- Transcripts contain code, prompts and possibly secrets. The server is read-only (never write to
  agent directories, open databases read-only), binds to `127.0.0.1` by default and makes no
  outbound requests. Keep it that way.
- Nothing from transcripts may end up in the repo: no screenshots of real sessions (use
  `npm run demo:video`, which reads nothing from disk), no fixture copied verbatim.
- `npm run check` and any diagnostics print aggregate counts only, never transcript content.

## Pull requests and commits

- One focused change per PR. Required before committing: `npm test` and the `node --check` loop.
- Commit messages: imperative summary line, body explains why; mention measured numbers for
  performance work.
- For visual changes include a screenshot made from demo data.

## Author

Silkscope is created and maintained by **Jan Horecny** (MIT license).
