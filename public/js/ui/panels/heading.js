// Section heading (top left): the active section, or the whole swarm in overview.

import { CAT } from '../../core/config.js';
import { Panel, setText, setStyle } from '../panel.js';

export class HeadingPanel extends Panel {
  id = 'heading';

  constructor(ctx) {
    super(ctx, { el: '#section' });
    this.title = this.$('#secTitle');
    this.sub = this.$('#secSub');
  }

  update({ store: s, active, overview }) {
    if (overview || !active) {
      setStyle(this.el, '--c', '#ffffff');
      setText(this.title, '∞ SWARM');
      setText(this.sub, `${s.total} events read · ${s.flags} flagged · ${s.sessions.size} sessions · ${s.pending} pending`);
    } else {
      const c = active.cat;
      setStyle(this.el, '--c', c.color);
      setText(this.title, `${String(CAT[c.key].index + 1).padStart(2, '0')} ${c.name.toUpperCase()}`);
      setText(this.sub, `${s.cats[c.key].count} events · ${active.nodes.size} targets · ${s.cats[c.key].flags} flagged · ${c.blurb}`);
    }
  }
}
