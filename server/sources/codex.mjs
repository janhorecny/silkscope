// Codex CLI: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, lines are { timestamp, type, payload }.
// session_meta (session id + cwd) is only on the first line, hence primeLines.

import path from 'node:path';
import { baseContext } from '../events.mjs';
import { clip, base, classifyShell, unwrapShell } from './shell.mjs';

function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return { raw: a }; }
}

function exitStatus(output) {
  if (output == null) return 'ok';
  let s = typeof output === 'string' ? output : JSON.stringify(output);
  try {
    const j = JSON.parse(s);
    const code = j?.metadata?.exit_code ?? j?.exit_code;
    if (typeof code === 'number') return code === 0 ? 'ok' : 'error';
    if (typeof j?.output === 'string') s = j.output;
  } catch {}
  const m = s.match(/(?:Process exited with code|Exit code:?)\s*(-?\d+)/i);
  if (m) return m[1] === '0' ? 'ok' : 'error';
  return /^(error|failed)/i.test(s.trim()) ? 'error' : 'ok';
}

export function parseLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  const p = d.payload || {};
  const ts = Date.parse(d.timestamp) || Date.now();
  if (d.type === 'session_meta') {
    ctx.session = p.id || ctx.session;
    ctx.project = base(p.cwd) || ctx.project;
    if (p.model) ctx.model = p.model;
    return out;
  }
  if (d.type === 'turn_context' && p.model) ctx.model = p.model;
  const common = { agent: 'codex', session: ctx.session, project: ctx.project, ts };

  if (d.type === 'event_msg') {
    if (p.type === 'user_message' && p.message) {
      const t = clip(p.message, 400);
      out.push({ ...common, id: `cx-u-${ts}-${++ctx.seq}`, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
    } else if (p.type === 'agent_message' && p.message) {
      out.push({ ...common, id: `cx-a-${ts}-${++ctx.seq}`, cat: 'think', verb: 'reply', target: clip(p.message, 36), detail: clip(p.message, 500), status: 'ok' });
    } else if (p.type === 'agent_reasoning' && p.text) {
      out.push({ ...common, id: `cx-r-${ts}-${++ctx.seq}`, cat: 'think', verb: 'think', target: clip(p.text, 36), detail: clip(p.text, 500), status: 'ok' });
    } else if (p.type === 'token_count') {
      const u = p.info?.last_token_usage;
      if (u) out.push({ ...common, id: `cx-t-${ts}-${++ctx.seq}`, cat: 'tokens', tokens: (u.input_tokens || 0) - (u.cached_input_tokens || 0) + (u.output_tokens || 0) });
    } else if (p.type === 'mcp_tool_call_begin') {
      const inv = p.invocation || {};
      out.push({ ...common, id: p.call_id, cat: 'net', verb: `${inv.server}:${inv.tool}`, target: clip(inv.tool, 40), detail: clip(JSON.stringify(inv.arguments), 600), status: 'pending' });
    } else if (p.type === 'mcp_tool_call_end') {
      out.push({ ...common, id: p.call_id + ':r', cat: 'result', ref: p.call_id, status: p.result && 'Err' in p.result ? 'error' : 'ok', detail: clip(JSON.stringify(p.result), 400) });
    }
    return out;
  }

  if (d.type === 'response_item') {
    if (p.type === 'function_call' || p.type === 'local_shell_call') {
      const args = parseArgs(p.arguments ?? p.action);
      const name = p.name || 'shell';
      if (/shell|exec|command/i.test(name) || args.command || args.cmd) {
        const cmd = unwrapShell(args.command ?? args.cmd ?? args.raw);
        const s = classifyShell(cmd);
        out.push({ ...common, id: p.call_id || p.id, cat: s.cat, verb: s.verb === 'run' ? 'shell' : s.verb, target: s.target, detail: clip(cmd, 600), status: 'pending' });
      } else if (name === 'update_plan') {
        out.push({ ...common, id: p.call_id, cat: 'agent', verb: 'plan', target: `${(args.plan || []).length} steps`, detail: clip(JSON.stringify(args), 600), status: 'pending' });
      } else if (name === 'apply_patch') {
        const s = classifyShell('apply_patch ' + (args.input || args.raw || ''));
        out.push({ ...common, id: p.call_id, cat: 'edit', verb: 'patch', target: s.target, detail: clip(args.input || args.raw, 600), status: 'pending' });
      } else {
        out.push({ ...common, id: p.call_id, cat: /web|fetch|search|http/i.test(name) ? 'net' : 'agent', verb: name, target: clip(Object.values(args).find((v) => typeof v === 'string') || name, 40), detail: clip(JSON.stringify(args), 600), status: 'pending' });
      }
    } else if (p.type === 'custom_tool_call') {
      const input = String(p.input || '');
      const isPatch = p.name === 'apply_patch';
      const s = isPatch ? classifyShell('apply_patch ' + input) : null;
      out.push({ ...common, id: p.call_id, cat: isPatch ? 'edit' : 'agent', verb: isPatch ? 'patch' : p.name, target: isPatch ? s.target : clip(input, 40), detail: clip(input, 600), status: 'pending' });
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      out.push({ ...common, id: p.call_id + ':r', cat: 'result', ref: p.call_id, status: exitStatus(p.output), detail: clip(typeof p.output === 'string' ? p.output : JSON.stringify(p.output), 400) });
    } else if (p.type === 'web_search_call') {
      out.push({ ...common, id: p.id || 'cx-w-' + ts, cat: 'net', verb: 'web_search', target: clip(p.action?.query || 'web', 40), detail: clip(JSON.stringify(p.action), 400), status: 'ok' });
    }
  }
  if (out.length && ctx.model) out[0].model = ctx.model;
  return out;
}

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'codex',
  label: 'Codex',
  defaultDir: (env, home) => env.CODEX_HOME ? path.join(env.CODEX_HOME, 'sessions') : path.join(home, '.codex', 'sessions'),
  fileFilter: (f) => f.endsWith('.jsonl'),
  newContext: (file) => baseContext(path.basename(file, '.jsonl')),
  parseLine,
  primeLines: 12,
};
