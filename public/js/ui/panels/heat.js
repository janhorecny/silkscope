// ACTIVITY HEAT: events per section per minute over the last 12 minutes, events per minute,
// target and link counts.

import { CATEGORIES } from '../../core/config.js';
import { fmtNum, hexToRgb, rgba } from '../../core/util.js';
import { Panel, setText, setStyle } from '../panel.js';

export class HeatPanel extends Panel {
  id = 'heat';

  constructor(ctx) {
    super(ctx, {
      title: 'ACTIVITY HEAT', badge: '0', badgeClass: 'amber', badgeId: 'heatTotal',
      body: `<div id="heat">${CATEGORIES.map((c) => `<div class="hrow" data-k="${c.key}"><span>${c.code}</span>${'<b></b>'.repeat(12)}</div>`).join('')}</div>
      <div class="big"><small>events per minute</small><strong id="epm">0/m</strong></div>
      <div class="kv2"><span>targets</span><b id="hTargets">0</b><span>links</span><b id="hLinks" class="amber">0</b></div>`,
    });
    this.rows = CATEGORIES.map((c) => ({ k: c.key, rgb: hexToRgb(c.color), cells: [...this.el.querySelectorAll(`.hrow[data-k="${c.key}"] b`)] }));
    this.epm = this.$('#epm'); this.targets = this.$('#hTargets'); this.links = this.$('#hLinks');
  }

  update({ store: s, heat: h }) {
    let hmax = 1;
    for (const r of this.rows) for (const v of h.rows[r.k]) if (v > hmax) hmax = v;
    for (const r of this.rows) {
      const vals = h.rows[r.k];
      r.cells.forEach((b, i) => {
        const v = vals[i];
        setStyle(b, 'background', v ? rgba(r.rgb, 0.25 + 0.75 * Math.sqrt(v / hmax)) : '#161a21');
      });
    }
    setText(this.epm, `${Math.round(h.events[h.events.length - 1])}/m`);
    setText(this.targets, s.targetCount);
    setText(this.links, s.links.size);
    this.badge(fmtNum(s.total));
  }
}
