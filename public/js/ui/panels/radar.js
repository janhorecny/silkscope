// COVERAGE RADAR: share of events per section on a polar chart, plus agents / flags bars.
// The chart is redrawn only when its inputs change.

import { CATEGORIES, BRAND } from '../../core/config.js';
import { TAU } from '../../core/util.js';
import { Panel, setText, setStyle, fitCanvas } from '../panel.js';

export class RadarPanel extends Panel {
  id = 'radar';

  constructor(ctx) {
    super(ctx, {
      title: 'COVERAGE RADAR', badge: 'live',
      body: `<canvas id="radar"></canvas>
      <div class="mini"><span>agents</span><div class="track"><div id="agentsBar" class="fill mintbg"></div></div><b id="agentsN">0</b></div>
      <div class="mini"><span>flags</span><div class="track"><div id="flagsBar" class="fill pinkbg"></div></div><b id="flagsN">0</b></div>`,
    });
    this.g = this.$('#radar').getContext('2d');
    this.agentsBar = this.$('#agentsBar'); this.agentsN = this.$('#agentsN');
    this.flagsBar = this.$('#flagsBar'); this.flagsN = this.$('#flagsN');
    this.key = '';
  }

  update({ store: s, scene, active }) {
    const cv = this.g.canvas;
    const key = `${cv.clientWidth}x${cv.clientHeight}|${active?.key}|${CATEGORIES.map((c) => s.cats[c.key].count).join(',')}`;
    if (key !== this.key) { this.key = key; this.#draw(s, active); }
    const n = scene.spiders.size;
    setStyle(this.agentsBar, 'width', `${Math.min(100, n * 20)}%`);
    setText(this.agentsN, n);
    setStyle(this.flagsBar, 'width', `${Math.min(100, s.flags * 3)}%`);
    setText(this.flagsN, s.flags);
  }

  #draw(store, active) {
    const g = this.g;
    const [w, h] = fitCanvas(g);
    const cx = w / 2, cy = h / 2 + 2, R = Math.min(w, h) / 2 - 16;
    const n = CATEGORIES.length;
    g.strokeStyle = '#252a33'; g.lineWidth = 1;
    for (let ring = 1; ring <= 4; ring++) {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU - Math.PI / 2, r = (R * ring) / 4;
        i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
    }
    const max = Math.max(1, ...Object.values(store.cats).map((c) => c.count));
    g.beginPath();
    CATEGORIES.forEach((c, i) => {
      const a = (i / n) * TAU - Math.PI / 2;
      const v = Math.sqrt(store.cats[c.key].count / max);
      const r = R * (0.08 + 0.92 * v);
      i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    });
    g.closePath();
    g.fillStyle = 'rgba(63,224,192,0.55)'; g.fill();
    g.strokeStyle = BRAND.spinneret; g.stroke();
    g.font = '8px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    CATEGORIES.forEach((c, i) => {
      const a = (i / n) * TAU - Math.PI / 2;
      g.fillStyle = active?.key === c.key ? c.color : '#7d8594';
      g.fillText(c.code, cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9) + 3);
    });
  }
}
