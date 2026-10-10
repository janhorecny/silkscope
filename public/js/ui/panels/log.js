// CRAWL LOG: the newest store log rows. Only new rows are inserted (and animated); existing rows
// are never re-rendered.

import { CAT, FLAG } from '../../core/config.js';
import { fmtTime } from '../../core/util.js';
import { Panel, esc } from '../panel.js';

export class LogPanel extends Panel {
  id = 'log';

  constructor(ctx) {
    super(ctx, { title: 'CRAWL LOG', badge: '0 e/s', badgeId: 'logRate', body: '<div id="log"></div>' });
    this.log = this.$('#log');
    this.reset();
  }

  reset() {
    this.log.innerHTML = '';
    this.logSeen = 0;
    this.lastTotal = 0;
    this.rate = 0;
  }

  update({ store: s }) {
    const rate = Math.max(0, s.total - this.lastTotal);
    this.lastTotal = s.total;
    this.rate = this.rate * 0.85 + rate * 4 * 0.15;
    this.badge(`${this.rate.toFixed(1)} e/s`);
    if (s.logSeq <= this.logSeen) return;
    const fresh = s.log.filter((e) => e.seq > this.logSeen).slice(-16);
    const bulk = fresh.length > 3;
    for (const e of fresh) {
      const c = e.status === 'error' && e.verb === 'flag' ? FLAG : CAT[e.cat]?.color || '#aaa';
      const row = document.createElement('div');
      row.className = bulk ? 'lr' : 'lr new';
      row.innerHTML = `<span class="t">${fmtTime(e.ts)}</span><span class="vb" style="color:${c}">${esc(String(e.verb || e.cat).slice(0, 9))}</span><span class="tg">${esc(e.target)}</span>`;
      this.log.prepend(row);
    }
    while (this.log.children.length > 16) this.log.lastElementChild.remove();
    this.logSeen = s.logSeq;
  }
}
