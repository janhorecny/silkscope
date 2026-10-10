// Braided strands between sections, brighter where the swarm travels, with a packet running
// along a strand whenever a crawler changes section (world.pulses).

import { TAU, clamp, rand, noise2, rgbaQ, quadAt } from '../../core/util.js';

export class WebLayer {
  id = 'web';
  views = ['crawler', 'neural'];

  constructor(world) {
    // Every unordered cluster pair, with its store link key and blended colour precomputed.
    const L = world.clusterList;
    this.pairs = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      this.pairs.push({
        a, b, link: [a.key, b.key].sort().join('>'), far: Math.hypot(a.x - b.x, a.y - b.y) > 820,
        mid: [(a.rgb[0] + b.rgb[0]) / 2, (a.rgb[1] + b.rgb[1]) / 2, (a.rgb[2] + b.rgb[2]) / 2], st: null,
      });
    }
  }

  draw(g, w) {
    const t = w.now / 1000, now = w.now, z = w.z, links = w.world.store.links, pulses = w.world.pulses;
    g.lineWidth = 0.6 / z;
    for (const pr of this.pairs) {
      const a = pr.a, b = pr.b;
      const lw = links.get(pr.link) || 0;
      if (pr.far && !lw) continue;
      // Strands are created lazily, the first time the pair is drawn.
      const st = pr.st || (pr.st = Array.from({ length: 3 }, (_, k) => ({
        ax: rand(-0.35, 0.35) * a.R, ay: rand(-0.35, 0.35) * a.R,
        bx: rand(-0.35, 0.35) * b.R, by: rand(-0.35, 0.35) * b.R, bend: rand(-0.28, 0.28), ph: rand(TAU), k,
      })));
      const use = Math.min(1, Math.log1p(lw) / 4);
      const base = 0.025 + use * 0.07;
      g.strokeStyle = rgbaQ(pr.mid, base * (0.4 + (a.lit + b.lit) / 2));
      g.beginPath();
      let gx0 = 0, gy0 = 0, gcx = 0, gcy = 0, gx1 = 0, gy1 = 0;
      for (let i = 0; i < st.length; i++) {
        const s = st[i];
        const x0 = a.x + s.ax, y0 = a.y + s.ay, x1 = b.x + s.bx, y1 = b.y + s.by;
        const bend = s.bend + noise2(s.ph, t * 0.07) * 0.08;
        const cx = (x0 + x1) / 2 - (y1 - y0) * bend, cy = (y0 + y1) / 2 + (x1 - x0) * bend;
        g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1);
        if (i === 0) { gx0 = x0; gy0 = y0; gcx = cx; gcy = cy; gx1 = x1; gy1 = y1; }
      }
      g.stroke();
      // Packets ride the first strand.
      for (const pl of pulses) {
        if (!((pl.a === a && pl.b === b) || (pl.a === b && pl.b === a))) continue;
        const p = clamp((now - pl.t0) / 1600, 0, 1);
        const rev = pl.a === b;
        for (let k = 0; k < 8; k++) {
          let pp = clamp(p - k * 0.012, 0, 1);
          if (rev) pp = 1 - pp;
          const x = quadAt(gx0, gcx, gx1, pp), y = quadAt(gy0, gcy, gy1, pp);
          g.fillStyle = rgbaQ(pl.rgb, 0.95 - k * 0.11);
          const q = (3.6 - k * 0.38) / Math.sqrt(z);
          g.fillRect(x - q / 2, y - q / 2, q, q);
        }
      }
    }
  }
}
