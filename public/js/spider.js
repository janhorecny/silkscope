// The crawler. One per agent session.
// Motion model distilled from the reference recording:
//  - a stiff spring straight to its target with only a small skitter, so travel looks purposeful
//  - ~26 cilia around the shell that trail against the direction of travel and ripple at rest
//  - a persistent silk dragline behind it (smooth, survives the whole section)
//  - before it leaves a section it throws a fan of long tentacles into the next one (anticipation)
//  - tentacles are thin solid curves with dots flowing toward the target, ending in a ring

import { AGENTS } from './config.js';
import { TAU, clamp, lerp, rand, noise2, hexToRgb, rgba, easeOutCubic, easeInOutCubic, quadPoint } from './util.js';

const CILIA = 26;
const MAX_TENTACLES = 22;
const SILK_MS = 45000;

export class Spider {
  constructor(session, agent, project, x = 0, y = 0) {
    this.session = session;
    this.agent = agent;
    this.project = project;
    this.style = AGENTS[agent] || AGENTS.claude;
    this.bodyRgb = hexToRgb(this.style.body);
    this.coreRgb = hexToRgb(this.style.core);
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.tx = x; this.ty = y;
    this.heading = rand(TAU);
    this.seed = rand(1000);
    this.alpha = 0;
    this.lastActive = performance.now();
    this.pulse = 0;
    this.silk = [];
    this.silkRgb = [235, 240, 255];
    this.tentacles = [];
    this.queue = [];
    this.nextAt = 0;
    this.cluster = null;
    this.enteredAt = performance.now();
    this.goAt = 0;
    this.goTarget = null;
    this.cilia = Array.from({ length: CILIA }, (_, i) => ({
      a: (i / CILIA) * TAU + rand(-0.08, 0.08), len: rand(1.0, 1.9), ph: rand(TAU), sp: rand(2, 4),
    }));
  }

  // Long hops follow an arc (like the silk in the reference); short shuffles go straight.
  goTo(x, y, delay = 0, now = performance.now(), speed = 1) {
    if (delay > 0) { this.goAt = now + delay; this.goTarget = [x, y, speed]; return; }
    this.goAt = 0; this.goTarget = null;
    const d = Math.hypot(x - this.x, y - this.y);
    if (d > 160) {
      const bend = (Math.random() < 0.5 ? -1 : 1) * rand(0.18, 0.32);
      const mx = (this.x + x) / 2, my = (this.y + y) / 2;
      this.path = { x0: this.x, y0: this.y, cx: mx - (y - this.y) * bend, cy: my + (x - this.x) * bend, x1: x, y1: y,
        t0: now, dur: (420 + d * 0.55) / speed };
    } else this.path = null;
    this.tx = x; this.ty = y;
  }

  // Silk is near-white with a hint of the section it was spun in.
  setSilk(rgb) { this.silkRgb = rgb.map((v) => Math.round(v * 0.35 + 240 * 0.65)); }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get arrived() { return !this.goTarget && !this.path && Math.hypot(this.tx - this.x, this.ty - this.y) < 30; }

  // Tentacle target is {cluster, x, y, node?}; x/y are relative to the cluster centre.
  reach(target, flagged = false, now = performance.now()) {
    const live = this.tentacles.filter((t) => !t.retract);
    if (live.length >= MAX_TENTACLES) live[0].retract = now;
    // Comb the tentacles: they all bend the same way relative to the body, like the reference.
    const wx = target.cluster.x + target.x, wy = target.cluster.y + target.y;
    const side = Math.sign((wx - this.x) * Math.sin(this.heading) - (wy - this.y) * Math.cos(this.heading)) || 1;
    this.tentacles.push({ ...target, t0: now, retract: 0, flagged, bend: side * rand(0.12, 0.26), dur: target.fan ? 420 : 520 });
    if (!target.fan) this.pulse = 1;
    this.lastActive = now;
  }

