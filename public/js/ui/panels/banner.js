// Bottom-centre banner: replay, demo, watched instance, "no activity yet".

import { Panel } from '../panel.js';

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
    bus.on('demo', ({ on }) => this.show(on ? 'DEMO FEED · SYNTHETIC SESSIONS' : '', 'demo'));
    bus.on('idle', () => this.show('NO AGENT ACTIVITY YET · START CLAUDE CODE OR CODEX · PRESS D FOR DEMO', 'idle'));
    bus.on('ev', () => { if (this.el.classList.contains('idle')) this.show(''); });
  }

  show(text, cls = '') {
    this.el.textContent = text;
    this.el.className = text ? 'show ' + cls : '';
  }
}
