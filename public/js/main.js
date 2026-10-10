import { Store } from './store.js';
import { Scene } from './scene.js';
import { Hud } from './hud.js';
import { startDemo } from './demo.js';
import { CATEGORIES } from './config.js';

const $ = (s) => document.querySelector(s);
const store = new Store();
const scene = new Scene($('#cv'), store);
const hud = new Hud(store, scene);

scene.onSelect = (sel) => hud.showInspector(sel);
scene.onFocus = () => {
  $('#bOverview').classList.toggle('on', scene.mode === 'overview');
};

let stopDemo = null;
let liveCount = 0;

function ingest(ev, animate = true) {
  const res = store.ingest(ev);
  if (!res.kind) return;
  scene.handle(ev, res, animate);
  if (animate) hud.narrate(ev, res);
}

// ---------------------------------------------------------------- replay
// History is folded in instantly, then the tail is replayed with motion so the
// screen builds itself up like the reference recording.
function replay(history) {
  const ANIM = 70;
  const cut = Math.max(0, history.length - ANIM);
  for (let i = 0; i < cut; i++) ingest(history[i], false);
  const tail = history.slice(cut);
  if (!tail.length) return;
  banner(`REPLAYING ${history.length} EVENTS FROM THE LAST HOURS`, 'replay');
  scene.speed = 2.2;
  let i = 0;
  const step = () => {
    if (i >= tail.length) { scene.speed = 1; banner(''); return; }
    ingest(tail[i++], true);
    setTimeout(step, 90);
  };
  step();
}

function banner(text, cls = '') {
  const b = $('#banner');
  b.textContent = text;
  b.className = text ? 'show ' + cls : '';
}

// ---------------------------------------------------------------- stream
function connect() {
  const es = new EventSource('/stream');
  es.addEventListener('hello', (m) => {
    const hello = JSON.parse(m.data);
    $('#live').className = 'live on';
    $('#live').textContent = '● LIVE';
    $('#srcs').textContent = hello.sources.map((s) => s.agent).join(' + ') || 'no sources';
    if (store.total === 0) replay(hello.history);
    if ((hello.demo || new URLSearchParams(location.search).has('demo')) && !stopDemo) toggleDemo();
    else if (!hello.history.length && !stopDemo) banner('NO AGENT ACTIVITY YET · START CLAUDE CODE OR CODEX · PRESS D FOR DEMO', 'idle');
  });
  es.addEventListener('ev', (m) => {
    liveCount++;
    if ($('#banner').classList.contains('idle')) banner('');
    ingest(JSON.parse(m.data), true);
  });
  es.onerror = () => {
    $('#live').className = 'live off';
    $('#live').textContent = '○ OFFLINE';
  };
}

function toggleDemo() {
  if (stopDemo) { stopDemo(); stopDemo = null; banner(''); }
  else { stopDemo = startDemo((ev) => ingest(ev, true)); banner('DEMO FEED · SYNTHETIC SESSIONS', 'demo'); }
  $('#bDemo').classList.toggle('on', !!stopDemo);
}

// ---------------------------------------------------------------- controls
const actions = {
  overview: () => scene.setMode(scene.mode === 'overview' ? 'auto' : 'overview'),
  follow: () => { scene.followSpider = null; scene.setMode('auto'); },
  matrix: () => { scene.matrix = !scene.matrix; $('#bMatrix').classList.toggle('on', scene.matrix); },
  demo: toggleDemo,
  pause: () => { scene.paused = !scene.paused; $('#bPause').classList.toggle('on', scene.paused); },
  help: () => { $('#help').hidden = !$('#help').hidden; },
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
$('#roster').addEventListener('click', (e) => {
  const b = e.target.closest('.crawler');
  if (!b) return;
  const sp = scene.spiders.get(b.dataset.s);
  if (sp) { scene.followSpider = sp; scene.setMode('auto'); hud.showInspector({ type: 'spider', spider: sp }); }
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '8') scene.focus(CATEGORIES[+k - 1].key);
  else if (k === '0' || k === 'o') actions.overview();
  else if (k === 'f') actions.follow();
  else if (k === 'm') actions.matrix();
  else if (k === 'd') actions.demo();
  else if (k === ' ') { e.preventDefault(); actions.pause(); }
  else if (k === '?' || k === 'h') actions.help();
  else if (k === 'escape') { $('#help').hidden = true; hud.showInspector(null); scene.selected = null; }
  else if (k === 'tab') {
    e.preventDefault();
    const sp = [...scene.spiders.values()];
    if (!sp.length) return;
    const i = sp.indexOf(scene.followSpider);
    scene.followSpider = sp[(i + 1) % sp.length];
    scene.setMode('auto');
    hud.showInspector({ type: 'spider', spider: scene.followSpider });
  }
});
window.addEventListener('resize', () => scene.resize());

// ---------------------------------------------------------------- loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!scene.paused) scene.update(dt, now);
  scene.draw(now);
  hud.frame(now, dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
connect();

// Debug handle: lets tests drive frames even when the tab is hidden (rAF is paused there).
window.__swarm = {
  store, scene, hud,
  step(n = 60, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { last += dt * 1000; scene.update(dt, last); hud.frame(last, dt); }
    scene.draw(last);
    return scene.frame;
  },
};
