// Codex CLI: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, lines are { timestamp, type, payload }.
//
// Shapes handled (Codex 0.104 → 0.147, cross-checked against several open-source parsers and a
// 1,397-rollout corpus analysis):
//   session_meta                      session id + cwd (first line; sometimes nested under payload.meta)
//   turn_context                      cwd + model per turn
//   response_item / function_call     shell | shell_command | exec_command | write_stdin | update_plan |
//                                     apply_patch | view_image | read_file | list_dir | grep_files |
//                                     web tools | MCP (namespace "mcp__server__" or name "mcp__server__tool")
//   response_item / custom_tool_call  apply_patch (input = patch) and exec / shell (input = program)
//   response_item / local_shell_call  action.command argv
//   response_item / web_search_call   action.query
//   response_item / *_output          result; exit code from JSON metadata or "Exit code: N" text
//   event_msg                         user_message, agent_message, agent_reasoning, token_count,
//                                     exec_command_begin/end, patch_apply_begin/end, mcp_tool_call_begin/end,
//                                     web_search_begin/end, item_started/item_completed (newer transport)
// The same call often appears twice (e.g. function_call + exec_command_begin, or *_output +
// exec_command_end). Actions are emitted once per call id (ctx.seen); duplicate results are
// harmless because the client only lets a later result upgrade ok → error.

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
    if (j?.success === false) return 'error';
    if (typeof j?.output === 'string') s = j.output;
  } catch {}
  const m = s.match(/(?:Process exited with code|Exit code:?)\s*(-?\d+)/i);
  if (m) return m[1] === '0' ? 'ok' : 'error';
  return /^(error|failed|aborted)/i.test(s.trim()) ? 'error' : 'ok';
}

const outText = (o) => clip(typeof o === 'string' ? o : JSON.stringify(o), 400);
const patchFiles = (text) => [...String(text).matchAll(/\*\*\* (?:Add|Update|Delete) File: (\S+)/g)].map((m) => base(m[1]));

// Map a tool name + arguments to {cat, verb, target, detail}.
function classifyCall(name, args, namespace) {
  const n = String(name || '');
  const ns = String(namespace || '');
  if (ns.startsWith('mcp__') || n.startsWith('mcp__')) {
    const parts = (ns + n).split('__').filter(Boolean); // mcp, server, tool
    const server = parts[1] || 'mcp', tool = parts.slice(2).join('__') || n;
    const first = Object.values(args || {}).find((v) => typeof v === 'string');
    return { cat: 'net', verb: `${server}:${tool}`, target: clip(first || tool, 40), detail: clip(JSON.stringify(args), 600) };
  }
  if (n === 'apply_patch') {
    const text = args.input ?? args.patch ?? args.raw ?? '';
    return { cat: 'edit', verb: 'patch', target: patchFiles(text).join(', ') || 'patch', detail: clip(text, 600) };
  }
  if (n === 'update_plan') return { cat: 'agent', verb: 'plan', target: `${(args.plan || []).length} steps`, detail: clip(JSON.stringify(args), 600) };
  if (n === 'view_image' || n === 'read_file') return { cat: 'read', verb: n, target: base(args.path || args.file_path) || n, detail: clip(JSON.stringify(args), 600) };
  if (n === 'list_dir' || n === 'grep_files' || n === 'find_files') return { cat: 'search', verb: n, target: clip(args.pattern || args.path || n, 40), detail: clip(JSON.stringify(args), 600) };
  if (n === 'write_stdin') return { cat: 'exec', verb: 'stdin', target: clip(args.chars || `session ${args.session_id ?? ''}`, 40), detail: clip(JSON.stringify(args), 600) };
  if (/^(shell|shell_command|exec_command|exec|local_shell|container\.exec)$/.test(n) || args.command || args.cmd) {
    const cmd = unwrapShell(args.command ?? args.cmd ?? args.raw ?? '');
    const s = classifyShell(cmd);
    return { cat: s.cat, verb: s.verb === 'run' ? 'shell' : s.verb, target: s.target, detail: clip(cmd, 600) };
  }
  const first = Object.values(args || {}).find((v) => typeof v === 'string');
  return { cat: /web|fetch|search|http|browse/i.test(n) ? 'net' : 'agent', verb: n || 'tool', target: clip(first || n, 40), detail: clip(JSON.stringify(args), 600) };
}

