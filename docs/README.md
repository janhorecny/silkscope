# Silkscope documentation

| Document | What it covers |
|-|-|
- [DEMO.md](DEMO.md): the scripted demo feed, options (seed, pace, clean, warm) and video recording tips.
- [AGENT-SUPPORT.md](AGENT-SUPPORT.md): verification status per agent (real transcripts, live, UI) and how to help close the gaps.
| [ARCHITECTURE.md](ARCHITECTURE.md) | The big picture: data flow from transcript file to pixels, module map, lifecycle, where state lives. |
| [EVENTS.md](EVENTS.md) | The normalised event schema, categories, result resolution, shell classification, the `/stream` SSE protocol and backpressure. |
| [ADDING-A-SOURCE.md](ADDING-A-SOURCE.md) | Step-by-step guide to supporting a new agent: adapter interface, worked example, client style, tests. |
| [RENDERING.md](RENDERING.md) | The canvas pipeline: scene, layers, camera modes, world model, crawler motion, labels, hit-testing. |
| [UI.md](UI.md) | The HUD: panel base class, every panel, settings and storage keys, hotkeys, adding a panel. |
| [PERFORMANCE.md](PERFORMANCE.md) | How it stays fast, measured numbers, adaptive quality, and how to measure it yourself. |
| [RESEARCH.md](RESEARCH.md) | Frame-by-frame analysis of the reference recording that inspired the motion design. |

Elsewhere in the repository: [CONTRIBUTING.md](../CONTRIBUTING.md),
[SECURITY.md](../SECURITY.md), [brand/BRAND.md](../brand/BRAND.md).
