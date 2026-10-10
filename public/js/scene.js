// The world: nebula clusters, the cosmic-web links between them, the crawler swarm,
// word tags, bursts, matrix rain and the camera. Everything is Canvas2D.

import { CATEGORIES, CAT, FLAG, PENDING } from './config.js';
import { Cluster } from './nebula.js';
import { Spider } from './spider.js';
import { TAU, clamp, lerp, damp, rand, pick, noise2, rgba, hexToRgb, quadPoint, easeOutBack } from './util.js';

const WORLD = { x0: -1000, y0: -780, x1: 920, y1: 900 };
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789ABCDEF<>{}[]=+*:;/\\|'.split('');
const FONT = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export class Scene {
  constructor(canvas, store) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.store = store;
    this.clusters = Object.fromEntries(CATEGORIES.map((c) => [c.key, new Cluster(c)]));
    this.clusterList = Object.values(this.clusters);
    this.spiders = new Map();
    this.bursts = [];
    this.pulses = [];
    this.cam = { x: 0, y: 0, z: 0.5 };
    this.camT = { x: 0, y: 0, z: 0.5 };
    this.mode = 'auto'; // auto | focus | free | overview
    this.focusCluster = null;
    this.followSpider = null;
    this.freeUntil = 0;
    this.mouse = { x: -1e4, y: -1e4, wx: 0, wy: 0, down: false, moved: false };
    this.hover = null;
    this.selected = null;
    this.matrix = true;
    this.paused = false;
    this.speed = 1;
    this.frame = 0;
    this.lastActivity = 0;
    this.activeCluster = null;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
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

  toWorld(sx, sy) {
    return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.H / 2) / this.cam.z + this.cam.y];
  }
  toScreen(wx, wy) {
    return [(wx - this.cam.x) * this.cam.z + this.W / 2, (wy - this.cam.y) * this.cam.z + this.H / 2];
  }

  // ---------------------------------------------------------------- interaction
  #bind() {
    const cv = this.cv;
    let last = null;
    cv.addEventListener('pointerdown', (e) => {
      this.mouse.down = true; this.mouse.moved = false;
      last = [e.clientX, e.clientY];
      cv.setPointerCapture(e.pointerId);
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
    cv.addEventListener('pointerup', () => { this.mouse.down = false; });
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
      const f = Math.exp(-e.deltaY * 0.0015);
      const ov = this.overviewCam().z;
      const z = clamp(this.camT.z * f, ov * 0.6, ov * 7);
      this.camT.z = z;
      // Keep the point under the cursor fixed.
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
    else if (h.type === 'spider') { this.followSpider = h.spider; this.setMode('auto'); this.onSelect({ type: 'spider', spider: h.spider }); }
    else if (h.type === 'cluster') this.focus(h.cluster.key);
  }

  setMode(m) {
    this.mode = m;
    if (m === 'free') this.freeUntil = performance.now() + 15000;
    if (m !== 'focus') this.focusCluster = null;
    this.onFocus(this.mode, this.focusCluster);
  }

  focus(key) {
    const c = this.clusters[key];
    if (!c) return;
    this.focusCluster = c;
    this.mode = 'focus';
    this.freeUntil = performance.now() + 25000;
    this.onFocus(this.mode, c);
  }

  // ---------------------------------------------------------------- events
  spiderFor(session) {
    let sp = this.spiders.get(session.id);
    if (!sp) {
      const a = rand(TAU);
      sp = new Spider(session.id, session.agent, session.project, this.cam.x + Math.cos(a) * 260, this.cam.y + Math.sin(a) * 200);
      this.spiders.set(session.id, sp);
      if (this.spiders.size > 6) {
        let old = null;
        for (const s of this.spiders.values()) if (!old || s.lastActive < old.lastActive) old = s;
        this.spiders.delete(old.session);
      }
    }
    sp.project = session.project;
    return sp;
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
      if (animate) {
        this.lastActivity = now;
        const sp = this.spiderFor(res.session);
        sp.lastActive = now;
        sp.queue.push({ cl, node, ev });
        if (sp.queue.length > 40) sp.queue.splice(0, sp.queue.length - 40);
        if (this.mode === 'overview') this.setMode('auto');
      } else {
        node.lastHit = now - 60000;
        cl.lit = 1;
      }
    } else if (res.kind === 'result' && res.orig.node) {
      const node = res.orig.node, cl = res.orig.cluster;
      node.pending = Math.max(0, node.pending - 1);
      if (ev.status === 'error') {
        node.flagged = true;
        node.flagTs = now;
        cl.flags++;
        if (animate) {
          this.burst(cl, node, hexToRgb(FLAG), 26);
          for (const sp of this.spiders.values()) for (const t of sp.tentacles) if (t.node === node) t.flagged = true;
        }
      }
    }
  }

  burst(cl, node, rgb, n = 14) {
    const [x, y] = cl.worldNode(node);
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), v = rand(20, 110);
      this.bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, rgb, s: rand(0.8, 2.2) });
    }
    if (this.bursts.length > 900) this.bursts.splice(0, this.bursts.length - 900);
  }

  primarySpider() {
    if (this.followSpider && this.spiders.has(this.followSpider.session)) return this.followSpider;
    let best = null;
    for (const s of this.spiders.values()) if (!best || s.lastActive > best.lastActive) best = s;
    return best;
  }

  // ---------------------------------------------------------------- update
  update(dt, now) {
    // Feed queued events to each crawler at a readable pace.
    for (const sp of this.spiders.values()) {
      if (sp.pendingReach && (sp.arrived || now > sp.pendingReach.at)) {
        const { cl, node, ev } = sp.pendingReach;
        sp.reach(node, cl, ev.status === 'error');
        node.lastHit = now;
        node.lastVerb = ev.verb;
        cl.heat = Math.min(1, cl.heat + 0.5);
        cl.lit = 1;
        this.burst(cl, node, cl.rgb, 10);
        sp.pendingReach = null;
      }
      if (!sp.pendingReach && sp.queue.length && now >= sp.nextAt) {
        const item = sp.queue.shift();
        const changed = sp.cluster !== item.cl;
        if (changed) {
          if (sp.cluster) this.pulses.push({ a: sp.cluster, b: item.cl, t0: now, rgb: item.cl.rgb });
          sp.retractAll(item.cl);
          sp.cluster = item.cl;
          sp.trailRgb = item.cl.rgb;
        }
        // Stand between the cloud's heart and the word, so tentacles fan outward.
        const k = 0.35 + rand(-0.1, 0.12);
        sp.goTo(item.cl.x + item.node.x * k + rand(-18, 18), item.cl.y + item.node.y * k + rand(-18, 18));
        sp.pendingReach = { ...item, at: now + (changed ? 900 : 120) / this.speed };
        const backlog = sp.queue.length;
        const gap = backlog > 24 ? 40 : backlog > 8 ? 120 : 340;
        sp.nextAt = now + gap / this.speed;
      }
      sp.update(dt, now);
    }
    // Retire crawlers idle for 20 minutes.
    for (const [k, sp] of this.spiders) if (now - sp.lastActive > 20 * 60e3) { sp.alpha -= dt; if (sp.alpha <= 0) this.spiders.delete(k); }

    const prim = this.primarySpider();
    this.activeCluster = this.focusCluster || prim?.cluster || this.activeCluster;
    for (const c of this.clusterList) {
      c.heat = Math.max(0, c.heat - dt * 0.35);
      c.activeT = damp(c.activeT, c === this.activeCluster ? 1 : 0, 3, dt);
    }

    for (const b of this.bursts) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= 1 - dt * 2.2; b.vy *= 1 - dt * 2.2;
      b.life -= dt * 0.9;
    }
    this.bursts = this.bursts.filter((b) => b.life > 0);
    this.pulses = this.pulses.filter((p) => now - p.t0 < 1600);

    // Camera.
    if ((this.mode === 'free' || this.mode === 'focus') && now > this.freeUntil) this.setMode('auto');
    if (this.mode === 'auto' && now - this.lastActivity > 45000) this.setMode('overview');
    const ov = this.overviewCam();
    if (this.mode === 'overview') Object.assign(this.camT, ov);
    else if (this.mode === 'focus' && this.focusCluster) {
      this.camT.x = this.focusCluster.x; this.camT.y = this.focusCluster.y; this.camT.z = ov.z * 2.3;
    } else if (this.mode === 'auto') {
      if (prim) {
        const cx = prim.cluster ? prim.cluster.x : prim.x, cy = prim.cluster ? prim.cluster.y : prim.y;
        this.camT.x = lerp(cx, prim.x, 0.55);
        this.camT.y = lerp(cy, prim.y, 0.55);
        this.camT.z = ov.z * 1.75;
      } else Object.assign(this.camT, ov);
    }
    const lam = this.mode === 'free' ? 10 : 1.6;
    this.cam.x = damp(this.cam.x, this.camT.x, lam, dt);
    this.cam.y = damp(this.cam.y, this.camT.y, lam, dt);
    this.cam.z = damp(this.cam.z, this.camT.z, lam * 0.9, dt);
    [this.mouse.wx, this.mouse.wy] = this.toWorld(this.mouse.x, this.mouse.y);
  }

  // ---------------------------------------------------------------- draw
  draw(now) {
    const g = this.g, W = this.W, H = this.H;
    this.frame++;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#050608';
    g.fillRect(0, 0, W, H);

    if (this.matrix) this.#drawRain(g, now);
    this.#drawStars(g, now);

    const z = this.cam.z;
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(z, z);
    g.translate(-this.cam.x, -this.cam.y);

    g.globalCompositeOperation = 'lighter';
    this.#drawWeb(g, now, z);
    for (const c of this.clusterList) this.#drawCluster(g, c, now, z);
    for (const b of this.bursts) {
      g.fillStyle = rgba(b.rgb, b.life * 0.9);
      g.fillRect(b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
    }
    for (const sp of this.spiders.values()) sp.drawTrail(g, z);
    for (const sp of this.spiders.values()) sp.drawTentacles(g, z, now);
    this.#drawCursorWeb(g, z);
    g.globalCompositeOperation = 'source-over';
    const prim = this.primarySpider();
    for (const sp of this.spiders.values()) sp.drawBody(g, z, now, sp === this.followSpider || sp === prim && this.spiders.size > 1);
    g.restore();

    this.#drawLabels(g, now);
    this.#pickHover();
    this.#drawHover(g, now);
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
    g.globalAlpha = 0.16;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.rainCv, 0, 0, this.W, this.H);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = 1;
  }

  #drawStars(g, now) {
    const W = this.W, H = this.H, t = now / 1000;
    for (const s of this.stars) {
      const px = ((s.x * W - this.cam.x * s.d * this.cam.z * 0.25) % W + W) % W;
      const py = ((s.y * H - this.cam.y * s.d * this.cam.z * 0.25) % H + H) % H;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (0.5 + s.d * 3) + s.ph));
      g.fillStyle = `rgba(200,210,230,${a * (0.3 + s.d)})`;
      g.fillRect(px, py, s.s, s.s);
    }
  }

  // Faint filaments that tie every cloud to its neighbours, brighter where the swarm travels.
  // Each link is a braid of thin strands anchored off-centre, so it reads as cosmic web, not a wire.
  #drawWeb(g, now, z) {
    const L = this.clusterList;
    const t = now / 1000;
    if (!this.strands) this.strands = new Map();
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const key = a.key + '>' + b.key;
      const w = this.store.links.get([a.key, b.key].sort().join('>')) || 0;
      if (d > 820 && !w) continue;
      let st = this.strands.get(key);
      if (!st) {
        st = Array.from({ length: 4 }, (_, k) => ({
          ax: rand(-0.35, 0.35) * a.R, ay: rand(-0.35, 0.35) * a.R,
          bx: rand(-0.35, 0.35) * b.R, by: rand(-0.35, 0.35) * b.R,
          bend: rand(-0.28, 0.28), ph: rand(TAU), k,
        }));
        this.strands.set(key, st);
      }
      const use = Math.min(1, Math.log1p(w) / 4);
      const base = 0.025 + use * 0.07;
      g.lineWidth = 0.6 / z;
      const pulses = this.pulses.filter((pl) => (pl.a === a && pl.b === b) || (pl.a === b && pl.b === a));
      for (const s of st) {
        const x0 = a.x + s.ax, y0 = a.y + s.ay, x1 = b.x + s.bx, y1 = b.y + s.by;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const bend = s.bend + noise2(s.ph, t * 0.07) * 0.08;
        const cx = mx - (y1 - y0) * bend, cy = my + (x1 - x0) * bend;
        const grad = g.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, rgba(a.rgb, base * (0.35 + a.lit)));
        grad.addColorStop(0.5, rgba([200, 210, 230], base * 0.35));
        grad.addColorStop(1, rgba(b.rgb, base * (0.35 + b.lit)));
        g.strokeStyle = grad;
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
        if (w && s.k < 2) {
          const p = (t * 0.06 + s.ph) % 1;
          const [x, y] = quadPoint(x0, y0, cx, cy, x1, y1, p);
          g.fillStyle = rgba(p < 0.5 ? a.rgb : b.rgb, 0.25 + use * 0.35);
          const q = 1.6 / Math.sqrt(z);
          g.fillRect(x - q / 2, y - q / 2, q, q);
        }
        if (s.k === 0) for (const pl of pulses) {
          let p = clamp((now - pl.t0) / 1600, 0, 1);
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
  }

  #drawCluster(g, c, now, z) {
    const t = now / 1000;
    const size = c.spriteSize * (1 + Math.sin(t * 0.4 + c.seed) * 0.008);
    const x = c.x - size / 2, y = c.y - size / 2;
    const dimA = 0.55 * (1 - c.lit * 0.85);
    if (dimA > 0.02) { g.globalAlpha = dimA; g.drawImage(c.spriteDim, x, y, size, size); }
    const litA = c.lit * (0.32 + 0.6 * c.activeT + 0.25 * c.heat);
    if (litA > 0.02) { g.globalAlpha = Math.min(1, litA); g.drawImage(c.spriteLit, x, y, size, size); }
    g.globalAlpha = 1;

    // Twinkling stars (and cursor proximity brightening).
    const mx = this.mouse.wx - c.x, my = this.mouse.wy - c.y;
    for (const s of c.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const near = clamp(1 - Math.hypot(s.x - mx, s.y - my) * z / 110, 0, 1);
      const a = (0.25 + tw * 0.55) * (0.5 + c.lit * 0.5) + near * 0.6;
      const sz = (s.s + near * 1.5) / Math.sqrt(z);
      g.fillStyle = near > 0 ? `rgba(255,255,255,${a})` : rgba(c.lit > 0.5 ? [235, 240, 255] : [190, 196, 210], a);
      g.fillRect(c.x + s.x - sz / 2, c.y + s.y - sz / 2, sz, sz);
    }

    // Word nodes.
    for (const n of c.nodes.values()) {
      const age = (now - n.lastHit) / 1000;
      const fresh = clamp(1 - age / 8, 0, 1);
      const nx = c.x + n.x, ny = c.y + n.y;
      const s = (1.4 + fresh * 2.4 + Math.min(2, Math.log1p(n.hits) * 0.5)) / Math.sqrt(z);
      g.fillStyle = n.flagged ? rgba(hexToRgb(FLAG), 0.9) : rgba(c.rgb, 0.35 + fresh * 0.65);
      g.fillRect(nx - s / 2, ny - s / 2, s, s);
      if (n.pending > 0) {
        // Pending tool call: blinking yellow block, like the reference's markers.
        const blink = 0.55 + 0.45 * Math.sin(now / 160 + n.x);
        const q = 5 / Math.sqrt(z);
        g.fillStyle = `rgba(255,216,74,${blink})`;
        g.fillRect(nx + 6 - q / 2, ny - 6 - q / 2, q, q);
      }
    }
  }

  #drawCursorWeb(g, z) {
    if (this.mouse.x < 0) return;
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

  #drawLabels(g, now) {
    g.textBaseline = 'alphabetic';
    const overview = this.mode === 'overview';
    this.tagBoxes = [];
    const cands = [];
    for (const c of this.clusterList) {
      const [sx, sy] = this.toScreen(c.x, c.y);
      if (sx < -400 || sx > this.W + 400 || sy < -400 || sy > this.H + 400) continue;
      // Section label.
      const [lx, ly] = this.toScreen(c.x + c.R * 0.08, c.y - c.R * 0.78);
      const lit = c.activeT > 0.5;
      g.font = `600 ${lit ? 14 : 12}px ${FONT}`;
      g.fillStyle = c.lit > 0.2 ? rgba(c.rgb, 0.55 + c.activeT * 0.45) : 'rgba(170,176,190,0.75)';
      g.fillText(c.cat.name, lx, ly);
      g.font = `9px ${FONT}`;
      g.fillStyle = 'rgba(140,146,160,0.85)';
      const state = c === this.activeCluster && now - this.lastActivity < 20000 ? 'crawling' : c.count ? 'idle' : 'queued';
      g.fillText(`${c.count} events · ${c.nodes.size} targets · ${state}`, lx, ly + 13);

      // Tag candidates: newest words, more when active or in overview.
      const nodes = [...c.nodes.values()].sort((a, b) => b.lastHit - a.lastHit);
      const limit = overview ? 7 : Math.round(4 + c.activeT * 14);
      for (let i = 0; i < nodes.length && i < 40; i++) {
        const n = nodes[i];
        const age = (now - n.lastHit) / 1000;
        let a = 0, pri = 0;
        if (i < limit) { a = overview ? 0.75 : 0.35 + c.activeT * 0.6; pri = 1 + c.activeT - i * 0.02; }
        if (age < 10) { a = Math.max(a, 1 - Math.max(0, age - 6) / 4); pri = Math.max(pri, 3 - age * 0.1); }
        if (n.flagged && (c.activeT > 0.3 || overview)) { a = Math.max(a, 0.9); pri = Math.max(pri, 2); }
        if (this.hover?.node === n || this.selected === n) { a = 1; pri = 10; }
        if (a < 0.04) continue;
        const [nx, ny] = this.toScreen(c.x + n.x, c.y + n.y);
        if (nx < -50 || nx > this.W + 10 || ny < -20 || ny > this.H + 20) continue;
        cands.push({ n, c, a, pri, nx, ny, age });
      }
    }
    // Greedy placement: highest priority first; a tag that would overlap another is tried
    // left of its node, then dropped (its node dot is still drawn).
    cands.sort((p, q) => q.pri - p.pri);
    const placed = [];
    const hit = (x, y, w, h) => placed.some((r) => x < r[0] + r[2] + 2 && x + w + 2 > r[0] && y < r[1] + r[3] + 1 && y + h + 1 > r[1]);
    g.font = `10px ${FONT}`;
    for (const t of cands) {
      if (placed.length > 70) break;
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
    // Crawler labels.
    for (const sp of this.spiders.values()) {
      const [x, y] = this.toScreen(sp.x, sp.y);
      g.font = `9px ${FONT}`;
      g.fillStyle = rgba(sp.bodyRgb, 0.85 * sp.alpha);
      const off = 22 * Math.max(1, this.cam.z);
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
    for (const c of this.clusterList) for (const n of c.nodes.values()) {
      const [x, y] = this.toScreen(c.x + n.x, c.y + n.y);
      const d = Math.hypot(x - mx, y - my);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) { this.hover = { type: 'node', node: best }; return; }
    for (const c of this.clusterList) {
      if (Math.hypot(this.mouse.wx - c.x, this.mouse.wy - c.y) < c.R * 0.8) { this.hover = { type: 'cluster', cluster: c }; return; }
    }
  }

  #drawHover(g, now) {
    const { x, y } = this.mouse;
    if (x < 0) return;
    // Crosshair readout.
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
      const r = c.R * 0.86 * this.cam.z;
      g.strokeStyle = rgba(c.rgb, 0.5);
      g.setLineDash([2, 5]);
      g.beginPath(); g.arc(cx, cy, r, now / 3000, now / 3000 + TAU); g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgba(c.rgb, 0.9);
      g.fillText(`[ click to focus ${c.cat.name} ]`, x + 12, y + 34);
    } else if (h.type === 'node') {
      const n = h.node, c = n.cluster;
      const [nx, ny] = this.toScreen(c.x + n.x, c.y + n.y);
      g.strokeStyle = rgba(c.rgb, 0.9);
      g.beginPath(); g.arc(nx, ny, 7 + Math.sin(now / 150) * 1.5, 0, TAU); g.stroke();
      const last = n.events[n.events.length - 1];
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`${n.hits} hits · ${last?.agent || ''} · ${last?.project || ''}`, x + 12, y + 34);
    } else if (h.type === 'spider') {
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`[ click to follow ${h.spider.style.label} · ${h.spider.project} ]`, x + 12, y + 34);
    }
  }
}