  retractAll(exceptCluster, now = performance.now()) {
    for (const t of this.tentacles) if (!t.retract && t.cluster !== exceptCluster) t.retract = now + rand(0, 220);
  }

  update(dt, now) {
    this.alpha = Math.min(1, this.alpha + dt * 1.5);
    if (this.goTarget && now >= this.goAt) { const [x, y, spd] = this.goTarget; this.goTarget = null; this.goTo(x, y, 0, now, spd); }
    let px = this.tx, py = this.ty;
    if (this.path) {
      const p = clamp((now - this.path.t0) / this.path.dur, 0, 1);
      [px, py] = quadPoint(this.path.x0, this.path.y0, this.path.cx, this.path.cy, this.path.x1, this.path.y1, easeInOutCubic(p));
      if (p >= 1) this.path = null;
    }
    const dx = px - this.x, dy = py - this.y;
    const dist = Math.hypot(dx, dy);
    const t = now / 1000;
    const amp = clamp(dist / 22, 0, 14);
    const k = 18, c = 2 * Math.sqrt(k) * 0.97;
    this.vx += ((dx + noise2(t * 2.2, this.seed) * amp) * k - this.vx * c) * dt;
    this.vy += ((dy + noise2(this.seed, t * 2.2) * amp) * k - this.vy * c) * dt;
    const sp = this.speed;
    if (sp > 1500) { this.vx *= 1500 / sp; this.vy *= 1500 / sp; }
    const idle = clamp(1 - sp / 40, 0, 1);
    this.x += this.vx * dt + noise2(t * 0.35, this.seed + 3) * 5 * idle * dt;
    this.y += this.vy * dt + noise2(this.seed + 5, t * 0.35) * 5 * idle * dt;
    if (sp > 10) {
      let d = Math.atan2(this.vy, this.vx) - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * clamp(dt * 5, 0, 1);
    }
    this.pulse = clamp(this.pulse - dt * 1.6, 0, 1);

    const last = this.silk[this.silk.length - 1];
    if (!last || Math.hypot(last.x - this.x, last.y - this.y) > 5) {
      this.silk.push({ x: this.x, y: this.y, t: now, rgb: this.silkRgb });
      if (this.silk.length > 700) this.silk.shift();
    }
    while (this.silk.length && now - this.silk[0].t > SILK_MS) this.silk.shift();
    this.tentacles = this.tentacles.filter((tn) => !(tn.retract && now - tn.retract > 450));
  }

  // ---------------------------------------------------------------- drawing
  drawSilk(g, zoom, now) {
    const s = this.silk;
    if (s.length < 3) return;
    g.lineWidth = 1.1 / Math.sqrt(zoom);
    g.lineCap = 'round';
    // Smooth path through midpoints. Segments are batched into a few age bands so a 700-point
    // dragline costs ~6 strokes instead of 700.
    const BANDS = 6;
    let i = 1;
    while (i < s.length - 1) {
      const band = Math.min(BANDS - 1, Math.floor(((now - s[i].t) / SILK_MS) * BANDS));
      const rgb = s[i].rgb;
      const age = (band + 0.5) / BANDS;
      const al = (1 - age) * (1 - age) * 0.7 * this.alpha;
      g.strokeStyle = rgba(rgb, al);
      g.beginPath();
      g.moveTo((s[i - 1].x + s[i].x) / 2, (s[i - 1].y + s[i].y) / 2);
      while (i < s.length - 1) {
        const b = s[i], c = s[i + 1];
        const bb = Math.min(BANDS - 1, Math.floor(((now - b.t) / SILK_MS) * BANDS));
        if (bb !== band || b.rgb !== rgb) break;
        g.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
        i++;
      }
      g.stroke();
      if (i < s.length - 1 && (Math.min(BANDS - 1, Math.floor(((now - s[i].t) / SILK_MS) * BANDS)) !== band || s[i].rgb !== rgb)) continue;
      i++;
    }
  }

