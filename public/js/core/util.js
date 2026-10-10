export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
// Frame-rate independent exponential smoothing.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

// Seeded PRNG so every cluster's nebula is stable across reloads.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Compact 2D value noise with smooth interpolation (good enough for wobble and density).
const P = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  const h = (i, j) => P[(P[(X + i) & 255] + Y + j) & 255] / 255;
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v) * 2 - 1;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2; a *= 0.5; }
  return s;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));

export function quadPoint(x0, y0, cx, cy, x1, y1, t) {
  const mt = 1 - t;
  return [mt * mt * x0 + 2 * mt * t * cx + t * t * x1, mt * mt * y0 + 2 * mt * t * cy + t * t * y1];
}

// One coordinate of a quadratic bézier; the scalar twin of quadPoint for hot loops (no array).
export const quadAt = (a, c, b, t) => { const mt = 1 - t; return mt * mt * a + 2 * mt * t * c + t * t * b; };

// Cached CSS colour strings for hot draw loops. Alpha snaps to 1/1000, far below what an 8-bit
// canvas can resolve, so thousands of per-frame template strings become table lookups.
// Keys are the rgb arrays themselves: pass long-lived arrays (cluster/agent colours, constants).
const RGBA = new WeakMap();
export function rgbaQ(rgb, a) {
  let t = RGBA.get(rgb);
  if (!t) RGBA.set(rgb, (t = new Array(1001)));
  const i = a > 0 ? (a < 1 ? Math.round(a * 1000) : 1000) : 0;
  return t[i] || (t[i] = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${i / 1000})`);
}

// Bumped when a web font finishes loading, so cached text widths can be re-measured.
export const fontEpoch = { v: 0 };
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => { fontEpoch.v++; }); // no-op outside a browser (tests)
