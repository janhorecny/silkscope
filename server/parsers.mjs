// Normalises Claude Code and Codex transcript lines into one event shape:
// { id, ts, agent, session, project, cat, verb, target, detail, status, ref?, tokens?, sidechain? }
// cat is one of: prompt think read search edit exec net agent

import path from 'node:path';

const clip = (s, n = 160) => {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => (p ? path.basename(String(p)) : '');

// ---------- shell command classification (shared by Claude Bash + Codex shell) ----------
const READ_CMDS = /^(cat|head|tail|less|more|nl|bat|sed\s+-n|wc|file|stat|xxd|jq)\b/;
const SEARCH_CMDS = /^(rg|grep|egrep|ag|ack|find|fd|ls|tree|locate|git\s+(grep|log|ls-files|status|diff|show|blame))\b/;
const NET_CMDS = /^(curl|wget|http|gh\s+api|ssh|scp|ping)\b/;
const EDIT_CMDS = /^(apply_patch|patch|tee|mv|cp|rm|mkdir|touch|git\s+(apply|commit|checkout|add|mv|rm))\b/;

function unwrapShell(cmd) {
  if (Array.isArray(cmd)) {
    if (cmd.length >= 3 && /(^|\/)(ba|z)?sh$/.test(cmd[0]) && /^-l?c$/.test(cmd[1])) return cmd.slice(2).join(' ');
    return cmd.join(' ');
  }
  return String(cmd || '');
}

export function classifyShell(command) {
  const c = command.trim().replace(/^(cd\s+[^&;]+(&&|;)\s*)+/, '').replace(/^(sudo|env\s+\S+=\S+)\s+/, '');
  let cat = 'exec';
  if (READ_CMDS.test(c)) cat = 'read';
  else if (SEARCH_CMDS.test(c)) cat = 'search';
  else if (NET_CMDS.test(c)) cat = 'net';
  else if (EDIT_CMDS.test(c)) cat = 'edit';
  let target = clip(c, 48);
  if (cat === 'read') {
    const m = c.match(/\s([^\s|><]+\.[\w]+)(\s|$)/);
    if (m) target = base(m[1]);
  }
  if (/apply_patch/.test(c)) {
    const files = [...c.matchAll(/\*\*\* (?:Add|Update|Delete) File: (\S+)/g)].map((m) => base(m[1]));
    if (files.length) target = files.join(', ');
  }
  return { cat, target, verb: cat === 'exec' ? 'run' : cat };
}

// ---------- Claude Code ----------
const CLAUDE_TOOL_CAT = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search', LS: 'search', ToolSearch: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'exec', BashOutput: 'exec', KillShell: 'exec', Monitor: 'exec',
  WebFetch: 'net', WebSearch: 'net',
  Task: 'agent', Agent: 'agent', TodoWrite: 'agent', Skill: 'agent', SendMessage: 'agent',
  ExitPlanMode: 'agent', EnterPlanMode: 'agent', Workflow: 'agent', AskUserQuestion: 'prompt',
};

function claudeToolTarget(name, input = {}) {
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': case 'NotebookRead':
      return base(input.file_path || input.notebook_path || input.path);
    case 'Grep': return clip(input.pattern, 40);
    case 'Glob': return clip(input.pattern, 40);
    case 'LS': return base(input.path);
    case 'Bash': return clip(input.command, 48);
    case 'WebFetch': try { return new URL(input.url).hostname; } catch { return clip(input.url, 40); }
    case 'WebSearch': return clip(input.query, 40);
    case 'Task': case 'Agent': return clip(input.description || input.subagent_type, 40);
    case 'Skill': return clip(input.skill, 40);
    case 'TodoWrite': return `${(input.todos || []).length} todos`;
    case 'ToolSearch': return clip(input.query, 40);
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string');
      return clip(first || name, 40);
    }
  }
}

function stripTags(text) {
  return String(text)
    .replace(/<(system-reminder|local-command-stdout|local-command-stderr|command-message|pasted_content)[^>]*>[\s\S]*?<\/\1[^>]*>/g, ' ')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1 ')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, '$1')
    .replace(/<[^>]+>/g, ' ');
}