  tentacleGeom(tn, now) {
    const nx = tn.cluster.x + tn.x, ny = tn.cluster.y + tn.y;
    let p = easeOutCubic(clamp((now - tn.t0) / tn.dur, 0, 1));
    if (tn.retract) p *= 1 - easeOutCubic(clamp((now - tn.retract) / 450, 0, 1));
    const sx = this.x, sy = this.y;
    const dx = nx - sx, dy = ny - sy;
    const cx = (sx + nx) / 2 - dy * tn.bend, cy = (sy + ny) / 2 + dx * tn.bend;
    return { sx, sy, cx, cy, nx, ny, p, len: Math.hypot(dx, dy) };
  }

  drawTentacles(g, zoom, now, abstract) {
    for (const tn of this.tentacles) {
      const { sx, sy, cx, cy, nx, ny, p, len } = this.tentacleGeom(tn, now);
      if (p <= 0.01) continue;
      const col = tn.flagged ? [255, 61, 129] : tn.fan ? this.silkRgb : [230, 236, 250];
      // Solid strand, drawn only up to the reached fraction.
      const steps = Math.max(6, Math.min(40, (len * p) / 12 | 0));
      g.strokeStyle = rgba(col, (abstract ? 0.35 : 0.42) * this.alpha * (tn.fan ? 0.7 : 1));
      g.lineWidth = (abstract ? 0.6 : 0.8) / Math.sqrt(zoom);
      g.beginPath();
      g.moveTo(sx, sy);
      for (let i = 1; i <= steps; i++) {
        const [x, y] = quadPoint(sx, sy, cx, cy, nx, ny, (i / steps) * p);
        g.lineTo(x, y);
      }
      g.stroke();
      if (!abstract) {
        // Data flowing out along the strand.
        const spacing = 9, flow = ((now / 45) % spacing) / spacing;
        const n = Math.floor((len * p) / spacing);
        const q = 1.4 / Math.sqrt(zoom);
        for (let i = 0; i < n; i++) {
          const tt = ((i + flow) * spacing) / len;
          if (tt > p) break;
          const [x, y] = quadPoint(sx, sy, cx, cy, nx, ny, tt);
          g.fillStyle = rgba(col, (0.3 + 0.6 * (i / n)) * this.alpha);
          g.fillRect(x - q / 2, y - q / 2, q, q);
        }
      }
      if (p > 0.97 && !tn.fan) {
        g.strokeStyle = rgba(col, 0.9 * this.alpha);
        g.lineWidth = 1 / zoom;
        g.beginPath(); g.arc(nx, ny, 2.8, 0, TAU); g.stroke();
      } else if (tn.fan) {
        const [x, y] = quadPoint(sx, sy, cx, cy, nx, ny, p);
        g.fillStyle = rgba(col, 0.9 * this.alpha);
        g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
      }
    }
  }

