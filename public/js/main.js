import { Store } from './store.js';
import { Scene } from './scene.js';
import { Hud } from './hud.js';
import { startDemo } from './demo.js';
import { Perf } from './perf.js';
import { Settings } from './settings.js';
import { CATEGORIES } from './config.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const store = new Store();
const scene = new Scene($('#cv'), store);
const hud = new Hud(store, scene);

// Every event ever seen (so switching instance can rebuild instantly), plus a per-session index
// for the instance picker that is independent of the current filter.
const RAW_MAX = 8000;
let raw = [];
const sessions = new Map();
let filter = null;
let stopDemo = null;

const perf = new Perf(scene, () => {
  let nodes = 0, tentacles = 0;
  for (const c of scene.clusterList) nodes += c.nodes.size;
  for (const sp of scene.spiders.values()) tentacles += sp.tentacles.length;
  return { raw: raw.length, nodes, synapses: scene.synapses.size, signals: scene.signals.length, bursts: scene.bursts.length, spiders: scene.spiders.size, tentacles };
});

hud.getInstances = () => [...sessions.values()].sort((a, b) => b.lastTs - a.lastTs);
hud.getListOptions = () => ({ windowMin: +settings.get('window'), agents: settings.get('agents') });
hud.collapsed = (() => { try { return localStorage.getItem('swarm.collapsed') === '1'; } catch { return false; } })();
hud.getCurrent = () => filter;
scene.onSelect = (sel) => hud.showInspector(sel);
scene.onFocus = () => $('#bOverview').classList.toggle('on', scene.mode === 'overview');

function track(ev) {
  if (!ev.session || ev.cat === 'tokens') return;
  let s = sessions.get(ev.session);
  if (!s) sessions.set(ev.session, (s = { id: ev.session, agent: ev.agent, project: ev.project || '?', lastTs: 0, events: 0, lastCat: null, demo: !!ev.demo, model: '' }));
  if (ev.project) s.project = ev.project;
  if (ev.model) s.model = ev.model;
  s.lastTs = Math.max(s.lastTs, ev.ts);
  if (ev.cat !== 'result') { s.events++; s.lastCat = ev.cat; }
}

function apply(ev, animate) {
  const res = store.ingest(ev);
  if (!res.kind) return;
  scene.handle(ev, res, animate);
  if (animate) hud.narrate(ev, res);
}

// Which events feed the map and HUD: the watched instance (if any) and the agents setting.
function passes(ev) {
  if (filter && ev.session !== filter) return false;
  const a = settings.get('agents');
  return a === 'both' || ev.agent === a;
}

function ingest(ev, animate = true) {
  raw.push(ev);
  if (raw.length > RAW_MAX) raw = raw.slice(-RAW_MAX * 0.9);
  track(ev);
  if (!passes(ev)) return;
  apply(ev, animate);
}

// Silent rebuild of the whole picture for the current filter.
function rebuild() {
  store.reset();
  scene.reset();
  hud.reset();
  for (const ev of raw) if (passes(ev)) apply(ev, false);
  const recent = [...store.sessions.values()].filter((s) => s.id === filter || Date.now() - s.lastTs < 30 * 60e3);
  scene.placeSpiders(recent);
}

function watch(id) {
  filter = id || null;
  try { localStorage.setItem('swarm.instance', filter || ''); } catch {}
  rebuild();
  scene.watch(filter);
  hud.showInspector(null);
  const s = filter && sessions.get(filter);
  banner(s ? `WATCHING ${s.agent.toUpperCase()} · ${s.project.toUpperCase()}` : 'WATCHING ALL INSTANCES', 'watch');
  setTimeout(() => banner(''), 2200);
}

