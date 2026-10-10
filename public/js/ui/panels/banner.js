// Bottom-centre banner: replay, demo, watched instance, "no activity yet".

import { Panel } from '../panel.js';

// ?clean=1: no demo banner or DEMO badges, for screenshots and videos of the demo feed.
export const CLEAN = new URLSearchParams(location.search).get('clean') === '1';

export class BannerPanel extends Panel {
  id = 'banner';

  constructor(ctx) {
    super(ctx, { el: '#banner' });
    const bus = ctx.bus;
    bus.on('watch', ({ session, announce }) => {
      if (!announce) return;
      this.show(session ? `WATCHING ${session.agent.toUpperCase()} · ${session.project.toUpperCase()}` : 'WATCHING ALL INSTANCES', 'watch');
      setTimeout(() => this.show(''), 2200);
    });
    bus.on('replay', ({ count, done }) => this.show(done ? '' : `REPLAYING ${count} EVENTS FROM THE LAST HOURS`, 'replay'));
    // Announce the demo, then get out of the way (it would sit in every frame of a recording).
    bus.on('demo', ({ on }) => {
      clearTimeout(this.demoT);
      this.show(on && !CLEAN ? 'DEMO FEED · SYNTHETIC SESSIONS' : '', 'demo');
      if (on) this.demoT = setTimeout(() => { if (this.el.classList.contains('demo')) this.show(''); }, 4000);
    });
    bus.on('idle', () => this.show('NO AGENT ACTIVITY YET · START CLAUDE CODE OR CODEX · PRESS D FOR DEMO', 'idle'));
    bus.on('ev', () => { if (this.el.classList.contains('idle')) this.show(''); });
  }

  show(text, cls = '') {
    this.el.textContent = text;
    this.el.className = text ? 'show ' + cls : '';
  }
}
