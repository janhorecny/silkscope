// SECTIONS: events (and flags) per section as bars; click to focus a section.

import { CATEGORIES } from '../../core/config.js';
import { Panel, setText, setStyle, toggleClass } from '../panel.js';

export class SectionsPanel extends Panel {
  id = 'sections';

  constructor(ctx) {
    super(ctx, {
      title: 'SECTIONS', badge: '0', badgeId: 'secCount',
      body: `<div id="sections">${CATEGORIES.map((c) =>
        `<div class="sec" data-k="${c.key}" style="--c:${c.color}"><div class="row"><span class="n">${c.name}</span><span class="v">0</span></div><div class="track"><div class="fill"></div></div></div>`).join('')}</div>`,
    });
    this.rows = [...this.el.querySelectorAll('.sec')].map((el) => ({ el, k: el.dataset.k, v: el.querySelector('.v'), fill: el.querySelector('.fill') }));
    this.$('#sections').addEventListener('click', (e) => {
      const s = e.target.closest('.sec');
      if (s) ctx.scene.focus(s.dataset.k);
    });
  }

  update({ store: s, active, overview }) {
    let max = 1, used = 0;
    for (const c of CATEGORIES) { const n = s.cats[c.key].count; if (n > max) max = n; if (n) used++; }
    for (const r of this.rows) {
      const c = s.cats[r.k];
      setText(r.v, `${c.count}${c.flags ? ` ⚑${c.flags}` : ''}`);
      setStyle(r.fill, 'width', `${(c.count / max) * 100}%`);
      toggleClass(r.el, 'on', active?.key === r.k && !overview);
    }
    this.badge(used);
  }
}
