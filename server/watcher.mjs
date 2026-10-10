// Polls the Claude Code and Codex transcript directories and tails JSONL files.
// Polling (not fs.watch) keeps it portable across macOS, Linux and Windows.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseClaudeLine, parseCodexLine } from './parsers.mjs';

const BACKFILL_BYTES = 1.5 * 1024 * 1024;

async function walk(dir, out, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'memory' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      await walk(p, out, depth + 1);
    } else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

export class Watcher extends EventEmitter {
  constructor({ claudeDir, codexDir, backfillHours = 8, backfillMax = 900, interval = 700 }) {
    super();
    this.sources = [
      { agent: 'claude', dir: claudeDir, parse: parseClaudeLine },
      { agent: 'codex', dir: codexDir, parse: parseCodexLine },
    ].filter((s) => s.dir && fs.existsSync(s.dir));
    this.backfillMs = backfillHours * 3600e3;
    this.backfillMax = backfillMax;
    this.interval = interval;
    this.files = new Map(); // path -> { offset, partial, ctx, source, mtime }
    this.history = [];
    this.stats = { files: 0, active: 0 };
  }

  async start() {
    const now = Date.now();
    const backfill = [];
    for (const src of this.sources) {
      const list = [];
      await walk(src.dir, list);
      for (const f of list) {
        let st;
        try { st = fs.statSync(f); } catch { continue; }
        const rec = this.#track(f, src, st);
        if (now - st.mtimeMs < this.backfillMs) {
          await this.#primeContext(rec, f);
          const start = Math.max(0, st.size - BACKFILL_BYTES);
          rec.offset = start;
          rec.skipFirst = start > 0;
          backfill.push(...(await this.#read(f, rec, st.size)));
        } else {
          rec.offset = st.size;
        }
      }
    }
    backfill.sort((a, b) => a.ts - b.ts);
    this.history = backfill.slice(-this.backfillMax);
    this.#loop();
    this.#scanLoop();
    return this;
  }

  #track(f, source, st) {
    const rec = { offset: 0, partial: '', source, mtime: st.mtimeMs, size: st.size,
      ctx: { session: path.basename(f, '.jsonl'), project: '', seenMsg: new Set(), model: '' } };
    if (source.agent === 'claude') {
      // ~/.claude/projects/-Users-me-dev-app/<session>.jsonl  ->  "app"
      const dir = path.basename(path.dirname(f));
      rec.ctx.project = dir.split('-').filter(Boolean).pop() || dir;
    }
    this.files.set(f, rec);
    this.stats.files = this.files.size;
    return rec;
  }

  // Codex keeps cwd only in the first line; Claude repeats it, but read the head anyway.
  async #primeContext(rec, f) {
    try {
      const fh = await fsp.open(f, 'r');
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const lines = buf.toString('utf8', 0, bytesRead).split('\n').slice(0, 12);
      for (const l of lines) {
        try { rec.source.parse(JSON.parse(l), rec.ctx); } catch {}
      }
      rec.ctx.seenMsg.clear();
    } catch {}
  }

  async #read(f, rec, size) {
    if (size < rec.offset) { rec.offset = 0; rec.partial = ''; } // truncated / rotated
    if (size === rec.offset) return [];
    const len = Math.min(size - rec.offset, 8 * 1024 * 1024);
    const fh = await fsp.open(f, 'r');
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, rec.offset);
    await fh.close();
    rec.offset += len;
    let text = rec.partial + buf.toString('utf8');
    const lines = text.split('\n');
    rec.partial = lines.pop();
    if (rec.skipFirst) { lines.shift(); rec.skipFirst = false; }
    const events = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      let d;
      try { d = JSON.parse(l); } catch { continue; }
      try {
        for (const ev of rec.source.parse(d, rec.ctx)) {
          if (!ev.id) ev.id = `${rec.source.agent}-${ev.ts}-${Math.random().toString(36).slice(2, 8)}`;
          events.push(ev);
        }
      } catch {}
    }
    return events;
  }

  async #loop() {
    const tick = async () => {
      const now = Date.now();
      let active = 0;
      for (const [f, rec] of this.files) {
        // Hot files are polled each tick; cold ones every ~10 ticks.
        const hot = now - rec.mtime < 15 * 60e3;
        if (!hot && Math.random() > 0.1) continue;
        let st;
        try { st = fs.statSync(f); } catch { this.files.delete(f); continue; }
        if (st.size !== rec.offset) {
          rec.mtime = st.mtimeMs;
          const evs = await this.#read(f, rec, st.size).catch(() => []);
          for (const ev of evs) this.#emit(ev);
        }
        if (now - rec.mtime < 120e3) active++;
      }
      this.stats.active = active;
      setTimeout(tick, this.interval);
    };
    tick();
  }

  async #scanLoop() {
    const scan = async () => {
      for (const src of this.sources) {
        const list = [];
        await walk(src.dir, list);
        for (const f of list) {
          if (this.files.has(f)) continue;
          let st;
          try { st = fs.statSync(f); } catch { continue; }
          const rec = this.#track(f, src, st);
          // New file created after startup: read it from the beginning.
          if (Date.now() - st.birthtimeMs < 10 * 60e3 || Date.now() - st.mtimeMs < 10e3) rec.offset = 0;
          else rec.offset = st.size;
        }
      }
      setTimeout(scan, 4000);
    };
    setTimeout(scan, 4000);
  }

  #emit(ev) {
    this.history.push(ev);
    if (this.history.length > this.backfillMax * 2) this.history.splice(0, this.history.length - this.backfillMax);
    this.emit('event', ev);
  }
}
