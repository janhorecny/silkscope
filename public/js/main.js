// Bootstrap: wire core (store, feed, stream, settings), the canvas scene and the DOM panels
// through one bus, then run the render loop.

import { Bus } from './core/bus.js';
import { Store } from './core/store.js';
import { Feed } from './core/feed.js';
import { Stream } from './core/stream.js';
import { Settings } from './core/settings.js';
import { Scene } from './render/scene.js';
import { Hud } from './ui/hud.js';
import { TopbarPanel } from './ui/panels/topbar.js';
import { TabsPanel } from './ui/panels/tabs.js';
import { HeadingPanel } from './ui/panels/heading.js';
import { ToolbarPanel } from './ui/panels/toolbar.js';
import { InstancesPanel } from './ui/panels/instances.js';
import { InspectorPanel } from './ui/panels/inspector.js';
import { BannerPanel } from './ui/panels/banner.js';
import { PerfPanel } from './ui/panels/perf.js';
import { LogPanel } from './ui/panels/log.js';
import { SectionsPanel } from './ui/panels/sections.js';
import { RadarPanel } from './ui/panels/radar.js';
import { HeatPanel } from './ui/panels/heat.js';
import { HealthPanel } from './ui/panels/health.js';
import { CodePanel } from './ui/panels/code.js';
import { Intro } from './ui/intro.js';
import { PauseOverlay } from './ui/pause.js';

const params = new URLSearchParams(location.search);
const bus = new Bus();
const store = new Store();
const settings = new Settings((key, value) => bus.emit('setting', { key, value }));
const scene = new Scene(document.querySelector('#cv'), { store, bus });
const feed = new Feed({ store, bus, settings });
// Demo knobs for reproducible video takes: ?seed=42 &pace=1.5 &warm=0
feed.demoOptions = { seed: params.get('seed') ?? undefined, pace: Number(params.get('pace')) || 1, warm: params.get('warm') !== '0' };

const hud = new Hud({ store, scene, feed, bus, settings });
for (const P of [TopbarPanel, TabsPanel, HeadingPanel, ToolbarPanel, InstancesPanel, InspectorPanel, BannerPanel]) hud.add(P);
// Bottom HUD, left to right.
for (const P of [LogPanel, SectionsPanel, RadarPanel, HeatPanel, HealthPanel, CodePanel]) hud.add(P);
const perf = hud.add(PerfPanel);

// Intro screen (unless skipped in settings or ?intro=0) and the pause overlay.
const intro = new Intro({ bus, settings, show: settings.get('intro') !== 'skip' && params.get('intro') !== '0' });
new PauseOverlay({ bus, scene, store });

// Live stream: the first hello replays history; ?demo or a demo server starts the demo feed.
// Nothing reaches the scene before START, so the replay plays out in front of the user.
bus.on('hello', ({ hello, first }) => {
  intro.ready(hello);
  intro.onStart(() => {
    if (first) feed.replay(hello.history);
    if ((hello.demo || params.has('demo')) && !feed.demoOn) settings.set('demo', 'on');
    else if (!hello.history.length && !feed.demoOn) bus.emit('idle');
  });
});
bus.on('ev', (ev) => intro.onStart(() => feed.ingest(ev, true)));

// Apply saved settings (URL ?view= overrides and is remembered).
for (const key of ['view', 'camera', 'labels', 'quality', 'motion', 'matrix']) bus.emit('setting', { key, value: settings.get(key) });
if (params.get('view')) settings.set('view', params.get('view'));
window.addEventListener('resize', () => scene.resize());

// ---------------------------------------------------------------- loop
let last = performance.now();
let loopErrors = 0;
let pausedFrames = 0;
// Anything that changes the picture while paused earns a fresh frame under the overlay.
for (const e of ['view', 'setting', 'rebuild', 'camera']) bus.on(e, () => { pausedFrames = 0; });
function loop(now) {
  // Schedule first so one bad frame can never stop the animation.
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = Math.max(last, now);
  // While the intro covers everything, or the pause overlay is up, the scene costs nothing:
  // a paused scene draws two more frames (so the overlay sits on a settled image) and then stops.
  if (intro.covering) return;
  pausedFrames = scene.paused ? pausedFrames + 1 : 0;
  try {
    const t0 = performance.now();
    if (!scene.paused) scene.update(dt, now);
    if (pausedFrames < 3) scene.draw(now);
    hud.frame(now, dt);
    perf.sample(now, performance.now() - t0);
  } catch (err) {
    if (loopErrors++ < 5) console.error('[swarm] frame error', err);
  }
}
requestAnimationFrame(loop);
new Stream('/stream', bus).connect();

// Debug handle: lets tests drive frames even when the tab is hidden (rAF is paused there).
window.__swarm = {
  store, scene, hud, perf, feed, bus,
  watch: (id) => feed.watch(id),
  setView: (v) => scene.setView(v),
  ingest: (ev, animate = true) => feed.ingest(ev, animate),
  step(n = 60, dt = 1 / 60) {
    last = Math.max(last, performance.now());
    for (let i = 0; i < n; i++) { last += dt * 1000; scene.update(dt, last); hud.frame(last, dt); }
    scene.draw(last);
    return scene.frame;
  },
};
