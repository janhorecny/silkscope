# Performance

Silkscope runs next to the agents it watches, often for hours, so it has to stay out of the way: a
stable frame rate in the browser, flat memory, and a server that idles at about 1 % CPU with
thousands of transcript files on disk. This page describes how, what was measured, and how to
measure it yourself.

## Measurements

### Browser, real use

Real Chrome, visible tab, 1600×1100 window, DPR 1, demo feed plus real transcript data. Measured
in three configurations: crawler view watching one instance, crawler view with all instances, and
neural view with all instances.

| Metric | Result |
|-|-|
| Frame rate | 100 fps (the display's refresh rate) in all three |
| p95 frame interval | 10.4–11.0 ms |
| Worst frame | 11.1 ms |
| Frames over 20 ms | 0 of 499 |
| JS heap | 26.6 MB |

### JS cost per `draw()`

Seeded benchmark: 3,200 events (~530 targets, ~1,700 synapses), canvas 1720×1007. Time spent in
JavaScript per `scene.draw()` before and after the render refactor (sprites, batching, cached
colours and text, in-place compaction):

| | Before | After |
|-|-|-|
| Crawler view | 1.96 ms | 1.08 ms |
| Neural view | 1.36 ms | 0.91 ms |
| `hud.frame()` | 0.025 ms | 0.011 ms |

This is JavaScript time only; rasterisation happens on the GPU/compositor and shows up in the frame
interval, which is why adaptive quality watches the interval rather than JS time (below).

### Server

About 3,900 transcript files on disk (Claude Code + Codex):

| Metric | Result |
|-|-|
| Start-up (index + backfill) | ~0.23 s |
| RSS after start | ~108 MB |
| JS heap after start | ~22 MB |
| Idle CPU | ~1 % |
| One discovery scan | 20 ms → 0.4 ms CPU with the directory-mtime cache |

The earlier unbounded backfill (read every recent file in full) took 3.0 s and 367 MB RSS on the
same data.

## Client design

### Pre-rendered sprites

- **Nebulae.** Each section's ~2,600 points, filaments and glow are drawn once at start into two
  off-screen canvases (lit and dormant, 1.25 px per world unit). Each frame costs two `drawImage`
  calls per visible section, cross-faded by `globalAlpha`.
- **Neurons.** One 64×64 radial-gradient glow sprite per section colour plus one for flags; the
  neural view stamps them with `drawImage` instead of creating gradients per node.
- **Matrix rain.** Rendered into its own half-resolution canvas and advanced only every 55 ms; each
  frame blits it once.

### Batching

- **Synapses** are grouped into 72 buckets (8 section colours + 1 cross-section colour, × 8 alpha
  bands). Each bucket keeps a growable `Float64Array` of curve coordinates between frames, and is
  drawn as one path with one `stroke()`. ~1,700 synapses become at most 72 strokes.
- **Silk** draglines (up to 700 points) are split into 6 age bands: ~6 strokes per crawler.
- **Web strands:** the 3 strands of a section pair share one path.
- Additive (`lighter`) blending is order independent, so batching does not change the picture.

### Culling

- Every world-space layer tests against `w.view`, the visible world rectangle plus an 80 px
  margin: sections (by radius), synapses (by endpoint bounds), neurons.
- Labels skip sections whose centre is far off-screen and tags outside the viewport.
- Hit-testing scans target dots only in sections within 1.2 R of the cursor, and caches the result
  until the cursor, the camera or a section's node set changes (`cluster.version`).

### No per-frame garbage

- Arrays that shrink every frame are compacted in place (`a[j++] = a[i]; a.length = j`):
  neural signals, the hot-node list, bursts, pulses, tentacles.
- The per-frame layer context `w` is one object refreshed in place.
- Labels use a fixed pool of 480 candidate objects, a pool of 64 tag boxes and a `Float64Array`
  for placed rectangles.
- The fire cascade's top-k synapse selection uses a reused array with insertion, not
  `filter().sort().slice()`.
- Each section keeps its nodes in recency order (`cluster.recent`) by insertion on every hit, so
  labels never sort a node map per frame.
- Only nodes with activation (`hot`) are decayed each frame.

### Cached colours and text

- `rgbaQ(rgb, alpha)` (`core/util.js`) returns a cached CSS colour string. Alpha is quantised to
  1/1000 (below what an 8-bit canvas can show) and the cache is a `WeakMap` keyed by the rgb array,
  so pass long-lived arrays. Thousands of per-frame template strings become table lookups.
- Tag text and its measured width are cached on the node and invalidated when the label, verb,
  flag state or loaded fonts change (`fontEpoch` bumps on `document.fonts` `loadingdone`).
- Section sublines and crawler captions are cached strings, rebuilt only when their inputs change.
- `ctx.font` is assigned only when it changes (assignment re-parses the font string).

### Change-only DOM writes

- `setText`, `setHTML`, `setClass`, `toggleClass`, `setStyle` (`ui/panel.js`) remember the last
  value on the element and skip identical writes. The top bar updates every frame through them and
  touches the DOM only for numbers that changed.
- Panels update at 4 Hz from one shared snapshot; `store.heat()` is computed once per tick.
- The instance list and radar chart re-render only when a key of their visible content changes; the
  crawl log inserts only new rows.
- The PERF panel samples two numbers per frame into typed ring buffers and touches the DOM only
  while open.

### Bounded state

All client collections are capped (raw events 8,000, nodes 220 per section, synapses 2,400,
signals ~500, bursts 600, crawlers 8, tentacles 22 per crawler, silk 700 points). See
[ARCHITECTURE.md](ARCHITECTURE.md#where-state-lives).

## Adaptive quality

`Scene.#adapt()` (`render/scene.js`) runs after every draw.

- It tracks the **real interval between frames** (exponential moving average, 5 % per frame), not
  just JS time, so it also catches GPU fill-rate stalls (for example a large retina canvas). JS
  time is tracked the same way.
- Frames in a hidden tab or after a gap above 250 ms are ignored (a hitch, not a trend).
- Every 90 frames, with `quality: auto`:
  - **step down** one level when the average interval is above **22 ms** (below ~45 fps);
  - **step up** one level when the interval is below **17.5 ms**, JS time below **6 ms**, and at
    least 600 frames have passed since the last step up.
- A step that changes the device-pixel ratio resizes the canvas.

| Level | `quality` | What changes |
|-|-|-|
| full | 1 | Canvas at `min(devicePixelRatio, 2)`. |
| eco | 0.5 | Canvas at DPR 1. |
| min | 0 | DPR 1, no matrix rain, 180 instead of 520 background stars, no cursor web, a third of the burst particles, tentacles without flowing dots. |

The `quality` setting can pin `full` (1) or `eco` (0.5). The current level shows in the top bar
FPS (`· eco`, `· min`) and the PERF header.

Reduced motion (setting `motion`) is separate from quality but also saves work: no bursts, no
anticipation fans, no rain, one-hop cascades, no flowing dots.

## Server design

- **Polling, not `fs.watch`.** Portable across macOS, Linux and Windows and immune to atomic-rename
  editors. Each pass is a `setTimeout` chain, so a slow pass never overlaps the next.
- **Hot and cold files.** A tick runs every 700 ms. Files modified in the last 15 minutes are
  `stat`ed every tick; all others are spread over 10 round-robin slots and each is checked every
  10th tick (~7 s). Only files whose size changed are opened.
- **Discovery with a directory-mtime cache.** Every 4 s the watcher walks the source trees, but a
  directory whose mtime has not changed costs one `stat` instead of a `readdir` and a path per
  entry (a directory's mtime moves when entries are added, removed or renamed). Every 15th scan
  (~60 s) is a full walk as a safety net for filesystems with coarse directory mtimes.
- **Bounded backfill.** At start-up files are sorted newest first and read only until there is
  enough history: at most 80 files, only those modified within `--hours` (default 8), only the
  last 768 KB of each, and no further files once ~1,170 events are collected; then the newest 900
  are kept. Priming reads at
  most 64 KB of each file's head. Start-up time and peak memory therefore do not grow with the
  number of old sessions.
- **Bounded reads.** A tick reads at most 8 MB of new data per file; the rest is read on the next
  tick. Incomplete trailing lines wait in a per-file buffer.
- **Bounded history.** `watcher.history` is trimmed back to 900 events when it reaches 1,800.
- **Cheap stats.** The `ping` payload is computed at most once per second and shared by all tabs.
- **SSE backpressure.** A client with more than 1 MiB unsent is skipped and, if stalled for 15 s,
  disconnected ([EVENTS.md](EVENTS.md#backpressure)).

## Measuring it yourself

### PERF panel (`P`)

| Row | Meaning |
|-|-|
| header | Current quality level (`full`, `eco`, `min`). |
| graph | Last 240 frames: frame interval (mint) and JS time (amber); dashed lines at 60 and 30 fps. |
| fps | Average over the last 240 frames, and the worst frame as fps. |
| frame | Average and p95 frame interval. |
| js / frame | Average and p95 JS time in `update + draw + hud.frame`. |
| canvas | CSS size, DPR, and estimated bitmap memory (main canvas, layer canvases, nebula sprites). |
| browser ram | `performance.memory` used / total heap (Chrome only). |
| heap trend | Least-squares slope of the heap over the last 2 minutes in MB/min; a steady positive value suggests a leak. |
| server ram, server heap, server cpu, watched files | From the server `ping` (every 2 s). |
| events kept | Raw events in the browser (`feed.raw`) and the server history. |
| targets, synapses, signals · bursts, crawlers · tentacles | World object counts. |

Frames after a gap above 250 ms (hidden tab) are not recorded.

### `window.__swarm`

A debug handle exposed by `main.js`:

| Member | Use |
|-|-|
| `store`, `scene`, `hud`, `perf`, `feed`, `bus` | The live instances. |
| `watch(id)` | Watch one session id (`null` = all). |
| `setView('crawler' \| 'neural')` | Switch view (not persisted). |
| `ingest(ev, animate = true)` | Feed one event as if it came from the stream. |
| `step(n = 60, dt = 1/60)` | Run `n` update steps and one draw, even in a hidden tab (rAF is paused there); returns the frame counter. |

Example: a seeded draw benchmark in the console.

```js
const S = window.__swarm;
S.scene.configure('quality', 'full');            // pin quality so #adapt does not change it
const cats = ['prompt', 'think', 'read', 'search', 'edit', 'exec', 'net', 'agent'];
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = Date.now();
for (let i = 0; i < 3200; i++) {
  const session = 'bench-' + (i % 3), cat = cats[(rnd() * 8) | 0];
  S.ingest({ id: 'b' + i, ts: now - (3200 - i) * 500, agent: i % 3 ? 'claude' : 'codex', session,
    project: 'bench', cat, verb: cat, target: `${cat}-${(rnd() * 70) | 0}`, status: 'ok' }, false);
}
S.step(120);                                      // settle crawlers and camera
for (const view of ['crawler', 'neural']) {
  S.setView(view);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) S.scene.draw(performance.now());
  console.log(view, ((performance.now() - t0) / 200).toFixed(2), 'ms per draw()');
}
console.log(S.scene.counts());
```

Run it while watching all instances (`A`) with the `agents` setting on `both`, otherwise the
filter drops the synthetic events. Events ingested with `animate = false` take the silent path (no
crawler queue, no crawlers), so they build the map instantly. Numbers depend on the machine, window size and how many targets are on screen;
compare before/after on the same setup. Reload the page afterwards to drop the synthetic data.

### Server

- The PERF panel shows server RSS, heap, CPU and watched files from the `ping` frames.
- Raw stats: `curl -N http://127.0.0.1:7777/stream` prints the `hello` (with the full history)
  and then a `ping` every 2 s.
- Start-up time: the CLI prints its banner only after the backfill has finished and the port is
  bound, so the time from launch to banner is the start-up cost.