  drawBody(g, zoom, now, focused) {
    const a = this.alpha, body = this.bodyRgb, t = now / 1000;
    const sp = this.speed;
    const rx = 15 + this.pulse * 3, ry = 12 + this.pulse * 2;
    const rot = this.heading * 0.2;

    // Cilia: trail against motion, ripple at rest.
    const drag = clamp(sp / 500, 0, 1);
    g.lineWidth = 0.9 / Math.sqrt(zoom);
    for (const c of this.cilia) {
      const ang = c.a + rot;
      const ex = Math.cos(ang) * rx, ey = Math.sin(ang) * ry;
      const bx = this.x + ex, by = this.y + ey;
      const len = (c.len * 16) * (1 + this.pulse * 0.35);
      const wave = Math.sin(t * c.sp + c.ph) * 0.35;
      // Sweep tips toward the back of travel.
      const back = Math.atan2(-this.vy, -this.vx);
      let da = back - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      const tipA = ang + wave * (1 - drag) + da * drag * 0.6;
      const tx = bx + Math.cos(tipA) * len, ty = by + Math.sin(tipA) * len;
      const kx = bx + Math.cos(ang + wave * 0.5) * len * 0.55, ky = by + Math.sin(ang + wave * 0.5) * len * 0.55;
      g.strokeStyle = rgba(body, 0.7 * a);
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(kx, ky, tx, ty); g.stroke();
      g.fillStyle = rgba(body, 0.95 * a);
      g.fillRect(tx - 0.8, ty - 0.8, 1.6, 1.6);
    }

    g.save();
    g.translate(this.x, this.y);
    g.rotate(rot);
    const glow = g.createRadialGradient(0, 0, 4, 0, 0, 52);
    glow.addColorStop(0, rgba(body, 0.24 * a));
    glow.addColorStop(1, rgba(body, 0));
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, 0, 52, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU);
    g.fillStyle = `rgba(3,14,16,${0.92 * a})`;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = rgba(body, 0.45 * a);
    g.lineWidth = 0.55;
    for (let i = -rx; i <= rx; i += 2.6) { g.beginPath(); g.moveTo(i, -ry); g.lineTo(i, ry); g.stroke(); }
    for (let j = -ry; j <= ry; j += 2.6) { g.beginPath(); g.moveTo(-rx, j); g.lineTo(rx, j); g.stroke(); }
    g.restore();
    g.strokeStyle = rgba(body, 0.95 * a);
    g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
    const s = 5.5 + this.pulse * 2.5 + Math.sin(now / 240) * 0.6;
    g.rotate(Math.PI / 4 + Math.sin(now / 900) * 0.2);
    g.fillStyle = rgba(this.coreRgb, a);
    g.shadowColor = rgba(this.coreRgb, 0.9);
    g.shadowBlur = 12;
    g.fillRect(-s / 2, -s / 2, s, s);
    g.shadowBlur = 0;
    g.restore();

    if (this.pulse > 0) {
      g.strokeStyle = rgba(this.coreRgb, this.pulse * 0.6 * a);
      g.lineWidth = 1 / zoom;
      g.beginPath(); g.arc(this.x, this.y, 24 + (1 - this.pulse) * 40, 0, TAU); g.stroke();
    }
    if (focused) this.#brackets(g, zoom, now, body, a);
  }

  // Abstract view: the agent is only a locus of attention.
  drawLocus(g, zoom, now, focused) {
    const a = this.alpha, t = now / 1000;
    const r = 7 + this.pulse * 5 + Math.sin(t * 3) * 0.6;
    const glow = g.createRadialGradient(this.x, this.y, 0, this.x, this.y, 60);
    glow.addColorStop(0, rgba(this.coreRgb, 0.35 * a));
    glow.addColorStop(0.3, rgba(this.bodyRgb, 0.1 * a));
    glow.addColorStop(1, rgba(this.bodyRgb, 0));
    g.fillStyle = glow;
    g.beginPath(); g.arc(this.x, this.y, 60, 0, TAU); g.fill();
    g.strokeStyle = rgba(this.bodyRgb, 0.9 * a);
    g.lineWidth = 1.2 / Math.sqrt(zoom);
    g.beginPath(); g.arc(this.x, this.y, Math.max(0.5, r), 0, TAU); g.stroke();
    g.fillStyle = rgba([255, 255, 255], a);
    g.beginPath(); g.arc(this.x, this.y, 2.2, 0, TAU); g.fill();
    if (this.pulse > 0) {
      g.strokeStyle = rgba(this.coreRgb, this.pulse * 0.7 * a);
      g.beginPath(); g.arc(this.x, this.y, Math.max(0, r + (1 - this.pulse) * 46), 0, TAU); g.stroke();
    }
    if (focused) this.#brackets(g, zoom, now, this.bodyRgb, a);
  }

  #brackets(g, zoom, now, rgb, a) {
    const r = 38 + Math.sin(now / 300) * 2;
    g.strokeStyle = rgba(rgb, 0.55 * a);
    g.lineWidth = 1 / zoom;
    for (let i = 0; i < 4; i++) {
      const st = i * (Math.PI / 2) + now / 2000;
      g.beginPath(); g.arc(this.x, this.y, r, st, st + 0.5); g.stroke();
    }
  }
}
