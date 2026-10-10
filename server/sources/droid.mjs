// Factory Droid: ~/.factory/sessions/<encoded-cwd>/<uuid>.jsonl
//   {type:'session_start', id, title, cwd, owner, version}
//   {type:'message', id, timestamp, message:{role, content}}   content: string | blocks
//     assistant blocks: text | thinking | tool_use{id, name, input}   (Anthropic-style)
//     user blocks: text | tool_result{tool_use_id, content, is_error}
// Format confirmed against local transcripts (text) and open-source Droid parsers (tool blocks).

import path from 'node:path';
import { baseContext } from '../events.mjs';
import { clip, base, classifyShell } from './shell.mjs';

function classify(name, a = {}) {
  const n = String(name || '');
  const file = base(a.file_path || a.path || a.filePath);
  if (/^(execute|bash|shell|run)$/i.test(n)) {
    const s = classifyShell(String(a.command || a.cmd || ''));
    return { cat: s.cat, verb: n, target: s.target };
  }
  if (/^(read|view|cat)$/i.test(n)) return { cat: 'read', verb: n, target: file || 'file' };
  if (/^(edit|multiedit|create|write|applypatch|apply_patch)$/i.test(n)) return { cat: 'edit', verb: n, target: file || base(String(a.patch || '').match(/File: (\S+)/)?.[1]) || 'file' };
  if (/^(grep|glob|ls|list|find|search)$/i.test(n)) {
    const q = a.pattern || (Array.isArray(a.patterns) ? a.patterns[0] : a.patterns) || a.directory_path || a.path;
    return { cat: 'search', verb: n, target: clip(q || n, 40) };
  }
  if (/web|fetch|url|http/i.test(n)) {
    let target = clip(a.url || a.query || n, 40);
    try { if (a.url) target = new URL(a.url).hostname; } catch {}
    return { cat: 'net', verb: n, target };
  }
  if (/todo|task|plan|agent|spec/i.test(n)) return { cat: 'agent', verb: n, target: clip(a.description || a.title || n, 40) };
  if (n.includes('___') || n.startsWith('mcp')) return { cat: 'net', verb: n, target: clip(Object.values(a).find((v) => typeof v === 'string') || n, 40) };
  return { cat: 'agent', verb: n || 'tool', target: clip(Object.values(a).find((v) => typeof v === 'string') || n, 40) };
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ') : '');

export function parseLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  if (d.type === 'session_start') {
    if (d.id) ctx.session = d.id;
    if (d.cwd) ctx.project = base(d.cwd);
    return out;
  }
  if (d.type !== 'message' || !d.message) return out;
  const m = d.message;
  const ts = Date.parse(d.timestamp) || Date.now();
  const common = { agent: 'droid', session: ctx.session, project: ctx.project, ts };
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
  blocks.forEach((x, i) => {
    const id = x.id || `${d.id || ts}:${i}`;
    if (m.role === 'user') {
      if (x.type === 'tool_result') out.push({ ...common, id: `${x.tool_use_id}:r`, cat: 'result', ref: x.tool_use_id, status: x.is_error ? 'error' : 'ok', detail: clip(textOf(x.content), 400) });
      else if (x.type === 'text' && x.text?.trim()) out.push({ ...common, id, cat: 'prompt', verb: 'prompt', target: clip(x.text, 42), detail: clip(x.text, 400), status: 'ok' });
    } else if (m.role === 'assistant') {
      if (x.type === 'tool_use') {
        const c = classify(x.name, x.input);
        out.push({ ...common, id, cat: c.cat, verb: c.verb, target: c.target, detail: clip(JSON.stringify(x.input), 600), status: 'pending' });
      } else if (x.type === 'thinking' && x.thinking) out.push({ ...common, id, cat: 'think', verb: 'think', target: clip(x.thinking, 36), detail: clip(x.thinking, 500), status: 'ok' });
      else if (x.type === 'text' && x.text?.trim()) out.push({ ...common, id, cat: 'think', verb: 'reply', target: clip(x.text, 36), detail: clip(x.text, 500), status: 'ok' });
    }
  });
  return out;
}

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'droid',
  label: 'Factory Droid',
  defaultDir: (env, home) => path.join(env.FACTORY_HOME || path.join(home, '.factory'), 'sessions'),
  fileFilter: (f) => f.endsWith('.jsonl'),
  newContext: (file) => {
    const dir = path.basename(path.dirname(file));
    return baseContext(path.basename(file, '.jsonl'), dir.split('-').filter(Boolean).pop() || dir);
  },
  parseLine,
  primeLines: 2,
};