export function parseClaudeLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  if (d.cwd) ctx.project = base(d.cwd);
  if (d.sessionId) ctx.session = d.sessionId;
  const ts = Date.parse(d.timestamp) || Date.now();
  const common = { agent: 'claude', session: ctx.session, project: ctx.project, ts, sidechain: !!d.isSidechain };
  const m = d.message;

  if (d.type === 'user' && m && !d.isMeta) {
    const c = m.content;
    if (typeof c === 'string') {
      const t = clip(stripTags(c), 400);
      if (t && !/^Caveat:|^\[Request interrupted/.test(t)) {
        out.push({ ...common, id: d.uuid, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
      }
    } else if (Array.isArray(c)) {
      for (const x of c) {
        if (x.type === 'tool_result') {
          const text = Array.isArray(x.content) ? x.content.map((y) => y.text || '').join(' ') : x.content;
          out.push({ ...common, id: d.uuid + ':' + x.tool_use_id, cat: 'result', ref: x.tool_use_id,
            status: x.is_error ? 'error' : 'ok', detail: clip(text, 400) });
        } else if (x.type === 'text' && !d.isSidechain) {
          const t = clip(stripTags(x.text), 400);
          if (t) out.push({ ...common, id: d.uuid + ':t', cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
        }
      }
    }
  }

  if (d.type === 'assistant' && m && Array.isArray(m.content)) {
    let tokens = 0;
    if (m.usage && m.id && !ctx.seenMsg.has(m.id)) {
      ctx.seenMsg.add(m.id);
      if (ctx.seenMsg.size > 5000) ctx.seenMsg.clear();
      const u = m.usage;
      tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    if (m.model) ctx.model = m.model;
    m.content.forEach((x, i) => {
      const id = (x.id || d.uuid + ':' + i);
      if (x.type === 'tool_use') {
        let cat = CLAUDE_TOOL_CAT[x.name] || (x.name.startsWith('mcp__') ? 'net' : 'exec');
        let target = claudeToolTarget(x.name, x.input);
        if (x.name === 'Bash' && x.input?.command) {
          const s = classifyShell(x.input.command);
          if (s.cat !== 'exec') { cat = s.cat; target = s.target; }
        }
        const tool = x.name.startsWith('mcp__') ? x.name.split('__').slice(1).join(':') : x.name;
        out.push({ ...common, id, cat, verb: tool, target, detail: clip(JSON.stringify(x.input), 600), status: 'pending', tokens });
      } else if (x.type === 'thinking') {
        out.push({ ...common, id, cat: 'think', verb: 'think', target: clip(x.thinking, 36) || 'reasoning', detail: clip(x.thinking, 500), status: 'ok', tokens });
      } else if (x.type === 'text' && x.text?.trim()) {
        out.push({ ...common, id, cat: 'think', verb: 'reply', target: clip(x.text, 36), detail: clip(x.text, 500), status: 'ok', tokens });
      }
      tokens = 0;
    });
  }
  if (out.length && ctx.model) out[0].model = ctx.model;
  return out;
}

// ---------- Codex ----------
function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return { raw: a }; }
}

function codexExitStatus(output) {
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

export function parseCodexLine(d, ctx) {
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
      out.push({ ...common, id: 'cx-u-' + ts + '-' + t.length, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
    } else if (p.type === 'agent_message' && p.message) {
      out.push({ ...common, id: 'cx-a-' + ts, cat: 'think', verb: 'reply', target: clip(p.message, 36), detail: clip(p.message, 500), status: 'ok' });
    } else if (p.type === 'agent_reasoning' && p.text) {
      out.push({ ...common, id: 'cx-r-' + ts + '-' + p.text.length, cat: 'think', verb: 'think', target: clip(p.text, 36), detail: clip(p.text, 500), status: 'ok' });
    } else if (p.type === 'token_count') {
      const u = p.info?.last_token_usage;
      if (u) out.push({ ...common, id: 'cx-t-' + ts, cat: 'tokens', tokens: (u.input_tokens || 0) - (u.cached_input_tokens || 0) + (u.output_tokens || 0) });
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
      out.push({ ...common, id: p.call_id + ':r', cat: 'result', ref: p.call_id, status: codexExitStatus(p.output), detail: clip(typeof p.output === 'string' ? p.output : JSON.stringify(p.output), 400) });
    } else if (p.type === 'web_search_call') {
      out.push({ ...common, id: p.id || 'cx-w-' + ts, cat: 'net', verb: 'web_search', target: clip(p.action?.query || 'web', 40), detail: clip(JSON.stringify(p.action), 400), status: 'ok' });
    }
  }
  if (out.length && ctx.model) out[0].model = ctx.model;
  return out;
}
