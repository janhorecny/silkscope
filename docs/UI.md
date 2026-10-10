# UI: HUD, panels, settings, hotkeys

The DOM around the canvas is a set of small panels, each one file under `public/js/ui/panels/`,
registered in `public/js/main.js` and driven by `Hud` (`public/js/ui/hud.js`). Panels read Store,
Scene and Feed; they never talk to each other except through the bus.

## Hud

```js
const hud = new Hud({ store, scene, feed, bus, settings });
hud.add(PanelClass, opts);   // constructs new PanelClass(ctx, opts), returns the instance
hud.get(id);                 // look a panel up by id
```

| Call | Cadence | What it does |
|-|-|-|
| `update()` | every 250 ms (`setInterval`, 4 Hz) | Builds one shared snapshot and calls `panel.update?.(state)` on every panel. A throwing panel is skipped (first 5 errors logged) without affecting the others. |
| `frame(now, dt)` | every animation frame | Calls `panel.frame?.(dt, now)`. Keep this cheap. |
| on bus `reset` | when the picture is rebuilt | Calls `panel.reset?.()`. |

The snapshot passed to `update(state)`:

```js
state = {
  now: Date.now(), store, scene, feed,
  active: scene.activeCluster,          // Cluster or null
  overview: scene.mode === 'overview',
  heat: store.heat(12),                 // { rows: {cat: number[12]}, tokens: number[12], events: number[12] }
}
```

`store.heat()` is computed once per tick and shared, not once per panel.

## Panel base class

`public/js/ui/panel.js`:

```js
// Panel interface: { id, update?(state), frame?(dt, now), reset?() }
export class Panel {
  constructor(ctx, { el, title, badge = '', badgeClass = 'mint', badgeId, body = '', parent = '#hud' } = {})
  $(sel)                // querySelector inside the panel root
  badge(text, cls)      // set the header badge text (and class), change-only
}
```

A panel owns one root element:

- `{ el }`: an existing element from `index.html` (selector or node), e.g. `#topbar`, `#inspector`.
- `{ title, badge, badgeClass, badgeId, body, parent }`: a new bottom-HUD box appended to `parent`,
  with the standard markup `<div class="panel"><header><span>TITLE</span><em class="…">badge</em></header>…body</div>`.
  `this.badgeEl` points at the `<em>`.

Change-only DOM helpers (the last written value is remembered on the element, so any module can
use them):

| Helper | Writes when |
|-|-|
| `setText(el, v)` | `String(v)` differs from the last text |
| `setHTML(el, v)` | the HTML string differs |
| `setClass(el, v)` | `className` differs |
| `toggleClass(el, cls, on)` | the class state differs |
| `setStyle(el, prop, v)` | the value differs; CSS custom properties (`--c`) via `setProperty` |
| `fitCanvas(g)` | Sizes a panel canvas to 2× its CSS size, reallocating only when the size changed; returns `[w, h]` with the context scaled ×2 and cleared. |
| `esc(s)` | Escapes `& < > "` for HTML templates. Use it for every event-derived string. |

## Panels

In mount order (`main.js`). Top and overlay panels first, then the six bottom-HUD boxes left to
right, then PERF.

