# Demo feed and recording videos

The demo feed plays believable, scripted agent work so you can show Silkscope without real
sessions, take screenshots, or record a video.

```bash
npm run demo:video        # demo only, seed 7, clean (no DEMO banner/badges), opens the browser
npm run demo              # your real agents plus the demo feed (demo sessions are marked DEMO)
npm start -- --demo-only --seed 42 --pace 1.5 --clean
```

## What it plays

Five sessions, one per agent style, on everyday projects:

| agent | project | stack |
|-|-|-|
| Claude Code | storefront | Next.js + Stripe |
| Codex | api-gateway | Go |
| pi | docs-site | Astro |
| opencode | mobile-app | Expo / React Native |
| Gemini CLI | data-pipeline | Python + Airflow |

Each session works through **stories**, one task after another: a prompt arrives, the agent plans,
searches, reads files, sometimes delegates to a subagent or looks up the docs, edits, runs the
tests, and about half the time a test fails (a pink flag), so it diagnoses, fixes and re-runs until
green, then lints or builds and replies. Every tool is spelled in that agent's own vocabulary
(`Read`/`Grep` for Claude Code, `rg -n` through Codex's shell, `read_file` for Gemini CLI, …), so the
crawl log and tags look like the real thing. Quick read/search streaks alternate with longer
thinking pauses and tests, which gives the crawlers a natural rhythm.

## Options

| CLI | URL | effect |
|-|-|-|
| `--demo-only` | | nothing is read from disk; only the demo feed |
| `--seed <n>` | `?seed=n` | same seed, same tasks, targets and failures: reproducible takes |
| `--pace <x>` | `?pace=x` | tempo multiplier (`1.5` = 50 % faster) |
| `--clean` | `?clean=1` | no DEMO banner and no DEMO badges in the instance list |
| | `?warm=0` | start from an empty map instead of a few minutes of finished work |
| | `?intro=0` | skip the intro screen |
| | `?view=neural` | open in the neural view |

Timing depends on real timers, so the same seed reproduces the sequence of events, not the exact
millisecond of each frame.

## Recording tips

- **Window.** 1920×1080 or 2560×1440 browser window; hide the bookmarks bar. Leave the tab visible:
  browsers pause rendering in background tabs.
- **Opening shot.** Load the page with the intro, let the web finish spinning, press Enter. The
  history replays into the map in front of the camera.
- **All agents.** The default wide shot is calm. Press `0` for a full overview.
- **Follow one agent.** Click a session in the instance list (or `Tab`). The camera locks on, dollies
  in while it works and cuts when it changes section. With `⚙ settings → camera → cinematic`
  (the default) this is the most dramatic shot.
- **Neural view.** `V` switches to the abstract neuron graph. It's quieter, so let it run 20 to 30 s.
- **Clean frame.** `?clean=1` hides demo labels; close the help, settings and perf panels.
- **Smoothness.** Check `FPS` in the top bar (or press `P`). On a retina screen at high resolution,
  set `⚙ settings → render quality → full` so adaptive quality does not lower resolution during
  the take.
- **Reproducible takes.** Keep the seed fixed (`npm run demo:video` uses 7) and restart the server
  between takes.
