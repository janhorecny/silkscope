// Screen-space text. LabelsLayer: section names and stats, target tags placed with collision
// avoidance (they follow the tentacles, as in the reference) and crawler captions. It publishes
// the tag boxes it drew in w.tagBoxes for hit-testing. HoverLayer: crosshair, coordinates and the
// hover details, drawn after the scene has picked what is under the cursor.

import { FLAG, FONT } from '../../core/config.js';
import { TAU, clamp, rgba, rgbaQ, easeOutBack, fontEpoch } from '../../core/util.js';

const F9 = `9px ${FONT}`, F10 = `10px ${FONT}`, F12 = `600 12px ${FONT}`, F14 = `600 14px ${FONT}`;
const MAX_CANDS = 8 * 60;
const byPri = (p, q) => q.pri - p.pri;

export class LabelsLayer {
  id = 'labels';
  views = ['crawler', 'neural'];
  space = 'screen';

  constructor() {
    this.touched = new Set();
    this.pool = Array.from({ length: MAX_CANDS }, () => ({ n: null, c: null, a: 0, pri: 0, nx: 0, ny: 0, age: 0 }));
    this.cands = [];
    this.placed = new Float64Array(4 * 64);
    this.boxPool = Array.from({ length: 64 }, () => ({ x: 0, y: 0, w: 0, h: 0, node: null }));
    this.font = '';
  }

  // Canvas font assignment re-parses the string, so skip it when nothing changes.
  #font(g, f) { if (this.font !== f) { g.font = f; this.font = f; } }

