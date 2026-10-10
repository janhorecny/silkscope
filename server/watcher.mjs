// Tails JSONL transcripts for any set of source adapters (see sources/index.mjs).
// Polling (not fs.watch) keeps it portable across macOS, Linux and Windows.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const BACKFILL_BYTES = 768 * 1024; // tail of each recent transcript to replay
const BACKFILL_FILES = 80;         // never read more than this many files at start-up
const HOT_MS = 15 * 60e3;          // modified this recently: polled every tick
const COLD_EVERY = 10;             // other files: polled once every N ticks, round-robin
const ACTIVE_MS = 120e3;
const FULL_RESCAN_EVERY = 15;      // scans; safety net for filesystems with coarse directory mtimes
const MAX_DEPTH = 6;

export class Watcher extends EventEmitter {
  /**
   * @param {{ sources: { adapter: import('./events.mjs').SourceAdapter, dir: string }[],
   *           backfillHours?: number, backfillMax?: number, interval?: number, scanInterval?: number }} opts
   */
  constructor({ sources, backfillHours = 8, backfillMax = 900, interval = 700, scanInterval = 4000 }) {
    super();
    this.sources = sources
      .filter((s) => s.dir && fs.existsSync(s.dir))
      .map((s) => ({ adapter: s.adapter, agent: s.adapter.id, dir: s.dir }));
    this.backfillMs = backfillHours * 3600e3;
    this.backfillMax = backfillMax;
    this.interval = interval;
    this.scanInterval = scanInterval;
    this.files = new Map(); // path -> { offset, partial, skipFirst, ctx, source, mtime, slot }
    this.dirs = new Map();  // dir -> { mtime, files, dirs }: lets the scan skip unchanged directories
    this.history = [];
    this.stats = { files: 0, active: 0, backfilledFiles: 0 };
    this.ticks = 0;
    this.scans = 0;
    this.slots = 0;
    this.timers = new Set();
  }

  async start() {
    const now = Date.now();
    // Index every transcript, newest first, then backfill only until there is enough history.
    // Reading stops early, so start-up time and peak memory don't grow with the number of old sessions.
    const all = [];
    for (const src of this.sources) {
      for (const f of this.#walk(src, src.dir, true)) {
        try { all.push([f, src, fs.statSync(f)]); } catch {}
      }
    }
    all.sort((a, b) => b[2].mtimeMs - a[2].mtimeMs);
    const backfill = [];
    const want = Math.ceil(this.backfillMax * 1.3);
    let read = 0;
    for (const [f, src, st] of all) {
      const rec = this.#track(f, src, st);
      if (backfill.length < want && read < BACKFILL_FILES && now - st.mtimeMs < this.backfillMs) {
        read++;
        await this.#primeContext(rec, f);
        const start = Math.max(0, st.size - BACKFILL_BYTES);
        rec.offset = start;
        rec.skipFirst = start > 0; // landed mid-line
        for (const ev of await this.#read(f, rec, st.size)) backfill.push(ev);
      } else {
        rec.offset = st.size;
      }
    }
    backfill.sort((a, b) => a.ts - b.ts);
    this.history = backfill.slice(-this.backfillMax);
    this.stats.backfilledFiles = read;
    this.#every(this.interval, () => this.#tick());
    this.#every(this.scanInterval, () => this.#scan(), true);
    return this;
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.stopped = true;
  }

  // setTimeout chain (not setInterval) so a slow pass never overlaps the next one.
  #every(ms, fn, delayFirst = false) {
    const run = async () => {
      this.timers.delete(t);
      try { await fn(); } catch {}
      if (!this.stopped) { t = setTimeout(run, ms); this.timers.add(t); }
    };
    let t = setTimeout(run, delayFirst ? ms : 0);
    this.timers.add(t);
  }

