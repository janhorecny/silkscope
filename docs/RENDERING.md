# Rendering

Everything on the stage is Canvas2D, drawn every animation frame into one `<canvas id="cv">`.
There are two looks over the same data:

- **crawler**: the reference look. Nebula clouds per section, one crawler per session, tentacles,
  silk draglines, target tags.
- **neural**: abstract. Every target is a neuron, every transition between targets a synapse,
  every tool call fires and the signal cascades along the agent's real paths.

Source files: `public/js/render/` (`scene.js`, `camera.js`, `graph.js`, `nebula.js`, `spider.js`,
`layers/*.js`).

## Frame pipeline

`main.js` runs one `requestAnimationFrame` loop:

```js
const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
if (!scene.paused) scene.update(dt, now);   // World, Camera, layer.update
scene.draw(now);                             // all layers, then adaptive quality
hud.frame(now, dt);                          // per-frame panels
perf.sample(now, performance.now() - t0);    // PERF panel ring buffer
```

The next frame is scheduled first, so one throwing frame cannot stop the loop (the first 5 errors
are logged). Pause (`space`) skips `update` only: drawing, hover and the HUD continue, and events
keep arriving.

`Scene.update(dt, now)`:

1. `world.update(dt, now, camera.focusCluster)`: crawler queues, motion, signals, decay.
2. `camera.update(dt, now, world)`.
3. `layer.update?.(dt, now, w)` for each layer.
4. Refresh the cursor's world position.

`Scene.draw(now)`:

1. Clear to Void (`#05060A`) at device-pixel scale.
2. Refresh the per-frame context `w` (below).
3. For each layer whose `views` includes the current view, in `LAYERS` order: world-space layers are
   drawn under the camera transform with `globalCompositeOperation = 'lighter'` (additive);
   screen-space layers in CSS pixels with `source-over`. The transform is pushed/popped only when the
   space changes between consecutive layers.
