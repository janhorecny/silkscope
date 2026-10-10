// opencode: SQLite at ~/.local/share/opencode/opencode.db (XDG_DATA_HOME honoured).
// A database source, not a JSONL one: the watcher calls open → backfill → poll (see events.mjs).
// Read through Node's built-in node:sqlite (Node ≥ 22.5), read-only, so zero dependencies stay.
// Verified against a local opencode 1.x database:
//   session(id, directory, title, …)
//   message(id, session_id, data: {role, modelID, …})
//   part(id, message_id, session_id, time_updated, data)   data.type:
//     tool         {callID, tool, state:{status pending|running|completed|error, input, metadata.exit, output}}
//     text         {text, synthetic?, time:{start, end}}     role user → prompt, assistant → reply
//     reasoning    {text, time}
//     step-finish  {tokens:{input, output, reasoning, cache:{read, write}}}
// A part is rewritten as it progresses (time_updated moves), so each is tracked by id: a tool call is
// emitted on first sight and its result once it reaches completed/error.

import fs from 'node:fs';
import path from 'node:path';
import { clip, base, classifyShell } from './shell.mjs';

const BATCH = 2000;

function classify(name, a = {}) {
  const n = String(name || '');
  const file = base(a.filePath || a.file_path || a.path);
  if (n === 'bash') { const s = classifyShell(String(a.command || '')); return { cat: s.cat, verb: 'bash', target: s.target }; }
  if (n === 'read') return { cat: 'read', verb: 'read', target: file || 'file' };
  if (n === 'edit' || n === 'write' || n === 'patch' || n === 'multiedit') return { cat: 'edit', verb: n, target: file || 'file' };
  if (n === 'grep' || n === 'glob' || n === 'list' || n === 'codesearch') return { cat: 'search', verb: n, target: clip(a.pattern || a.query || a.path || n, 40) };
  if (n === 'webfetch' || n === 'websearch') {
    let target = clip(a.url || a.query || n, 40);
    try { if (a.url) target = new URL(a.url).hostname; } catch {}
    return { cat: 'net', verb: n, target };
  }
  if (/^(task|todowrite|todoread|skill|question|plan.*)$/.test(n)) return { cat: n === 'question' ? 'prompt' : 'agent', verb: n, target: clip(a.description || a.name || n, 40) };
  // MCP tools arrive as "<server>_<tool>".
  const first = Object.values(a).find((v) => typeof v === 'string');
  return { cat: n.includes('_') ? 'net' : 'agent', verb: n.replace('_', ':'), target: clip(first || n, 40) };
}

async function openDb(file) {
  // node:sqlite prints an ExperimentalWarning on first import; it's expected, keep the console clean.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    return null; // Node too old for node:sqlite, or the file is not a database
  } finally {
    process.emitWarning = emit;
  }
}

function toEvents(rows, h) {
  const out = [];
  for (const r of rows) {
    let d;
    try { d = JSON.parse(r.data); } catch { continue; }
    if (h.seenAt.get(r.id) === r.time_updated) continue;
    h.seenAt.set(r.id, r.time_updated);
    if (h.seenAt.size > 50000) h.seenAt.clear();
    h.cursor = Math.max(h.cursor, r.time_updated);
    const common = { agent: 'opencode', session: r.session_id, project: base(r.directory) || 'opencode', ts: r.time_updated };
    if (r.model) common.model = r.model;
    if (d.type === 'tool') {
      const st = d.state || {};
      if (!h.calls.has(r.id)) {
        h.calls.add(r.id);
        const c = classify(d.tool, st.input);
        out.push({ ...common, id: r.id, cat: c.cat, verb: c.verb, target: c.target, detail: clip(JSON.stringify(st.input), 600), status: 'pending', ts: st.time?.start || r.time_updated });
      }
      if ((st.status === 'completed' || st.status === 'error') && !h.done.has(r.id)) {
        h.done.add(r.id);
        const exit = st.metadata?.exit;
        const failed = st.status === 'error' || (typeof exit === 'number' && exit !== 0);
        out.push({ ...common, id: `${r.id}:r`, cat: 'result', ref: r.id, status: failed ? 'error' : 'ok', detail: clip(st.error || st.output, 400) });
      }
    } else if ((d.type === 'text' || d.type === 'reasoning') && d.text?.trim() && !d.synthetic) {
      // Streamed text is rewritten until it ends; emit it once, when finished.
      if (d.time && !d.time.end) continue;
      if (h.done.has(r.id)) continue;
      h.done.add(r.id);
      const t = clip(d.text, 400);
      if (d.type === 'text' && r.role === 'user') out.push({ ...common, id: r.id, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
      else out.push({ ...common, id: r.id, cat: 'think', verb: d.type === 'reasoning' ? 'think' : 'reply', target: clip(t, 36), detail: t, status: 'ok' });
    } else if (d.type === 'step-finish' && d.tokens && !h.done.has(r.id)) {
      h.done.add(r.id);
      const k = d.tokens;
      out.push({ ...common, id: r.id, cat: 'tokens', tokens: (k.input || 0) + (k.output || 0) + (k.reasoning || 0) + (k.cache?.write || 0) });
    }
  }
  return out;
}

const QUERY = `SELECT p.id, p.session_id, p.time_updated, p.data, s.directory,
    json_extract(m.data, '$.role') AS role, json_extract(m.data, '$.modelID') AS model
  FROM part p JOIN message m ON m.id = p.message_id JOIN session s ON s.id = p.session_id`;

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'opencode',
  label: 'opencode',
  kind: 'db',
  defaultDir: (env, home) => path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode'),
  async open(dir) {
    const file = path.join(dir, 'opencode.db');
    if (!fs.existsSync(file)) return null;
    const db = await openDb(file);
    if (!db) return null;
    try {
      return { db, file, cursor: 0, seenAt: new Map(), calls: new Set(), done: new Set(),
        recent: db.prepare(`${QUERY} WHERE p.time_updated > ? ORDER BY p.time_updated DESC LIMIT ?`),
        since: db.prepare(`${QUERY} WHERE p.time_updated >= ? ORDER BY p.time_updated ASC LIMIT ${BATCH}`),
        count: db.prepare('SELECT count(*) AS n FROM session') };
    } catch {
      db.close();
      return null; // schema we don't recognise (older JSON-file storage, or a future layout)
    }
  },
  // Newest parts within the window, oldest first.
  backfill(h, sinceMs, max) {
    const rows = h.recent.all(sinceMs, Math.ceil(max * 2.5)).reverse();
    const evs = toEvents(rows, h);
    h.cursor = Math.max(h.cursor, Date.now() - 1000, ...rows.map((r) => r.time_updated));
    return evs;
  },
  // Parts updated since the cursor (>= plus the per-part timestamp memo, so equal-ms writes aren't lost).
  // part.time_updated has no index, so the query scans; it only runs when the database or its WAL
  // actually changed (two stats per tick otherwise).
  poll(h) {
    const sig = [h.file, `${h.file}-wal`].map((f) => { try { const st = fs.statSync(f); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; } }).join('|');
    if (sig === h.sig) return [];
    h.sig = sig;
    try { return toEvents(h.since.all(h.cursor), h); } catch { return []; }
  },
  sessions(h) { try { return h.count.get().n; } catch { return 0; } },
  close(h) { try { h.db.close(); } catch {} },
};
