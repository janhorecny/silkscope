# Changelog

All notable changes to Silkscope are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Add entries under **Unreleased** as you work;
`npm run release -- patch|minor|major` turns them into a version.

## [Unreleased]

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

[Unreleased]: https://github.com/janhorecny/silkscope/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/janhorecny/silkscope/releases/tag/v0.1.0