  draw(g, w) {
    const { world, cam, now, neural } = w;
    const W = w.W, H = w.H;
    this.font = '';
    g.textBaseline = 'alphabetic';
    const overview = w.overview;
    const spiders = world.spiders;
    // With many crawlers on screen only the most active one's tentacles carry labels,
    // otherwise the map turns into a wall of text.
    const onlyPrim = spiders.size > 2 && !world.single;
    const labelledCount = onlyPrim ? (w.prim ? 1 : 0) : spiders.size;
    const touched = this.touched;
    touched.clear();
    if (onlyPrim) { if (w.prim) this.#touch(w.prim); }
    else for (const sp of spiders.values()) this.#touch(sp);
    const freshFor = labelledCount < spiders.size ? 2.5 : 5;
    const labelMode = w.labelMode;

    const cands = this.cands;
    cands.length = 0;
    for (const c of world.clusterList) {
      const sx = cam.sx(c.x), sy = cam.sy(c.y);
      if (sx < -400 || sx > W + 400 || sy < -400 || sy > H + 400) continue;
      const lx = cam.sx(c.x + c.R * 0.08), ly = cam.sy(c.y - c.R * 0.78);
      const lit = c.activeT > 0.5;
      this.#font(g, lit ? F14 : F12);
      g.fillStyle = c.lit > 0.2 ? rgbaQ(c.rgb, (neural ? 0.35 : 0.55) + c.activeT * 0.45) : 'rgba(170,176,190,0.6)';
      g.fillText(c.cat.name, lx, ly);
      if (!neural || lit) {
        this.#font(g, F9);
        g.fillStyle = 'rgba(140,146,160,0.85)';
        const state = c === world.activeCluster && now - world.lastActivity < 20000 ? 'crawling' : c.count ? 'idle' : 'queued';
        if (c._subN !== c.count || c._subT !== c.nodes.size || c._subS !== state) {
          c._subN = c.count; c._subT = c.nodes.size; c._subS = state;
          c._sub = `${c.count} events · ${c.nodes.size} targets · ${state}`;
        }
        g.fillText(c._sub, lx, ly + 13);
      }

      // Tags follow the tentacles (as in the reference); L shows every recent word; the
      // neural view stays wordless apart from hover. c.recent is already newest first.
      const nodes = c.recent;
      const limit = labelMode === 'all' && !neural ? (overview ? 8 : Math.round(5 + c.activeT * 14)) : 0;
      for (let i = 0; i < nodes.length && i < 60; i++) {
        const n = nodes[i];
        const age = (now - n.lastHit) / 1000;
        let a = 0, pri = 0;
        if (i < limit) { a = overview ? 0.7 : 0.35 + c.activeT * 0.6; pri = 1 + c.activeT - i * 0.02; }
        if (!neural && labelMode !== 'none') {
          if (touched.has(n)) { a = Math.max(a, 0.95); pri = Math.max(pri, 4 - age * 0.05); }
          if (age < freshFor) { a = Math.max(a, 1 - Math.max(0, age - freshFor * 0.6) / (freshFor * 0.4)); pri = Math.max(pri, 3 - age * 0.1); }
          if (n.flagged && c.activeT > 0.5 && !overview) { a = Math.max(a, 0.85); pri = Math.max(pri, 2); }
        }
        if (w.hover?.node === n || w.selected === n) { a = 1; pri = 10; }
        if (a < 0.04) continue;
        const nx = cam.sx(c.x + n.x), ny = cam.sy(c.y + n.y);
        if (nx < -50 || nx > W + 10 || ny < -20 || ny > H + 20) continue;
        const t = this.pool[cands.length];
        t.n = n; t.c = c; t.a = a; t.pri = pri; t.nx = nx; t.ny = ny; t.age = age;
        cands.push(t);
      }
    }
    cands.sort(byPri);

    const placed = this.placed, boxes = w.tagBoxes;
    let np = 0;
    boxes.length = 0;
    const hit = (x, y, bw, bh) => {
      for (let i = 0; i < np; i += 4) if (x < placed[i] + placed[i + 2] + 2 && x + bw + 2 > placed[i] && y < placed[i + 1] + placed[i + 3] + 1 && y + bh + 1 > placed[i + 1]) return true;
      return false;
    };
    this.#font(g, F10);
    for (const t of cands) {
      if (np / 4 > 60) break;
      const { n, c, a, nx, ny, age } = t;
      const label = this.#label(n, age);
      // Measured with whatever font the previous tag left set (a popping tag shrinks it), as before.
      const bw = (this.font === F10 ? this.#width(g, n, label) : g.measureText(label).width) + 8, bh = 14;
      let x = nx + 6;
      const y = ny - bh / 2;
      if (hit(x, y, bw, bh)) { x = nx - 6 - bw; if (hit(x, y, bw, bh)) { if (t.pri < 9) continue; x = nx + 6; } }
      placed[np] = x; placed[np + 1] = y; placed[np + 2] = bw; placed[np + 3] = bh;
      np += 4;
      const pop = clamp((now - n.lastHit) / 380, 0, 1);
      const scale = age < 1 ? 0.7 + 0.3 * easeOutBack(pop) : 1;
      if (x < nx) {
        g.strokeStyle = rgbaQ(c.rgb, 0.5 * a);
        g.beginPath(); g.moveTo(nx - 2, ny); g.lineTo(x + bw, ny); g.stroke();
      }
      const box = this.boxPool[boxes.length];
      this.#tag(g, x - 6, ny, label, n, c.rgb, a, n.flagged, scale, box);
      box.node = n;
      boxes.push(box);
    }

    this.#font(g, F9);
    for (const sp of spiders.values()) {
      const x = cam.sx(sp.x), y = cam.sy(sp.y);
      if (x < -100 || x > W + 100 || y < -100 || y > H + 100) continue;
      const off = 24 * Math.max(1, Math.sqrt(cam.z));
      g.fillStyle = rgbaQ(sp.bodyRgb, 0.85 * sp.alpha);
      if (sp._capP !== sp.project) { sp._capP = sp.project; sp._cap = `${sp.style.label} · ${sp.project}`; }
      g.fillText(sp._cap, x + off, y + off + 6);
      if (sp.queue.length > 2) {
        g.fillStyle = `rgba(255,216,74,${0.8 * sp.alpha})`;
        g.fillText(`+${sp.queue.length} queued`, x + off, y + off + 17);
      }
    }
  }

  #touch(sp) { for (const t of sp.tentacles) if (!t.retract && t.node) this.touched.add(t.node); }

  // Tag text, cached on the node until its inputs change.
  #label(n, age) {
    const mode = n.flagged ? 2 : age < 4 && n.lastVerb ? 1 : 0;
    if (n._lm !== mode || n._lsrc !== n.label || (mode === 1 && n._lv !== n.lastVerb)) {
      const short = n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label;
      n._lt = mode === 2 ? `${short} · ⚑ error` : mode === 1 ? `${short} · ${n.lastVerb}` : short;
      n._lm = mode; n._lsrc = n.label; n._lv = n.lastVerb; n._lw = -1;
    }
    return n._lt;
  }

  // Width of the cached tag text at 10px; re-measured when the text or the loaded fonts change.
  #width(g, n, label) {
    if (n._lw < 0 || n._lwe !== fontEpoch.v || n._lwt !== label) { n._lw = g.measureText(label).width; n._lwe = fontEpoch.v; n._lwt = label; }
    return n._lw;
  }