export function parseLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  const p = d.payload || {};
  const ts = Date.parse(d.timestamp) || Date.now();
  if (d.type === 'session_meta') {
    const meta = p.meta || p;
    ctx.session = meta.id || ctx.session;
    ctx.project = base(meta.cwd) || ctx.project;
    if (meta.model) ctx.model = meta.model;
    return out;
  }
  if (d.type === 'turn_context') {
    if (p.model) ctx.model = p.model;
    if (p.cwd) ctx.project = base(p.cwd);
    return out;
  }
  const common = { agent: 'codex', session: ctx.session, project: ctx.project, ts };
  // Emit an action once per call id, however many shapes describe it.
  const action = (id, c, status = 'pending') => {
    const key = id || `cx-${ts}-${++ctx.seq}`;
    if (id) { if (ctx.seen.has(id)) return; ctx.seen.add(id); if (ctx.seen.size > 20000) ctx.seen.clear(); }
    out.push({ ...common, id: key, cat: c.cat, verb: c.verb, target: c.target, detail: c.detail, status });
  };
  const result = (ref, status, detail) => { if (ref) out.push({ ...common, id: `${ref}:r${++ctx.seq}`, cat: 'result', ref, status, detail }); };

  if (d.type === 'event_msg') {
    switch (p.type) {
      case 'user_message': {
        if (!p.message) break;
        const t = clip(p.message, 400);
        out.push({ ...common, id: `cx-u-${ts}-${++ctx.seq}`, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
        break;
      }
      case 'agent_message':
        if (p.message) out.push({ ...common, id: `cx-a-${ts}-${++ctx.seq}`, cat: 'think', verb: 'reply', target: clip(p.message, 36), detail: clip(p.message, 500), status: 'ok' });
        break;
      case 'agent_reasoning':
        if (p.text) out.push({ ...common, id: `cx-r-${ts}-${++ctx.seq}`, cat: 'think', verb: 'think', target: clip(p.text, 36), detail: clip(p.text, 500), status: 'ok' });
        break;
      case 'token_count': {
        const u = p.info?.last_token_usage;
        if (u) out.push({ ...common, id: `cx-t-${ts}-${++ctx.seq}`, cat: 'tokens', tokens: (u.input_tokens || 0) - (u.cached_input_tokens || 0) + (u.output_tokens || 0) });
        break;
      }
      case 'exec_command_begin':
        action(p.call_id, classifyCall('shell', { command: p.command }));
        break;
      case 'exec_command_end':
        result(p.call_id, p.exit_code === 0 || p.exit_code == null ? 'ok' : 'error', clip(p.aggregated_output ?? p.formatted_output ?? p.stdout ?? p.stderr, 400));
        break;
      case 'patch_apply_begin': {
        const files = Object.keys(p.changes || {}).map(base);
        action(p.call_id, { cat: 'edit', verb: 'patch', target: files.join(', ') || 'patch', detail: clip(files.join('\n'), 600) });
        break;
      }
      case 'patch_apply_end':
        result(p.call_id, p.success === false ? 'error' : 'ok', clip(p.stdout || p.stderr, 400));
        break;
      case 'mcp_tool_call_begin': {
        const inv = p.invocation || {};
        action(p.call_id, { cat: 'net', verb: `${inv.server}:${inv.tool}`, target: clip(inv.tool, 40), detail: clip(JSON.stringify(inv.arguments), 600) });
        break;
      }
      case 'mcp_tool_call_end': {
        const r = p.result || {};
        const err = 'Err' in r || r.Ok?.isError === true || r.is_error === true;
        result(p.call_id, err ? 'error' : 'ok', outText(r));
        break;
      }
      case 'web_search_begin':
        action(p.call_id, { cat: 'net', verb: 'web_search', target: clip(p.query || 'web', 40), detail: clip(p.query, 400) });
        break;
      case 'web_search_end':
        if (p.query && !ctx.seen.has(p.call_id)) action(p.call_id, { cat: 'net', verb: 'web_search', target: clip(p.query, 40), detail: clip(p.query, 400) }, 'ok');
        else result(p.call_id, 'ok', clip(p.query, 400));
        break;
      case 'item_started':
      case 'item_completed': {
        // Newer transport: one item with its own lifecycle. Type tags appear as PascalCase or snake_case.
        const it = p.item || {};
        const kind = String(it.type || '').replace(/_/g, '').toLowerCase();
        const done = p.type === 'item_completed';
        let c = null;
        if (kind === 'commandexecution') c = classifyCall('shell', { command: it.command });
        else if (kind === 'filechange') {
          const files = (it.changes || []).map((x) => base(x.path)).filter(Boolean);
          c = { cat: 'edit', verb: 'patch', target: files.join(', ') || 'patch', detail: clip(files.join('\n'), 600) };
        } else if (kind === 'mcptoolcall') c = { cat: 'net', verb: `${it.server}:${it.tool}`, target: clip(it.tool, 40), detail: clip(JSON.stringify(it.arguments), 600) };
        else if (kind === 'websearch') c = { cat: 'net', verb: 'web_search', target: clip(it.query || 'web', 40), detail: clip(it.query, 400) };
        if (!c || !it.id) break;
        const failed = it.exit_code != null ? it.exit_code !== 0 : /fail|error|declined/i.test(String(it.status || ''));
        if (!done) action(it.id, c);
        else if (!ctx.seen.has(it.id)) action(it.id, c, failed ? 'error' : 'ok');
        else result(it.id, failed ? 'error' : 'ok', clip(it.aggregated_output ?? it.status, 400));
        break;
      }
    }
    if (out.length && ctx.model) out[0].model = ctx.model;
    return out;
  }

  if (d.type === 'response_item') {
    if (p.type === 'function_call') {
      action(p.call_id || p.id, classifyCall(p.name, parseArgs(p.arguments), p.namespace));
    } else if (p.type === 'local_shell_call') {
      action(p.call_id || p.id, classifyCall('shell', { command: p.action?.command }));
    } else if (p.type === 'custom_tool_call') {
      const input = String(p.input ?? '');
      const c = p.name === 'apply_patch' ? classifyCall('apply_patch', { input })
        : /^(exec|shell|shell_command)$/.test(p.name) ? classifyCall('shell', { command: input })
        : classifyCall(p.name, { input });
      action(p.call_id || p.id, c);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      result(p.call_id, exitStatus(p.output), outText(p.output));
    } else if (p.type === 'web_search_call') {
      action(p.id || p.call_id, { cat: 'net', verb: 'web_search', target: clip(p.action?.query || 'web', 40), detail: clip(JSON.stringify(p.action), 400) }, 'ok');
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
