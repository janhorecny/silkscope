# Research notes

How the reference recording (`snapgram.io_xxjegvl33ftu.mp4`, 21 s, 720×1280, credited "defileo / X",
UI branded `studio.prompt`, swarm `prompt-crawler`) was decoded, and how each piece maps onto live
Claude Code and Codex activity.

## 1. What the reference actually does (frame-by-frame breakdown)

Frames were sampled at 1 fps with ffmpeg and cropped to the canvas and HUD.

| Element in the video | Behaviour | Our equivalent |
|-|-|-|
| Top stats line `SWARM prompt-crawler · LEGS 16 · TENTACLES 22 · WORDS READ 105/181 · LINKS 23 · FLAGS 7 · T 12.20 · FRAME 0732` | live counters, monospace, tabular numbers | `AGENTS · LEGS · TENTACLES · EVENTS READ · TARGETS · LINKS · FLAGS · TOKENS · T · FRAME` |
| 8 tabs (role, objective, context, roles, rules, review, start, ship) | the current one fills with its colour | 8 activity sections: prompt, think, read, search, edit, exec, net, agent |
| Section heading `04 ROLES / six owners · six outputs` | colour bar on the left | `05 EDIT / 24 events · 24 targets · 0 flagged · files written` |
| Nebula clusters | ~thousands of dust points + a fine web of short filaments; grey when queued, tinted when visited, brightest when active | pre-rendered filament sprite per cluster in two tints, cross-faded |
| Cluster label `context / 23/35 words · reading` | label above-right of the cloud | `exec / 192 events · 88 targets · crawling` |
| The crawler | oval shell with grid hatching, magenta diamond core, ~16 short curved legs | same, legs are procedural IK-style steppers |
| Tentacles | dotted curves from the body to individual words, fanning out | dotted quadratic béziers with dots flowing toward the target |
| Word tags | small outlined boxes `transcript · claim`; flagged words are solid pink `smallest · ⚑ vague` | outlined target tags `server.ts · Edit`; failed tool calls become solid pink `npm test · ⚑ error` |
| Wandering trail | thin jagged line in the section colour showing where the crawler walked | noise-wandered spring path with an age-faded breadcrumb trail |
| Yellow squares | blinking markers scattered in a cloud | tool calls still waiting for a result |
| Final "08 SHIP" | camera pulls out, every cloud lit with its tags | overview mode (auto after 45 s idle, or `0`) |
| HUD: CRAWL LOG, SECTIONS, COVERAGE RADAR, WORD HEAT, SPEC SCORE, CRAWLER.PY | six dense panels | CRAWL LOG, SECTIONS, COVERAGE RADAR, ACTIVITY HEAT, SWARM HEALTH, SWARM.PY |

The reference is a scripted prompt-building demo; it is not a product that can be installed. We
checked `filamental.space` as a candidate: it is a desktop 3D document/knowledge-graph app
(Obsidian-style spaces with named connectors), with a different visual language and no live
agent telemetry, so it is not the tool behind the video and was not used.

## 1b. Second pass: dense frame analysis of the transitions (8 fps)

- **Anticipation.** Before the crawler leaves a section it shoots a fan of 15–20 long curved tentacles
  into the *next* cloud. Only then does the tab switch, the new cloud floods with colour and the old
  one drops back to grey.
- **The world moves, not the crawler.** The crawler sits near the screen centre; the camera tracks it
  tightly, dollies in slowly while it works, pulls out and swings over on a section change, and
  zooms all the way out for the final SHIP frame.
- **Silk.** A near-white dragline stays behind the crawler for the whole section, smooth and arced.
- **Cilia, not legs.** The body is ringed by ~25 short curved hairs (sea-urchin like) that ripple.
- **Tentacles** are thin solid curves with dots flowing out, ending in a ring at the tagged word.
- **Labels follow the tentacles.** Only touched words carry tags; everything else is a dot.

## 2. Motion principles we kept

1. **Everything breathes.** Nothing is ever static: stars twinkle, clouds scale by ±0.8 %, idle
   crawlers drift on value noise, legs re-plant.
2. **Spring, not tween, for travel.** The crawler follows a critically-damped spring toward its
   target plus a perpendicular noise offset proportional to distance. That produces the jagged,
   alive path in the reference instead of a robotic straight line.
3. **Procedural gait.** Each of the 16 feet stays planted until its rest point (body + angle ×
   length + velocity lead) drifts past 42 % of leg length, then steps in 110 ms with an arc lift.
   Alternating groups step on alternate 110 ms beats; a hard reach limit drags feet so legs never
   rubber-band. (Approach after classic procedural spider IK write-ups, e.g. Alan Zucconi's
   tentacle IK and the analytic two-bone spider in `majidmanzarpour/threejs-procedural-spider`.)
4. **Reach, then reveal.** A tentacle grows over 520 ms (ease-out cubic), *then* the tag pops
   with an ease-out-back scale. Cause before effect, as in the video.
5. **Frame-rate independent smoothing.** Camera and highlight transitions use
   `lerp(a, b, 1 - exp(-λ·dt))`, so motion feels identical at 60 Hz and 120 Hz.
6. **Paced playback.** Events queue per crawler and are released at 340 ms, 120 ms or 40 ms
   intervals depending on backlog. Bursts stay readable, and the swarm never falls minutes behind.
7. **Cosmic web + matrix.** Clouds are tied by braided, off-centre filament strands with packets
   drifting along well-used links; a faint katakana/hex rain sits behind everything (toggle `M`).

## 3. Data sources (verified)

**Claude Code**: `~/.claude/projects/<encoded-cwd>/<session>.jsonl` (verified locally).
`assistant` lines carry `message.content[]` with `tool_use {id, name, input}`, `thinking`, `text`
and `message.usage`; `user` lines carry the prompt text or `tool_result {tool_use_id, is_error}`.
Usage repeats across content blocks of the same `message.id`, so tokens are de-duplicated by id.

**Codex CLI**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (format confirmed from several
open-source parsers: clickhouse/nerve, gstack, mempalace, langwatch). Each line is
`{timestamp, type, payload}`:
- `session_meta` → session id + `cwd` (first line only, so the watcher always reads the head)
- `response_item/function_call` (`shell`, `exec_command`, `update_plan`, …) and `custom_tool_call`
  (`apply_patch`) → actions; `*_output` → results (exit code from `metadata.exit_code` or
  `Process exited with code N`)
- `event_msg/user_message`, `agent_message`, `agent_reasoning`, `token_count`, `mcp_tool_call_*`

Shell commands from both agents are classified by their first verb (`cat/sed -n` → read,
`rg/grep/find/git status` → search, `curl` → net, `apply_patch/mv/git commit` → edit, else exec).

## 4. Architecture choices

- **Zero dependencies.** Node's `http` + polling tailer on the server; plain ES modules and
  Canvas2D on the client. No build step, so `npx`/`node` just runs.
- **Polling over `fs.watch`.** Portable across macOS/Linux/Windows and immune to editor-style
  atomic renames. Hot files (modified < 15 min) are polled every 700 ms, cold files ~every 7 s,
  new files are discovered every 4 s. Measured ~1 % CPU with ~4 000 transcript files.
- **SSE, not WebSockets.** One-way stream, auto-reconnect for free.
- **Canvas2D with cached sprites.** Each cloud's ~2 600 points and filaments are rendered once into
  two off-screen canvases. A full frame measured ~3.8 ms at 1720×1007.
- **Localhost only** (`127.0.0.1` by default): transcripts can contain secrets, so nothing is ever
  sent off the machine.
