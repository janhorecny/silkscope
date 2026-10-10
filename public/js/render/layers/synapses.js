// The neural graph: synapses between targets (faint under the crawler view, the main subject of
// the neural view), neurons as glowing points (neural view only) and the signals that cascade
// along synapses when a target fires.

import { FLAG } from '../../core/config.js';
import { TAU, clamp, hexToRgb, rgba, rgbaQ, quadAt } from '../../core/util.js';

const BANDS = 8;
const CROSS_RGB = [205, 215, 235];
const FLAG_RGB = hexToRgb(FLAG);
const WHITE = [255, 255, 255];

function glowSprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, rgba(WHITE, 1));
  grad.addColorStop(0.12, rgba(rgb, 0.9));
  grad.addColorStop(0.4, rgba(rgb, 0.25));
  grad.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class SynapsesLayer {
  id = 'synapses';
  views = ['crawler', 'neural'];

  constructor(world) {
    const L = world.clusterList;
    this.glow = L.map((c) => glowSprite(c.rgb));
    this.flagGlow = glowSprite(FLAG_RGB);
    // Synapses are batched by colour (one per cluster + one for cross-section links) and alpha band:
    // a handful of strokes per frame. Buckets keep their typed buffers between frames.
    this.buckets = [];
    for (let col = 0; col <= L.length; col++) {
      const rgb = col < L.length ? L[col].rgb : CROSS_RGB;
      for (let band = 0; band < BANDS; band++) {
        this.buckets.push({ style: rgba(rgb, (band + 0.5) / 10), buf: new Float64Array(96), n: 0 });
      }
    }
    this.cross = L.length;
  }

  pixels() { return this.glow.length * 64 * 64; }

  draw(g, w) {
    this.#synapses(g, w);
    if (w.neural) this.#neurons(g, w);
    this.#signals(g, w);
  }

  #synapses(g, w) {
    const syn = w.world.synapses;
    if (!syn.size) return;
    const now = w.now, v = w.view, neural = w.neural;
    const strength = neural ? 1 : 0.32;
    const buckets = this.buckets;
    for (const s of syn.values()) {
      const A = s.a, B = s.b;
      const ax = A.cluster.x + A.x, ay = A.cluster.y + A.y, bx = B.cluster.x + B.x, by = B.cluster.y + B.y;
      if (Math.max(ax, bx) < v.x0 || Math.min(ax, bx) > v.x1 || Math.max(ay, by) < v.y0 || Math.min(ay, by) > v.y1) continue;
      const recent = clamp(1 - (now - s.last) / 6000, 0, 1);
      const al = (0.05 + Math.min(0.25, Math.log1p(s.w) * 0.07) + recent * 0.35 + ((A.act || 0) + (B.act || 0)) * 0.22) * strength;
      if (al < 0.02) continue;
      const band = Math.min(7, Math.floor(al * 10));
      const col = A.cluster === B.cluster ? A.cluster.index : this.cross;
      const bk = buckets[col * BANDS + band];
      if (bk.n + 6 > bk.buf.length) { const nb = new Float64Array(bk.buf.length * 2); nb.set(bk.buf); bk.buf = nb; }
      const cx = (ax + bx) / 2 - (by - ay) * s.bend, cy = (ay + by) / 2 + (bx - ax) * s.bend;
      const b = bk.buf; let i = bk.n;
      b[i++] = ax; b[i++] = ay; b[i++] = cx; b[i++] = cy; b[i++] = bx; b[i++] = by;
      bk.n = i;
    }
    // Additive blending is order independent, so a fixed bucket order draws the same picture.
    g.lineWidth = (neural ? 0.7 : 0.5) / Math.sqrt(w.z);
    for (const bk of buckets) {
      if (!bk.n) continue;
      const b = bk.buf;
      g.strokeStyle = bk.style;
      g.beginPath();
      for (let i = 0; i < bk.n; i += 6) { g.moveTo(b[i], b[i + 1]); g.quadraticCurveTo(b[i + 2], b[i + 3], b[i + 4], b[i + 5]); }
      g.stroke();
      bk.n = 0;
    }
  }

  #neurons(g, w) {
    const now = w.now, v = w.view, sq = Math.sqrt(w.z);
    for (const c of w.world.clusterList) {
      const glow = this.glow[c.index];
      for (const n of c.recent) {
        const x = c.x + n.x, y = c.y + n.y;
        if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
        const act = n.act || 0;
        const r = (1.6 + Math.log1p(n.hits) * 1.1) / sq;
        const fresh = clamp(1 - (now - n.lastHit) / 8000, 0, 1);
        const gs = (r * 7 + 30 * act) * (1 + fresh * 0.4);
        g.globalAlpha = Math.min(1, 0.12 + act * 0.7 + fresh * 0.25);
        g.drawImage(n.flagged ? this.flagGlow : glow, x - gs / 2, y - gs / 2, gs, gs);
        g.globalAlpha = 1;
        g.fillStyle = n.flagged ? rgbaQ(FLAG_RGB, 1) : rgbaQ(c.rgb, Math.min(1, 0.55 + act));
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
    }
  }

  #signals(g, w) {
    const now = w.now, neural = w.neural;
    const q = (neural ? 3 : 2.2) / Math.sqrt(w.z);
    const tail = neural ? 5 : 3;
    for (const s of w.world.signals) {
      const p = clamp((now - s.t0) / s.dur, 0, 1);
      const A = s.from, B = s.to;
      const ax = A.cluster.x + A.x, ay = A.cluster.y + A.y, bx = B.cluster.x + B.x, by = B.cluster.y + B.y;
      const bend = s.s.a === A ? s.s.bend : -s.s.bend;
      const cx = (ax + bx) / 2 - (by - ay) * bend, cy = (ay + by) / 2 + (bx - ax) * bend;
      const rgb = B.cluster.rgb;
      for (let k = 0; k < tail; k++) {
        const pp = clamp(p - k * 0.03, 0, 1);
        const x = quadAt(ax, cx, bx, pp), y = quadAt(ay, cy, by, pp);
        g.fillStyle = rgbaQ(k ? rgb : WHITE, (1 - k / tail) * Math.min(1, s.e + 0.3) * (neural ? 1 : 0.7));
        const qq = q * (1 - k / (tail + 1));
        g.fillRect(x - qq / 2, y - qq / 2, qq, qq);
      }
    }
  }
}