// ---------------------------------------------------------------- replay
// History is folded in silently, then the tail is replayed with motion so the screen builds itself.
function replay(history) {
  const saved = (() => { try { return localStorage.getItem('swarm.instance'); } catch { return null; } })();
  for (const ev of history) { raw.push(ev); track(ev); }
  if (saved && sessions.has(saved)) filter = saved;
  const mine = raw.filter(passes);
  const ANIM = 60;
  const cut = Math.max(0, mine.length - ANIM);
  for (let i = 0; i < cut; i++) apply(mine[i], false);
  scene.placeSpiders([...store.sessions.values()].filter((s) => s.id === filter || Date.now() - s.lastTs < 30 * 60e3));
  scene.watch(filter);
  const tail = mine.slice(cut);
  if (!tail.length) return;
  banner(`REPLAYING ${mine.length} EVENTS FROM THE LAST HOURS`, 'replay');
  scene.speed = 2.2;
  let i = 0;
  const step = () => {
    if (i >= tail.length) { scene.speed = 1; banner(''); return; }
    apply(tail[i++], true);
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
  let first = true;
  es.addEventListener('hello', (m) => {
    const hello = JSON.parse(m.data);
    $('#live').className = 'live on';
    $('#live').textContent = '● LIVE';
    $('#srcs').textContent = hello.sources.map((s) => s.agent).join(' + ') || 'no sources';
    if (first) { replay(hello.history); started = true; }
    first = false;
    if ((hello.demo || params.has('demo')) && !stopDemo) settings.set('demo', 'on');
    else if (!hello.history.length && !stopDemo) banner('NO AGENT ACTIVITY YET · START CLAUDE CODE OR CODEX · PRESS D FOR DEMO', 'idle');
  });
  es.addEventListener('ping', (m) => perf.setServer(JSON.parse(m.data)));
  es.addEventListener('ev', (m) => {
    if ($('#banner').classList.contains('idle')) banner('');
    ingest(JSON.parse(m.data), true);
  });
  es.onerror = () => {
    $('#live').className = 'live off';
    $('#live').textContent = '○ OFFLINE';
  };
}

function setDemo(on) {
  if (!on && stopDemo) { stopDemo(); stopDemo = null; banner(''); }
  else if (on && !stopDemo) { stopDemo = startDemo((ev) => ingest(ev, true)); banner('DEMO FEED · SYNTHETIC SESSIONS', 'demo'); }
}
const toggleDemo = () => settings.set('demo', stopDemo ? 'off' : 'on');

function setView(v) {
  scene.view = v;
  document.body.classList.toggle('neural', v === 'neural');
  for (const b of document.querySelectorAll('#viewSeg button')) b.classList.toggle('on', b.dataset.view === v);
}

// Apply one setting to the running app.
function applySetting(k, v) {
  if (k === 'view') setView(v);
  else if (k === 'camera') scene.cameraMode = v;
  else if (k === 'labels') scene.labelMode = v;
  else if (k === 'quality') { scene.qualityMode = v; if (v !== 'auto') { scene.quality = v === 'full' ? 1 : 0.5; scene.resize(); } }
  else if (k === 'motion') scene.reduced = v === 'reduced';
  else if (k === 'matrix') scene.matrix = v === 'on';
  else if (k === 'demo') setDemo(v === 'on');
  else if (k === 'agents') { if (started) rebuild(); }
  hud._instKey = '';
}
let started = false;
const settings = new Settings(applySetting);

// ---------------------------------------------------------------- controls
const actions = {
  all: () => watch(null),
  overview: () => scene.setMode(scene.mode === 'overview' ? 'auto' : 'overview'),
  view: () => settings.cycle('view'),
  labels: () => settings.cycle('labels'),
  matrix: () => settings.cycle('matrix'),
  demo: toggleDemo,
  settings: () => settings.toggle(),
  pause: () => { scene.paused = !scene.paused; $('#bPause').classList.toggle('on', scene.paused); },
  help: () => { $('#help').hidden = !$('#help').hidden; },
  perf: () => perf.toggle(),
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) settings.set('view', b.dataset.view);
});
$('#instances').addEventListener('click', (e) => {
  if (e.target.closest('.col')) {
    hud.collapsed = !hud.collapsed;
    try { localStorage.setItem('swarm.collapsed', hud.collapsed ? '1' : '0'); } catch {}
    hud._instKey = '';
    return;
  }
  const b = e.target.closest('.inst');
  if (b) watch(b.dataset.s || null);
});
$('#inspector').addEventListener('click', (e) => {
  const b = e.target.closest('.watch');
  if (b) watch(b.dataset.s);
});
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
  else if (k === 'escape') { $('#help').hidden = true; settings.toggle(false); hud.showInspector(null); scene.selected = null; }
  else if (k === 'tab') {
    // Cycle through instances, most recent first.
    e.preventDefault();
    const list = hud.getInstances().slice(0, 12).map((s) => s.id);
    if (!list.length) return;
    const i = list.indexOf(filter);
    watch(list[(i + 1) % list.length]);
  }
});
window.addEventListener('resize', () => scene.resize());

// Apply saved settings (URL ?view= and ?demo override for this load).
for (const k of ['view', 'camera', 'labels', 'quality', 'motion', 'matrix']) applySetting(k, settings.get(k));
if (params.get('view')) settings.set('view', params.get('view'));

// ---------------------------------------------------------------- loop
let last = performance.now();
let loopErrors = 0;
function loop(now) {
  // Schedule first so one bad frame can never stop the animation.
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = Math.max(last, now);
  try {
    const t0 = performance.now();
    if (!scene.paused) scene.update(dt, now);
    scene.draw(now);
    hud.frame(now, dt);
    perf.sample(now, performance.now() - t0);
  } catch (err) {
    if (loopErrors++ < 5) console.error('[swarm] frame error', err);
  }
}
requestAnimationFrame(loop);
connect();

// Debug handle: lets tests drive frames even when the tab is hidden (rAF is paused there).
window.__swarm = {
  store, scene, hud, perf, watch, setView, ingest,
  step(n = 60, dt = 1 / 60) {
    last = Math.max(last, performance.now());
    for (let i = 0; i < n; i++) { last += dt * 1000; scene.update(dt, last); hud.frame(last, dt); }
    scene.draw(last);
    return scene.frame;
  },
};