4. `#adapt()`: adaptive quality (see [PERFORMANCE.md](PERFORMANCE.md#adaptive-quality)).

### Layer order

```js
const LAYERS = [BackgroundLayer, WebLayer, ClustersLayer, SynapsesLayer, CrawlersLayer, LabelsLayer, HoverLayer];
```

| Layer | File | Space | Views | Draws |
|-|-|-|-|-|
| `background` | `layers/background.js` | screen | both | Matrix rain and a parallax star field. |
| `web` | `layers/web.js` | world | both | Braided strands between sections and packets on section changes. |
| `clusters` | `layers/clusters.js` | world | both | Nebula sprites; in crawler view also stars, target dots, pending markers, cursor web. |
| `synapses` | `layers/synapses.js` | world | both | Synapses (faint in crawler, main subject in neural), neurons (neural only), signals. |
| `crawlers` | `layers/crawlers.js` | world | both | Bursts, silk, tentacles, crawler bodies or neural loci. |
| `labels` | `layers/labels.js` | screen | both | Section names, target tags, crawler captions; publishes tag boxes. |
| `hover` | `layers/labels.js` | screen | both | Hit-test, crosshair, coordinates, hover details, cursor style. |

## The Layer interface

```js
// One file per layer under layers/, registered in LAYERS order (scene.js):
{
  id: string,
  views: ['crawler', 'neural'],      // which looks draw it
  space?: 'world' | 'screen',        // default 'world'
  resize?(W, H),                     // CSS-pixel size changed (also called on quality steps)
  pixels?(),                         // bitmap pixels this layer owns, for the PERF panel
  update?(dt, now, w),               // optional per-frame simulation step (skipped while paused)
  draw(g, w),                        // g: CanvasRenderingContext2D, w: per-frame context
}
```

Layers are constructed once with the World: `new L(world)`.

The per-frame context `w` is one object refreshed in place (no allocation per frame):

| Field | Meaning |
|-|-|
| `now` | `performance.now()` of this frame. |
| `z` | Camera zoom (world units → CSS px). |
| `view` | `{x0, y0, x1, y1}` visible world rectangle plus an 80 px margin, for culling. |
| `W`, `H` | Canvas size in CSS pixels. |
| `neural` | `true` in the neural view. |
| `overview` | Camera in overview, or in auto mode with no single instance watched. |
| `quality` | `1`, `0.5` or `0` (adaptive). |
| `reduced`, `matrix`, `labelMode` | User settings (`motion`, `matrix`, `labels`). |
| `world`, `cam`, `mouse`, `canvas` | World model, `Camera` instance, mouse state (`x, y` screen, `wx, wy` world, `down`), the canvas. |
| `prim` | Primary crawler: the watched one, else the most recently active. |
| `hover`, `selected` | Current hover pick and selected node. |
| `tagBoxes` | Screen boxes of the tags drawn this frame (written by `labels`). |
| `pickHover()` | Re-runs hit-testing and updates `w.hover` (called by `hover`). |

### Adding a layer

1. Create `public/js/render/layers/<name>.js`:

```js
import { rgbaQ } from '../../core/util.js';

const RING = [255, 216, 74]; // long-lived array: rgbaQ caches strings per array

export class PendingRingsLayer {
  id = 'pendingRings';
  views = ['crawler'];          // space defaults to 'world'

  constructor(world) { this.world = world; }

  draw(g, w) {
    const v = w.view;
    g.lineWidth = 1 / w.z;
    for (const c of w.world.clusterList) {
      for (const n of c.recent) {
        if (!n.pending) continue;
        const x = c.x + n.x, y = c.y + n.y;
        if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
        g.strokeStyle = rgbaQ(RING, 0.4 + 0.3 * Math.sin(w.now / 200));
        g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
      }
    }
  }
}
```

2. Import it in `scene.js` and insert it into `LAYERS` where it should stack.
3. Keep to the performance rules in [PERFORMANCE.md](PERFORMANCE.md): cull with `w.view`, no
   per-frame allocation, cached colour strings (`rgbaQ`), batch strokes where you can. In world
   space everything adds light (`lighter`); switch `globalCompositeOperation` locally if you need
   opaque shapes and restore it (as `CrawlersLayer` does).
4. If the layer owns off-screen canvases, implement `pixels()`; if they depend on the window size,
   implement `resize(W, H)`.

## Camera

`render/camera.js`. "The world moves, not the crawler." The camera holds `cam {x, y, z}` (mutated
in place; World and layers keep the reference) and a target `camT`. Each frame it either runs a
flight or eases `cam` toward `camT` with frame-rate independent damping
(`damp(a, b, λ, dt) = lerp(a, b, 1 - exp(-λ·dt))`).

World bounds are `WORLD = { x0: -1000, y0: -780, x1: 920, y1: 900 }`; the overview zoom fits them
to the window (`× 0.98`). User zoom is clamped to 0.6×–8× the overview zoom.

### Modes (`camera.mode`)

| Mode | Entered by | Target | λ | Leaves |
|-|-|-|-|-|
| `auto`, one instance watched | default; `watch` | Between the crawler and its section centre (55 % toward the crawler); zoom `2.1×` overview, dollying in to `2.85×` over 9 s in one section (cinematic) or fixed `2.3×` (calm). | 3 (cinematic), 1.3 (calm) | |
| `auto`, all instances | default | Overview framing, leaning 10 % toward the active section and zoomed 6 % in while there was activity in the last 30 s. | 0.7 | |
| `focus` | click a cloud, a tab or a SECTIONS row; keys `1`–`8` | Section centre, `2.3×` overview. | 2.5 | back to `auto` after 25 s |
| `free` | drag or wheel | Wherever the user put it. | 10 | back to `auto` 15 s after the last drag/wheel |
| `overview` | `0`, `O`, the overview button, double-click | Overview framing. | 0.7 | toggled off by the same controls |

### Camera styles

`camera.cameraMode`, set by the `camera` setting.

| Style | Effect |
|-|-|
| `cinematic` | Section changes of the watched crawler trigger a flight with a zoom dip (pull out, punch in); slow dolly-in while it stays. |
| `calm` | Smooth follow, no automatic flights on section change, flights have no dip, no dolly. |
| `still` | In `auto` the camera never moves by itself and `fly()` is a no-op. User pan/zoom, focus and overview still work. |

### Flights

`fly(now, dip)` animates from the current position to `camT` over 950 ms with
`easeInOutCubic`; zoom is multiplied by `1 - dip · sin(π·p)`, so it pulls out mid-way and punches
back in. `dip` is forced to 0 in `calm` or with reduced motion.

| Trigger | dip |
|-|-|
| Watched crawler changes section (`cinematic` + `auto` only, more than 700 ms since the last flight ended, backlog < 12) | 0.42 |
| `watch` (instance changed) | 0.35 |
| `focus` | 0.25 |

## The World model

`render/graph.js` (`World`) holds everything layers read. No drawing happens there.

### Clusters and nodes

Each of the 8 categories is a `Cluster` (`render/nebula.js`) at a fixed map position from
`core/config.js`, radius 270 world units.

- **Point cloud:** ~2,600 points from 4–7 rotated Gaussian blobs, carved with fBm noise so it reads as
  gas. Seeded by the category key (`mulberry32(hashStr(key))`), so it is identical across reloads.
- **Sprites:** rendered once at start into two off-screen canvases at 1.25 px per world unit: lit
  (category colour) and dormant (grey). Filaments link each point to up to 3 neighbours (spatial
  hash), plus 70 long faint strands. Layers cross-fade the two sprites.
- **Stars:** 64 live points per cloud that twinkle and react to the cursor.
- **Nodes:** `cluster.node(target)` returns the node for an event's `target` (empty → `·`), creating
  it on a random dense point. Nodes never move. At most 220 per cluster; the one with the oldest
  `lastHit` is evicted. `cluster.recent` keeps nodes newest-hit first (insertion, not a sort per
  frame) and `cluster.version` bumps on add/evict for hit-test caching.
- **Section state:** `lit` (0..1 colour mix, ever active), `heat` (spikes per hit, decays 0.35/s),
  `activeT` (eases to 1 for the active section), `flash` (on crawler arrival).

### Synapses

When a session touches node B right after node A, the undirected synapse `A~B` gets `w++` and
`last = now` (silent rebuilds back-date `last` by 2 min so they do not look fresh). At most 2,400;
when exceeded, the weakest-and-stalest tenth (by `w + last/60000`) is pruned in one pass.

### Signals and the fire cascade

When a crawler's tentacle reaches a node, `world.fire(node, 1, 0, null, now)`:

1. `node.act += energy` (max 1.8); the node joins the `hot` list (only hot nodes are decayed,
   `act *= exp(-1.7·dt)`).
2. Unless depth ≥ 2 (≥ 1 with reduced motion) or more than 500 signals are in flight: pick the
   top-k synapses by weight (k = 6 at depth 0, 3 deeper), excluding the one back to the sender,
   and launch a signal along each. Duration `260 + 0.9 · distance` ms; energy
   `e · (0.4 + min(0.4, 0.15 · log1p(w)))`.
3. When a signal arrives, its target fires with the signal's energy at `depth + 1`.

So one tool call lights its target and cascades up to two hops along the paths the agent actually
took.

### Crawler pacing queue

Events arrive in bursts (a Claude message can hold several tool calls). Each crawler has a queue
(max 40, oldest dropped) and releases one item at a time in `World.update`:

1. **Pick.** When nothing is pending and `now ≥ nextAt`, shift the next `{cl, node, ev}`. The
   destination is near the section centre (`centre + node × 0.2` ± 10 units), not on the node.
2. **Section change.** Send a packet along the strand between the sections, retract tentacles in
   other sections, flash the new cloud, throw the **anticipation fan** (12 long tentacles into random
   points of the next cloud, staggered 14 ms; 4 when the backlog is above 12; none with reduced
   motion), tint the silk, and start moving after a lead of 340 ms (60 ms under backlog). The reach
   happens between `lead + 300` ms (if arrived) and `lead + 900` ms. The camera is told
   (`onTravel`).
3. **Same section.** Move at once; reach after at most 90 ms.
4. **Reach.** A tentacle grows to the node, the node is touched (recency, tag), section heat +0.5,
   a burst of 10 particles, and the node fires.
5. **Gap** before the next item: 300 ms, 110 ms when more than 8 are queued, 40 ms above 24;
   at least 760 ms after a section change unless the backlog is above 24.

All durations are divided by `world.speed` (2.2 during history replay, else 1). Fan tentacles
retract 900 ms after the body has arrived. The label `+N queued` appears under a crawler with more
than 2 waiting.

### Crawlers

`world.spiderFor(session)` creates a `Spider` per session (max 8; the least recently active one
that is not watched is dropped). A crawler idle for 20 minutes fades out and is removed, unless it
is the watched one. After a rebuild, `placeSpiders()` parks a crawler in each recent session's last
section and re-attaches up to 12 tentacles to its last nodes there.

Other transient state: `bursts` (particles, max 600, none with reduced motion, a third at quality
0), `pulses` (section-to-section packets, 1.6 s).

## Crawler motion model

`render/spider.js`, distilled from the reference recording ([RESEARCH.md](RESEARCH.md)).

**Travel.** `goTo(x, y, delay, now, speed)`. Hops longer than 160 units follow a quadratic arc
(control point offset perpendicular by ±0.18–0.32 of the distance, random side) over
`(420 + 0.55·d) / speed` ms with `easeInOutCubic`; shorter moves target the point directly.

**Spring.** The body chases the path point with a stiff spring (`k = 18`, damping
`2√k · 0.97`, just under critical) plus a small noise skitter whose amplitude grows with distance
(`min(14, d/22)`). Speed is capped at 1,500 units/s. At rest a slow noise drift keeps it alive.
Above 10 units/s the heading eases toward the direction of travel (rate 5/s).

**Cilia.** 26 hairs around the shell. Each is a quadratic curve with its own length, phase and
ripple speed; at rest they ripple, in motion their tips sweep toward the back of travel
(proportional to speed / 500). A `pulse` (set on every non-fan reach, decays 1.6/s) swells the
shell and cilia and draws an expanding ring.

**Body.** Grid-hatched oval shell (15×12 units, clipped hatching every 2.6), diamond core with a
glow, soft radial halo. Colours from `AGENTS[agent]` in `core/config.js`. Rotating brackets mark
the primary crawler when there is more than one (or one is watched).

**Silk.** A point is dropped every 5 units of travel (max 700, kept 45 s). Drawn as a smooth
midpoint-quadratic path, batched into 6 age bands so a full dragline is ~6 strokes. Colour is
near-white with 35 % of the section colour it was spun in.

**Tentacles.** Max 22 live; the oldest retracts when a new one is needed. They are "combed": all
bend to the same side relative to the heading. Growth takes 520 ms (fan: 420 ms) with
`easeOutCubic`; retraction 450 ms. Each is a solid quadratic strand drawn up to the reached
fraction, with dots flowing toward the target (crawler view at quality ≥ 0.5 without reduced motion)
and a ring at the target once reached. Pink when the call failed, silk-tinted for fan tentacles,
near-white otherwise. On a section change, tentacles into other sections retract.

**Neural view.** The body is replaced by a locus of attention (`drawLocus`): a glowing ring and
dot, with the same pulse and brackets. Tentacles are drawn thinner and without flowing dots.

## Labels policy

`LabelsLayer` (screen space) decides which targets carry a tag. Candidates are the 60 most recently
hit nodes of each on-screen section; each gets an alpha and a priority:

| Rule | Applies | Alpha | Priority |
|-|-|-|-|
| Under the cursor or selected | always, both views, every label mode | 1 | 10 |
| Touched by a live tentacle | crawler view, labels ≠ `none` | 0.95 | 4 − age·0.05 |
| Hit in the last `freshFor` s (5 s; 2.5 s when only the primary crawler is labelled) | crawler view, labels ≠ `none` | fades out over the last 40 % | 3 − age·0.1 |
| Flagged, in the active section, not overview | crawler view, labels ≠ `none` | 0.85 | 2 |
| Recent node within the `all` limit (8 in overview, else 5 + 14·activeT) | crawler view, labels = `all` | 0.7 overview, else 0.35 + 0.6·activeT | ~1–2 |

- With more than 2 crawlers and no single instance watched, only the primary crawler's tentacles
  count as "touched", otherwise the map becomes a wall of text.
- The neural view is wordless except for hover/selection.
- Candidates are sorted by priority and placed right of the dot, else left with a leader line; if
  both positions collide, the tag is dropped (unless priority ≥ 9). At most ~60 tags per frame.
- Text: `label · verb` for 4 s after a hit, `label · ⚑ error` when flagged (solid pink box),
  otherwise the label; truncated to 30 characters. New tags pop in with an ease-out-back scale.
- Section names are always drawn; the stats subline (`N events · N targets · crawling|idle|queued`)
  in crawler view, and in neural view only for the active section.
- Crawler captions: `agent · project`, plus `+N queued`.

## Hit-testing

`Scene.#pickHover()` runs once per frame from `HoverLayer` (after the labels, so this frame's tag
boxes are known) and on click. First match wins:

1. a **tag box** in `w.tagBoxes` (screen rectangles) → node;
2. a **crawler** within 26 px of the cursor → spider;
3. the nearest **target dot** within 12 px, scanning only clusters within 1.2 R of the cursor. The
   result is cached until the cursor, the camera or any `cluster.version` changes;
4. a **cloud** within 0.8 R → cluster.

Click: node → select it and open the inspector; crawler → inspector with session details and
"watch only this instance"; cloud → focus the section; empty space → close the inspector.
A drag of more than 2 px pans instead of clicking. Double-click → overview. Wheel → zoom around
the cursor.
