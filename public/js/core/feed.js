// The event pipeline between the stream and everything that draws. Keeps every raw event (so
// switching instance can rebuild instantly), a per-session index for the instance picker that is
// independent of the current filter, the watched instance and the agents filter, the history
// replay and the demo feed. Everything downstream learns about events through the bus.

import { startDemo } from './demo.js';

const RAW_MAX = 8000;
const RECENT_MS = 30 * 60e3;
const LS_INSTANCE = 'swarm.instance';

export class Feed {
  constructor({ store, bus, settings }) {
    this.store = store;
    this.bus = bus;
    this.settings = settings;
    this.raw = [];
    this.sessions = new Map();
    this.filter = null;
    this.started = false; // first hello processed; before that a rebuild has nothing to show
    this.stopDemo = null;
    bus.on('setting', ({ key, value }) => {
      if (key === 'demo') this.setDemo(value === 'on');
      else if (key === 'agents' && this.started) this.rebuild();
    });
  }

  get demoOn() { return !!this.stopDemo; }

  // Which events feed the map and HUD: the watched instance (if any) and the agents setting.
  passes(ev) {
    if (this.filter && ev.session !== this.filter) return false;
    const a = this.settings.get('agents');
    return a === 'all' || ev.agent === a;
  }

  ingest(ev, animate = true) {
    this.raw.push(ev);
    if (this.raw.length > RAW_MAX) this.raw = this.raw.slice(-RAW_MAX * 0.9);
    this.#track(ev);
    if (this.passes(ev)) this.#apply(ev, animate);
  }

  // Sessions for the instance picker, most recent first.
  instances() { return [...this.sessions.values()].sort((a, b) => b.lastTs - a.lastTs); }

  // Silent rebuild of the whole picture for the current filter.
  rebuild() {
    this.store.reset();
    this.bus.emit('reset');
    for (const ev of this.raw) if (this.passes(ev)) this.#apply(ev, false);
    this.bus.emit('rebuild', { sessions: this.#recent() });
  }

  watch(id) {
    this.filter = id || null;
    try { localStorage.setItem(LS_INSTANCE, this.filter || ''); } catch {}
    this.rebuild();
    this.bus.emit('watch', { id: this.filter, session: this.filter && this.sessions.get(this.filter), announce: true });
  }

  // History is folded in silently, then the tail is replayed with motion so the screen builds itself.
  replay(history) {
    const saved = (() => { try { return localStorage.getItem(LS_INSTANCE); } catch { return null; } })();
    for (const ev of history) { this.raw.push(ev); this.#track(ev); }
    if (saved && this.sessions.has(saved)) this.filter = saved;
    const mine = this.raw.filter((ev) => this.passes(ev));
    const ANIM = 60;
    const cut = Math.max(0, mine.length - ANIM);
    for (let i = 0; i < cut; i++) this.#apply(mine[i], false);
    this.bus.emit('rebuild', { sessions: this.#recent() });
    this.bus.emit('watch', { id: this.filter, session: this.filter && this.sessions.get(this.filter), announce: false });
    this.started = true;
    const tail = mine.slice(cut);
    if (!tail.length) return;
    this.bus.emit('replay', { count: mine.length });
    let i = 0;
    const step = () => {
      if (i >= tail.length) { this.bus.emit('replay', { done: true }); return; }
      this.#apply(tail[i++], true);
      setTimeout(step, 90);
    };
    step();
  }

  setDemo(on) {
    if (!on && this.stopDemo) { this.stopDemo(); this.stopDemo = null; this.bus.emit('demo', { on: false }); }
    else if (on && !this.stopDemo) {
      // Warm start folds a few minutes of finished demo work in silently, then parks the crawlers.
      this.stopDemo = startDemo((ev) => this.ingest(ev, true), { ...this.demoOptions, past: (ev) => this.ingest(ev, false) });
      if (this.demoOptions?.warm !== false) this.bus.emit('rebuild', { sessions: this.#recent() });
      this.bus.emit('demo', { on: true });
    }
  }

  #apply(ev, animate) {
    const res = this.store.ingest(ev);
    if (res.kind) this.bus.emit('event', { ev, res, animate });
  }

  #recent() {
    const now = Date.now();
    return [...this.store.sessions.values()].filter((s) => s.id === this.filter || now - s.lastTs < RECENT_MS);
  }

  #track(ev) {
    if (!ev.session || ev.cat === 'tokens') return;
    let s = this.sessions.get(ev.session);
    if (!s) this.sessions.set(ev.session, (s = { id: ev.session, agent: ev.agent, project: ev.project || '?', lastTs: 0, events: 0, lastCat: null, demo: !!ev.demo, model: '' }));
    if (ev.project) s.project = ev.project;
    if (ev.model) s.model = ev.model;
    s.lastTs = Math.max(s.lastTs, ev.ts);
    if (ev.cat !== 'result') { s.events++; s.lastCat = ev.cat; }
  }
}
