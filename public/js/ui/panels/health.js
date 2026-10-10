// SWARM HEALTH: tokens-per-minute sparkline (it breathes, so it redraws every tick) and the
// tool-call success-rate gauge.

import { fmtNum } from '../../core/util.js';
import { BRAND } from '../../core/config.js';
import { Panel, fitCanvas } from '../panel.js';

export class HealthPanel extends Panel {
  id = 'health';

  constructor(ctx) {
    super(ctx, { title: 'SWARM HEALTH', badge: 'live', badgeId: 'tokRate', body: '<canvas id="spark"></canvas><canvas id="gauge"></canvas>' });
    this.spark = this.$('#spark').getContext('2d');
    this.gauge = this.$('#gauge').getContext('2d');
    this.gv = null;
  }

  update({ store, heat }) {
    this.#spark(heat.tokens);
    this.#gauge(store.health);
    this.badge(`${fmtNum(heat.tokens[heat.tokens.length - 1])} tok/m`);
  }

  #spark(tokens) {
    const g = this.spark;
    const [w, h] = fitCanvas(g);
    const max = Math.max(1, ...tokens);
    const t = performance.now() / 1000;
    g.strokeStyle = BRAND.warn; g.lineWidth = 1.4;
    g.beginPath();
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const f = (i / N) * (tokens.length - 1);
      const a = tokens[Math.floor(f)], b = tokens[Math.min(tokens.length - 1, Math.ceil(f))];
      const v = (a + (b - a) * (f % 1)) / max;
      const y = h - 6 - v * (h - 14) + Math.sin(t * 2 + i * 0.4) * 1.5;
      i ? g.lineTo((i / N) * w, y) : g.moveTo(0, y);
    }
    g.stroke();
  }

  #gauge(v) {
    const g = this.gauge;
    const [w, h] = fitCanvas(g);
    const cx = w / 2, cy = h / 2 + 6, r = Math.min(w, h) / 2 - 8;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineWidth = 7; g.lineCap = 'butt';
    g.strokeStyle = '#1b2028';
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    this.gv = this.gv == null ? v : this.gv + (v - this.gv) * 0.2;
    g.strokeStyle = this.gv > 85 ? BRAND.spinneret : this.gv > 60 ? BRAND.warn : BRAND.venom;
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * (this.gv / 100)); g.stroke();
    g.fillStyle = '#eef1f6';
    g.textAlign = 'center';
    g.font = '600 22px "JetBrains Mono", monospace';
    g.fillText(Math.round(this.gv), cx, cy + 6);
    g.font = '8px "JetBrains Mono", monospace';
    g.fillStyle = '#7d8594';
    g.fillText('success rate', cx, cy + 20);
  }
}
