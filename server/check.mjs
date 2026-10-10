// `silkscope --check`: run every adapter over the user's own transcripts and report how well it
// understood them (no content is printed). The key number is "matched": tool results that found
// the call they belong to. Anything well below 100 % means the agent's format moved.

import fs from 'node:fs';
import path from 'node:path';

const MAX_FILES = 200; // newest transcripts per JSONL source

function walk(adapter, dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && e.name !== 'node_modules' && !adapter.skipDir?.(e.name)) walk(adapter, p, out, depth + 1);
    } else if (adapter.fileFilter(p)) out.push(p);
  }
  return out;
}

function tally(stats, events) {
  for (const ev of events) {
    if (ev.cat === 'tokens') continue;
    if (ev.cat === 'result') {
      stats.results++;
      const call = stats.calls.get(ev.ref);
      if (call) { stats.matched++; if (call.status === 'pending') { call.status = ev.status; if (ev.status === 'error') stats.flagged++; } }
      continue;
    }
    stats.actions++;
    stats.cats[ev.cat] = (stats.cats[ev.cat] || 0) + 1;
    stats.sessions.add(ev.session);
    if (ev.status === 'pending') stats.calls.set(ev.id, { status: 'pending' });
  }
}

export async function check(sources) {
  const report = [];
  for (const { adapter, dir } of sources) {
    const s = { id: adapter.id, label: adapter.label, dir, found: fs.existsSync(dir), units: 0, lines: 0, badLines: 0,
      actions: 0, results: 0, matched: 0, flagged: 0, cats: {}, calls: new Map(), sessions: new Set(), ms: 0 };
    const t0 = performance.now();
    if (s.found && adapter.kind === 'db') {
      const h = await adapter.open(dir).catch(() => null);
      if (h) {
        s.units = adapter.sessions?.(h) ?? 0;
        tally(s, adapter.backfill(h, 0, 6000));
        adapter.close?.(h);
      } else s.note = 'database not readable (needs Node ≥ 22.5 for node:sqlite, or an unknown layout)';
    } else if (s.found) {
      const files = walk(adapter, dir).map((f) => [f, fs.statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(0, MAX_FILES);
      s.units = files.length;
      for (const [f] of files) {
        const ctx = adapter.newContext(f);
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          s.lines++;
          let d;
          try { d = JSON.parse(line); } catch { s.badLines++; continue; }
          try { tally(s, adapter.parseLine(d, ctx)); } catch { s.badLines++; }
        }
      }
    }
    s.ms = Math.round(performance.now() - t0);
    s.pending = [...s.calls.values()].filter((c) => c.status === 'pending').length;
    s.sessions = s.sessions.size;
    delete s.calls;
    report.push(s);
  }
  return report;
}
