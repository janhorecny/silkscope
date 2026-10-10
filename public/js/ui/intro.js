// Intro: the crawler spins an orb web while the app loads. The capture spiral's completion is the
// real loading progress (renderer → stream → transcripts → history). START unlocks when ready;
// the replay of history only begins after it, so the user sees the scene build itself.

import { BRAND, CATEGORIES } from '../core/config.js';
import { TAU, clamp, damp, rgba, hexToRgb } from '../core/util.js';

const TEAL = hexToRgb(BRAND.spinneret), VENOM = hexToRgb(BRAND.venom), SILK = hexToRgb(BRAND.silk);
const DEW = CATEGORIES.map((c) => hexToRgb(c.color));
const SPOKES = 16, TURNS = 7;

export class Intro {
  constructor({ bus, settings, show }) {
    this.el = document.querySelector('#intro');
    this.active = show;
    this.covering = show;      // true while the intro fully hides the app (skip rendering it)
    this.progress = 0;         // target
    this.shown = 0;            // displayed (smoothed)
    this.readyAt = 0;
    this.t0 = performance.now();
    this.starters = [];
    if (!show) { this.el.remove(); return; }
    this.cv = this.el.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    this.btn = this.el.querySelector('.start');
    this.lines = Object.fromEntries([...this.el.querySelectorAll('[data-step]')].map((li) => [li.dataset.step, li]));
    this.spokes = Array.from({ length: SPOKES }, (_, i) => (i / SPOKES) * TAU + (Math.sin(i * 7.3) * 0.08));
    this.#size();
    window.addEventListener('resize', this.onResize = () => this.#size());

    this.step('renderer', 'done', '8 nebulae spun');
    this.step('stream', 'active', 'connecting…');
    this.progress = 0.22;
    bus.on('live', (on) => { if (!on && !this.isReady) this.step('stream', 'error', 'server not reachable · retrying'); });

    this.btn.addEventListener('click', () => this.start());
    this.el.querySelector('.skip input').addEventListener('change', (e) => settings.set('intro', e.target.checked ? 'skip' : 'show'));
    // Capture phase: while the intro is up, Enter/Space start it and no app hotkey fires underneath.
    window.addEventListener('keydown', this.onKey = (e) => {
      if (!this.active) return;
      e.stopImmediatePropagation();
      if ((e.key === 'Enter' || e.key === ' ') && this.isReady) { e.preventDefault(); this.start(); }
    }, true);
    this.raf = requestAnimationFrame((t) => this.#frame(t));
  }

  step(name, state, text) {
    const li = this.lines?.[name];
    if (!li) return;
    li.className = state;
    li.querySelector('em').textContent = text;
  }

  // First SSE hello: we know how much history there is.
  ready(hello) {
    if (!this.active || this.isReady) return;
    const demoOnly = !hello.sources.length && hello.demo;
    const agents = hello.sources.map((s) => s.agent).join(' + ') || (demoOnly ? 'demo' : 'no agent sources');
    this.step('stream', 'done', `connected · ${agents}`);
    this.step('transcripts', 'done', demoOnly ? 'not read · demo only' : `${(hello.files || 0).toLocaleString('en')} indexed`);
    const n = hello.history.length;
    const demo = hello.demo || new URLSearchParams(location.search).has('demo');
    this.step('history', 'done', n ? `${n.toLocaleString('en')} events ready to replay` : demo ? 'demo feed · 5 synthetic sessions ready' : 'no activity yet · the demo feed is one key away (D)');
    this.progress = 1;
    // Let the web finish spinning before START lights up (never less than ~1.4 s of intro).
    this.readyAt = Math.max(performance.now() + 450, this.t0 + 1400);
  }

  get isReady() { return this.readyAt > 0 && performance.now() >= this.readyAt; }

  onStart(fn) { if (!this.active) fn(); else this.starters.push(fn); }

  start() {
    if (!this.active || !this.isReady) return;
    this.active = false;
    this.covering = false;
    this.el.classList.add('leaving');
    for (const fn of this.starters.splice(0)) fn();
    setTimeout(() => {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('resize', this.onResize);
      this.el.remove();
    }, 900);
  }

  #size() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = r.width * this.dpr;
    this.cv.height = r.height * this.dpr;
    this.S = r.width;
  }

  #frame(now) {
    if (!this.el.isConnected) return;
    this.raf = requestAnimationFrame((t) => this.#frame(t));
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    // Slowly creep while waiting so the web never looks frozen, but never claim more than 92 %.
    if (this.progress < 1) this.progress = Math.min(0.92, this.progress + dt * 0.04);
    this.shown = damp(this.shown, this.progress, 2.2, dt);
    if (this.isReady && !this.btn.classList.contains('ready')) {
      this.btn.disabled = false;
      this.btn.classList.add('ready');
      this.el.classList.add('ready');
    }
    this.#draw(now / 1000);
  }

  #draw(t) {
    const g = this.g, S = this.S, c = S / 2, R = S * 0.46;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const intro = clamp((performance.now() - this.t0) / 900, 0, 1);

    // Spokes grow out first.
    g.lineWidth = 0.8;
    for (const a of this.spokes) {
      const len = R * intro;
      g.strokeStyle = rgba(SILK, 0.22);
      g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len); g.stroke();
    }

