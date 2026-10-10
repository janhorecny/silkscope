// The world model every layer reads: the eight clusters and their target nodes, the synapse graph
// between targets, neural signals, the crawler swarm with its paced event queues, bursts and the
// pulses that run between sections. No drawing here.

import { CATEGORIES, FLAG } from '../core/config.js';
import { Cluster } from './nebula.js';
import { Spider } from './spider.js';
import { TAU, damp, rand, pick, hexToRgb } from '../core/util.js';

const MAX_SYNAPSES = 2400;
const MAX_SIGNALS = 500;
const FLAG_RGB = hexToRgb(FLAG);

export class World {
  constructor(store) {
    this.store = store;
    this.clusterList = CATEGORIES.map((c, i) => new Cluster(c, i));
    this.clusters = Object.fromEntries(this.clusterList.map((c) => [c.key, c]));
    this.spiders = new Map();
    this.bursts = [];
    this.pulses = [];
    this.synapses = new Map();
    this.signals = [];
    this.lastNode = new Map();    // session -> last node touched (for synapses)
    this.recentNodes = new Map(); // session -> recent distinct nodes (re-attach after rebuild)
    this.hot = [];                // nodes with act > 0: only these need decaying
    this.single = null;           // watched session id, or null for all
    this.speed = 1;               // playback speed (history replay runs faster)
    this.reduced = false;         // reduced motion
    this.quality = 1;             // mirrors Scene.quality (bursts thin out when degraded)
    this.lastActivity = 0;
    this.activeCluster = null;
    this.cam = { x: 0, y: 0 };    // camera position, shared by reference (spawn point fallback)
    this.onTravel = () => {};     // (spider, now, backlog): a crawler is moving to another section
    this._arrived = [];
    this._top = [];
  }

  reset() {
    for (const c of this.clusterList) c.reset();
    this.spiders.clear();
    this.bursts.length = 0;
    this.pulses.length = 0;
    this.synapses.clear();
    this.signals.length = 0;
    this.lastNode.clear();
    this.recentNodes.clear();
    this.hot.length = 0;
    this.activeCluster = null;
  }

  spiderFor(session, x, y) {
    let sp = this.spiders.get(session.id);
    if (!sp) {
      if (x == null) {
        const near = this.clusters[session.lastCat], a = rand(TAU);
        x = (near ? near.x : this.cam.x) + Math.cos(a) * 140;
        y = (near ? near.y : this.cam.y) + Math.sin(a) * 110;
      }
      sp = new Spider(session.id, session.agent, session.project, x, y);
      this.spiders.set(session.id, sp);
      if (this.spiders.size > 8) {
        let old = null;
        for (const s of this.spiders.values()) if (s.session !== this.single && (!old || s.lastActive < old.lastActive)) old = s;
        if (old) this.spiders.delete(old.session);
      }
    }
    sp.project = session.project;
    return sp;
  }

  // After a silent rebuild, park a crawler where each recent session last was.
  placeSpiders(sessions) {
    const now = performance.now();
    for (const s of sessions) {
      const cl = this.clusters[s.lastCat];
      if (!cl) continue;
      const sp = this.spiderFor(s, cl.x + rand(-30, 30), cl.y + rand(-30, 30));
      sp.cluster = cl;
      sp.setSilk(cl.rgb);
      sp.enteredAt = now;
      sp.lastActive = now - Math.min(19 * 60e3, Math.max(0, Date.now() - s.lastTs));
      // Re-attach tentacles to what it was last touching in this section.
      const rn = (this.recentNodes.get(s.id) || []).filter((n) => n.cluster === cl).slice(-12);
      rn.forEach((n, i) => sp.reach({ cluster: cl, x: n.x, y: n.y, node: n }, n.flagged, now + 200 + i * 40));
    }
  }

  primarySpider() {
    if (this.single) return this.spiders.get(this.single) || null;
    let best = null;
    for (const s of this.spiders.values()) if (!best || s.lastActive > best.lastActive) best = s;
    return best;
  }

