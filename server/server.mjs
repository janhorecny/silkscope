import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Watcher } from './watcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

// Process health for the PERF panel: memory and CPU share since the previous sample.
let cpuPrev = process.cpuUsage(), cpuAt = process.hrtime.bigint();
function serverStats(watcher) {
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(cpuPrev);
  const wallUs = Number(now - cpuAt) / 1000;
  cpuPrev = process.cpuUsage(); cpuAt = now;
  const m = process.memoryUsage();
  return {
    ...watcher.stats,
    rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal,
    cpu: wallUs > 0 ? ((cpu.user + cpu.system) / wallUs) * 100 : 0,
    history: watcher.history.length,
    uptime: process.uptime(),
  };
}

export async function startServer(opts = {}) {
  const home = os.homedir();
  const claudeDir = opts.claudeDir || process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') || path.join(home, '.claude', 'projects');
  const codexDir = opts.codexDir || (process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'sessions') : path.join(home, '.codex', 'sessions'));

  const watcher = await new Watcher({ claudeDir, codexDir, backfillHours: opts.backfillHours ?? 8 }).start();
  const clients = new Set();

  watcher.on('event', (ev) => {
    const msg = `event: ev\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(msg);
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const hello = {
        sources: watcher.sources.map((s) => ({ agent: s.agent, dir: s.dir })),
        files: watcher.stats.files,
        history: watcher.history,
        demo: !!opts.demo,
      };
      res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(`event: ping\ndata: ${JSON.stringify(serverStats(watcher))}\n\n`), 2000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
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
  return { url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`, watcher, server };
}