    // Capture spiral, outside-in like an orb weaver, polygonal between spokes. Length = progress.
    const total = SPOKES * TURNS;
    const drawn = Math.floor(total * this.shown);
    const rAt = (k) => R * (0.96 - 0.78 * (k / total));
    const pt = (k) => { const a = this.spokes[k % SPOKES]; return [c + Math.cos(a) * rAt(k), c + Math.sin(a) * rAt(k)]; };
    g.strokeStyle = rgba(SILK, 0.5);
    g.lineWidth = 0.9;
    g.beginPath();
    for (let k = 0; k <= drawn; k++) { const [x, y] = pt(k); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    // Dew drops in the section colours, glinting along the finished spiral.
    for (let k = 0; k <= drawn; k += 3) {
      const [x, y] = pt(k);
      const glint = 0.5 + 0.5 * Math.sin(t * 3 - k * 0.35);
      g.fillStyle = rgba(DEW[k % DEW.length], 0.25 + glint * 0.7);
      g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
    // The thread being laid right now leads back to the spinneret.
    if (drawn < total) {
      const [x, y] = pt(drawn);
      g.strokeStyle = rgba(TEAL, 0.7);
      g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(c, c); g.lineTo(x, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgba(TEAL, 1);
      g.fillRect(x - 2, y - 2, 4, 4);
    }

    // The crawler.
    const glow = g.createRadialGradient(c, c, 4, c, c, 70);
    glow.addColorStop(0, rgba(TEAL, 0.3)); glow.addColorStop(1, rgba(TEAL, 0));
    g.fillStyle = glow; g.beginPath(); g.arc(c, c, 70, 0, TAU); g.fill();
    const rx = 24, ry = 19;
    g.lineWidth = 1.3;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU, w = Math.sin(t * 2.4 + i * 1.3) * 0.35;
      const len = 20 + (i % 3) * 7;
      const bx = c + Math.cos(a) * rx, by = c + Math.sin(a) * ry;
      const tx = bx + Math.cos(a + w) * len, ty = by + Math.sin(a + w) * len;
      g.strokeStyle = rgba(TEAL, 0.75);
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + Math.cos(a) * len * 0.55, by + Math.sin(a) * len * 0.55, tx, ty); g.stroke();
      g.fillStyle = rgba(TEAL, 1); g.fillRect(tx - 1, ty - 1, 2, 2);
    }
    g.save();
    g.beginPath(); g.ellipse(c, c, rx, ry, 0, 0, TAU);
    g.fillStyle = '#031012'; g.fill(); g.clip();
    g.strokeStyle = rgba(TEAL, 0.45); g.lineWidth = 0.6;
    for (let i = -rx; i <= rx; i += 3.4) { g.beginPath(); g.moveTo(c + i, c - ry); g.lineTo(c + i, c + ry); g.stroke(); }
    for (let j = -ry; j <= ry; j += 3.4) { g.beginPath(); g.moveTo(c - rx, c + j); g.lineTo(c + rx, c + j); g.stroke(); }
    g.restore();
    g.strokeStyle = rgba(TEAL, 1); g.lineWidth = 2;
    g.beginPath(); g.ellipse(c, c, rx, ry, 0, 0, TAU); g.stroke();
    const s = 10 + Math.sin(t * 4) * 1.2 + (this.isReady ? Math.sin(t * 7) * 1.5 : 0);
    g.save(); g.translate(c, c); g.rotate(Math.PI / 4 + Math.sin(t) * 0.15);
    g.shadowColor = rgba(VENOM, 0.9); g.shadowBlur = 16;
    g.fillStyle = rgba(VENOM, 1); g.fillRect(-s / 2, -s / 2, s, s);
    g.restore();
  }
}
