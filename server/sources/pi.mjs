// pi coding agent: ~/.pi/agent/sessions/--<encoded-cwd>--/<iso-time>_<uuid>.jsonl
// (PI_CODING_AGENT_SESSION_DIR, or PI_CODING_AGENT_DIR/sessions). Verified against pi 0.86 transcripts.
//   {type:'session', id, cwd, timestamp}                       header
//   {type:'message', timestamp, message:{role, content[]}}     role user | assistant | toolResult
//     assistant content: text | thinking | toolCall{id, name, arguments}; plus model, usage
//     toolResult: {toolCallId, toolName, content[], isError}
//   model_change, thinking_level_change, custom, custom_message  ignored (no activity)

import path from 'node:path';
import { baseContext } from '../events.mjs';
import { clip, base, classifyShell } from './shell.mjs';

// Built-in tools (pi --help) plus the shapes extensions commonly use.
function classify(name, a = {}) {
  const n = String(name || '');
  const file = base(a.path || a.file_path || a.file);
  if (n === 'bash' || n === 'powershell') {
    const s = classifyShell(String(a.command || ''));
    return { cat: s.cat, verb: n, target: s.target };
  }
  if (n === 'read') return { cat: 'read', verb: 'read', target: file || 'file' };
  if (n === 'edit' || n === 'write') return { cat: 'edit', verb: n, target: file || 'file' };
  if (n === 'grep' || n === 'ffgrep' || n === 'find' || n === 'ls' || n === 'glob') {
    return { cat: 'search', verb: n, target: clip(a.pattern || a.glob || a.query || a.path || n, 40) };
  }
  if (/search|fetch|reader|web|http|browse|url/i.test(n)) {
    const q = a.url || a.query || (Array.isArray(a.queries) ? a.queries[0] : '') || a.prompt;
    let target = clip(q || n, 40);
    try { if (a.url) target = new URL(a.url).hostname; } catch {}
    return { cat: 'net', verb: n, target };
  }
  if (/todo|plan|goal|workflow|task|agent|skill/i.test(n)) {
    return { cat: 'agent', verb: n, target: clip(a.summary || a.description || a.title || n, 40) };
  }
  const first = Object.values(a).find((v) => typeof v === 'string');
  return { cat: 'agent', verb: n || 'tool', target: clip(first || n, 40) };
}

const textOf = (content) => (Array.isArray(content) ? content : [content])
  .map((x) => (typeof x === 'string' ? x : x?.type === 'text' ? x.text : ''))
  .join(' ');

export function parseLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  if (d.type === 'session') {
    if (d.id) ctx.session = d.id;
    if (d.cwd) ctx.project = base(d.cwd);
    return out;
  }
  if (d.type === 'model_change' && d.modelId) { ctx.model = d.modelId; return out; }
  if (d.type !== 'message' || !d.message) return out;
  const m = d.message;
  const ts = Date.parse(d.timestamp) || m.timestamp || Date.now();
  const common = { agent: 'pi', session: ctx.session, project: ctx.project, ts };
  if (m.model) ctx.model = m.model;

  if (m.role === 'user') {
    const t = clip(textOf(m.content), 400);
    if (t) out.push({ ...common, id: d.id || `pi-u-${ts}-${++ctx.seq}`, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
  } else if (m.role === 'assistant' && Array.isArray(m.content)) {
    const u = m.usage;
    let tokens = u ? (u.input || 0) + (u.output || 0) + (u.cacheWrite || 0) : 0;
    m.content.forEach((x, i) => {
      const id = x.id || `${d.id || ts}:${i}`;
      if (x.type === 'toolCall') {
        const c = classify(x.name, x.arguments);
        out.push({ ...common, id, cat: c.cat, verb: c.verb, target: c.target, detail: clip(JSON.stringify(x.arguments), 600), status: 'pending', tokens });
      } else if (x.type === 'thinking' && x.thinking) {
        out.push({ ...common, id, cat: 'think', verb: 'think', target: clip(x.thinking, 36), detail: clip(x.thinking, 500), status: 'ok', tokens });
      } else if (x.type === 'text' && x.text?.trim()) {
        out.push({ ...common, id, cat: 'think', verb: 'reply', target: clip(x.text, 36), detail: clip(x.text, 500), status: 'ok', tokens });
      } else return;
      tokens = 0; // usage belongs to the message, count it once
    });
    if (m.stopReason === 'error' && m.errorMessage) {
      out.push({ ...common, id: `${d.id || ts}:err`, cat: 'think', verb: 'error', target: clip(m.errorMessage, 36), detail: clip(m.errorMessage, 500), status: 'error' });
    }
  } else if (m.role === 'toolResult' && m.toolCallId) {
    out.push({ ...common, id: `${m.toolCallId}:r`, cat: 'result', ref: m.toolCallId, status: m.isError ? 'error' : 'ok', detail: clip(textOf(m.content), 400) });
  }
  if (out.length && ctx.model) out[0].model = ctx.model;
  return out;
}

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'pi',
  label: 'pi',
  defaultDir: (env, home) => env.PI_CODING_AGENT_SESSION_DIR
    || path.join(env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'), 'sessions'),
  fileFilter: (f) => f.endsWith('.jsonl'),
  // "--Users-me-dev-app--" -> "app" until the session header supplies the real cwd.
  newContext: (file) => {
    const dir = path.basename(path.dirname(file)).replace(/^-+|-+$/g, '');
    const id = path.basename(file, '.jsonl').split('_').pop();
    return baseContext(id, dir.split('-').filter(Boolean).pop() || dir);
  },
  parseLine,
  primeLines: 4,
};
