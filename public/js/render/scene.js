// Orchestrates the canvas: owns the world model, the camera and an ordered list of layers. Two
// looks over the same data:
//   crawler  the reference recording: clouds, crawler, tentacles, tags
//   neural   ultra abstract: every target is a neuron, every transition a synapse, every tool
//            call fires and the signal cascades along the agent's real paths
// Also does input, hit-testing and adaptive quality. Canvas2D throughout.
//
// Layer interface (one file per layer under layers/, registered in LAYERS order):
//   { id, views: ['crawler', 'neural'], space?: 'world' | 'screen',
//     resize?(W, H), pixels?(), update?(dt, now, w), draw(g, w) }
// World-space layers are drawn under the camera transform with additive ('lighter') blending;
// screen-space layers in CSS pixels with source-over. `w` is the per-frame context (see #ctx).

import { World } from './graph.js';
import { Camera } from './camera.js';
import { BackgroundLayer } from './layers/background.js';
import { WebLayer } from './layers/web.js';
import { ClustersLayer } from './layers/clusters.js';
import { SynapsesLayer } from './layers/synapses.js';
import { CrawlersLayer } from './layers/crawlers.js';
import { LabelsLayer, HoverLayer } from './layers/labels.js';
import { clamp } from '../core/util.js';
import { BRAND } from '../core/config.js';

const LAYERS = [BackgroundLayer, WebLayer, ClustersLayer, SynapsesLayer, CrawlersLayer, LabelsLayer, HoverLayer];

export class Scene {
  constructor(canvas, { store, bus }) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.bus = bus;
    this.world = new World(store);
    this.camera = new Camera();
    this.world.cam = this.camera.cam;
    this.world.onTravel = (sp, now, backlog) => this.camera.onTravel(sp, now, backlog, this.world.single);
    this.camera.onChange = (mode, focus) => bus.emit('camera', { mode, focus });
    this.layers = LAYERS.map((L) => new L(this.world));
    this.mouse = { x: -1e4, y: -1e4, wx: 0, wy: 0, down: false, moved: false };
    this.hover = null;
    this.selected = null;
    this.view = 'crawler'; // crawler | neural
    // User settings (see core/settings.js); defaults match the reference.
    this.matrix = true;
    this.labelMode = 'touched'; // touched | all | none
    this.qualityMode = 'auto';  // auto | full | eco
    this.reduced = false;
    this.paused = false;
    this.frame = 0;
    this._q = 1;           // 1 full, 0.5 reduced, 0 minimal; adapts to frame time
    this.frameMs = 8;
    this.w = this.#makeCtx();
    this._pick = { mx: NaN, my: NaN, wx: NaN, wy: NaN, cx: NaN, cy: NaN, cz: NaN, v: -1, node: null };
    this.#bind();
    this.resize();
    this.camera.snapOverview();

