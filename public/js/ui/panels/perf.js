// PERF panel: frame timing graph, browser heap, server process health and object counts.
// Sampling is always on (two numbers per frame); the DOM is only touched while open.

import { Panel, setText, setClass } from '../panel.js';
import { BRAND } from '../../core/config.js';

const MB = (b) => (b / 1048576).toFixed(b < 100 * 1048576 ? 1 : 0) + ' MB';
const IDS = ['pfQ', 'pfFps', 'pfFrame', 'pfCpu', 'pfCanvas', 'pfHeap', 'pfHeapTrend', 'pfRss', 'pfSHeap', 'pfSCpu', 'pfFiles', 'pfRaw', 'pfNodes', 'pfSyn', 'pfSig', 'pfSp'];

export class PerfPanel extends Panel {
  id = 'perf';

  constructor(ctx) {
    super(ctx, { el: '#perf' });
    this.N = 240;
    this.gap = new Float32Array(this.N);
    this.cpu = new Float32Array(this.N);
    this.i = 0;
    this.prev = 0;
    this.heap = [];   // [t, usedBytes] once per second
    this.server = null;
    this.open = false;
    this.g = this.$('#pfGraph').getContext('2d');
    this.f = Object.fromEntries(IDS.map((id) => [id, this.$('#' + id)]));
    this.btn = document.querySelector('#bPerf');
    ctx.bus.on('ping', (stats) => { this.server = stats; });
    ctx.bus.on('toggle', (what) => { if (what === 'perf') this.toggle(); });
    setInterval(() => this.#heapSample(), 1000);
  }

  // Called once per animation frame with the JS time spent in update + draw + HUD.
  sample(now, cpuMs) {
    const gap = this.prev ? now - this.prev : 16.7;
    this.prev = now;
    if (gap > 250) return; // tab was hidden; not a real frame
    this.gap[this.i] = gap;
    this.cpu[this.i] = cpuMs;
    this.i = (this.i + 1) % this.N;
  }


  toggle() {
    this.open = !this.open;
    this.el.hidden = !this.open;
    this.btn.classList.toggle('on', this.open);
  }

  #heapSample() {
    const m = performance.memory;
    if (!m) return;
    this.heap.push([performance.now(), m.usedJSHeapSize]);
    if (this.heap.length > 120) this.heap.shift();
  }

  // MB per minute over the last two minutes (least squares), to spot leaks.
  #heapTrend() {
    const h = this.heap;
    if (h.length < 20) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [t, y] of h) { sx += t; sy += y; sxx += t * t; sxy += t * y; }
    const n = h.length;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx); // bytes per ms
    return (slope * 60000) / 1048576;
  }

  #stats(arr) {
    let sum = 0, n = 0, max = 0;
    const sorted = [];
    for (const v of arr) if (v > 0) { sum += v; n++; if (v > max) max = v; sorted.push(v); }
    sorted.sort((a, b) => a - b);
    return { avg: n ? sum / n : 0, max, p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0 };
  }

  update({ scene, feed }) {
    if (!this.open) return;
    const gap = this.#stats(this.gap), cpu = this.#stats(this.cpu);
    const fps = gap.avg ? 1000 / gap.avg : 0;
    const set = (id, text, cls = '') => { setText(this.f[id], text); setClass(this.f[id], cls); };
    set('pfFps', `${fps.toFixed(0)}  (worst ${gap.max ? (1000 / gap.max).toFixed(0) : '–'})`, fps < 40 ? 'bad' : fps < 55 ? 'warn' : '');
    set('pfFrame', `${gap.avg.toFixed(1)} ms · p95 ${gap.p95.toFixed(1)}`);
    set('pfCpu', `${cpu.avg.toFixed(2)} ms · p95 ${cpu.p95.toFixed(2)}`, cpu.p95 > 10 ? 'warn' : '');
    const q = scene.quality === 1 ? 'full' : scene.quality > 0 ? 'eco' : 'min';
    set('pfQ', `quality ${q}`, q === 'full' ? 'mint' : q === 'eco' ? 'amber' : 'pink');
    set('pfCanvas', `${scene.W | 0}×${scene.H | 0} @${scene.dpr}x · ~${MB(scene.bitmapPixels() * 4)} bitmaps`);

    const m = performance.memory;
    if (m) {
      const pct = (m.usedJSHeapSize / m.jsHeapSizeLimit) * 100;
      set('pfHeap', `${MB(m.usedJSHeapSize)} / ${MB(m.totalJSHeapSize)} (${pct.toFixed(1)}% of limit)`, pct > 60 ? 'bad' : pct > 30 ? 'warn' : '');
      const tr = this.#heapTrend();
      set('pfHeapTrend', tr == null ? 'measuring…' : `${tr >= 0 ? '+' : ''}${tr.toFixed(2)} MB/min`, tr != null && tr > 2 ? 'warn' : '');
    } else {
      set('pfHeap', 'n/a (Chrome only)');
      set('pfHeapTrend', '–');
    }
    const s = this.server;
    if (s) {
      set('pfRss', MB(s.rss), s.rss > 500 * 1048576 ? 'warn' : '');
      set('pfSHeap', `${MB(s.heapUsed)} / ${MB(s.heapTotal)}`);
      set('pfSCpu', `${s.cpu.toFixed(1)} %`, s.cpu > 25 ? 'warn' : '');
      set('pfFiles', `${s.files} (${s.active} active)`);
    }
    const c = scene.counts();
    set('pfRaw', `${feed.raw.length} browser · ${s ? s.history : '–'} server`);
    set('pfNodes', String(c.nodes));
    set('pfSyn', String(c.synapses));
    set('pfSig', `${c.signals} · ${c.bursts}`);
    set('pfSp', `${c.spiders} · ${c.tentacles}`);
    this.#graph();
  }

  #graph() {
    const g = this.g, cv = g.canvas;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * 2) { cv.width = w * 2; cv.height = h * 2; }
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, w, h);
    const maxMs = 50;
    const y = (ms) => h - Math.min(ms, maxMs) / maxMs * (h - 4) - 2;
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(0, y(16.7)); g.lineTo(w, y(16.7)); g.stroke();
    g.beginPath(); g.moveTo(0, y(33.3)); g.lineTo(w, y(33.3)); g.stroke();
    g.setLineDash([]);
    const line = (arr, color) => {
      g.strokeStyle = color; g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < this.N; k++) {
        const v = arr[(this.i + k) % this.N];
        const x = (k / (this.N - 1)) * w;
        k ? g.lineTo(x, y(v)) : g.moveTo(x, y(v));
      }
      g.stroke();
    };
    line(this.gap, BRAND.spinneret);
    line(this.cpu, BRAND.warn);
    g.fillStyle = '#6b7383';
    g.font = '8px "JetBrains Mono", monospace';
    g.fillText('60fps', 2, y(16.7) - 2);
    g.fillText('30fps', 2, y(33.3) - 2);
  }
}
