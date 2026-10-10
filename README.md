# agent swarm

A live, local visualiser for **Claude Code** and **Codex** activity. Every session becomes a crawler
that walks a nebula of eight sections (prompt, think, read, search, edit, exec, net, agent),
reaching dotted tentacles to the files, commands and URLs your agent touches. Failed tool calls light
up as pink flags, pending calls blink yellow, and the HUD underneath keeps score.

Everything runs on your machine. The server only reads the transcript files the agents already write,
and binds to `127.0.0.1`.

## Run

```bash
# Node 18+; no dependencies
git clone <this repo> agent-swarm && cd agent-swarm
npm start                # opens http://127.0.0.1:7777
npm run demo             # synthetic sessions, no agent needed
npm install -g .         # optional: then just run `agent-swarm` anywhere
```

Options:

```
--port <n>          port (default 7777, auto-increments if busy)
--host <addr>       bind address (default 127.0.0.1)
--no-open           don't open the browser
--demo              start the synthetic feed
--hours <n>         hours of history to replay on load (default 8)
--claude-dir <dir>  default ~/.claude/projects   (respects CLAUDE_CONFIG_DIR)
--codex-dir <dir>   default ~/.codex/sessions    (respects CODEX_HOME)
```

## Two views, one or all instances

- **crawler view** (default): the reference look. Sections are nebulae, each session is a crawler that
  throws a fan of tentacles into the next section, arcs over on a silk dragline, then reaches its
  targets. Labels appear only where a tentacle is touching (press `L` for every recent label).
- **neural view** (`V`): ultra abstract. Every target is a neuron, every move from one target to the
  next is a synapse (it thickens with use), every tool call fires and the signal cascades two hops
  along the agent's real paths. No text except on hover.
- **instances** (top right): watch *all sessions* in a calm wide shot, or pick one Claude / Codex
  session. The map and every HUD panel are rebuilt for that instance only, and the camera follows it
  tightly: a slow dolly-in while it works in a section, a pull-out-and-punch-in cut when it moves.

## Toolbar

| control | what it does |
|-|-|
| **crawler · neural** | the reference look, or the abstract neural network of targets (`V`) |
| **overview** | fit the whole map; press again to resume following (`0`, double-click) |
| **pause** | freeze motion; events keep being recorded (`space`) |
| **perf** | frame timing, browser and server memory, object counts (`P`) |
| **⚙ settings** | everything below, saved in the browser (`S`) |
| **?** | help and shortcuts |
| **INSTANCES** | `all sessions` or one session (agent, project, current section, events, last activity). A filled pulsing dot means active in the last 2 min; `DEMO` marks synthetic sessions; `−` collapses the list; hover a row for session id and model. `A` all, `Tab` next |

## Settings

| setting | options | meaning |
|-|-|-|
| View | crawler / neural | same as the toolbar switch |
| Camera | cinematic / calm / still | cuts and slow dolly-in on section changes · smooth follow · never moves on its own |
| Labels | touched / all recent / none | only targets a tentacle is on (as in the reference) · every recent target · hover only |
| Agents | both / claude / codex | which agents feed the map and HUD |
| Instance list | 15 min / 1 h / 8 h / all | hide sessions idle longer than this |
| Render quality | auto / full / eco | auto drops resolution and effects below ~45 fps |
| Motion | full / reduced | reduced removes tentacle fans, bursts, camera swoops and rain (defaults to reduced if the OS asks for it) |
| Matrix rain | on / off | background glyphs |
| Demo feed | off / on | synthetic sessions, marked DEMO, never written anywhere |

## Other input

| input | action |
|-|-|
| drag / wheel | pan / zoom around the cursor |
| click a cloud | focus that section |
| click a tag, dot or neuron | inspect every hit on that target, with input and result |
| click a crawler | details, then "watch only this instance" |
| `1`–`8` | jump to section |
| `L` · `M` · `D` | cycle labels · matrix rain · demo feed |
| `Esc` | close panels |

## Performance

Everything is Canvas2D with pre-rendered nebula sprites, batched strokes (silk, synapses, links)
and off-screen culling. A frame costs ~1.5 ms of JS at 1720×950 with ~550 synapses and ~100 live
signals. Quality adapts to the real frame interval: below ~45 fps it drops to DPR 1 and static
tentacles, then also turns off the matrix rain; it climbs back when there is headroom. The top bar
shows `FPS` (and `eco` / `min` when degraded). Hidden tabs cost nothing (rendering pauses).

Press `P` for the **PERF panel**: a live frame-time / JS-time graph (last 240 frames), FPS with p95,
canvas bitmap memory, browser JS heap with a MB/min trend to spot leaks (Chrome only, via
`performance.memory`), the server's RSS, heap and CPU %, and counts of every live object (events
kept, targets, synapses, signals, crawlers, tentacles). Server start-up backfill reads newest
transcripts first and stops once it has enough history: ~0.2 s and ~115 MB RSS with ~3 900 files.

## How it maps

| visual | meaning |
|-|-|
| crawler (teal shell, pink core) | a Claude Code session |
| crawler (white shell, cyan core) | a Codex session |
| tentacle | one tool call reaching its target |
| tag | a target: file, pattern, command, host, subagent |
| solid pink tag `· ⚑ error` | the tool call failed (`is_error` / non-zero exit) |
| yellow block | tool call still running |
| trail | where the crawler walked recently |
| strands between clouds | transitions between sections; brighter when used more |

See [RESEARCH.md](RESEARCH.md) for the frame-by-frame breakdown of the reference recording, the
motion principles and the transcript formats.

## Tests

```bash
npm test
```
