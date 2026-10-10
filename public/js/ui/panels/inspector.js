// Inspector (right): every hit on a target with input and result, or a crawler's session details
// with "watch only this instance". Opened by the scene (click) via the 'inspect' bus event.

import { fmtTime, fmtNum } from '../../core/util.js';
import { Panel, esc } from '../panel.js';

export class InspectorPanel extends Panel {
  id = 'inspector';

  constructor(ctx) {
    super(ctx, { el: '#inspector' });
    ctx.bus.on('inspect', (sel) => this.show(sel));
    ctx.bus.on('watch', ({ announce }) => { if (announce) this.show(null); });
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.x')) { ctx.scene.clearSelection(); this.el.hidden = true; return; }
      const b = e.target.closest('.watch');
      if (b) ctx.feed.watch(b.dataset.s);
    });
  }

  show(sel) {
    const el = this.el;
    if (!sel) { el.hidden = true; return; }
    el.hidden = false;
    if (sel.type === 'node') {
      const n = sel.node, c = n.cluster.cat;
      const evs = [...n.events].reverse().slice(0, 14);
      el.style.setProperty('--c', c.color);
      el.innerHTML = `<header><span class="k">${c.name}</span><button class="x">×</button></header>
        <h2>${esc(n.label)}</h2>
        <div class="meta"><span>${n.hits} hits</span><span>${n.flagged ? '<b class="flag">⚑ flagged</b>' : 'clean'}</span><span>${n.pending ? n.pending + ' pending' : ''}</span></div>
        <ol>${evs.map((e) => `<li class="${e.status}"><div><span class="t">${fmtTime(e.ts)}</span> <b>${esc(e.verb)}</b> <span class="ag">${esc(e.agent)} · ${esc(e.project)}</span> <span class="st">${e.status}</span></div>
          <pre>${esc(e.detail)}</pre>${e.result ? `<pre class="res">${esc(e.result)}</pre>` : ''}</li>`).join('')}</ol>`;
    } else if (sel.type === 'spider') {
      const sp = sel.spider, s = this.ctx.store.sessions.get(sp.session) || {};
      el.style.setProperty('--c', sp.style.body);
      el.innerHTML = `<header><span class="k">crawler</span><button class="x">×</button></header>
        <h2>${esc(sp.style.label)} · ${esc(sp.project)}</h2>
        <div class="kv"><span>session</span><b>${esc(String(sp.session).slice(0, 18))}</b>
        <span>model</span><b>${esc(s.model || '—')}</b>
        <span>events</span><b>${s.events || 0}</b>
        <span>tokens</span><b>${fmtNum(s.tokens || 0)}</b>
        <span>section</span><b>${sp.cluster ? sp.cluster.cat.name : '—'}</b>
        <span>queue</span><b>${sp.queue.length}</b>
        <span>last seen</span><b>${s.lastTs ? fmtTime(s.lastTs) : '—'}</b></div>
        <button class="watch" data-s="${esc(sp.session)}">watch only this instance</button>`;
    }
  }
}
