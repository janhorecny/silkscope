// Aggregates the event stream into the numbers the HUD shows.
import { CATEGORIES } from './config.js';

const MIN = 60e3;

export class Store {
  constructor() { this.reset(); }

  reset() {
    this.cats = Object.fromEntries(CATEGORIES.map((c) => [c.key, { count: 0, flags: 0, targets: new Set() }]));
    this.sessions = new Map();
    this.byId = new Map();
    this.log = [];
    this.logSeq = 0;
    this.buckets = new Map(); // minute -> { cats: {}, tokens, events }
    this.ok = 0;
    this.err = 0;
    this.pending = 0;
    this.links = new Map();
    this.total = 0;
    this.tokens = 0;
    this.flags = 0;
    this.lastEvent = null;
    this.firstTs = 0;
  }

  bucket(ts) {
    const m = Math.floor(ts / MIN);
    let b = this.buckets.get(m);
    if (!b) {
      b = { cats: {}, tokens: 0, events: 0 };
      this.buckets.set(m, b);
      if (this.buckets.size > 90) this.buckets.delete(this.buckets.keys().next().value);
    }
    return b;
  }

  session(ev) {
    let s = this.sessions.get(ev.session);
    if (!s) {
      s = { id: ev.session, agent: ev.agent, project: ev.project || '?', events: 0, tokens: 0, lastTs: 0, lastCat: null, model: '' };
      this.sessions.set(ev.session, s);
    }
    if (ev.project) s.project = ev.project;
    if (ev.model) s.model = ev.model;
    s.lastTs = Math.max(s.lastTs, ev.ts);
    return s;
  }

  // Returns { kind: 'action' | 'result' | 'tokens' | null, ... }
  ingest(ev) {
    if (!this.firstTs) this.firstTs = ev.ts;
    const s = this.session(ev);
    const b = this.bucket(ev.ts);
    if (ev.tokens) { this.tokens += ev.tokens; s.tokens += ev.tokens; b.tokens += ev.tokens; }

    if (ev.cat === 'tokens') return { kind: 'tokens', session: s };

    if (ev.cat === 'result') {
      const orig = this.byId.get(ev.ref);
      if (!orig) return { kind: null };
      // Some agents report one call's outcome twice (Codex: *_output and exec_command_end).
      // Count the first; a later one may only upgrade ok -> error.
      const prev = orig.ev.status;
      if (prev !== 'pending' && !(prev === 'ok' && ev.status === 'error')) return { kind: null };
      if (prev === 'pending') this.pending = Math.max(0, this.pending - 1);
      else this.ok = Math.max(0, this.ok - 1);
      orig.ev.status = ev.status;
      orig.ev.result = ev.detail;
      if (ev.status === 'error') {
        this.err++; this.flags++;
        this.cats[orig.ev.cat].flags++;
        this.pushLog({ ...orig.ev, verb: 'flag', ts: ev.ts, status: 'error' });
      } else this.ok++;
      return { kind: 'result', orig, session: s };
    }

    if (!this.cats[ev.cat]) return { kind: null };
    this.total++;
    s.events++;
    b.events++;
    b.cats[ev.cat] = (b.cats[ev.cat] || 0) + 1;
    const c = this.cats[ev.cat];
    c.count++;
    c.targets.add(ev.target);
    // Bounded like the map (which evicts cold nodes); oldest names go first.
    if (c.targets.size > 2000) c.targets.delete(c.targets.values().next().value);
    if (ev.status === 'pending') this.pending++;
    if (s.lastCat && s.lastCat !== ev.cat) {
      const k = [s.lastCat, ev.cat].sort().join('>');
      this.links.set(k, (this.links.get(k) || 0) + 1);
    }
    s.lastCat = ev.cat;
    const rec = { ev, session: s };
    this.byId.set(ev.id, rec);
    if (this.byId.size > 4000) this.byId.delete(this.byId.keys().next().value);
    this.pushLog(ev);
    this.lastEvent = ev;
    return { kind: 'action', rec, session: s };
  }

  pushLog(ev) {
    this.log.push({ ...ev, seq: ++this.logSeq });
    if (this.log.length > 60) this.log.shift();
  }

  get targetCount() {
    let n = 0;
    for (const c of Object.values(this.cats)) n += c.targets.size;
    return n;
  }

  // Per category activity over the last `n` minutes (oldest first).
  heat(n = 12, now = Date.now()) {
    const m0 = Math.floor(now / MIN);
    const rows = {};
    for (const c of CATEGORIES) rows[c.key] = [];
    const tokens = [], events = [];
    for (let i = n - 1; i >= 0; i--) {
      const b = this.buckets.get(m0 - i);
      for (const c of CATEGORIES) rows[c.key].push(b?.cats[c.key] || 0);
      tokens.push(b?.tokens || 0);
      events.push(b?.events || 0);
    }
    return { rows, tokens, events };
  }

  get health() {
    const t = this.ok + this.err;
    return t ? Math.round((this.ok / t) * 100) : 100;
  }
}
