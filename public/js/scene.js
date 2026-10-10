// The world: nebula sections, the synapse graph between targets, the crawler swarm, tags,
// bursts, matrix rain and the camera. Two looks over the same data:
//   crawler  the reference recording: clouds, crawler, tentacles, tags
//   neural   ultra abstract: every target is a neuron, every transition a synapse, every tool
//            call fires and the signal cascades along the agent's real paths
// Canvas2D throughout; costs are capped and quality adapts to frame time.

import { CATEGORIES, FLAG } from './config.js';
import { Cluster } from './nebula.js';
import { Spider } from './spider.js';
import { TAU, clamp, lerp, damp, rand, pick, noise2, rgba, hexToRgb, quadPoint, easeOutBack, easeInOutCubic } from './util.js';

const WORLD = { x0: -1000, y0: -780, x1: 920, y1: 900 };
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789ABCDEF<>{}[]=+*:;/\\|'.split('');
const FONT = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const MAX_SYNAPSES = 2400;
const MAX_SIGNALS = 500;

function glowSprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, rgba([255, 255, 255], 1));
  grad.addColorStop(0.12, rgba(rgb, 0.9));
  grad.addColorStop(0.4, rgba(rgb, 0.25));
  grad.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class Scene {
  constructor(canvas, store) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.store = store;
    this.clusters = Object.fromEntries(CATEGORIES.map((c) => [c.key, new Cluster(c)]));
    this.clusterList = Object.values(this.clusters);
    for (const c of this.clusterList) c.glow = glowSprite(c.rgb);
    this.flagGlow = glowSprite(hexToRgb(FLAG));
    this.spiders = new Map();
    this.bursts = [];
    this.pulses = [];
    this.synapses = new Map();
    this.signals = [];
    this.lastNode = new Map(); // session -> last node touched (for synapses)
    this.recentNodes = new Map(); // session -> recent distinct nodes (re-attach after rebuild)
    this.cam = { x: 0, y: 0, z: 0.5 };
    this.camT = { x: 0, y: 0, z: 0.5 };
    this.mode = 'auto'; // auto | focus | free | overview
    this.view = 'crawler'; // crawler | neural
    this.single = null;
    this.focusCluster = null;
    this.followSpider = null;
    this.flight = null;
    this.lastFlightEnd = 0;
    this.freeUntil = 0;
    this.mouse = { x: -1e4, y: -1e4, wx: 0, wy: 0, down: false, moved: false };
    this.hover = null;
    this.selected = null;
    // User settings (see settings.js); defaults match the reference.
    this.matrix = true;
    this.labelMode = 'touched'; // touched | all | none
    this.qualityMode = 'auto';  // auto | full | eco
    this.cameraMode = 'cinematic'; // cinematic | calm | still
    this.reduced = false;       // reduced motion
    this.paused = false;
    this.speed = 1;
    this.frame = 0;
    this.lastActivity = 0;
    this.activeCluster = null;
    this.quality = 1;      // 1 full, 0.5 reduced, 0 minimal; adapts to frame time
    this.frameMs = 8;
    this.onSelect = () => {};
    this.onFocus = () => {};
    this.#initStars();
    this.#initRain();
    this.#bind();
    this.resize();
    this.cam = { ...this.overviewCam() };
  }

  // ---------------------------------------------------------------- setup
  #initStars() {
    this.stars = Array.from({ length: 520 }, () => ({
      x: Math.random(), y: Math.random(), d: Math.pow(Math.random(), 2) * 0.6 + 0.05,
      s: Math.random() < 0.06 ? 1.6 : 0.8, ph: rand(TAU),
    }));
  }

  #initRain() {
    this.rainCv = document.createElement('canvas');
    this.rainG = this.rainCv.getContext('2d');
    this.rainCols = [];
    this.rainNext = 0;
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality < 1 ? 1 : 2);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    this.rainCv.width = Math.ceil(r.width / 2);
    this.rainCv.height = Math.ceil(r.height / 2);
    const cols = Math.ceil(this.rainCv.width / 8);
    this.rainCols = Array.from({ length: cols }, () => ({ y: rand(-60, 0), v: rand(0.4, 1.3), on: Math.random() < 0.55 }));
  }

  overviewCam() {
    const w = WORLD.x1 - WORLD.x0, h = WORLD.y1 - WORLD.y0;
    const z = Math.min(this.W / w, this.H / h) * 0.98;
    return { x: (WORLD.x0 + WORLD.x1) / 2, y: (WORLD.y0 + WORLD.y1) / 2, z };
  }

  toWorld(sx, sy) { return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.H / 2) / this.cam.z + this.cam.y]; }
  toScreen(wx, wy) { return [(wx - this.cam.x) * this.cam.z + this.W / 2, (wy - this.cam.y) * this.cam.z + this.H / 2]; }

  // World-space view rectangle with a margin, for culling.
  #view(margin = 80) {
    const [x0, y0] = this.toWorld(-margin, -margin);
    const [x1, y1] = this.toWorld(this.W + margin, this.H + margin);
    return { x0, y0, x1, y1 };
  }

  // ---------------------------------------------------------------- interaction
  #bind() {
    const cv = this.cv;
    let last = null;
    cv.addEventListener('pointerdown', (e) => {
      this.mouse.down = true; this.mouse.moved = false;
      last = [e.clientX, e.clientY];
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      if (this.mouse.down && last) {
        const dx = e.clientX - last[0], dy = e.clientY - last[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) this.mouse.moved = true;
        if (this.mouse.moved) {
          this.camT.x -= dx / this.cam.z; this.camT.y -= dy / this.cam.z;
          this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z;
          this.setMode('free');
        }
        last = [e.clientX, e.clientY];
      }
    });
    window.addEventListener('pointerup', () => { this.mouse.down = false; });
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      if (!this.mouse.moved) this.#click();
      this.mouse.moved = false;
    });
    cv.addEventListener('pointerleave', () => { this.mouse.x = this.mouse.y = -1e4; });
    cv.addEventListener('dblclick', () => this.setMode('overview'));
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wy] = this.toWorld(this.mouse.x, this.mouse.y);
      const ov = this.overviewCam().z;
      const z = clamp(this.camT.z * Math.exp(-e.deltaY * 0.0015), ov * 0.6, ov * 8);
      this.camT.z = z;
      this.camT.x = wx - (this.mouse.x - this.W / 2) / z;
      this.camT.y = wy - (this.mouse.y - this.H / 2) / z;
      this.setMode('free');
    }, { passive: false });
  }

  #click() {
    [this.mouse.wx, this.mouse.wy] = this.toWorld(this.mouse.x, this.mouse.y);
    this.#pickHover();
    const h = this.hover;
    if (!h) { this.selected = null; this.onSelect(null); return; }
    if (h.type === 'node') { this.selected = h.node; this.onSelect({ type: 'node', node: h.node }); }
    else if (h.type === 'spider') this.onSelect({ type: 'spider', spider: h.spider });
    else if (h.type === 'cluster') this.focus(h.cluster.key);
  }

  setMode(m) {
    this.mode = m;
    if (m === 'free') { this.freeUntil = performance.now() + 15000; this.flight = null; }
    if (m !== 'focus') this.focusCluster = null;
    this.onFocus(this.mode, this.focusCluster);
  }

  focus(key) {
    const c = this.clusters[key];
    if (!c) return;
    this.focusCluster = c;
    this.mode = 'focus';
    this.freeUntil = performance.now() + 25000;
    this.#fly(performance.now(), 0.25);
    this.onFocus(this.mode, c);
  }

  // Watch one instance (session id) or all (null).
  watch(sessionId) {
    this.single = sessionId;
    this.followSpider = null;
    this.focusCluster = null;
    this.mode = 'auto';
    this.#fly(performance.now(), 0.35);
    this.onFocus(this.mode, null);
  }

  #fly(now, dip = 0.42) {
    if (this.cameraMode === 'still') return;
    if (this.cameraMode === 'calm' || this.reduced) dip = 0;
    this.flight = { x0: this.cam.x, y0: this.cam.y, z0: this.cam.z, t0: now, dur: 950, dip };
  }

  // ---------------------------------------------------------------- data
  reset() {
    for (const c of this.clusterList) c.reset();
    this.spiders.clear();
    this.bursts = [];
    this.pulses = [];
    this.synapses.clear();
    this.signals = [];
    this.lastNode.clear();
    this.recentNodes.clear();
    this.selected = null;
    this.followSpider = null;
    this.focusCluster = null;
    this.activeCluster = null;
    this.hover = null;
  }

  spiderFor(session, x, y) {
    let sp = this.spiders.get(session.id);
    if (!sp) {
      if (x == null) {
        const near = this.clusters[session.lastCat], a = rand(TAU);
        x = (near ? near.x : this.cam.x) + Math.cos(a) * 140;
        y = (near ? near.y : this.cam.y) + Math.sin(a) * 110;
      }
      sp = new Spider(session.id, session.agent, session.project, x, y);
      this.spiders.set(session.id, sp);
      if (this.spiders.size > 8) {
        let old = null;
        for (const s of this.spiders.values()) if (s.session !== this.single && (!old || s.lastActive < old.lastActive)) old = s;
        if (old) this.spiders.delete(old.session);
      }
    }
    sp.project = session.project;
    return sp;
  }

  // After a silent rebuild, park a crawler where each recent session last was.
  placeSpiders(sessions) {
    const now = performance.now();
    for (const s of sessions) {
      const cl = this.clusters[s.lastCat];
      if (!cl) continue;
      const sp = this.spiderFor(s, cl.x + rand(-30, 30), cl.y + rand(-30, 30));
      sp.cluster = cl;
      sp.setSilk(cl.rgb);
      sp.enteredAt = now;
      sp.lastActive = now - Math.min(19 * 60e3, Math.max(0, Date.now() - s.lastTs));
      // Re-attach tentacles to what it was last touching in this section.
      const rn = (this.recentNodes.get(s.id) || []).filter((n) => n.cluster === cl).slice(-12);
      rn.forEach((n, i) => sp.reach({ cluster: cl, x: n.x, y: n.y, node: n }, n.flagged, now + 200 + i * 40));
    }
  }

  #synapse(a, b, now) {
    if (!a || !b || a === b) return;
    const key = a.id < b.id ? a.id + '~' + b.id : b.id + '~' + a.id;
    let s = this.synapses.get(key);
    if (!s) {
      s = { a, b, w: 0, last: 0, bend: rand(-0.22, 0.22) };
      this.synapses.set(key, s);
      a.syn.push(s); b.syn.push(s);
      if (this.synapses.size > MAX_SYNAPSES) {
        // Prune the weakest stale tenth in one go (amortised).
        const arr = [...this.synapses.entries()].sort((p, q) => (p[1].w + p[1].last / 6e4) - (q[1].w + q[1].last / 6e4));
        for (const [k, v] of arr.slice(0, MAX_SYNAPSES / 10)) {
          this.synapses.delete(k);
          v.a.syn = v.a.syn.filter((x) => x !== v);
          v.b.syn = v.b.syn.filter((x) => x !== v);
        }
      }
    }
    s.w++;
    s.last = now;
  }

  handle(ev, res, animate) {
    const now = performance.now();
    if (res.kind === 'action') {
      const cl = this.clusters[ev.cat];
      const node = cl.node(ev.target);
      node.hits++;
      node.events.push(ev);
      if (node.events.length > 40) node.events.shift();
      if (ev.status === 'pending') node.pending++;
      res.rec.node = node;
      res.rec.cluster = cl;
      cl.count++;
      cl.lastTs = ev.ts;
      cl.lit = Math.max(cl.lit, 0.35);
      this.#synapse(this.lastNode.get(ev.session), node, animate ? now : now - 120000);
      this.lastNode.set(ev.session, node);
      let rn = this.recentNodes.get(ev.session);
      if (!rn) this.recentNodes.set(ev.session, (rn = []));
      const i = rn.indexOf(node);
      if (i >= 0) rn.splice(i, 1);
      rn.push(node);
      if (rn.length > 24) rn.shift();
      if (animate) {
        this.lastActivity = now;
        const sp = this.spiderFor(res.session);
        sp.lastActive = now;
        sp.queue.push({ cl, node, ev });
        if (sp.queue.length > 40) sp.queue.splice(0, sp.queue.length - 40);
      } else {
        node.lastHit = now - 60000;
        cl.lit = 1;
      }
    } else if (res.kind === 'result' && res.orig.node) {
      const node = res.orig.node, cl = res.orig.cluster;
      node.pending = Math.max(0, node.pending - 1);
      if (ev.status === 'error') {
        node.flagged = true;
        cl.flags++;
        if (animate) {
          this.burst(cl, node, hexToRgb(FLAG), 26);
          node.act = 1.6;
          for (const sp of this.spiders.values()) for (const t of sp.tentacles) if (t.node === node) t.flagged = true;
        }
      }
    }
  }

  // Fire a neuron; the signal cascades two hops along its strongest synapses.
  fire(node, energy, depth, from, now) {
    node.act = Math.min(1.8, (node.act || 0) + energy);
    if (depth >= (this.reduced ? 1 : 2) || this.signals.length > MAX_SIGNALS) return;
    const out = node.syn.filter((s) => s.a !== from && s.b !== from).sort((p, q) => q.w - p.w).slice(0, depth ? 3 : 6);
    for (const s of out) {
      const to = s.a === node ? s.b : s.a;
      const [ax, ay] = node.cluster.worldNode(node), [bx, by] = to.cluster.worldNode(to);
      const d = Math.hypot(bx - ax, by - ay);
      this.signals.push({ s, from: node, to, t0: now, dur: 260 + d * 0.9, e: energy * (0.4 + Math.min(0.4, Math.log1p(s.w) * 0.15)), depth: depth + 1 });
    }
  }

  burst(cl, node, rgb, n = 14) {
    if (this.reduced) return;
    if (this.quality < 0.5) n = Math.ceil(n / 3);
    const [x, y] = cl.worldNode(node);
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), v = rand(20, 110);
      this.bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, rgb, s: rand(0.8, 2.2) });
    }
    if (this.bursts.length > 600) this.bursts.splice(0, this.bursts.length - 600);
  }

  primarySpider() {
    if (this.single) return this.spiders.get(this.single) || null;
    let best = null;
    for (const s of this.spiders.values()) if (!best || s.lastActive > best.lastActive) best = s;
    return best;
  }

  // ---------------------------------------------------------------- update
  update(dt, now) {
    dt = clamp(dt, 0, 0.05);
    for (const sp of this.spiders.values()) {
      if (sp.pendingReach && (now > sp.pendingReach.at || (sp.arrived && now > sp.pendingReach.min))) {
        const { cl, node, ev } = sp.pendingReach;
        sp.reach({ cluster: cl, x: node.x, y: node.y, node }, ev.status === 'error', now);
        node.lastHit = now;
        node.lastVerb = ev.verb;
        cl.heat = Math.min(1, cl.heat + 0.5);
        cl.lit = 1;
        this.burst(cl, node, cl.rgb, 10);
        this.fire(node, 1, 0, null, now);
        sp.pendingReach = null;
      }
      if (!sp.pendingReach && sp.queue.length && now >= sp.nextAt) {
        const item = sp.queue.shift();
        const changed = sp.cluster !== item.cl;
        const backlog = sp.queue.length;
        const k = 0.2;
        const tx = item.cl.x + item.node.x * k + rand(-10, 10), ty = item.cl.y + item.node.y * k + rand(-10, 10);
        if (changed) {
          if (sp.cluster) this.pulses.push({ a: sp.cluster, b: item.cl, t0: now, rgb: item.cl.rgb });
          sp.retractAll(item.cl, now);
          sp.cluster = item.cl;
          sp.enteredAt = now;
          item.cl.flash = 1;
          // Anticipation: a fan of long tentacles into the next cloud before the body moves.
          const fan = this.reduced ? 0 : backlog > 12 ? 4 : 12;
          for (let i = 0; i < fan; i++) {
            const p = pick(item.cl.pts);
            sp.reach({ cluster: item.cl, x: p[0] * 0.8, y: p[1] * 0.8, fan: true }, false, now + i * 14);
          }
          sp.setSilk(item.cl.rgb);
          const lead = backlog > 12 ? 60 : 340;
          sp.goTo(tx, ty, lead / this.speed, now, this.speed);
          sp.pendingReach = { ...item, min: now + (lead + 300) / this.speed, at: now + (lead + 900) / this.speed };
          // Camera cut, skipped if the last one just ended so think/exec ping-pong stays calm.
          if (this.cameraMode === 'cinematic' && this.#watched(sp) && this.mode === 'auto' && now - this.lastFlightEnd > 700 && backlog < 12) this.#fly(now);
        } else {
          sp.goTo(tx, ty, 0, now, this.speed);
          sp.pendingReach = { ...item, min: now, at: now + 90 / this.speed };
        }
        let gap = backlog > 24 ? 40 : backlog > 8 ? 110 : 300;
        if (changed && backlog <= 24) gap = Math.max(gap, 760);
        sp.nextAt = now + gap / this.speed;
      }
      // Fan tentacles fade once the body has arrived.
      if (sp.arrived) for (const t of sp.tentacles) if (t.fan && !t.retract && now - t.t0 > 900) t.retract = now;
      sp.update(dt, now);
    }
    for (const [k, sp] of this.spiders) {
      if (k !== this.single && now - sp.lastActive > 20 * 60e3) { sp.alpha -= dt; if (sp.alpha <= 0) this.spiders.delete(k); }
    }

    // Neural signals.
    const arrived = [];
    this.signals = this.signals.filter((s) => {
      if (now - s.t0 >= s.dur) { arrived.push(s); return false; }
      return true;
    });
    for (const s of arrived) this.fire(s.to, s.e, s.depth, s.from, now);
    const decay = Math.exp(-dt * 1.7);
    for (const c of this.clusterList) for (const n of c.nodes.values()) if (n.act > 0.001) n.act *= decay; else n.act = 0;

    const prim = this.primarySpider();
    this.activeCluster = this.focusCluster || prim?.cluster || this.activeCluster;
    for (const c of this.clusterList) {
      c.heat = Math.max(0, c.heat - dt * 0.35);
      c.flash = Math.max(0, (c.flash || 0) - dt * 1.4);
      c.activeT = damp(c.activeT, c === this.activeCluster ? 1 : 0, 4, dt);
    }

    for (const b of this.bursts) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= 1 - dt * 2.2; b.vy *= 1 - dt * 2.2;
      b.life -= dt * 0.9;
    }
    this.bursts = this.bursts.filter((b) => b.life > 0);
    this.pulses = this.pulses.filter((p) => now - p.t0 < 1600);

    this.#camera(dt, now, prim);
    [this.mouse.wx, this.mouse.wy] = this.toWorld(this.mouse.x, this.mouse.y);
  }

  #watched(sp) { return this.single ? sp.session === this.single : sp === this.followSpider; }

  #camera(dt, now, prim) {
    if ((this.mode === 'free' || this.mode === 'focus') && now > this.freeUntil) this.setMode('auto');
    const ov = this.overviewCam();
    let lam = 1.6;
    const sp = this.single ? this.spiders.get(this.single) : this.followSpider;
    const still = this.cameraMode === 'still' && this.mode === 'auto';
    if (still) {
      // Still camera: never moves on its own; only the user pans and zooms.
    } else if (this.mode === 'overview' || (this.mode === 'auto' && !sp)) {
      // All instances: a calm wide shot that only leans toward the busy section.
      Object.assign(this.camT, ov);
      if (this.mode === 'auto' && this.activeCluster && now - this.lastActivity < 30000) {
        this.camT.x = lerp(ov.x, this.activeCluster.x, 0.1);
        this.camT.y = lerp(ov.y, this.activeCluster.y, 0.1);
        this.camT.z = ov.z * 1.06;
      }
      lam = 0.7;
    } else if (this.mode === 'focus' && this.focusCluster) {
      this.camT.x = this.focusCluster.x; this.camT.y = this.focusCluster.y; this.camT.z = ov.z * 2.3;
      lam = 2.5;
    } else if (this.mode === 'auto' && sp) {
      // Tight follow with a slow dolly-in while the crawler stays in one section.
      const dwell = clamp((now - sp.enteredAt) / 9000, 0, 1);
      this.camT.x = sp.cluster ? lerp(sp.cluster.x, sp.x, 0.55) : sp.x;
      this.camT.y = sp.cluster ? lerp(sp.cluster.y, sp.y, 0.55) : sp.y;
      const cine = this.cameraMode === 'cinematic';
      this.camT.z = ov.z * (2.1 + (cine ? dwell * 0.75 : 0.2));
      lam = cine ? 3 : 1.3;
    }
    if (this.mode === 'free') lam = 10;
    if (this.flight) {
      const f = this.flight;
      const p = clamp((now - f.t0) / f.dur, 0, 1), e = easeInOutCubic(p);
      this.cam.x = lerp(f.x0, this.camT.x, e);
      this.cam.y = lerp(f.y0, this.camT.y, e);
      this.cam.z = lerp(f.z0, this.camT.z, e) * (1 - f.dip * Math.sin(Math.PI * p));
      if (p >= 1) { this.flight = null; this.lastFlightEnd = now; }
    } else {
      this.cam.x = damp(this.cam.x, this.camT.x, lam, dt);
      this.cam.y = damp(this.cam.y, this.camT.y, lam, dt);
      this.cam.z = damp(this.cam.z, this.camT.z, lam * 0.9, dt);
    }
  }

  // ---------------------------------------------------------------- draw
  draw(now) {
    const t0 = performance.now();
    const g = this.g, W = this.W, H = this.H;
    const neural = this.view === 'neural';
    this.frame++;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#050608';
    g.fillRect(0, 0, W, H);

    if (this.matrix && this.quality > 0 && !this.reduced) this.#drawRain(g, now);
    this.#drawStars(g, now);

    const z = this.cam.z;
    const view = this.#view();
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(z, z);
    g.translate(-this.cam.x, -this.cam.y);
    g.globalCompositeOperation = 'lighter';
    this.#drawWeb(g, now, z);
    for (const c of this.clusterList) {
      if (c.x + c.R * 1.2 < view.x0 || c.x - c.R * 1.2 > view.x1 || c.y + c.R * 1.2 < view.y0 || c.y - c.R * 1.2 > view.y1) continue;
      this.#drawCluster(g, c, now, z, neural);
    }
    this.#drawSynapses(g, now, z, view, neural);
    if (neural) this.#drawNeurons(g, now, z, view);
    this.#drawSignals(g, now, z, neural);
    for (const b of this.bursts) {
      g.fillStyle = rgba(b.rgb, b.life * 0.9);
      g.fillRect(b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
    }
    for (const sp of this.spiders.values()) sp.drawSilk(g, z, now);
    for (const sp of this.spiders.values()) sp.drawTentacles(g, z, now, neural || this.quality < 0.5 || this.reduced);
    if (this.quality > 0) this.#drawCursorWeb(g, z);
    g.globalCompositeOperation = neural ? 'lighter' : 'source-over';
    const prim = this.primarySpider();
    for (const sp of this.spiders.values()) {
      const focused = sp === prim && (this.single || this.spiders.size > 1);
      if (neural) sp.drawLocus(g, z, now, focused); else sp.drawBody(g, z, now, focused);
    }
    g.restore();
    g.globalCompositeOperation = 'source-over';

    this.#drawLabels(g, now, neural);
    this.#pickHover();
    this.#drawHover(g, now);
    this.#adapt(performance.now() - t0, now);
  }

  // Adaptive quality. Watches the real frame interval (catches GPU fill-rate stalls on retina
  // screens, not just JS time) and steps quality down: 1 full -> 0.5 (DPR 1, no flowing dots)
  // -> 0 (also no matrix rain, fewer stars). Recovers when there is headroom again.
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

  #drawRain(g, now) {
    const rg = this.rainG, w = this.rainCv.width, h = this.rainCv.height;
    if (now > this.rainNext) {
      this.rainNext = now + 55;
      rg.fillStyle = 'rgba(5,6,8,0.16)';
      rg.fillRect(0, 0, w, h);
      rg.font = `9px ${FONT}`;
      const heat = this.activeCluster ? this.activeCluster.heat : 0;
      for (let i = 0; i < this.rainCols.length; i++) {
        const c = this.rainCols[i];
        if (!c.on) { if (Math.random() < 0.002) c.on = true; continue; }
        const y = c.y * 10;
        rg.fillStyle = Math.random() < 0.08 ? 'rgba(220,255,240,0.85)' : `rgba(63,224,165,${0.55 + heat * 0.3})`;
        rg.fillText(pick(GLYPHS), i * 8, y);
        c.y += c.v * (1 + heat);
        if (y > h + 20) { c.y = rand(-30, 0); c.v = rand(0.4, 1.3); c.on = Math.random() < 0.6; }
      }
    }
    g.globalAlpha = this.view === 'neural' ? 0.08 : 0.15;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.rainCv, 0, 0, this.W, this.H);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = 1;
  }

  #drawStars(g, now) {
    const W = this.W, H = this.H, t = now / 1000;
    const n = this.quality < 0.5 ? 180 : this.stars.length;
    for (let i = 0; i < n; i++) {
      const s = this.stars[i];
      const px = ((s.x * W - this.cam.x * s.d * this.cam.z * 0.25) % W + W) % W;
      const py = ((s.y * H - this.cam.y * s.d * this.cam.z * 0.25) % H + H) % H;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (0.5 + s.d * 3) + s.ph));
      g.fillStyle = `rgba(200,210,230,${a * (0.3 + s.d)})`;
      g.fillRect(px, py, s.s, s.s);
    }
  }

  // Braided strands between sections: brighter where the swarm travels.
  #drawWeb(g, now, z) {
    const L = this.clusterList;
    const t = now / 1000;
    if (!this.strands) this.strands = new Map();
    g.lineWidth = 0.6 / z;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const w = this.store.links.get([a.key, b.key].sort().join('>')) || 0;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 820 && !w) continue;
      const key = a.key + '>' + b.key;
      let st = this.strands.get(key);
      if (!st) {
        st = Array.from({ length: 3 }, (_, k) => ({
          ax: rand(-0.35, 0.35) * a.R, ay: rand(-0.35, 0.35) * a.R,
          bx: rand(-0.35, 0.35) * b.R, by: rand(-0.35, 0.35) * b.R, bend: rand(-0.28, 0.28), ph: rand(TAU), k,
        }));
        this.strands.set(key, st);
      }
      const use = Math.min(1, Math.log1p(w) / 4);
      const base = 0.025 + use * 0.07;
      const mid = rgba([(a.rgb[0] + b.rgb[0]) / 2, (a.rgb[1] + b.rgb[1]) / 2, (a.rgb[2] + b.rgb[2]) / 2], base * (0.4 + (a.lit + b.lit) / 2));
      const pulses = this.pulses.filter((pl) => (pl.a === a && pl.b === b) || (pl.a === b && pl.b === a));
      g.strokeStyle = mid;
      g.beginPath();
      const geo = st.map((s) => {
        const x0 = a.x + s.ax, y0 = a.y + s.ay, x1 = b.x + s.bx, y1 = b.y + s.by;
        const bend = s.bend + noise2(s.ph, t * 0.07) * 0.08;
        const cx = (x0 + x1) / 2 - (y1 - y0) * bend, cy = (y0 + y1) / 2 + (x1 - x0) * bend;
        g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1);
        return [x0, y0, cx, cy, x1, y1];
      });
      g.stroke();
      for (const pl of pulses) {
        const [x0, y0, cx, cy, x1, y1] = geo[0];
        const p = clamp((now - pl.t0) / 1600, 0, 1);
        const rev = pl.a === b;
        for (let k = 0; k < 8; k++) {
          let pp = clamp(p - k * 0.012, 0, 1);
          if (rev) pp = 1 - pp;
          const [x, y] = quadPoint(x0, y0, cx, cy, x1, y1, pp);
          g.fillStyle = rgba(pl.rgb, 0.95 - k * 0.11);
          const q = (3.6 - k * 0.38) / Math.sqrt(z);
          g.fillRect(x - q / 2, y - q / 2, q, q);
        }
      }
    }
  }

  #drawCluster(g, c, now, z, neural) {
    const t = now / 1000;
    const size = c.spriteSize * (1 + Math.sin(t * 0.4 + c.seed) * 0.008);
    const x = c.x - size / 2, y = c.y - size / 2;
    const fade = neural ? 0.28 : 1;
    const dimA = 0.55 * (1 - c.lit * 0.85) * fade;
    if (dimA > 0.02) { g.globalAlpha = dimA; g.drawImage(c.spriteDim, x, y, size, size); }
    const litA = (c.lit * (0.3 + 0.6 * c.activeT + 0.25 * c.heat) + c.flash * 0.6) * fade;
    if (litA > 0.02) { g.globalAlpha = Math.min(1, litA); g.drawImage(c.spriteLit, x, y, size, size); }
    g.globalAlpha = 1;
    if (neural) return;

    const mx = this.mouse.wx - c.x, my = this.mouse.wy - c.y;
    for (const s of c.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const near = clamp(1 - Math.hypot(s.x - mx, s.y - my) * z / 110, 0, 1);
      const a = (0.25 + tw * 0.55) * (0.5 + c.lit * 0.5) + near * 0.6;
      const sz = (s.s + near * 1.5) / Math.sqrt(z);
      g.fillStyle = near > 0 ? `rgba(255,255,255,${a})` : rgba(c.lit > 0.5 ? [235, 240, 255] : [190, 196, 210], a);
      g.fillRect(c.x + s.x - sz / 2, c.y + s.y - sz / 2, sz, sz);
    }
    const sq = Math.sqrt(z);
    for (const n of c.nodes.values()) {
      const fresh = clamp(1 - (now - n.lastHit) / 8000, 0, 1);
      const nx = c.x + n.x, ny = c.y + n.y;
      const s = (1.4 + fresh * 2.4 + Math.min(2, Math.log1p(n.hits) * 0.5) + n.act * 2) / sq;
      g.fillStyle = n.flagged ? rgba(hexToRgb(FLAG), 0.9) : rgba(c.rgb, Math.min(1, 0.35 + fresh * 0.65 + n.act * 0.5));
      g.fillRect(nx - s / 2, ny - s / 2, s, s);
      if (n.pending > 0) {
        const blink = 0.55 + 0.45 * Math.sin(now / 160 + n.x);
        const q = 5 / sq;
        g.fillStyle = `rgba(255,216,74,${blink})`;
        g.fillRect(nx + 6 - q / 2, ny - 6 - q / 2, q, q);
      }
    }
  }

  // Synapses: batched by cluster colour into a few alpha bands (a handful of strokes total).
  #drawSynapses(g, now, z, view, neural) {
    if (!this.synapses.size) return;
    const bands = new Map();
    const strength = neural ? 1 : 0.32;
    for (const s of this.synapses.values()) {
      const A = s.a, B = s.b;
      const ax = A.cluster.x + A.x, ay = A.cluster.y + A.y, bx = B.cluster.x + B.x, by = B.cluster.y + B.y;
      if (Math.max(ax, bx) < view.x0 || Math.min(ax, bx) > view.x1 || Math.max(ay, by) < view.y0 || Math.min(ay, by) > view.y1) continue;
      const recent = clamp(1 - (now - s.last) / 6000, 0, 1);
      const al = (0.05 + Math.min(0.25, Math.log1p(s.w) * 0.07) + recent * 0.35 + ((A.act || 0) + (B.act || 0)) * 0.22) * strength;
      if (al < 0.02) continue;
      const band = Math.min(7, Math.floor(al * 10));
      const col = A.cluster === B.cluster ? A.cluster.key : 'x';
      const k = col + band;
      let arr = bands.get(k);
      if (!arr) bands.set(k, (arr = { col, band, segs: [] }));
      const cx = (ax + bx) / 2 - (by - ay) * s.bend, cy = (ay + by) / 2 + (bx - ax) * s.bend;
      arr.segs.push(ax, ay, cx, cy, bx, by);
    }
    g.lineWidth = (neural ? 0.7 : 0.5) / Math.sqrt(z);
    for (const { col, band, segs } of bands.values()) {
      const rgb = col === 'x' ? [205, 215, 235] : this.clusters[col].rgb;
      g.strokeStyle = rgba(rgb, (band + 0.5) / 10);
      g.beginPath();
      for (let i = 0; i < segs.length; i += 6) { g.moveTo(segs[i], segs[i + 1]); g.quadraticCurveTo(segs[i + 2], segs[i + 3], segs[i + 4], segs[i + 5]); }
      g.stroke();
    }
  }

  #drawNeurons(g, now, z, view) {
    const sq = Math.sqrt(z);
    for (const c of this.clusterList) {
      for (const n of c.nodes.values()) {
        const x = c.x + n.x, y = c.y + n.y;
        if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
        const act = n.act || 0;
        const r = (1.6 + Math.log1p(n.hits) * 1.1) / sq;
        const fresh = clamp(1 - (now - n.lastHit) / 8000, 0, 1);
        const gs = (r * 7 + 30 * act) * (1 + fresh * 0.4);
        g.globalAlpha = Math.min(1, 0.12 + act * 0.7 + fresh * 0.25);
        g.drawImage(n.flagged ? this.flagGlow : c.glow, x - gs / 2, y - gs / 2, gs, gs);
        g.globalAlpha = 1;
        g.fillStyle = n.flagged ? rgba(hexToRgb(FLAG), 1) : rgba(c.rgb, Math.min(1, 0.55 + act));
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
    }
  }

  #drawSignals(g, now, z, neural) {
    const q = (neural ? 3 : 2.2) / Math.sqrt(z);
    for (const s of this.signals) {
      const p = clamp((now - s.t0) / s.dur, 0, 1);
      const A = s.from, B = s.to;
      const ax = A.cluster.x + A.x, ay = A.cluster.y + A.y, bx = B.cluster.x + B.x, by = B.cluster.y + B.y;
      const bend = s.s.a === A ? s.s.bend : -s.s.bend;
      const cx = (ax + bx) / 2 - (by - ay) * bend, cy = (ay + by) / 2 + (bx - ax) * bend;
      const rgb = B.cluster.rgb;
      const tail = neural ? 5 : 3;
      for (let k = 0; k < tail; k++) {
        const pp = clamp(p - k * 0.03, 0, 1);
        const [x, y] = quadPoint(ax, ay, cx, cy, bx, by, pp);
        g.fillStyle = rgba(k ? rgb : [255, 255, 255], (1 - k / tail) * Math.min(1, s.e + 0.3) * (neural ? 1 : 0.7));
        const qq = q * (1 - k / (tail + 1));
        g.fillRect(x - qq / 2, y - qq / 2, qq, qq);
      }
    }
  }

  #drawCursorWeb(g, z) {
    if (this.mouse.x < 0 || this.view === 'neural') return;
    const mx = this.mouse.wx, my = this.mouse.wy;
    g.lineWidth = 0.7 / z;
    for (const c of this.clusterList) {
      if (Math.hypot(c.x - mx, c.y - my) > c.R * 1.3) continue;
      for (const s of c.stars) {
        const d = Math.hypot(c.x + s.x - mx, c.y + s.y - my) * z;
        if (d > 110) continue;
        g.strokeStyle = rgba(c.rgb, (1 - d / 110) * 0.6);
        g.beginPath(); g.moveTo(mx, my); g.lineTo(c.x + s.x, c.y + s.y); g.stroke();
      }
    }
  }

  #tag(g, x, y, text, rgb, alpha, flagged, scale = 1) {
    g.font = `${10 * scale}px ${FONT}`;
    const w = g.measureText(text).width + 8 * scale, h = 14 * scale;
    const tx = x + 6, ty = y - h / 2;
    g.globalAlpha = alpha;
    if (flagged) {
      g.fillStyle = FLAG;
      g.fillRect(tx, ty, w, h);
      g.fillStyle = '#16070d';
    } else {
      g.fillStyle = 'rgba(6,8,12,0.82)';
      g.fillRect(tx, ty, w, h);
      g.strokeStyle = rgba(rgb, 0.85);
      g.lineWidth = 1;
      g.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
      g.fillStyle = rgba(rgb, 1);
    }
    g.fillText(text, tx + 4 * scale, ty + 10.5 * scale);
    g.globalAlpha = 1;
    return [tx, ty, w, h];
  }

  #drawLabels(g, now, neural) {
    g.textBaseline = 'alphabetic';
    const overview = this.mode === 'overview' || (!this.single && this.mode === 'auto');
    this.tagBoxes = [];
    const cands = [];
    const touched = new Set();
    // With many crawlers on screen only the most active one's tentacles carry labels,
    // otherwise the map turns into a wall of text.
    const labelled = this.spiders.size > 2 && !this.single ? [this.primarySpider()].filter(Boolean) : [...this.spiders.values()];
    for (const sp of labelled) for (const t of sp.tentacles) if (!t.retract && t.node) touched.add(t.node);

    for (const c of this.clusterList) {
      const [sx, sy] = this.toScreen(c.x, c.y);
      if (sx < -400 || sx > this.W + 400 || sy < -400 || sy > this.H + 400) continue;
      const [lx, ly] = this.toScreen(c.x + c.R * 0.08, c.y - c.R * 0.78);
      const lit = c.activeT > 0.5;
      g.font = `600 ${lit ? 14 : 12}px ${FONT}`;
      g.fillStyle = c.lit > 0.2 ? rgba(c.rgb, (neural ? 0.35 : 0.55) + c.activeT * 0.45) : 'rgba(170,176,190,0.6)';
      g.fillText(c.cat.name, lx, ly);
      if (!neural || lit) {
        g.font = `9px ${FONT}`;
        g.fillStyle = 'rgba(140,146,160,0.85)';
        const state = c === this.activeCluster && now - this.lastActivity < 20000 ? 'crawling' : c.count ? 'idle' : 'queued';
        g.fillText(`${c.count} events · ${c.nodes.size} targets · ${state}`, lx, ly + 13);
      }

      // Tags follow the tentacles (as in the reference); L shows every recent word; the
      // neural view stays wordless apart from hover.
      const nodes = [...c.nodes.values()].sort((a, b) => b.lastHit - a.lastHit);
      const limit = this.labelMode === 'all' && !neural ? (overview ? 8 : Math.round(5 + c.activeT * 14)) : 0;
      for (let i = 0; i < nodes.length && i < 60; i++) {
        const n = nodes[i];
        const age = (now - n.lastHit) / 1000;
        let a = 0, pri = 0;
        if (i < limit) { a = overview ? 0.7 : 0.35 + c.activeT * 0.6; pri = 1 + c.activeT - i * 0.02; }
        if (!neural && this.labelMode !== 'none') {
          if (touched.has(n)) { a = Math.max(a, 0.95); pri = Math.max(pri, 4 - age * 0.05); }
          const freshFor = labelled.length < this.spiders.size ? 2.5 : 5;
          if (age < freshFor) { a = Math.max(a, 1 - Math.max(0, age - freshFor * 0.6) / (freshFor * 0.4)); pri = Math.max(pri, 3 - age * 0.1); }
          if (n.flagged && c.activeT > 0.5 && !overview) { a = Math.max(a, 0.85); pri = Math.max(pri, 2); }
        }
        if (this.hover?.node === n || this.selected === n) { a = 1; pri = 10; }
        if (a < 0.04) continue;
        const [nx, ny] = this.toScreen(c.x + n.x, c.y + n.y);
        if (nx < -50 || nx > this.W + 10 || ny < -20 || ny > this.H + 20) continue;
        cands.push({ n, c, a, pri, nx, ny, age });
      }
    }
    cands.sort((p, q) => q.pri - p.pri);
    const placed = [];
    const hit = (x, y, w, h) => placed.some((r) => x < r[0] + r[2] + 2 && x + w + 2 > r[0] && y < r[1] + r[3] + 1 && y + h + 1 > r[1]);
    g.font = `10px ${FONT}`;
    for (const t of cands) {
      if (placed.length > 60) break;
      const { n, c, a, nx, ny, age } = t;
      const short = n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label;
      const label = n.flagged ? `${short} · ⚑ error` : age < 4 && n.lastVerb ? `${short} · ${n.lastVerb}` : short;
      const w = g.measureText(label).width + 8, h = 14;
      let x = nx + 6;
      const y = ny - h / 2;
      if (hit(x, y, w, h)) { x = nx - 6 - w; if (hit(x, y, w, h)) { if (t.pri < 9) continue; x = nx + 6; } }
      placed.push([x, y, w, h]);
      const pop = clamp((now - n.lastHit) / 380, 0, 1);
      const scale = age < 1 ? 0.7 + 0.3 * easeOutBack(pop) : 1;
      if (x < nx) {
        g.strokeStyle = rgba(c.rgb, 0.5 * a);
        g.beginPath(); g.moveTo(nx - 2, ny); g.lineTo(x + w, ny); g.stroke();
      }
      const box = this.#tag(g, x - 6, ny, label, c.rgb, a, n.flagged, scale);
      this.tagBoxes.push({ box, node: n });
    }

    for (const sp of this.spiders.values()) {
      const [x, y] = this.toScreen(sp.x, sp.y);
      if (x < -100 || x > this.W + 100 || y < -100 || y > this.H + 100) continue;
      const off = 24 * Math.max(1, Math.sqrt(this.cam.z));
      g.font = `9px ${FONT}`;
      g.fillStyle = rgba(sp.bodyRgb, 0.85 * sp.alpha);
      g.fillText(`${sp.style.label} · ${sp.project}`, x + off, y + off + 6);
      if (sp.queue.length > 2) {
        g.fillStyle = `rgba(255,216,74,${0.8 * sp.alpha})`;
        g.fillText(`+${sp.queue.length} queued`, x + off, y + off + 17);
      }
    }
  }

  #pickHover() {
    const mx = this.mouse.x, my = this.mouse.y;
    this.hover = null;
    if (mx < 0) return;
    for (const t of this.tagBoxes || []) {
      const [x, y, w, h] = t.box;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) { this.hover = { type: 'node', node: t.node }; return; }
    }
    for (const sp of this.spiders.values()) {
      const [x, y] = this.toScreen(sp.x, sp.y);
      if (Math.hypot(x - mx, y - my) < 26) { this.hover = { type: 'spider', spider: sp }; return; }
    }
    let best = null, bd = 12;
    for (const c of this.clusterList) {
      if (Math.hypot(this.mouse.wx - c.x, this.mouse.wy - c.y) > c.R * 1.2) continue;
      for (const n of c.nodes.values()) {
        const [x, y] = this.toScreen(c.x + n.x, c.y + n.y);
        const d = Math.hypot(x - mx, y - my);
        if (d < bd) { bd = d; best = n; }
      }
    }
    if (best) { this.hover = { type: 'node', node: best }; return; }
    for (const c of this.clusterList) {
      if (Math.hypot(this.mouse.wx - c.x, this.mouse.wy - c.y) < c.R * 0.8) { this.hover = { type: 'cluster', cluster: c }; return; }
    }
  }

  #drawHover(g, now) {
    const { x, y } = this.mouse;
    if (x < 0) return;
    g.strokeStyle = 'rgba(220,230,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 14, y); g.lineTo(x - 5, y); g.moveTo(x + 5, y); g.lineTo(x + 14, y);
    g.moveTo(x, y - 14); g.lineTo(x, y - 5); g.moveTo(x, y + 5); g.lineTo(x, y + 14);
    g.stroke();
    g.font = `9px ${FONT}`;
    g.fillStyle = 'rgba(160,170,190,0.8)';
    g.fillText(`x ${String(Math.round(this.mouse.wx)).padStart(5, ' ')}  y ${String(Math.round(this.mouse.wy)).padStart(5, ' ')}`, x + 12, y + 22);
    const h = this.hover;
    this.cv.style.cursor = h ? 'pointer' : this.mouse.down ? 'grabbing' : 'crosshair';
    if (!h) return;
    if (h.type === 'cluster') {
      const c = h.cluster;
      const [cx, cy] = this.toScreen(c.x, c.y);
      g.strokeStyle = rgba(c.rgb, 0.5);
      g.setLineDash([2, 5]);
      g.beginPath(); g.arc(cx, cy, c.R * 0.86 * this.cam.z, now / 3000, now / 3000 + TAU); g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgba(c.rgb, 0.9);
      g.fillText(`[ click to focus ${c.cat.name} ]`, x + 12, y + 34);
    } else if (h.type === 'node') {
      const n = h.node, c = n.cluster;
      const [nx, ny] = this.toScreen(c.x + n.x, c.y + n.y);
      g.strokeStyle = rgba(c.rgb, 0.9);
      g.beginPath(); g.arc(nx, ny, 7 + Math.sin(now / 150) * 1.5, 0, TAU); g.stroke();
      // Highlight this neuron's synapses.
      g.lineWidth = 1;
      for (const s of n.syn) {
        const o = s.a === n ? s.b : s.a;
        const [ox, oy] = this.toScreen(o.cluster.x + o.x, o.cluster.y + o.y);
        g.strokeStyle = rgba(o.cluster.rgb, 0.55);
        g.beginPath(); g.moveTo(nx, ny); g.lineTo(ox, oy); g.stroke();
      }
      const last = n.events[n.events.length - 1];
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`${n.hits} hits · ${n.syn.length} links · ${last?.agent || ''} · ${last?.project || ''}`, x + 12, y + 34);
    } else if (h.type === 'spider') {
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`[ click to inspect ${h.spider.style.label} · ${h.spider.project} ]`, x + 12, y + 34);
    }
  }
}