    bus.on('event', ({ ev, res, animate }) => this.world.handle(ev, res, animate));
    bus.on('reset', () => this.reset());
    bus.on('rebuild', ({ sessions }) => this.world.placeSpiders(sessions));
    bus.on('watch', ({ id }) => this.watch(id));
    bus.on('replay', ({ done }) => { this.world.speed = done ? 1 : 2.2; });
    bus.on('setting', ({ key, value }) => this.configure(key, value));
  }

  // ---------------------------------------------------------------- state shared with the outside
  get quality() { return this._q; }
  set quality(q) { this._q = q; this.world.quality = q; }
  get mode() { return this.camera.mode; }
  get activeCluster() { return this.world.activeCluster; }
  get clusterList() { return this.world.clusterList; }
  get spiders() { return this.world.spiders; }
  get synapses() { return this.world.synapses; }
  get signals() { return this.world.signals; }
  get bursts() { return this.world.bursts; }

  setView(v) {
    this.view = v;
    this.bus.emit('view', v);
  }

  // Motion freeze; events keep being recorded. The pause overlay and toolbar listen on the bus.
  setPaused(v) {
    if (this.paused === v) return;
    this.paused = v;
    this.bus.emit('pause', v);
  }

  // Apply one user setting.
  configure(key, v) {
    if (key === 'view') this.setView(v);
    else if (key === 'camera') this.camera.cameraMode = v;
    else if (key === 'labels') this.labelMode = v;
    else if (key === 'quality') { this.qualityMode = v; if (v !== 'auto') { this.quality = v === 'full' ? 1 : 0.5; this.resize(); } }
    else if (key === 'motion') this.reduced = this.world.reduced = this.camera.reduced = v === 'reduced';
    else if (key === 'matrix') this.matrix = v === 'on';
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality < 1 ? 1 : 2);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    this.camera.resize(this.W, this.H);
    for (const L of this.layers) L.resize?.(this.W, this.H);
  }

  // Canvas bitmap pixels (main canvas, layer canvases, nebula sprites), for the PERF panel.
  bitmapPixels() {
    let px = this.cv.width * this.cv.height;
    for (const L of this.layers) px += L.pixels?.() || 0;
    for (const c of this.world.clusterList) px += c.spriteLit.width * c.spriteLit.height * 2;
    return px;
  }

  counts() { return this.world.counts(); }

  // ---------------------------------------------------------------- camera / selection
  setMode(m) { this.camera.setMode(m); }

  focus(key) {
    const c = this.world.clusters[key];
    if (c) this.camera.focus(c);
  }

  // Watch one instance (session id) or all (null).
  watch(sessionId) {
    this.world.single = sessionId;
    this.camera.watch();
  }

  clearSelection() { this.selected = null; }

  reset() {
    this.world.reset();
    this.selected = null;
    this.camera.followSpider = null;
    this.camera.focusCluster = null;
    this.hover = null;
  }

  primarySpider() { return this.world.primarySpider(); }

  // ---------------------------------------------------------------- input
  #bind() {
    const cv = this.cv, m = this.mouse;
    let last = null;
    cv.addEventListener('pointerdown', (e) => {
      m.down = true; m.moved = false;
      last = [e.clientX, e.clientY];
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      m.x = e.clientX - r.left; m.y = e.clientY - r.top;
      if (m.down && last) {
        const dx = e.clientX - last[0], dy = e.clientY - last[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) m.moved = true;
        if (m.moved) this.camera.pan(dx, dy);
        last = [e.clientX, e.clientY];
      }
    });
    window.addEventListener('pointerup', () => { m.down = false; });
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      m.x = e.clientX - r.left; m.y = e.clientY - r.top;
      if (!m.moved) this.#click();
      m.moved = false;
    });
    cv.addEventListener('pointerleave', () => { m.x = m.y = -1e4; });
    cv.addEventListener('dblclick', () => this.setMode('overview'));
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.zoomAt(m.x, m.y, e.deltaY);
    }, { passive: false });
  }

  #click() {
    [this.mouse.wx, this.mouse.wy] = this.camera.toWorld(this.mouse.x, this.mouse.y);
    this.#pickHover();
    const h = this.hover;
    if (!h) { this.selected = null; this.bus.emit('inspect', null); return; }
    if (h.type === 'node') { this.selected = h.node; this.bus.emit('inspect', { type: 'node', node: h.node }); }
    else if (h.type === 'spider') this.bus.emit('inspect', { type: 'spider', spider: h.spider });
    else if (h.type === 'cluster') this.focus(h.cluster.key);
  }

  // What is under the cursor: tag, crawler, target dot, cloud (in that order).
  #pickHover() {
    const m = this.mouse, mx = m.x, my = m.y;
    this.hover = null;
    if (mx < 0) return;
    for (const t of this.w.tagBoxes) {
      if (mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h) { this.hover = { type: 'node', node: t.node }; return; }
    }
    const cam = this.camera;
    for (const sp of this.world.spiders.values()) {
      if (Math.hypot(cam.sx(sp.x) - mx, cam.sy(sp.y) - my) < 26) { this.hover = { type: 'spider', spider: sp }; return; }
    }
    const best = this.#nearestNode();
    if (best) { this.hover = { type: 'node', node: best }; return; }
    for (const c of this.world.clusterList) {
      if (Math.hypot(m.wx - c.x, m.wy - c.y) < c.R * 0.8) { this.hover = { type: 'cluster', cluster: c }; return; }
    }
  }

  // Nearest target dot within 12 px, only in clouds near the cursor. Nodes never move, so the
  // answer is cached until the cursor, the camera or the node set changes.
  #nearestNode() {
    const m = this.mouse, c0 = this.camera.cam, P = this._pick;
    let v = 0;
    for (const c of this.world.clusterList) v += c.version;
    if (P.mx === m.x && P.my === m.y && P.wx === m.wx && P.wy === m.wy && P.cx === c0.x && P.cy === c0.y && P.cz === c0.z && P.v === v) return P.node;
    const cam = this.camera;
    let best = null, bd = 12;
    for (const c of this.world.clusterList) {
      if (Math.hypot(m.wx - c.x, m.wy - c.y) > c.R * 1.2) continue;
      for (const n of c.recent) {
        const d = Math.hypot(cam.sx(c.x + n.x) - m.x, cam.sy(c.y + n.y) - m.y);
        // Ties go to the older node, as the old Map-order scan did.
        if (d < bd || (d === bd && best?.cluster === c && n.seq < best.seq)) { bd = d; best = n; }
      }
    }
    P.mx = m.x; P.my = m.y; P.wx = m.wx; P.wy = m.wy; P.cx = c0.x; P.cy = c0.y; P.cz = c0.z; P.v = v; P.node = best;
    return best;
  }

  // ---------------------------------------------------------------- update
  update(dt, now) {
    dt = clamp(dt, 0, 0.05);
    this.world.update(dt, now, this.camera.focusCluster);
    this.camera.update(dt, now, this.world);
    for (const L of this.layers) L.update?.(dt, now, this.w);
    [this.mouse.wx, this.mouse.wy] = this.camera.toWorld(this.mouse.x, this.mouse.y);
  }

  // ---------------------------------------------------------------- draw
  // The per-frame context handed to every layer. One object, refreshed in place each frame.
  #makeCtx() {
    return {
      now: 0, z: 1, view: { x0: 0, y0: 0, x1: 0, y1: 0 }, W: 0, H: 0, neural: false, overview: false,
      quality: 1, reduced: false, matrix: true, labelMode: 'touched',
      world: this.world, cam: this.camera, mouse: this.mouse, canvas: this.cv,
      prim: null, hover: null, selected: null, tagBoxes: [],
      pickHover: () => { this.#pickHover(); this.w.hover = this.hover; },
    };
  }

  #ctx(now) {
    const w = this.w, cam = this.camera;
    w.now = now; w.z = cam.cam.z; w.W = this.W; w.H = this.H;
    cam.viewRect(80, w.view);
    w.neural = this.view === 'neural';
    w.overview = cam.mode === 'overview' || (!this.world.single && cam.mode === 'auto');
    w.quality = this.quality; w.reduced = this.reduced; w.matrix = this.matrix; w.labelMode = this.labelMode;
    w.prim = this.world.primarySpider();
    w.hover = this.hover; w.selected = this.selected;
    return w;
  }

  draw(now) {
    const t0 = performance.now();
    const g = this.g, W = this.W, H = this.H;
    this.frame++;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = BRAND.void;
    g.fillRect(0, 0, W, H);

    const w = this.#ctx(now), cam = this.camera.cam;
    let inWorld = false;
    for (const L of this.layers) {
      if (!L.views.includes(this.view)) continue;
      const world = L.space !== 'screen';
      if (world && !inWorld) {
        g.save();
        g.translate(W / 2, H / 2);
        g.scale(cam.z, cam.z);
        g.translate(-cam.x, -cam.y);
        g.globalCompositeOperation = 'lighter';
      } else if (!world && inWorld) {
        g.restore();
        g.globalCompositeOperation = 'source-over';
      }
      inWorld = world;
      L.draw(g, w);
    }
    if (inWorld) { g.restore(); g.globalCompositeOperation = 'source-over'; }
    this.#adapt(performance.now() - t0, now);
  }

  // Adaptive quality. Watches the real frame interval (catches GPU fill-rate stalls on retina
  // screens, not just JS time) and steps quality down: 1 full -> 0.5 (DPR 1)
  // -> 0 (also no flowing dots, no matrix rain, fewer stars). Recovers when there is headroom again.
  #adapt(cpuMs, now) {
    const gap = this._lastDraw ? now - this._lastDraw : 16;
    this._lastDraw = now;
    if (document.hidden || gap > 250) return; // background tab or a hitch, not a trend
    this.frameMs = this.frameMs * 0.95 + gap * 0.05;
    this.cpuMs = (this.cpuMs || cpuMs) * 0.95 + cpuMs * 0.05;
    if (this.frame % 90) return;
    const q = this.quality;
    if (this.qualityMode !== 'auto') {
      this.quality = this.qualityMode === 'full' ? 1 : 0.5;
      if (q !== this.quality) this.resize();
      return;
    }
    if (this.frameMs > 22 && q > 0) this.quality = q > 0.5 ? 0.5 : 0;
    else if (this.frameMs < 17.5 && this.cpuMs < 6 && q < 1 && this.frame - (this._upAt || 0) > 600) { this.quality = q < 0.5 ? 0.5 : 1; this._upAt = this.frame; }
    if ((q < 0.5) !== (this.quality < 0.5) || (q === 1) !== (this.quality === 1)) this.resize();
  }
}