  // Fold one store result into the world. animate=false is the silent rebuild path.
  handle(ev, res, animate) {
    const now = performance.now();
    if (res.kind === 'action') {
      const cl = this.clusters[ev.cat];
      const node = cl.node(ev.target);
      node.hits++;
      node.events.push(ev);
      if (node.events.length > 40) node.events.shift();
      if (ev.status === 'pending') node.pending++;
      res.rec.node = node;
      res.rec.cluster = cl;
      cl.count++;
      cl.lastTs = ev.ts;
      cl.lit = Math.max(cl.lit, 0.35);
      this.#synapse(this.lastNode.get(ev.session), node, animate ? now : now - 120000);
      this.lastNode.set(ev.session, node);
      let rn = this.recentNodes.get(ev.session);
      if (!rn) this.recentNodes.set(ev.session, (rn = []));
      const i = rn.indexOf(node);
      if (i >= 0) rn.splice(i, 1);
      rn.push(node);
      if (rn.length > 24) rn.shift();
      if (animate) {
        this.lastActivity = now;
        const sp = this.spiderFor(res.session);
        sp.lastActive = now;
        sp.queue.push({ cl, node, ev });
        if (sp.queue.length > 40) sp.queue.splice(0, sp.queue.length - 40);
      } else {
        cl.touch(node, now - 60000);
        cl.lit = 1;
      }
    } else if (res.kind === 'result' && res.orig.node) {
      const node = res.orig.node, cl = res.orig.cluster;
      node.pending = Math.max(0, node.pending - 1);
      if (ev.status === 'error') {
        node.flagged = true;
        cl.flags++;
        if (animate) {
          this.burst(cl, node, FLAG_RGB, 26);
          node.act = 1.6;
          this.#hot(node);
          for (const sp of this.spiders.values()) for (const t of sp.tentacles) if (t.node === node) t.flagged = true;
        }
      }
    }
  }

