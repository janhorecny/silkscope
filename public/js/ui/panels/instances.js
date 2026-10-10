// Instance picker: watch everything, or one Claude/Codex session. Re-rendered only when what it
// shows changes (or a setting / the collapsed state does).

import { CAT, AGENTS } from '../../core/config.js';
import { Panel, esc, toggleClass } from '../panel.js';

const LS_COLLAPSED = 'swarm.collapsed';
const SHOWN = 12;

export class InstancesPanel extends Panel {
  id = 'instances';

  constructor(ctx) {
    super(ctx, { el: '#instances' });
    this.collapsed = (() => { try { return localStorage.getItem(LS_COLLAPSED) === '1'; } catch { return false; } })();
    this.key = '';
    ctx.bus.on('setting', () => { this.key = ''; });
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.col')) {
        this.collapsed = !this.collapsed;
        try { localStorage.setItem(LS_COLLAPSED, this.collapsed ? '1' : '0'); } catch {}
        this.key = '';
        return;
      }
      const b = e.target.closest('.inst');
      if (b) ctx.feed.watch(b.dataset.s || null);
    });
  }

  reset() { this.key = ''; }

  update({ now, feed }) {
    const all = feed.instances();
    const cur = feed.filter;
    const windowMin = +this.ctx.settings.get('window'), agents = this.ctx.settings.get('agents');
    const ago = (ts) => { const m = (now - ts) / 60e3; return m < 1 ? 'now' : m < 60 ? `${m | 0}m ago` : m < 1440 ? `${(m / 60) | 0}h ago` : `${(m / 1440) | 0}d ago`; };
    const list = all.filter((s) => (agents === 'both' || s.agent === agents) && (!windowMin || now - s.lastTs < windowMin * 60e3));
    const live = list.filter((s) => now - s.lastTs < 120e3).length;
    const shown = list.slice(0, SHOWN);
    if (cur && !shown.some((s) => s.id === cur)) { const c = all.find((s) => s.id === cur); if (c) shown.push(c); }
    const hidden = list.length - Math.min(SHOWN, list.length);
    const key = [cur, live, list.length, this.collapsed, ...shown.map((s) => s.id + s.lastCat + s.events + ago(s.lastTs))].join('|');
    if (key === this.key) return;
    this.key = key;
    toggleClass(this.el, 'collapsed', this.collapsed);
    this.el.innerHTML = `<header><span>INSTANCES</span><span><em>${live} live</em> / ${list.length} shown${hidden ? ` · ${hidden} more` : ''}<button class="col" title="Collapse / expand">${this.collapsed ? '+' : '−'}</button></span></header>
      <button class="inst all ${cur ? '' : 'on'}" data-s="" title="Every session at once, calm wide camera (A)"><i></i><b>all sessions</b><span>wide calm view</span><small></small></button>` +
      shown.map((s) => {
        const style = (AGENTS[s.agent] || AGENTS.claude).body;
        const isLive = now - s.lastTs < 120e3;
        const tip = `${s.agent} · ${s.project}${s.demo ? ' (synthetic demo)' : ''}\nsession ${s.id}${s.model ? '\nmodel ' + s.model : ''}\nlast section: ${s.lastCat || '—'} · ${s.events} events · last activity ${ago(s.lastTs)}`;
        return `<button class="inst ${s.id === cur ? 'on' : ''} ${isLive ? 'live' : ''}" data-s="${esc(s.id)}" style="--c:${style}" title="${esc(tip)}">
          <i></i><b>${esc(s.agent)}</b><span>${esc(s.project)}${s.demo ? '<em class="demo">DEMO</em>' : ''}</span><em style="color:${CAT[s.lastCat]?.color || '#777'}">${s.lastCat || '—'}</em><small>${s.events} ev · ${ago(s.lastTs)}</small></button>`;
      }).join('');
  }
}
