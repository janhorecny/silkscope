// The nebulae: cross-faded pre-rendered sprites (dormant grey / lit colour), live twinkling stars
// that brighten near the cursor, target dots, blinking pending markers and the faint web of lines
// from the cursor to nearby stars. The neural view keeps only a dimmed sprite.

import { FLAG, PENDING_RGB } from '../../core/config.js';
import { clamp, hexToRgb, rgbaQ } from '../../core/util.js';

const FLAG_RGB = hexToRgb(FLAG);
const WHITE = [255, 255, 255];
const STAR_LIT = [235, 240, 255];
const STAR_DIM = [190, 196, 210];

export class ClustersLayer {
  id = 'clusters';
  views = ['crawler', 'neural'];

  draw(g, w) {
    const v = w.view;
    for (const c of w.world.clusterList) {
      const m = c.R * 1.2;
      if (c.x + m < v.x0 || c.x - m > v.x1 || c.y + m < v.y0 || c.y - m > v.y1) continue;
      this.#cluster(g, c, w);
    }
    if (w.quality > 0 && !w.neural) this.#cursorWeb(g, w);
  }

  #cluster(g, c, w) {
    const now = w.now, t = now / 1000, z = w.z, neural = w.neural;
    const size = c.spriteSize * (1 + Math.sin(t * 0.4 + c.seed) * 0.008);
    const x = c.x - size / 2, y = c.y - size / 2;
    const fade = neural ? 0.28 : 1;
    const dimA = 0.55 * (1 - c.lit * 0.85) * fade;
    if (dimA > 0.02) { g.globalAlpha = dimA; g.drawImage(c.spriteDim, x, y, size, size); }
    const litA = (c.lit * (0.3 + 0.6 * c.activeT + 0.25 * c.heat) + c.flash * 0.6) * fade;
    if (litA > 0.02) { g.globalAlpha = Math.min(1, litA); g.drawImage(c.spriteLit, x, y, size, size); }
    g.globalAlpha = 1;
    if (neural) return;

    const mx = w.mouse.wx - c.x, my = w.mouse.wy - c.y;
    const sq = Math.sqrt(z);
    const starRgb = c.lit > 0.5 ? STAR_LIT : STAR_DIM;
    for (const s of c.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const near = clamp(1 - Math.hypot(s.x - mx, s.y - my) * z / 110, 0, 1);
      const a = (0.25 + tw * 0.55) * (0.5 + c.lit * 0.5) + near * 0.6;
      const sz = (s.s + near * 1.5) / sq;
      g.fillStyle = rgbaQ(near > 0 ? WHITE : starRgb, a);
      g.fillRect(c.x + s.x - sz / 2, c.y + s.y - sz / 2, sz, sz);
    }
    // Draw order inside the additive pass does not matter, so walk the recency array (no iterator).
    for (const n of c.recent) {
      const fresh = clamp(1 - (now - n.lastHit) / 8000, 0, 1);
      const nx = c.x + n.x, ny = c.y + n.y;
      const s = (1.4 + fresh * 2.4 + Math.min(2, Math.log1p(n.hits) * 0.5) + n.act * 2) / sq;
      g.fillStyle = n.flagged ? rgbaQ(FLAG_RGB, 0.9) : rgbaQ(c.rgb, Math.min(1, 0.35 + fresh * 0.65 + n.act * 0.5));
      g.fillRect(nx - s / 2, ny - s / 2, s, s);
      if (n.pending > 0) {
        const blink = 0.55 + 0.45 * Math.sin(now / 160 + n.x);
        const q = 5 / sq;
        g.fillStyle = rgbaQ(PENDING_RGB, blink);
        g.fillRect(nx + 6 - q / 2, ny - 6 - q / 2, q, q);
      }
    }
  }

  #cursorWeb(g, w) {
    if (w.mouse.x < 0) return;
    const mx = w.mouse.wx, my = w.mouse.wy, z = w.z;
    g.lineWidth = 0.7 / z;
    for (const c of w.world.clusterList) {
      if (Math.hypot(c.x - mx, c.y - my) > c.R * 1.3) continue;
      for (const s of c.stars) {
        const d = Math.hypot(c.x + s.x - mx, c.y + s.y - my) * z;
        if (d > 110) continue;
        g.strokeStyle = rgbaQ(c.rgb, (1 - d / 110) * 0.6);
        g.beginPath(); g.moveTo(mx, my); g.lineTo(c.x + s.x, c.y + s.y); g.stroke();
      }
    }
  }
}