  #tag(g, x, y, text, n, rgb, alpha, flagged, scale, box) {
    let w;
    if (scale === 1) { this.#font(g, F10); w = this.#width(g, n, text) + 8; }
    else { const f = `${10 * scale}px ${FONT}`; g.font = f; this.font = f; w = g.measureText(text).width + 8 * scale; }
    const h = 14 * scale;
    const tx = x + 6, ty = y - h / 2;
    g.globalAlpha = alpha;
    if (flagged) {
      g.fillStyle = FLAG;
      g.fillRect(tx, ty, w, h);
      g.fillStyle = '#16070d';
    } else {
      g.fillStyle = 'rgba(6,8,12,0.82)';
      g.fillRect(tx, ty, w, h);
      g.strokeStyle = rgbaQ(rgb, 0.85);
      g.lineWidth = 1;
      g.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
      g.fillStyle = rgbaQ(rgb, 1);
    }
    g.fillText(text, tx + 4 * scale, ty + 10.5 * scale);
    g.globalAlpha = 1;
    box.x = tx; box.y = ty; box.w = w; box.h = h;
  }
}

export class HoverLayer {
  id = 'hover';
  views = ['crawler', 'neural'];
  space = 'screen';

  draw(g, w) {
    w.pickHover(); // after the labels: hit-testing needs this frame's tag boxes
    const { x, y } = w.mouse;
    if (x < 0) return;
    const now = w.now, cam = w.cam;
    g.strokeStyle = 'rgba(220,230,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 14, y); g.lineTo(x - 5, y); g.moveTo(x + 5, y); g.lineTo(x + 14, y);
    g.moveTo(x, y - 14); g.lineTo(x, y - 5); g.moveTo(x, y + 5); g.lineTo(x, y + 14);
    g.stroke();
    g.font = F9;
    g.fillStyle = 'rgba(160,170,190,0.8)';
    g.fillText(`x ${String(Math.round(w.mouse.wx)).padStart(5, ' ')}  y ${String(Math.round(w.mouse.wy)).padStart(5, ' ')}`, x + 12, y + 22);
    const h = w.hover;
    const cursor = h ? 'pointer' : w.mouse.down ? 'grabbing' : 'crosshair';
    if (w.canvas.style.cursor !== cursor) w.canvas.style.cursor = cursor;
    if (!h) return;
    if (h.type === 'cluster') {
      const c = h.cluster;
      g.strokeStyle = rgba(c.rgb, 0.5);
      g.setLineDash([2, 5]);
      g.beginPath(); g.arc(cam.sx(c.x), cam.sy(c.y), c.R * 0.86 * cam.z, now / 3000, now / 3000 + TAU); g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgba(c.rgb, 0.9);
      g.fillText(`[ click to focus ${c.cat.name} ]`, x + 12, y + 34);
    } else if (h.type === 'node') {
      const n = h.node, c = n.cluster;
      const nx = cam.sx(c.x + n.x), ny = cam.sy(c.y + n.y);
      g.strokeStyle = rgba(c.rgb, 0.9);
      g.beginPath(); g.arc(nx, ny, 7 + Math.sin(now / 150) * 1.5, 0, TAU); g.stroke();
      // Highlight this neuron's synapses.
      g.lineWidth = 1;
      for (const s of n.syn) {
        const o = s.a === n ? s.b : s.a;
        g.strokeStyle = rgbaQ(o.cluster.rgb, 0.55);
        g.beginPath(); g.moveTo(nx, ny); g.lineTo(cam.sx(o.cluster.x + o.x), cam.sy(o.cluster.y + o.y)); g.stroke();
      }
      const last = n.events[n.events.length - 1];
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`${n.hits} hits · ${n.syn.length} links · ${last?.agent || ''} · ${last?.project || ''}`, x + 12, y + 34);
    } else if (h.type === 'spider') {
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`[ click to inspect ${h.spider.style.label} · ${h.spider.project} ]`, x + 12, y + 34);
    }
  }
}