  #synapse(a, b, now) {
    if (!a || !b || a === b) return;
    const key = a.id < b.id ? a.id + '~' + b.id : b.id + '~' + a.id;
    let s = this.synapses.get(key);
    if (!s) {
      s = { a, b, w: 0, last: 0, bend: rand(-0.22, 0.22) };
      this.synapses.set(key, s);
      a.syn.push(s); b.syn.push(s);
      if (this.synapses.size > MAX_SYNAPSES) {
        // Prune the weakest stale tenth in one go (amortised).
        const arr = [...this.synapses.entries()].sort((p, q) => (p[1].w + p[1].last / 6e4) - (q[1].w + q[1].last / 6e4));
        for (const [k, v] of arr.slice(0, MAX_SYNAPSES / 10)) {
          this.synapses.delete(k);
          v.a.syn = v.a.syn.filter((x) => x !== v);
          v.b.syn = v.b.syn.filter((x) => x !== v);
        }
      }
    }
    s.w++;
    s.last = now;
  }

  #hot(node) { if (!node.hot) { node.hot = true; this.hot.push(node); } }

  // Fire a neuron; the signal cascades two hops along its strongest synapses.
  fire(node, energy, depth, from, now) {
    node.act = Math.min(1.8, (node.act || 0) + energy);
    this.#hot(node);
    if (depth >= (this.reduced ? 1 : 2) || this.signals.length > MAX_SIGNALS) return;
    // Top-k by weight without filter/sort/slice garbage. Insertion after equal weights keeps the
    // order a stable sort would give.
    const k = depth ? 3 : 6, top = this._top;
    top.length = 0;
    for (const s of node.syn) {
      if (s.a === from || s.b === from) continue;
      let i = top.length;
      while (i > 0 && top[i - 1].w < s.w) i--;
      if (i >= k) continue;
      for (let m = top.length < k ? top.length : k - 1; m > i; m--) top[m] = top[m - 1];
      top[i] = s;
    }
    const ax = node.cluster.x + node.x, ay = node.cluster.y + node.y;
    for (const s of top) {
      const to = s.a === node ? s.b : s.a;
      const d = Math.hypot(to.cluster.x + to.x - ax, to.cluster.y + to.y - ay);
      this.signals.push({ s, from: node, to, t0: now, dur: 260 + d * 0.9, e: energy * (0.4 + Math.min(0.4, Math.log1p(s.w) * 0.15)), depth: depth + 1 });
    }
    top.length = 0;
  }

  burst(cl, node, rgb, n = 14) {
    if (this.reduced) return;
    if (this.quality < 0.5) n = Math.ceil(n / 3);
    const x = cl.x + node.x, y = cl.y + node.y;
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), v = rand(20, 110);
      this.bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, rgb, s: rand(0.8, 2.2) });
    }
    if (this.bursts.length > 600) this.bursts.splice(0, this.bursts.length - 600);
  }

  // Advance the swarm. `focus` is the camera's focused cluster (it wins the "active" section).
  update(dt, now, focus) {
    for (const sp of this.spiders.values()) {
      if (sp.pendingReach && (now > sp.pendingReach.at || (sp.arrived && now > sp.pendingReach.min))) {
        const { cl, node, ev } = sp.pendingReach;
        sp.reach({ cluster: cl, x: node.x, y: node.y, node }, ev.status === 'error', now);
        cl.touch(node, now);
        node.lastVerb = ev.verb;
        cl.heat = Math.min(1, cl.heat + 0.5);
        cl.lit = 1;
        this.burst(cl, node, cl.rgb, 10);
        this.fire(node, 1, 0, null, now);
        sp.pendingReach = null;
      }
      if (!sp.pendingReach && sp.queue.length && now >= sp.nextAt) {
        const item = sp.queue.shift();
        const changed = sp.cluster !== item.cl;
        const backlog = sp.queue.length;
        const k = 0.2;
        const tx = item.cl.x + item.node.x * k + rand(-10, 10), ty = item.cl.y + item.node.y * k + rand(-10, 10);
        if (changed) {
          if (sp.cluster) this.pulses.push({ a: sp.cluster, b: item.cl, t0: now, rgb: item.cl.rgb });
          sp.retractAll(item.cl, now);
          sp.cluster = item.cl;
          sp.enteredAt = now;
          item.cl.flash = 1;
          // Anticipation: a fan of long tentacles into the next cloud before the body moves.
          const fan = this.reduced ? 0 : backlog > 12 ? 4 : 12;
          for (let i = 0; i < fan; i++) {
            const p = pick(item.cl.pts);
            sp.reach({ cluster: item.cl, x: p[0] * 0.8, y: p[1] * 0.8, fan: true }, false, now + i * 14);
          }
          sp.setSilk(item.cl.rgb);
          const lead = backlog > 12 ? 60 : 340;
          sp.goTo(tx, ty, lead / this.speed, now, this.speed);
          sp.pendingReach = { ...item, min: now + (lead + 300) / this.speed, at: now + (lead + 900) / this.speed };
          this.onTravel(sp, now, backlog);
        } else {
          sp.goTo(tx, ty, 0, now, this.speed);
          sp.pendingReach = { ...item, min: now, at: now + 90 / this.speed };
        }
        let gap = backlog > 24 ? 40 : backlog > 8 ? 110 : 300;
        if (changed && backlog <= 24) gap = Math.max(gap, 760);
        sp.nextAt = now + gap / this.speed;
      }
      // Fan tentacles fade once the body has arrived.
      if (sp.arrived) for (const t of sp.tentacles) if (t.fan && !t.retract && now - t.t0 > 900) t.retract = now;
      sp.update(dt, now);
    }
    for (const [k, sp] of this.spiders) {
      if (k !== this.single && now - sp.lastActive > 20 * 60e3) { sp.alpha -= dt; if (sp.alpha <= 0) this.spiders.delete(k); }
    }

    // Neural signals: compact in place, then fire the arrivals (which may queue new signals).
    const sig = this.signals, arrived = this._arrived;
    let j = 0;
    for (let i = 0; i < sig.length; i++) { const s = sig[i]; if (now - s.t0 >= s.dur) arrived.push(s); else sig[j++] = s; }
    sig.length = j;
    for (let i = 0; i < arrived.length; i++) { const s = arrived[i]; this.fire(s.to, s.e, s.depth, s.from, now); }
    arrived.length = 0;

    const decay = Math.exp(-dt * 1.7), hot = this.hot;
    j = 0;
    for (let i = 0; i < hot.length; i++) {
      const n = hot[i];
      if (n.act > 0.001) { n.act *= decay; hot[j++] = n; } else { n.act = 0; n.hot = false; }
    }
    hot.length = j;

    const prim = this.primarySpider();
    this.activeCluster = focus || prim?.cluster || this.activeCluster;
    for (const c of this.clusterList) {
      c.heat = Math.max(0, c.heat - dt * 0.35);
      c.flash = Math.max(0, (c.flash || 0) - dt * 1.4);
      c.activeT = damp(c.activeT, c === this.activeCluster ? 1 : 0, 4, dt);
    }

    const bs = this.bursts, fr = 1 - dt * 2.2;
    j = 0;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= fr; b.vy *= fr;
      b.life -= dt * 0.9;
      if (b.life > 0) bs[j++] = b;
    }
    bs.length = j;
    const ps = this.pulses;
    j = 0;
    for (let i = 0; i < ps.length; i++) if (now - ps[i].t0 < 1600) ps[j++] = ps[i];
    ps.length = j;
  }

  // Object counts for the PERF panel.
  counts() {
    let nodes = 0, tentacles = 0;
    for (const c of this.clusterList) nodes += c.nodes.size;
    for (const sp of this.spiders.values()) tentacles += sp.tentacles.length;
    return { nodes, synapses: this.synapses.size, signals: this.signals.length, bursts: this.bursts.length, spiders: this.spiders.size, tentacles };
  }
}
