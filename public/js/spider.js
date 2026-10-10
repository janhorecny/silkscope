// The crawler. One per live agent session.
// Body moves with a critically-damped spring plus a noise "wander" so its trail is jagged like the
// reference. Legs are procedural: each foot stays planted until its rest point drifts too far, then
// steps with an arc (alternating gait groups). Tentacles are dotted bezier reaches to word nodes.

import { AGENTS } from './config.js';
import { TAU, clamp, lerp, rand, noise2, hexToRgb, rgba, easeOutCubic, quadPoint } from './util.js';

const LEGS = 16;

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
    this.born = performance.now();
    this.alpha = 0;
    this.lastActive = performance.now();
    this.pulse = 0;
    this.trail = [];
    this.trailRgb = [255, 255, 255];
    this.tentacles = [];
    this.queue = [];
    this.nextAt = 0;
    this.cluster = null;
    this.legs = Array.from({ length: LEGS }, (_, i) => {
      const a = (i / LEGS) * TAU + rand(-0.12, 0.12);
      const len = rand(30, 48);
      return { a, len, fx: x + Math.cos(a) * len, fy: y + Math.sin(a) * len, ox: 0, oy: 0, nx: 0, ny: 0, t: 1, group: i % 2 };
    });
    this.stepping = 0;
  }

  goTo(x, y) { this.tx = x; this.ty = y; }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get arrived() { return Math.hypot(this.tx - this.x, this.ty - this.y) < 40; }

  reach(node, cluster, flagged) {
    // Retract the oldest tentacles when there are too many.
    const live = this.tentacles.filter((t) => !t.retract);
    if (live.length >= 18) live[0].retract = performance.now();
    this.tentacles.push({ node, cluster, t0: performance.now(), retract: 0, flagged,
      bend: rand(-0.35, 0.35) });
    this.pulse = 1;
    this.lastActive = performance.now();
  }

  retractAll(exceptCluster) {
    const now = performance.now();
    for (const t of this.tentacles) if (!t.retract && t.cluster !== exceptCluster) t.retract = now + rand(0, 180);
  }

  update(dt, now) {
    this.alpha = Math.min(1, this.alpha + dt * 1.5);
    // Spring towards target with a wandering offset perpendicular to travel.
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const dist = Math.hypot(dx, dy);
    const wanderAmp = clamp(dist / 6, 0, 60);
    const t = now / 1000;
    const wx = noise2(t * 0.9, this.seed) * wanderAmp;
    const wy = noise2(this.seed, t * 0.9) * wanderAmp;
    const k = 7.5, c = 2 * Math.sqrt(k) * 0.92;
    this.vx += ((dx + wx) * k - this.vx * c) * dt;
    this.vy += ((dy + wy) * k - this.vy * c) * dt;
    const sp = this.speed;
    if (sp > 900) { this.vx *= 900 / sp; this.vy *= 900 / sp; }
    // Idle drift so it never looks frozen.
    const idle = clamp(1 - sp / 40, 0, 1);
    this.x += this.vx * dt + noise2(t * 0.35, this.seed + 3) * 6 * idle * dt;
    this.y += this.vy * dt + noise2(this.seed + 5, t * 0.35) * 6 * idle * dt;
    if (sp > 8) {
      const target = Math.atan2(this.vy, this.vx);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * clamp(dt * 4, 0, 1);
    }
    this.pulse = Math.max(0, this.pulse - dt * 1.6);

    // Trail: sampled breadcrumbs, faded by age.
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.x, last.y - this.y) > 4) {
      this.trail.push({ x: this.x, y: this.y, t: now, rgb: this.trailRgb });
      if (this.trail.length > 420) this.trail.shift();
    }
    while (this.trail.length && now - this.trail[0].t > 9000) this.trail.shift();

    // Gait.
    let stepping = 0;
    for (const L of this.legs) if (L.t < 1) stepping++;
    for (let i = 0; i < this.legs.length; i++) {
      const L = this.legs[i];
      const breathe = noise2(t * 0.8 + i, this.seed) * 0.12;
      const ang = L.a + this.heading * 0.25 + breathe;
      const lead = clamp(sp * 0.12, 0, 26);
      const rx = this.x + Math.cos(ang) * L.len + (this.vx / (sp || 1)) * lead;
      const ry = this.y + Math.sin(ang) * L.len + (this.vy / (sp || 1)) * lead;
      if (L.t < 1) {
        L.t = Math.min(1, L.t + dt / 0.11);
        const e = easeOutCubic(L.t);
        L.fx = lerp(L.ox, L.nx, e);
        L.fy = lerp(L.oy, L.ny, e);
        L.lift = Math.sin(L.t * Math.PI);
      } else {
        L.lift = 0;
        const off = Math.hypot(rx - L.fx, ry - L.fy);
        const groupOk = ((now / 110) | 0) % 2 === L.group;
        if (off > L.len * 0.42 && ((groupOk && stepping < 9) || off > L.len * 0.9)) {
          L.ox = L.fx; L.oy = L.fy; L.nx = rx; L.ny = ry; L.t = 0; stepping++;
        }
      }
      // A leg can never stretch past its reach: drag the foot along (a skitter, not a rubber band).
      const reach = L.len * 1.5;
      const fdx = L.fx - this.x, fdy = L.fy - this.y, fd = Math.hypot(fdx, fdy);
      if (fd > reach) {
        L.fx = this.x + (fdx / fd) * reach; L.fy = this.y + (fdy / fd) * reach;
        if (L.t < 1) { L.nx = rx; L.ny = ry; L.ox = L.fx; L.oy = L.fy; }
      }
    }

    // Tentacles: extend, hold, retract.
    this.tentacles = this.tentacles.filter((tn) => !(tn.retract && now - tn.retract > 450));
  }

  drawTrail(g, zoom) {
    const tr = this.trail;
    if (tr.length < 2) return;
    const now = performance.now();
    g.lineWidth = 1.3 / zoom;
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      const age = (now - b.t) / 9000;
      g.strokeStyle = rgba(b.rgb, (1 - age) * 0.75 * this.alpha);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }

  drawTentacles(g, zoom, now) {
    for (const tn of this.tentacles) {
      const [nx, ny] = tn.cluster.worldNode(tn.node);
      let p = easeOutCubic(clamp((now - tn.t0) / 520, 0, 1));
      if (tn.retract) p *= 1 - easeOutCubic(clamp((now - tn.retract) / 450, 0, 1));
      if (p <= 0.01) continue;
      const sx = this.x, sy = this.y;
      const mx = (sx + nx) / 2, my = (sy + ny) / 2;
      const dx = nx - sx, dy = ny - sy;
      const cx = mx - dy * tn.bend, cy = my + dx * tn.bend;
      const len = Math.hypot(dx, dy);
      const spacing = 5.5;
      const n = Math.max(2, Math.floor((len * p) / spacing));
      const flow = ((now / 60) % spacing) / spacing;
      const col = tn.flagged ? '255,61,129' : '235,240,255';
      for (let i = 0; i < n; i++) {
        const tt = ((i + flow) * spacing) / len;
        if (tt > p) break;
        const [x, y] = quadPoint(sx, sy, cx, cy, nx, ny, tt);
        const a = 0.35 + 0.55 * (i / n);
        g.fillStyle = `rgba(${col},${a * this.alpha})`;
        const s = 1.25 / Math.sqrt(zoom);
        g.fillRect(x - s / 2, y - s / 2, s, s);
      }
      if (p > 0.98) {
        g.strokeStyle = `rgba(${col},0.9)`;
        g.lineWidth = 1 / zoom;
        g.beginPath(); g.arc(nx, ny, 2.6, 0, TAU); g.stroke();
        g.fillStyle = `rgba(${col},1)`;
        g.fillRect(nx - 1, ny - 1, 2, 2);
      }
    }
  }

  drawBody(g, zoom, now, focused) {
    const a = this.alpha;
    const body = this.bodyRgb;
    // Legs: two-segment curve body -> knee -> foot with the knee pushed outward.
    g.lineWidth = 1.05 / Math.sqrt(zoom);
    for (const L of this.legs) {
      const ang = Math.atan2(L.fy - this.y, L.fx - this.x);
      const bx = this.x + Math.cos(ang) * 13, by = this.y + Math.sin(ang) * 10;
      const mx = (bx + L.fx) / 2, my = (by + L.fy) / 2;
      const knee = 7 + L.lift * 9;
      const kx = mx + Math.cos(ang) * knee * 0.3 - Math.sin(ang) * knee * 0.5;
      const ky = my + Math.sin(ang) * knee * 0.3 + Math.cos(ang) * knee * 0.5;
      g.strokeStyle = rgba(body, 0.75 * a);
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(kx, ky, L.fx, L.fy); g.stroke();
      g.fillStyle = rgba(body, 0.95 * a);
      g.fillRect(L.fx - 0.9, L.fy - 0.9, 1.8, 1.8);
    }

    g.save();
    g.translate(this.x, this.y);
    g.rotate(this.heading * 0.25);
    const rx = 17 + this.pulse * 3, ry = 13 + this.pulse * 2;
    // Glow
    const glow = g.createRadialGradient(0, 0, 4, 0, 0, 46);
    glow.addColorStop(0, rgba(body, 0.22 * a));
    glow.addColorStop(1, rgba(body, 0));
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.fill();
    // Shell
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU);
    g.fillStyle = `rgba(3,14,16,${0.9 * a})`;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = rgba(body, 0.45 * a);
    g.lineWidth = 0.6;
    for (let i = -rx; i <= rx; i += 3) { g.beginPath(); g.moveTo(i, -ry); g.lineTo(i, ry); g.stroke(); }
    for (let j = -ry; j <= ry; j += 3) { g.beginPath(); g.moveTo(-rx, j); g.lineTo(rx, j); g.stroke(); }
    g.restore();
    g.strokeStyle = rgba(body, 0.95 * a);
    g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
    // Core diamond
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
      g.beginPath(); g.arc(this.x, this.y, 22 + (1 - this.pulse) * 40, 0, TAU); g.stroke();
    }
    if (focused) {
      const r = 34 + Math.sin(now / 300) * 2;
      g.strokeStyle = rgba(body, 0.5 * a);
      g.lineWidth = 1 / zoom;
      for (let i = 0; i < 4; i++) {
        const st = i * (Math.PI / 2) + now / 2000;
        g.beginPath(); g.arc(this.x, this.y, r, st, st + 0.5); g.stroke();
      }
    }
  }
}
