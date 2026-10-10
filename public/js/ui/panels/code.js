// SILK.PY: a typewriter that narrates the crawl as pseudo-Python, one line per animated event.

import { Panel, esc, setText } from '../panel.js';

export class CodePanel extends Panel {
  id = 'code';

  constructor(ctx) {
    super(ctx, { title: 'SILK.PY', badge: '0 l/s', badgeClass: 'pink', badgeId: 'lps', body: '<pre id="code"></pre>' });
    this.pre = this.$('#code');
    this.code = { queue: [], typing: null, typed: 0, lps: 0, done: [] };
    this.code.queue.push(
      ['c', '# silk.py · watch your coding agents spin'],
      ['', 'graph = load("~/.claude/projects")'],
      ['', 'scope = Silkscope(cilia=26, tentacles=22)'],
      ['', ''],
      ['k', 'for ev in scope.stream():'],
    );
    this.codeTick = 0;
    this.lpsT = 0;
    ctx.bus.on('event', ({ ev, res, animate }) => { if (animate) this.#narrate(ev, res); });
  }

  #narrate(ev, res) {
    const q = this.code.queue;
    if (q.length > 14) q.splice(0, q.length - 10);
    if (res.kind === 'action') {
      if (this.lastCat !== ev.cat) {
        q.push(['', `    spider.walk_to("${ev.cat}")`]);
        this.lastCat = ev.cat;
      }
      const t = String(ev.target || '').replace(/"/g, "'").slice(0, 26);
      q.push(['', `    hit = spider.reach("${t}")`]);
    } else if (res.kind === 'result' && ev.status === 'error') {
      q.push(['f', '    flag(hit, kind="error")']);
    }
  }

  frame(dt) {
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
    const t = performance.now();
    // Re-rendered every 60 ms even when unchanged: re-creating the cursor restarts its blink,
    // which is what keeps it solid (the established look).
    if (t - this.codeTick > 60) {
      this.codeTick = t;
      const lines = c.done.map(([k, s]) => hl(k, s));
      lines.push(c.typing ? hl(c.typing[0], c.typing[1].slice(0, Math.floor(c.typed))) + '<span class="cur"></span>' : '<span class="cur"></span>');
      this.pre.innerHTML = lines.join('\n');
    }
    if (t - this.lpsT > 1000) {
      this.lpsT = t;
      setText(this.badgeEl, `${c.lps} l/s`);
      c.lps = 0;
    }
  }
}

function hl(kind, s) {
  if (kind === 'c' || s.trim().startsWith('#')) return `<span class="cm">${esc(s)}</span>`;
  let h = esc(s)
    .replace(/(&quot;.*?&quot;|"[^"]*")/g, '<span class="str">$1</span>')
    .replace(/\b(for|in|if|return|def|import)\b/g, '<span class="kw">$1</span>')
    .replace(/(\w+)(?=\()/g, '<span class="fn">$1</span>');
  if (kind === 'f') h = `<span class="fl">${h}</span>`;
  return h;
}
