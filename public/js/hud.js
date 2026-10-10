// DOM side: top stats bar, section tabs, section heading, the six bottom panels,
// crawler roster and inspector.

import { CATEGORIES, CAT, FLAG } from './config.js';
import { fmtTime, fmtNum, clamp, TAU, hexToRgb, rgba } from './util.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(store, scene) {
    this.store = store;
    this.scene = scene;
    this.t0 = performance.now();
    this.logSeen = 0;
    this.code = { lines: [], queue: [], typing: null, typed: 0, lps: 0, done: [] };
    this.tokenHist = [];
    this.rate = 0;
    this.lastTotal = 0;
    this.#buildTabs();
    this.#buildSections();
    this.#buildHeat();
    this.#seedCode();
    this.radar = $('#radar').getContext('2d');
    this.spark = $('#spark').getContext('2d');
    this.gauge = $('#gauge').getContext('2d');
    setInterval(() => this.#slow(), 250);
  }

  #buildTabs() {
    $('#tabs').innerHTML = CATEGORIES.map((c) =>
      `<button class="tab" data-k="${c.key}" style="--c:${c.color}"><span>${c.name}</span><i></i></button>`).join('');
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) this.scene.focus(b.dataset.k);
    });
  }

  #buildSections() {
    $('#sections').innerHTML = CATEGORIES.map((c) =>
      `<div class="sec" data-k="${c.key}" style="--c:${c.color}"><div class="row"><span class="n">${c.name}</span><span class="v">0</span></div><div class="track"><div class="fill"></div></div></div>`).join('');
    $('#sections').addEventListener('click', (e) => {
      const s = e.target.closest('.sec');
      if (s) this.scene.focus(s.dataset.k);
    });
  }

  #buildHeat() {
    $('#heat').innerHTML = CATEGORIES.map((c) =>
      `<div class="hrow" data-k="${c.key}"><span>${c.code}</span>${'<b></b>'.repeat(12)}</div>`).join('');
  }

  #seedCode() {
    const sources = 'stream';
    this.code.queue.push(
      ['c', '# swarm.py · tails your coding agents'],
      ['', 'graph = load("~/.claude/projects")'],
      ['', 'swarm = Crawler(legs=16, tentacles=18)'],
      ['', ''],
      ['k', `for ev in swarm.${sources}():`],
    );
  }

  // Called for every animated event so the code panel narrates the crawl.
  narrate(ev, res) {
    const q = this.code.queue;
    if (q.length > 14) q.splice(0, q.length - 10);
    if (res.kind === 'action') {
      if (this.lastNarrCat !== ev.cat) {
        q.push(['', `    spider.walk_to("${ev.cat}")`]);
        this.lastNarrCat = ev.cat;
      }
      const t = String(ev.target || '').replace(/"/g, "'").slice(0, 26);
      q.push(['', `    hit = spider.reach("${t}")`]);
    } else if (res.kind === 'result' && ev.status === 'error') {
      q.push(['f', `    flag(hit, kind="error")`]);
    }
  }

  // ------------------------------------------------------------ per frame (cheap)
  frame(now, dt) {
    this.#typeCode(dt);
    const s = this.store;
    const tent = [...this.scene.spiders.values()].reduce((n, sp) => n + sp.tentacles.filter((t) => !t.retract).length, 0);
    $('#st-agents').textContent = this.scene.spiders.size;
    $('#st-legs').textContent = this.scene.spiders.size * 16;
    $('#st-tent').textContent = tent;
    $('#st-events').textContent = fmtNum(s.total);
    $('#st-targets').textContent = fmtNum(s.targetCount);
    $('#st-links').textContent = [...s.links.values()].reduce((a, b) => a + b, 0);
    $('#st-flags').textContent = s.flags;
    $('#st-tokens').textContent = fmtNum(s.tokens);
    $('#st-t').textContent = ((now - this.t0) / 1000).toFixed(2);
    $('#st-frame').textContent = String(this.scene.frame % 10000).padStart(4, '0');
  }

  // ------------------------------------------------------------ 4 Hz
  #slow() {
    const s = this.store, sc = this.scene;
    const active = sc.activeCluster;
    const overview = sc.mode === 'overview';

    // Tabs + heading.
    for (const b of document.querySelectorAll('.tab')) {
      b.classList.toggle('on', !overview && active?.key === b.dataset.k);
      b.querySelector('i').textContent = s.cats[b.dataset.k].count || '';
    }
    const head = $('#section');
    if (overview || !active) {
      head.style.setProperty('--c', '#ffffff');
      $('#secTitle').textContent = `∞ SWARM`;
      $('#secSub').textContent = `${s.total} events read · ${s.flags} flagged · ${s.sessions.size} sessions · ${s.pending} pending`;
    } else {
      const c = active.cat;
      head.style.setProperty('--c', c.color);
      $('#secTitle').textContent = `${String(CAT[c.key].index + 1).padStart(2, '0')} ${c.name.toUpperCase()}`;
      $('#secSub').textContent = `${s.cats[c.key].count} events · ${active.nodes.size} targets · ${s.cats[c.key].flags} flagged · ${c.blurb}`;
    }

    // Log.
    const rate = s.total - this.lastTotal;
    this.lastTotal = s.total;
    this.rate = this.rate * 0.85 + rate * 4 * 0.15;
    $('#logRate').textContent = `${this.rate.toFixed(1)} e/s`;
    const rows = s.log.slice(-14).reverse();
    $('#log').innerHTML = rows.map((e) => {
      const c = e.status === 'error' && e.verb === 'flag' ? FLAG : CAT[e.cat]?.color || '#aaa';
      return `<div class="lr"><span class="t">${fmtTime(e.ts)}</span><span class="vb" style="color:${c}">${esc(String(e.verb || e.cat).slice(0, 9))}</span><span class="tg">${esc(e.target)}</span></div>`;
    }).join('');

    // Sections.
    const max = Math.max(1, ...Object.values(s.cats).map((c) => c.count));
    for (const el of document.querySelectorAll('.sec')) {
      const c = s.cats[el.dataset.k];
      el.querySelector('.v').textContent = `${c.count}${c.flags ? ` ⚑${c.flags}` : ''}`;
      el.querySelector('.fill').style.width = `${(c.count / max) * 100}%`;
      el.classList.toggle('on', active?.key === el.dataset.k && !overview);
    }
    $('#secCount').textContent = CATEGORIES.filter((c) => s.cats[c.key].count).length;

    // Heat.
    const h = s.heat(12);
    const hmax = Math.max(1, ...Object.values(h.rows).flat());
    for (const row of document.querySelectorAll('.hrow')) {
      const k = row.dataset.k, rgb = hexToRgb(CAT[k].color);
      [...row.querySelectorAll('b')].forEach((b, i) => {
        const v = h.rows[k][i];
        b.style.background = v ? rgba(rgb, 0.25 + 0.75 * Math.sqrt(v / hmax)) : '#161a21';
      });
    }
    const epm = h.events[h.events.length - 1] + h.events[h.events.length - 2] * 0.5;
    $('#epm').textContent = `${Math.round(h.events[h.events.length - 1])}/m`;
    $('#hTargets').textContent = s.targetCount;
    $('#hLinks').textContent = s.links.size;
    $('#heatTotal').textContent = fmtNum(s.total);

    this.#drawRadar();
    this.#drawSpark(h.tokens);
    this.#drawGauge(s.health);
    $('#tokRate').textContent = `${fmtNum(h.tokens[h.tokens.length - 1])} tok/m`;
    $('#agentsBar').style.width = `${Math.min(100, sc.spiders.size * 20)}%`;
    $('#agentsN').textContent = sc.spiders.size;
    $('#flagsBar').style.width = `${Math.min(100, s.flags * 3)}%`;
    $('#flagsN').textContent = s.flags;
    this.#roster();
  }

  #drawRadar() {
    const g = this.radar, cv = g.canvas;
    const W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2;
    g.scale(2, 2);
    const w = W / 2, h = H / 2, cx = w / 2, cy = h / 2 + 2, R = Math.min(w, h) / 2 - 16;
    const n = CATEGORIES.length;
    g.strokeStyle = '#252a33'; g.lineWidth = 1;
    for (let ring = 1; ring <= 4; ring++) {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU - Math.PI / 2, r = (R * ring) / 4;
        i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
    }
    const max = Math.max(1, ...Object.values(this.store.cats).map((c) => c.count));
    g.beginPath();
    CATEGORIES.forEach((c, i) => {
      const a = (i / n) * TAU - Math.PI / 2;
      const v = Math.sqrt(this.store.cats[c.key].count / max);
      const r = R * (0.08 + 0.92 * v);
      i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    });
    g.closePath();
    g.fillStyle = 'rgba(63,224,165,0.55)'; g.fill();
    g.strokeStyle = '#3fe0a5'; g.stroke();
    g.font = '8px "JetBrains Mono", monospace';
    g.fillStyle = '#7d8594';
    g.textAlign = 'center';
    CATEGORIES.forEach((c, i) => {
      const a = (i / n) * TAU - Math.PI / 2;
      g.fillStyle = this.scene.activeCluster?.key === c.key ? c.color : '#7d8594';
      g.fillText(c.code, cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9) + 3);
    });
  }

  #drawSpark(tokens) {
    const g = this.spark, cv = g.canvas;
    const W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2;
    g.scale(2, 2);
    const w = W / 2, h = H / 2;
    const max = Math.max(1, ...tokens);
    const t = performance.now() / 1000;
    g.strokeStyle = '#f5b73b'; g.lineWidth = 1.4;
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

  #drawGauge(v) {
    const g = this.gauge, cv = g.canvas;
    const W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2;
    g.scale(2, 2);
    const w = W / 2, h = H / 2, cx = w / 2, cy = h / 2 + 6, r = Math.min(w, h) / 2 - 8;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineWidth = 7; g.lineCap = 'butt';
    g.strokeStyle = '#1b2028';
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    this.gv = this.gv == null ? v : this.gv + (v - this.gv) * 0.2;
    const col = this.gv > 85 ? '#3fe0a5' : this.gv > 60 ? '#f5b73b' : '#ff3d81';
    g.strokeStyle = col;
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * (this.gv / 100)); g.stroke();
    g.fillStyle = '#eef1f6';
    g.textAlign = 'center';
    g.font = '600 22px "JetBrains Mono", monospace';
    g.fillText(Math.round(this.gv), cx, cy + 6);
    g.font = '8px "JetBrains Mono", monospace';
    g.fillStyle = '#7d8594';
    g.fillText('success rate', cx, cy + 20);
  }

  #typeCode(dt) {
    const c = this.code;
    if (!c.typing && c.queue.length) { c.typing = c.queue.shift(); c.typed = 0; }
    if (c.typing) {
      const speed = c.queue.length > 6 ? 160 : 55;
      c.typed += dt * speed;
      if (c.typed >= c.typing[1].length) {
        c.done.push(c.typing);
        c.typing = null;
        c.lps++;
        if (c.done.length > 11) c.done.splice(0, c.done.length - 11);
      }
    }
    if (!this._codeTick || performance.now() - this._codeTick > 60) {
      this._codeTick = performance.now();
      const lines = c.done.map(([k, s]) => this.#hl(k, s));
      if (c.typing) lines.push(this.#hl(c.typing[0], c.typing[1].slice(0, Math.floor(c.typed))) + '<span class="cur"></span>');
      else lines.push('<span class="cur"></span>');
      $('#code').innerHTML = lines.join('\n');
    }
    if (!this._lpsT || performance.now() - this._lpsT > 1000) {
      this._lpsT = performance.now();
      $('#lps').textContent = `${c.lps} l/s`;
      c.lps = 0;
    }
  }

  #hl(kind, s) {
    if (kind === 'c' || s.trim().startsWith('#')) return `<span class="cm">${esc(s)}</span>`;
    let h = esc(s)
      .replace(/(&quot;.*?&quot;|"[^"]*")/g, '<span class="str">$1</span>')
      .replace(/\b(for|in|if|return|def|import)\b/g, '<span class="kw">$1</span>')
      .replace(/(\w+)(?=\()/g, '<span class="fn">$1</span>');
    if (kind === 'f') h = `<span class="fl">${h}</span>`;
    return h;
  }

  #roster() {
    const el = $('#roster');
    const sp = [...this.scene.spiders.values()].sort((a, b) => b.lastActive - a.lastActive);
    const key = sp.map((s) => s.session + s.cluster?.key + s.queue.length + (this.scene.followSpider === s)).join('|');
    if (key === this._rosterKey) return;
    this._rosterKey = key;
    el.innerHTML = sp.map((s) => {
      const sess = this.store.sessions.get(s.session);
      return `<button class="crawler ${this.scene.followSpider === s ? 'on' : ''}" data-s="${esc(s.session)}" style="--c:${s.style.body}">
        <i></i><b>${esc(s.style.label)}</b><span>${esc(s.project)}</span><em style="color:${s.cluster ? s.cluster.cat.color : '#888'}">${s.cluster ? s.cluster.cat.name : '—'}</em><small>${sess ? sess.events : 0}</small></button>`;
    }).join('');
  }

  showInspector(sel) {
    const el = $('#inspector');
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
      const sp = sel.spider, s = this.store.sessions.get(sp.session) || {};
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
        <p class="hint">camera is following this crawler · press F to release</p>`;
    }
    el.querySelector('.x').onclick = () => { this.scene.selected = null; el.hidden = true; };
  }
}
