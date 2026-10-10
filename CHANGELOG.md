# Changelog

All notable changes to Silkscope are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Add entries under **Unreleased** as you work;
`npm run release -- patch|minor|major` turns them into a version.

## [Unreleased]

### Added
- Scripted demo feed for videos: five agents (Claude Code, Codex, pi, opencode, Gemini CLI) on
  everyday projects work through stories (plan, search, read, edit, failing test, fix, verify,
  reply) in English, each in its own tool vocabulary, with natural pacing.
- Demo options: `--demo-only` (nothing read from disk), `--seed` (reproducible takes), `--pace`,
  `--clean` (no DEMO banner/badges), warm start (`?warm=0` to disable); `npm run demo:video`.
- `docs/DEMO.md` with recording tips.
- `npm run check` shortcut for `--check`.
- `AGENTS.md` with instructions for AI coding agents (and `CLAUDE.md` importing it).
- Author credit (Jan Horecny) in the README, `--help` and package metadata.
- `docs/AGENT-SUPPORT.md`: per-agent verification status (real transcripts, live, UI), also
  summarised in the README.

### Fixed
- Tests now run on Windows (the npm test glob was not expanded by PowerShell/cmd); CI no longer
  cancels the other platforms when one fails.
- The demo banner disappears after a few seconds instead of sitting in every frame.
- Readability: the Mist text token is lighter (`#828BA0`, 5.9:1 on Void instead of 4.3:1); the
  intro hint (was 2.6:1), crawl-log times (2.5:1) and code comments now meet WCAG AA; the intro's
  skip checkbox is styled to match.
- README: Quick start and Command line now agree (`npm start -- <options>` from the clone,
  `silkscope <options>` after `npm install -g .`); the demo has four sessions, not three.

## [0.2.0] - 2026-10-10

### Added
- pi support (`~/.pi/agent/sessions`), verified on live sessions: 100 % of tool results matched.
- opencode support through its SQLite database (read-only, built-in `node:sqlite`, Node ≥ 22.5),
  polled only when the database or its WAL changes.
- Gemini CLI (`~/.gemini/tmp/*/chats/*.jsonl`) and Factory Droid (`~/.factory/sessions`) support.
- Database source adapters (`kind: 'db'`: open, backfill, poll) alongside JSONL adapters.
- `silkscope --check`: runs every adapter over your own transcripts and reports how many tool
  results matched their calls, without showing any transcript content.
- Crawler styles for every agent; the agents setting lists all registered agents.
- The instance list says how many older sessions the time window hides.

### Changed
- Codex adapter rewritten for Codex 0.104 to 0.147: `custom_tool_call` shells (`exec`), MCP calls by
  namespace, `exec_command_*`, `patch_apply_*`, `web_search_*`, `item_started`/`item_completed`,
  nested `session_meta`, cwd from `turn_context`; one action per call id across duplicate records.

### Fixed
- A call reported twice (Codex `*_output` plus `exec_command_end`) no longer double-counts the
  success rate; a later result can only upgrade ok to error.

## [0.1.0] - 2026-10-10

First public release.

### Added
- Live tailing of Claude Code and Codex transcripts through pluggable source adapters
  (`server/sources/`), newest-first bounded backfill and an SSE stream with backpressure.
- Crawler view modelled on the reference recording: eight nebula sections, one crawler per session
  with tentacle fans, arced travel, silk draglines, cilia, camera cuts and dolly-in.
- Neural view: targets as neurons, real transitions as synapses, two-hop firing cascades.
- Instance picker (watch one session or all), inspector, six-panel HUD, settings panel with
  camera, labels, agents, instance window, render quality, reduced motion, matrix rain, intro and
  demo options.
- Intro screen whose orb web is the real loading progress, with START; pause overlay with play.
- PERF panel with frame timing, browser and server memory and live object counts; adaptive render
  quality based on the real frame interval.
- Branded CLI: crawler mark, palette, start-up summary, `--sources`, `--version`, clean ctrl+c.
- Brand: name, mark, banner, colour-blind tested palette (`brand/BRAND.md`).

[Unreleased]: https://github.com/janhorecny/silkscope/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/janhorecny/silkscope/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/janhorecny/silkscope/releases/tag/v0.1.0
