// Top stats line (per frame, writes only changed numbers) and the connection badge.

import { fmtNum } from '../../core/util.js';
import { Panel, setText, setClass } from '../panel.js';

export class TopbarPanel extends Panel {
  id = 'topbar';

  constructor(ctx) {
    super(ctx, { el: '#topbar' });
    this.t0 = performance.now();
    const ids = ['agents', 'legs', 'tent', 'events', 'targets', 'links', 'flags', 'tokens', 't', 'frame', 'fps'];
    this.st = Object.fromEntries(ids.map((k) => [k, this.$(`#st-${k}`)]));
    this.live = this.$('#live');
    this.srcs = this.$('#srcs');
    this.ver = this.$('.ver');
    ctx.bus.on('live', (on) => {
      setClass(this.live, on ? 'live on' : 'live off');
      setText(this.live, on ? '● LIVE' : '○ OFFLINE');
    });
    ctx.bus.on('hello', ({ hello }) => {
      setText(this.srcs, hello.sources.map((s) => s.agent).join(' + ') || (hello.demo ? 'demo' : 'no sources'));
      if (hello.version) setText(this.ver, `v${hello.version}`);
    });
  }

  frame(dt, now) {
    const { store: s, scene } = this.ctx, st = this.st;
    let tent = 0;
    for (const sp of scene.spiders.values()) tent += sp.liveTentacles;
    let links = 0;
    for (const v of s.links.values()) links += v;
    setText(st.agents, scene.spiders.size);
    setText(st.legs, scene.spiders.size * 16);
    setText(st.tent, tent);
    setText(st.events, fmtNum(s.total));
    setText(st.targets, fmtNum(s.targetCount));
    setText(st.links, links);
    setText(st.flags, s.flags);
    setText(st.tokens, fmtNum(s.tokens));
    setText(st.t, ((now - this.t0) / 1000).toFixed(2));
    setText(st.frame, String(scene.frame % 10000).padStart(4, '0'));
    if (scene.frame % 20 === 0) {
      const fps = Math.round(1000 / Math.max(1, scene.frameMs));
      const q = scene.quality === 1 ? '' : scene.quality > 0 ? ' · eco' : ' · min';
      setText(st.fps, `${Math.min(fps, 240)}${q}`);
      setClass(st.fps, fps < 40 ? 'pink' : fps < 55 ? 'amber' : 'mint');
    }
  }
}
