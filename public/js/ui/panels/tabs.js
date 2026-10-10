// Section tabs: the current section fills with its colour; click to focus a section.

import { CATEGORIES } from '../../core/config.js';
import { Panel, setText, toggleClass } from '../panel.js';

export class TabsPanel extends Panel {
  id = 'tabs';

  constructor(ctx) {
    super(ctx, { el: '#tabs' });
    this.el.innerHTML = CATEGORIES.map((c) =>
      `<button class="tab" data-k="${c.key}" style="--c:${c.color}"><span>${c.name}</span><i></i></button>`).join('');
    this.tabs = [...this.el.querySelectorAll('.tab')].map((el) => ({ el, k: el.dataset.k, i: el.querySelector('i') }));
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) ctx.scene.focus(b.dataset.k);
    });
  }

  update({ store: s, active, overview }) {
    for (const t of this.tabs) {
      toggleClass(t.el, 'on', !overview && active?.key === t.k);
      setText(t.i, s.cats[t.k].count || '');
    }
  }
}
