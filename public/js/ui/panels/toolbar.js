// Toolbar (top right), help overlay and every hotkey:
//   V view · A all · 0/O overview · L labels · M rain · D demo · P perf · S settings · ? help
//   Tab next instance · 1-8 sections · space pause · Esc close panels

import { CATEGORIES } from '../../core/config.js';
import { Panel, toggleClass } from '../panel.js';

export class ToolbarPanel extends Panel {
  id = 'toolbar';

  constructor(ctx) {
    super(ctx, { el: '#controls' });
    const { scene, feed, settings, bus } = ctx;
    const $ = (s) => document.querySelector(s);
    const help = $('#help'), bPause = $('#bPause'), bOverview = $('#bOverview');
    const seg = [...document.querySelectorAll('#viewSeg button')];

    const actions = {
      all: () => feed.watch(null),
      overview: () => scene.setMode(scene.mode === 'overview' ? 'auto' : 'overview'),
      view: () => settings.cycle('view'),
      labels: () => settings.cycle('labels'),
      matrix: () => settings.cycle('matrix'),
      demo: () => settings.set('demo', feed.demoOn ? 'off' : 'on'),
      settings: () => settings.toggle(),
      pause: () => scene.setPaused(!scene.paused),
      help: () => { help.hidden = !help.hidden; },
      perf: () => bus.emit('toggle', 'perf'),
    };
    this.actions = actions;

    this.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
    $('#viewSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) settings.set('view', b.dataset.view);
    });
    bus.on('pause', (p) => toggleClass(bPause, 'on', p));
    bus.on('view', (v) => {
      document.body.classList.toggle('neural', v === 'neural');
      for (const b of seg) toggleClass(b, 'on', b.dataset.view === v);
    });
    bus.on('camera', ({ mode }) => toggleClass(bOverview, 'on', mode === 'overview'));

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '8') scene.focus(CATEGORIES[+k - 1].key);
      else if (k === '0' || k === 'o') actions.overview();
      else if (k === 'a') actions.all();
      else if (k === 'v') actions.view();
      else if (k === 'l') actions.labels();
      else if (k === 'm') actions.matrix();
      else if (k === 'p') actions.perf();
      else if (k === 's') actions.settings();
      else if (k === 'd') actions.demo();
      else if (k === ' ') { e.preventDefault(); actions.pause(); }
      else if (k === '?' || k === 'h') actions.help();
      else if (k === 'escape') { help.hidden = true; settings.toggle(false); bus.emit('inspect', null); scene.clearSelection(); }
      else if (k === 'tab') {
        // Cycle through instances, most recent first.
        e.preventDefault();
        // Same filters as the instances list, so Tab never lands on a hidden session.
        const agents = settings.get('agents'), win = +settings.get('window') * 60e3, now = Date.now();
        const list = feed.instances().filter((s) => (agents === 'all' || s.agent === agents) && (!win || now - s.lastTs < win)).slice(0, 12).map((s) => s.id);
        if (!list.length) return;
        const i = list.indexOf(feed.filter);
        feed.watch(list[(i + 1) % list.length]);
      }
    });
  }
}