| Panel (`id`) | File | Root | Shows | Data | Cadence |
|-|-|-|-|-|-|
| `topbar` | `topbar.js` | `#topbar` | AGENTS (crawlers), LEGS (crawlers × 16, a nod to the reference), TENTACLES (live), EVENTS READ, TARGETS (distinct targets), LINKS (section transitions), FLAGS, TOKENS, T (s since load), FRAME, FPS (with `eco`/`min` suffix); source list; `● LIVE` / `○ OFFLINE` badge. | Store, Scene; bus `hello`, `live` | `frame()`; FPS every 20 frames |
| `tabs` | `tabs.js` | `#tabs` | One tab per section with its event count; the active one fills with its colour. Click focuses the section. | Store, active cluster | 4 Hz |
| `heading` | `heading.js` | `#section` | `NN NAME` plus counts and blurb of the active section; `∞ SWARM` with totals in overview or when nothing is active. | Store, active cluster | 4 Hz |
| `toolbar` | `toolbar.js` | `#controls` | View switch, overview, pause, perf, settings, help buttons; all hotkeys; toggles the help overlay. | Scene, Feed, Settings | events |
| `instances` | `instances.js` | `#instances` | "all sessions" plus up to 12 sessions, most recent first (plus the watched one if it fell off), filtered by the `agents` and `window` settings. Each row: agent, project, DEMO tag, last section, event count, age; tooltip with session id and model. Header: live count (activity in the last 120 s), shown, hidden. Click a row to watch it; `−`/`+` collapses. | `feed.instances()` (independent of the current filter) | 4 Hz, re-rendered only when a key of the visible content changes |
| `inspector` | `inspector.js` | `#inspector` | **Node:** section, label, hits, flagged / pending, the last 14 events (time, verb, agent · project, status, input, result). **Crawler:** agent · project, session, model, events, tokens, section, queue length, last seen, "watch only this instance". Snapshot at open time. | bus `inspect`; Store sessions | events |
| `banner` | `banner.js` | `#banner` | Centre banner: `WATCHING …` (2.2 s), `REPLAYING N EVENTS…`, `DEMO FEED…`, and the idle hint (cleared by the first live event). | bus `watch`, `replay`, `demo`, `idle`, `ev` | events |
| `log` | `log.js` | CRAWL LOG | Newest 16 log rows (time, verb in section colour or pink for flags, target); badge: events/s, smoothed. Only new rows are inserted; bursts of more than 3 are not animated. | `store.log` (60 rows, `seq`-numbered) | 4 Hz |
| `sections` | `sections.js` | SECTIONS | Per-section event count, `⚑` flag count and a bar relative to the busiest; badge: sections used. Click focuses. | `store.cats` | 4 Hz |
| `radar` | `radar.js` | COVERAGE RADAR | Polar chart of events per section (square-root scale), active section highlighted; agents bar (crawlers × 20 %) and flags bar (flags × 3 %). | `store.cats`, Scene | 4 Hz; chart redrawn only when size, active section or counts change |
| `heat` | `heat.js` | ACTIVITY HEAT | 8 × 12 grid: events per section per minute over 12 minutes; events in the current minute; distinct targets and section links; badge: total events. | `state.heat`, Store | 4 Hz |
| `health` | `health.js` | SWARM HEALTH | Tokens-per-minute sparkline (12 min, gently animated) and success-rate gauge (`ok / (ok + err)`, eased; Spinneret > 85, Warn > 60, else Venom); badge: tokens in the current minute. | `state.heat.tokens`, `store.health` | 4 Hz, always redrawn |
| `code` | `code.js` | SILK.PY | Typewriter narration of animated events as pseudo-Python (`spider.walk_to("edit")`, `hit = spider.reach("db.ts")`, `flag(hit, kind="error")`); badge: lines/s. | bus `event` (animated only) | `frame()`; DOM every 60 ms |
| `perf` | `perf.js` | `#perf` | See [PERFORMANCE.md](PERFORMANCE.md#measuring-it-yourself). | frame samples, `performance.memory`, bus `ping` | samples every frame; DOM at 4 Hz only while open |

Not panels, but part of the UI:

- **Settings** (`core/settings.js`, `#settings`): rendered by `Settings` itself from the schema.
- **Help** (`#help` in `index.html`): static controls and legend, toggled by the toolbar.

## Settings

One schema (`SCHEMA` in `public/js/core/settings.js`) drives the settings panel, the defaults and
persistence. Every change emits bus `setting {key, value}`; at boot `main.js` emits one per key for
`view`, `camera`, `labels`, `quality`, `motion`, `matrix` so consumers start in sync.

| Key | Label | Options (value: label) | Default | Effect |
|-|-|-|-|-|
| `view` | View | `crawler`, `neural` | `crawler` | Which look the scene draws. |
| `camera` | Camera | `cinematic`, `calm`, `still` | `cinematic` | Camera style ([RENDERING.md](RENDERING.md#camera-styles)). |
| `labels` | Labels | `touched`, `all`: all recent, `none` | `touched` | Tag policy ([RENDERING.md](RENDERING.md#labels-policy)). |
| `agents` | Agents | `both`, `claude`, `codex` | `both` | Which agents feed the map and HUD; changing it rebuilds. |
| `window` | Instance list | `15`: 15 min, `60`: 1 h, `480`: 8 h, `0`: all | `480` | Hides sessions idle longer than this from the instance list. |
| `quality` | Render quality | `auto`, `full`, `eco` | `auto` | `auto` adapts; `full` = 1, `eco` = 0.5 ([PERFORMANCE.md](PERFORMANCE.md#adaptive-quality)). |
| `motion` | Motion | `full`, `reduced` | `reduced` if the OS asks for reduced motion, else `full` | Reduced: no tentacle fans, bursts, camera dips, matrix rain; cascades one hop. |
| `matrix` | Matrix rain | `on`, `off` | `on` | Background glyph rain. |
| `intro` | Intro screen | `show`, `skip` | `show` | The loading screen with START (see below). |
| `demo` | Demo feed | `off`, `on` | `off` | Synthetic sessions marked DEMO. **Volatile**: never saved. |

### Storage and URL parameters

| Key | Content |
|-|-|
| `localStorage['swarm.settings']` | JSON object of every non-volatile setting. Unknown or invalid values fall back to the default. |
| `localStorage['swarm.instance']` | Watched session id (empty = all). Restored on load if the session is in the history. |
| `localStorage['swarm.collapsed']` | `'1'` when the instance list is collapsed. |
| `?view=crawler\|neural` | Sets the view on load (through `settings.set`, so it is also saved). |
| `?demo` | Turns the demo feed on (as does starting the server with `--demo`). |
| `?intro=0` | Skips the intro screen for this load. |

"reset" in the settings panel restores every default.

## Intro and pause overlays

Two full-screen states live outside the panel registry (`public/js/ui/intro.js`, `ui/pause.js`):

- **Intro.** Shown on load unless the `intro` setting is `skip` or the URL has `?intro=0`. The
  crawler spins an orb web whose capture spiral is the real loading progress: renderer ready,
  stream connected (first `hello`), transcripts indexed, history counted. START unlocks once the
  web is complete (at least ~1.4 s), with Enter or Space as shortcuts. History replay and live
  events are held until START, so the scene builds itself in front of the user. While the intro is
  up, the render loop skips the scene entirely, and app hotkeys are swallowed.
- **Pause.** `scene.setPaused(true)` (space or the toolbar) emits bus `pause`. The overlay shows the
  mark, a play button and how many events arrived meanwhile. The scene draws two settling frames
  and then stops drawing until it resumes or something changes the picture (`view`, `setting`,
  `rebuild`, `camera`).

The version in the top bar comes from the server's `hello.version` (read from `package.json`).

## Hotkeys and mouse

Handled in `ToolbarPanel`. Keys are ignored while an `<input>` has focus or with Cmd/Ctrl held.

| Key | Action |
|-|-|
| `1` – `8` | Focus a section (prompt, think, read, search, edit, exec, net, agent) |
| `0` or `O` | Toggle overview |
| `A` | Watch all instances |
| `Tab` | Watch the next instance (cycles the 12 most recent sessions) |
| `V` | Cycle view (crawler / neural) |
| `L` | Cycle labels (touched / all / none) |
| `M` | Toggle matrix rain |
| `D` | Toggle demo feed |
| `P` | Toggle PERF panel |
| `S` | Toggle settings |
| `?` or `H` | Toggle help |
| `Space` | Pause motion (data keeps arriving) |
| `Esc` | Close help, settings and inspector; clear the selection |

| Mouse | Action |
|-|-|
| Drag | Pan (camera goes `free` for 15 s) |
| Wheel | Zoom around the cursor |
| Click tag or target dot | Select and inspect the target |
| Click crawler | Inspect the session |
| Click cloud | Focus the section |
| Click empty space | Close the inspector |
| Double-click | Overview |

## Adding a panel

1. Create `public/js/ui/panels/<name>.js`:

```js
// PENDING: tool calls still waiting for a result, per agent.
import { Panel, setText } from '../panel.js';

export class PendingPanel extends Panel {
  id = 'pending';

  constructor(ctx) {
    super(ctx, { title: 'PENDING', badge: '0', badgeClass: 'amber', body: '<div class="big"><strong id="pendN">0</strong></div>' });
    this.n = this.$('#pendN');
  }

  update({ store }) {
    setText(this.n, store.pending);
    this.badge(store.flags ? `${store.flags} ⚑` : 'clean');
  }
}
```

2. Register it in `main.js`, in the position where it should appear:

```js
import { PendingPanel } from './ui/panels/pending.js';
// Bottom HUD, left to right.
for (const P of [LogPanel, SectionsPanel, RadarPanel, HeatPanel, HealthPanel, CodePanel, PendingPanel]) hud.add(P);
```

3. Style it in `public/styles.css` if the shared `.panel` styles are not enough (the bottom HUD is a
   grid of six columns, so a seventh box needs a layout change there).

Guidelines:

- Put slow work in `update()` (4 Hz); use `frame()` only for things that must animate smoothly.
- Write through the change-only helpers; never rebuild `innerHTML` unconditionally on a timer
  (the exception is `CodePanel`, which re-creates its cursor on purpose to keep it solid).
- Escape every event-derived string with `esc()`.
- Listen on the bus for discrete events (`event`, `watch`, `inspect`, …; list in
  `public/js/core/bus.js`) and implement `reset()` if the panel keeps state derived from events.
