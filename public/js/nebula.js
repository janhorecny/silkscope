// A cluster is one nebula: a pre-rendered filament web (two tints: dormant grey and lit colour),
// a set of live twinkling stars, and the "word" nodes the crawlers touch.

import { CLUSTER_RADIUS } from './config.js';
import { mulberry32, hashStr, hexToRgb, rgba, fbm, TAU, gauss, clamp } from './util.js';

const SPRITE_SCALE = 1.25; // sprite pixels per world unit
const DORMANT = [150, 156, 172];

function buildPoints(seed, R) {
  const rnd = mulberry32(seed);
  const g = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  const blobs = [];
  const nb = 4 + ((rnd() * 4) | 0);
  for (let i = 0; i < nb; i++) {
    const a = rnd() * TAU, d = rnd() * R * 0.45;
    blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, sx: R * (0.18 + rnd() * 0.26), sy: R * (0.14 + rnd() * 0.24), rot: rnd() * TAU, w: 0.5 + rnd() });
  }
  const pts = [];
  const N = 2600;
  let guard = 0;
  while (pts.length < N && guard++ < N * 6) {
    const b = blobs[(rnd() * blobs.length) | 0];
    let x = g() * b.sx, y = g() * b.sy;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    [x, y] = [b.x + x * c - y * s, b.y + x * s + y * c];
    const r = Math.hypot(x, y);
    if (r > R * 1.05) continue;
    // Wispy density: noise carves voids and ridges so it reads as gas, not a blob.
    const n = fbm(x * 0.006 + seed * 0.001, y * 0.006, 4);
    if (rnd() > clamp(0.55 + n * 1.6, 0.05, 1)) continue;
    pts.push([x, y, rnd()]);
  }
  return pts;
}

function renderSprite(pts, R, rgb, intensity, seed) {
  const size = Math.ceil(R * 2.3 * SPRITE_SCALE);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const o = size / 2;
  g.translate(o, o);
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.globalCompositeOperation = 'lighter';

  const glow = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.05);
  glow.addColorStop(0, rgba(rgb, 0.10 * intensity));
  glow.addColorStop(0.5, rgba(rgb, 0.045 * intensity));
  glow.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = glow;
  g.beginPath(); g.arc(0, 0, R * 1.1, 0, TAU); g.fill();

  // Spatial hash for neighbour filaments.
  const cell = 24, grid = new Map();
  pts.forEach((p, i) => {
    const k = ((p[0] / cell) | 0) + ':' + ((p[1] / cell) | 0);
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  });
  g.lineWidth = 0.45;
  const maxD = 22;
  const rnd = mulberry32(seed ^ 0x9e37);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const cx = (x / cell) | 0, cy = (y / cell) | 0;
    let links = 0;
    for (let dx = -1; dx <= 1 && links < 3; dx++) for (let dy = -1; dy <= 1 && links < 3; dy++) {
      const arr = grid.get(cx + dx + ':' + (cy + dy));
      if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue;
        const d = Math.hypot(pts[j][0] - x, pts[j][1] - y);
        if (d < maxD && rnd() < 0.55) {
          g.strokeStyle = rgba(rgb, (1 - d / maxD) * 0.22 * intensity);
          g.beginPath(); g.moveTo(x, y); g.lineTo(pts[j][0], pts[j][1]); g.stroke();
          if (++links >= 3) break;
        }
      }
    }
  }
  // Long faint strands: the "cosmic web" texture across the cloud.
  g.lineWidth = 0.35;
  for (let k = 0; k < 70; k++) {
    const a = pts[(rnd() * pts.length) | 0], b = pts[(rnd() * pts.length) | 0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > R * 0.9) continue;
    g.strokeStyle = rgba(rgb, 0.05 * intensity);
    g.beginPath(); g.moveTo(a[0], a[1]);
    g.quadraticCurveTo((a[0] + b[0]) / 2 + (rnd() - 0.5) * 60, (a[1] + b[1]) / 2 + (rnd() - 0.5) * 60, b[0], b[1]);
    g.stroke();
  }
  for (const [x, y, w] of pts) {
    g.fillStyle = rgba(rgb, (0.25 + w * 0.45) * intensity);
    const s = 0.5 + w * 0.9;
    g.fillRect(x - s / 2, y - s / 2, s, s);
  }
  return cv;
}

export class Cluster {
  constructor(cat) {
    this.cat = cat;
    this.key = cat.key;
    this.x = cat.pos[0];
    this.y = cat.pos[1];
    this.R = CLUSTER_RADIUS;
    this.rgb = hexToRgb(cat.color);
    this.seed = hashStr(cat.key) & 0xffff;
    this.pts = buildPoints(this.seed, this.R);
    this.spriteLit = renderSprite(this.pts, this.R, this.rgb, 1, this.seed);
    this.spriteDim = renderSprite(this.pts, this.R, DORMANT, 0.55, this.seed);
    this.spriteSize = this.spriteLit.width / SPRITE_SCALE;
    const rnd = mulberry32(this.seed + 7);
    this.stars = Array.from({ length: 64 }, () => {
      const p = this.pts[(rnd() * this.pts.length) | 0];
      return { x: p[0], y: p[1], ph: rnd() * TAU, sp: 0.6 + rnd() * 2, s: 1 + rnd() * 1.6 };
    });
    this.nodes = new Map();
    this.count = 0;
    this.flags = 0;
    this.lit = 0;       // 0..1 colour mix (has any activity)
    this.heat = 0;      // decays; spikes on each event
    this.activeT = 0;   // 0..1 when this is the current section
    this.lastTs = 0;
  }

  node(target) {
    const key = target || '·';
    let n = this.nodes.get(key);
    if (!n) {
      // Place new words on the dense parts of the cloud, away from the exact centre.
      const p = this.pts[(Math.random() * this.pts.length) | 0];
      const j = 0.85;
      n = { key, label: key, cluster: this, x: p[0] * j + gauss() * 6, y: p[1] * j + gauss() * 6,
        hits: 0, born: performance.now(), lastHit: 0, flagged: false, pending: 0, events: [] };
      this.nodes.set(key, n);
      if (this.nodes.size > 220) {
        // Forget the coldest node so long sessions stay legible.
        let cold = null;
        for (const m of this.nodes.values()) if (!cold || m.lastHit < cold.lastHit) cold = m;
        if (cold && cold !== n) this.nodes.delete(cold.key);
      }
    }
    return n;
  }

  worldNode(n) { return [this.x + n.x, this.y + n.y]; }
}
