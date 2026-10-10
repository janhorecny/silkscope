// Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.jsonl (GEMINI_CLI_HOME or ~/.gemini).
// Append-only JSONL since the ChatRecordingService migration; older monolithic .json recordings
// are rewritten in place and are not tailed. Lines:
//   {sessionId, projectHash, startTime, …}                       metadata (first line)
//   {id, timestamp, type:'user'|'gemini'|'info'|'error', content, toolCalls[], thoughts[], tokens, model}
//   {$set: {...}}                                                metadata patches (ignored)
// A message is appended again whenever it changes (tool calls progress), so tool calls are
// de-duplicated by id: first sight emits the call, a terminal status emits its result once.

import path from 'node:path';
import { baseContext } from '../events.mjs';
import { clip, base, classifyShell } from './shell.mjs';

function classify(name, a = {}) {
  const n = String(name || '');
  const file = base(a.file_path || a.absolute_path || a.path);
  if (n === 'run_shell_command') { const s = classifyShell(String(a.command || '')); return { cat: s.cat, verb: 'shell', target: s.target }; }
  if (n === 'read_file' || n === 'read_many_files') return { cat: 'read', verb: n, target: file || clip((a.paths || [])[0] || 'files', 40) };
  if (n === 'write_file' || n === 'replace' || n === 'edit') return { cat: 'edit', verb: n, target: file || 'file' };
  if (n === 'glob' || n === 'search_file_content' || n === 'grep' || n === 'list_directory') return { cat: 'search', verb: n, target: clip(a.pattern || a.path || n, 40) };
  if (/web|fetch|search|url/i.test(n)) {
    let target = clip(a.query || a.url || a.prompt || n, 40);
    try { if (a.url) target = new URL(a.url).hostname; } catch {}
    return { cat: 'net', verb: n, target };
  }
  if (/todo|memory|plan|agent|delegate/i.test(n)) return { cat: 'agent', verb: n, target: clip(n, 40) };
  return { cat: n.includes('__') ? 'net' : 'agent', verb: n || 'tool', target: clip(Object.values(a).find((v) => typeof v === 'string') || n, 40) };
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ') : '');
const DONE = /^(success|error|cancelled|canceled|failed)$/i;

export function parseLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object' || d.$set) return out;
  if (d.sessionId && !d.type) { ctx.session = d.sessionId; return out; }
  if (!d.type) return out;
  const ts = Date.parse(d.timestamp) || Date.now();
  if (d.model) ctx.model = d.model;
  const common = { agent: 'gemini', session: ctx.session, project: ctx.project, ts };
  const once = (key) => { if (ctx.seen.has(key)) return false; ctx.seen.add(key); return true; };

  const text = clip(textOf(d.content), 400);
  if (d.type === 'user' && text && once(`m:${d.id}`)) out.push({ ...common, id: d.id || `gm-u-${ts}-${++ctx.seq}`, cat: 'prompt', verb: 'prompt', target: clip(text, 42), detail: text, status: 'ok' });
  if (d.type === 'gemini') {
    for (const th of d.thoughts || []) {
      const t = th.subject || th.description;
      if (t && once(`t:${d.id}:${t}`)) out.push({ ...common, id: `gm-t-${ts}-${++ctx.seq}`, cat: 'think', verb: 'think', target: clip(t, 36), detail: clip(`${th.subject || ''} ${th.description || ''}`, 500), status: 'ok' });
    }
    if (text && once(`m:${d.id}:${text.length > 60 ? 'full' : text}`)) out.push({ ...common, id: `gm-a-${ts}-${++ctx.seq}`, cat: 'think', verb: 'reply', target: clip(text, 36), detail: text, status: 'ok' });
    if (d.tokens && once(`k:${d.id}`)) out.push({ ...common, id: `gm-k-${ts}-${++ctx.seq}`, cat: 'tokens', tokens: (d.tokens.input || 0) - (d.tokens.cached || 0) + (d.tokens.output || 0) });
    for (const tc of d.toolCalls || []) {
      if (!tc.id) continue;
      if (once(`c:${tc.id}`)) {
        const c = classify(tc.name, tc.args);
        out.push({ ...common, id: tc.id, cat: c.cat, verb: c.verb, target: c.target, detail: clip(JSON.stringify(tc.args), 600), status: 'pending' });
      }
      if (DONE.test(tc.status || '') && once(`r:${tc.id}`)) {
        out.push({ ...common, id: `${tc.id}:r`, cat: 'result', ref: tc.id, status: /success/i.test(tc.status) ? 'ok' : 'error', detail: clip(JSON.stringify(tc.result), 400) });
      }
    }
  }
  if (d.type === 'error' && text) out.push({ ...common, id: d.id || `gm-e-${ts}-${++ctx.seq}`, cat: 'think', verb: 'error', target: clip(text, 36), detail: text, status: 'error' });
  if (out.length && ctx.model) out[0].model = ctx.model;
  return out;
}

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'gemini',
  label: 'Gemini CLI',
  defaultDir: (env, home) => path.join(env.GEMINI_CLI_HOME || path.join(home, '.gemini'), 'tmp'),
  fileFilter: (f) => f.endsWith('.jsonl') && path.basename(path.dirname(f)) === 'chats',
  // tmp/<project>/chats/session-….jsonl: newer CLIs name <project> after the folder, older ones hash it.
  newContext: (file) => {
    const proj = path.basename(path.dirname(path.dirname(file)));
    return baseContext(path.basename(file, '.jsonl'), /^[0-9a-f]{40,}$/.test(proj) ? 'gemini' : proj);
  },
  parseLine,
  primeLines: 2,
};
