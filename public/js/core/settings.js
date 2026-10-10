// User settings: one schema drives the panel, the defaults and persistence (localStorage).

import { AGENTS } from './config.js';

const KEY = 'swarm.settings';
const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const SCHEMA = [
  { key: 'view', label: 'View', hint: 'crawler: the reference look · neural: abstract network of targets', options: [['crawler', 'crawler'], ['neural', 'neural']], def: 'crawler' },
  { key: 'camera', label: 'Camera', hint: 'cinematic: cuts and slow dolly when the watched session changes section · calm: smooth follow · still: only you move it', options: [['cinematic', 'cinematic'], ['calm', 'calm'], ['still', 'still']], def: 'cinematic' },
  { key: 'labels', label: 'Labels', hint: 'touched: only targets a tentacle is on · all: every recent target · none: hover only', options: [['touched', 'touched'], ['all', 'all recent'], ['none', 'none']], def: 'touched' },
  { key: 'agents', label: 'Agents', hint: 'which agents feed the map and the HUD', options: [['all', 'all'], ...Object.keys(AGENTS).map((id) => [id, id])], def: 'all' },
  { key: 'window', label: 'Instance list', hint: 'hide sessions with no activity in this window', options: [['15', '15 min'], ['60', '1 h'], ['480', '8 h'], ['0', 'all']], def: '480' },
  { key: 'quality', label: 'Render quality', hint: 'auto drops resolution and effects when FPS falls below ~45', options: [['auto', 'auto'], ['full', 'full'], ['eco', 'eco']], def: 'auto' },
  { key: 'motion', label: 'Motion', hint: 'reduced: no tentacle fans, bursts, camera swoops or matrix rain', options: [['full', 'full'], ['reduced', 'reduced']], def: prefersReduced ? 'reduced' : 'full' },
  { key: 'matrix', label: 'Matrix rain', hint: 'falling glyphs behind the map', options: [['on', 'on'], ['off', 'off']], def: 'on' },
  { key: 'intro', label: 'Intro screen', hint: 'the loading screen with the START button when the app opens', options: [['show', 'show'], ['skip', 'skip']], def: 'show' },
  { key: 'demo', label: 'Demo feed', hint: 'adds synthetic sessions (marked DEMO); never mixed into real data on disk', options: [['off', 'off'], ['on', 'on']], def: 'off', volatile: true },
];

export class Settings {
  constructor(onChange) {
    this.onChange = onChange;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
    this.v = {};
    for (const s of SCHEMA) {
      const ok = s.options.some(([k]) => k === saved[s.key]);
      this.v[s.key] = ok && !s.volatile ? saved[s.key] : s.def;
    }
    this.el = document.querySelector('#settings');
    this.#render();
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (b) this.set(b.dataset.k, b.dataset.v);
      if (e.target.closest('.reset')) for (const s of SCHEMA) this.set(s.key, s.def);
    });
  }

  get(k) { return this.v[k]; }

  set(k, val) {
    if (this.v[k] === val) return;
    this.v[k] = val;
    try {
      const keep = Object.fromEntries(SCHEMA.filter((s) => !s.volatile).map((s) => [s.key, this.v[s.key]]));
      localStorage.setItem(KEY, JSON.stringify(keep));
    } catch {}
    this.#render();
    this.onChange(k, val);
  }

  // Cycle to the next option (used by hotkeys).
  cycle(k) {
    const s = SCHEMA.find((x) => x.key === k);
    const i = s.options.findIndex(([v]) => v === this.v[k]);
    this.set(k, s.options[(i + 1) % s.options.length][0]);
  }

  toggle(open) {
    this.el.hidden = open == null ? !this.el.hidden : !open;
    document.querySelector('#bSettings').classList.toggle('on', !this.el.hidden);
  }

  #render() {
    this.el.innerHTML = `<header><span>SETTINGS</span><button class="reset" title="Restore defaults">reset</button></header>` +
      SCHEMA.map((s) => `<div class="set"><div class="lab">${s.label}</div>
        <div class="seg">${s.options.map(([v, l]) => `<button data-k="${s.key}" data-v="${v}" class="${this.v[s.key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="hint">${s.hint}</div></div>`).join('') +
      `<p class="foot">saved in this browser · hotkeys: V view · L labels · M rain · D demo · S settings</p>`;
  }
}
