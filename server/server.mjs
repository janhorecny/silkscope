import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Watcher } from './watcher.mjs';
import { EventHub } from './hub.mjs';
import { staticHandler } from './static.mjs';
import { ADAPTERS } from './sources/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// package.json is the single source of the version (CLI banner, hello, UI top bar).
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Process health for the PERF panel: memory and CPU share since the previous sample.
// Cached for 1 s so several open tabs don't each measure a sliver of the same interval.
let cpuPrev = process.cpuUsage(), cpuAt = process.hrtime.bigint(), last = null, lastAt = 0;
function serverStats(watcher) {
  if (last && Date.now() - lastAt < 1000) return last;
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(cpuPrev);
  const wallUs = Number(now - cpuAt) / 1000;
  cpuPrev = process.cpuUsage(); cpuAt = now;
  const m = process.memoryUsage();
  lastAt = Date.now();
  return last = {
    ...watcher.stats,
    rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal,
    cpu: wallUs > 0 ? ((cpu.user + cpu.system) / wallUs) * 100 : 0,
    history: watcher.history.length,
    uptime: process.uptime(),
  };
}

/**
 * Which adapters to watch and where. `opts.sources` (ids) narrows the set; a dir comes from
 * `opts.dirs[id]`, then `opts[<id>Dir]` (e.g. claudeDir), then the adapter default.
 * Sources whose dir doesn't exist are dropped by the watcher.
 */
export function resolveSources(opts = {}, env = process.env, home = os.homedir()) {
  if (opts.noSources) return []; // --demo-only: nothing from disk
  const want = opts.sources?.length ? new Set(opts.sources) : null;
  return ADAPTERS
    .filter((a) => !want || want.has(a.id))
    .map((adapter) => ({ adapter, dir: opts.dirs?.[adapter.id] || opts[`${adapter.id}Dir`] || adapter.defaultDir(env, home) }));
}

export async function startServer(opts = {}) {
  const watcher = await new Watcher({ sources: resolveSources(opts), backfillHours: opts.backfillHours ?? 8 }).start();
  const hub = new EventHub({ stats: () => serverStats(watcher) });
  const serve = staticHandler(ROOT);
  watcher.on('event', (ev) => hub.broadcast('ev', ev));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/stream') {
      return hub.add(req, res, {
        sources: watcher.sources.map((s) => ({ agent: s.agent, dir: s.dir })),
        files: watcher.stats.files,
        history: watcher.history,
        demo: !!opts.demo,
        version: VERSION,
      });
    }
    serve(req, res, url.pathname);
  });

  const host = opts.host || '127.0.0.1';
  let port = opts.port || 7777;
  await new Promise((resolve, reject) => {
    const tryListen = () => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && !opts.strictPort) { port++; tryListen(); } else reject(e);
      });
      server.listen(port, host, resolve);
    };
    tryListen();
  });
  const close = () => { watcher.stop(); hub.close(); server.close(); };
  return { url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`, watcher, server, hub, close };
}