  // Yields transcript files in directories whose mtime changed since the last walk (all of them when
  // `full`). A directory's mtime moves when entries are added, removed or renamed in it, so unchanged
  // directories cost one stat instead of a readdir plus a path per file.
  *#walk(src, dir, full, depth = 0) {
    if (depth > MAX_DEPTH) return;
    let st;
    try { st = fs.statSync(dir); } catch { this.dirs.delete(dir); return; }
    let c = this.dirs.get(dir);
    if (full || !c || c.mtime !== st.mtimeMs) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      c = { mtime: st.mtimeMs, files: [], dirs: [] };
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || src.adapter.skipDir?.(e.name)) continue;
          c.dirs.push(p);
        } else if (src.adapter.fileFilter(p)) c.files.push(p);
      }
      this.dirs.set(dir, c);
      yield* c.files;
    }
    for (const d of c.dirs) yield* this.#walk(src, d, full, depth + 1);
  }

  #track(f, source, st) {
    const rec = { offset: 0, partial: '', skipFirst: false, source, mtime: st.mtimeMs,
      slot: this.slots++ % COLD_EVERY, ctx: source.adapter.newContext(f) };
    this.files.set(f, rec);
    this.stats.files = this.files.size;
    return rec;
  }

  // Some formats keep session/cwd only in the head (Codex session_meta), so parse the first lines
  // for context before reading the tail. Events are discarded and the de-dup set reset, otherwise a
  // short file read from offset 0 would lose the token counts already marked seen.
  async #primeContext(rec, f) {
    const n = rec.source.adapter.primeLines;
    if (!n) return;
    try {
      const fh = await fsp.open(f, 'r');
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const lines = buf.toString('utf8', 0, bytesRead).split('\n').slice(0, n);
      for (const l of lines) {
        try { rec.source.adapter.parseLine(JSON.parse(l), rec.ctx); } catch {}
      }
      rec.ctx.seen?.clear();
    } catch {}
  }

  async #read(f, rec, size) {
    if (size < rec.offset) { rec.offset = 0; rec.partial = ''; rec.skipFirst = false; } // truncated / rotated
    if (size === rec.offset) return [];
    const len = Math.min(size - rec.offset, 8 * 1024 * 1024);
    const fh = await fsp.open(f, 'r');
    const buf = Buffer.alloc(len);
    try { await fh.read(buf, 0, len, rec.offset); } finally { await fh.close(); }
    rec.offset += len;
    const lines = (rec.partial + buf.toString('utf8')).split('\n');
    rec.partial = lines.pop(); // incomplete last line waits for the next append
    if (rec.skipFirst) { lines.shift(); rec.skipFirst = false; }
    const { adapter } = rec.source;
    const events = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      let d;
      try { d = JSON.parse(l); } catch { continue; }
      try {
        for (const ev of adapter.parseLine(d, rec.ctx)) {
          if (!ev.id) ev.id = `${adapter.id}-${ev.ts}-${Math.random().toString(36).slice(2, 8)}`;
          events.push(ev);
        }
      } catch {}
    }
    return events;
  }

  async #tick() {
    const now = Date.now();
    const slot = this.ticks++ % COLD_EVERY;
    let active = 0;
    for (const [f, rec] of this.files) {
      // Hot files every tick; cold ones in a fixed slot, so each is seen every COLD_EVERY ticks.
      if (now - rec.mtime >= HOT_MS && rec.slot !== slot) continue;
      let st;
      try { st = fs.statSync(f); } catch { this.files.delete(f); this.stats.files = this.files.size; continue; }
      if (st.size !== rec.offset) {
        rec.mtime = st.mtimeMs;
        const evs = await this.#read(f, rec, st.size).catch(() => []);
        for (const ev of evs) this.#emit(ev);
      }
      if (now - rec.mtime < ACTIVE_MS) active++;
    }
    this.stats.active = active;
  }

  async #scan() {
    const full = ++this.scans % FULL_RESCAN_EVERY === 0;
    for (const src of this.sources) {
      for (const f of this.#walk(src, src.dir, full)) {
        if (this.files.has(f)) continue;
        let st;
        try { st = fs.statSync(f); } catch { continue; }
        const rec = this.#track(f, src, st);
        // New file created after start-up: read it from the beginning.
        const now = Date.now();
        rec.offset = now - st.birthtimeMs < 10 * 60e3 || now - st.mtimeMs < 10e3 ? 0 : st.size;
      }
    }
  }

  #emit(ev) {
    this.history.push(ev);
    if (this.history.length > this.backfillMax * 2) this.history.splice(0, this.history.length - this.backfillMax);
    this.emit('event', ev);
  }
}
