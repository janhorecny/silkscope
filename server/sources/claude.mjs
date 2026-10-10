// Claude Code: ~/.claude/projects/<encoded-cwd>/<session>.jsonl (subagents nest deeper).
// `assistant` lines carry tool_use / thinking / text + usage; `user` lines carry prompts and tool_result.

import path from 'node:path';
import { baseContext } from '../events.mjs';
import { clip, base, classifyShell } from './shell.mjs';

const TOOL_CAT = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search', LS: 'search', ToolSearch: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'exec', BashOutput: 'exec', KillShell: 'exec', Monitor: 'exec',
  WebFetch: 'net', WebSearch: 'net',
  Task: 'agent', Agent: 'agent', TodoWrite: 'agent', Skill: 'agent', SendMessage: 'agent',
  ExitPlanMode: 'agent', EnterPlanMode: 'agent', Workflow: 'agent', AskUserQuestion: 'prompt',
};

function toolTarget(name, input = {}) {
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

export function parseLine(d, ctx) {
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
      c.forEach((x, i) => {
        if (x.type === 'tool_result') {
          const text = Array.isArray(x.content) ? x.content.map((y) => y.text || '').join(' ') : x.content;
          out.push({ ...common, id: d.uuid + ':' + x.tool_use_id, cat: 'result', ref: x.tool_use_id,
            status: x.is_error ? 'error' : 'ok', detail: clip(text, 400) });
        } else if (x.type === 'text' && !d.isSidechain) {
          const t = clip(stripTags(x.text), 400);
          if (t) out.push({ ...common, id: `${d.uuid}:t${i}`, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
        }
      });
    }
  }

  if (d.type === 'assistant' && m && Array.isArray(m.content)) {
    let tokens = 0;
    // Usage repeats on every content line of one message.id: count it once.
    if (m.usage && m.id && !ctx.seen.has(m.id)) {
      ctx.seen.add(m.id);
      if (ctx.seen.size > 5000) ctx.seen.clear();
      const u = m.usage;
      tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    if (m.model) ctx.model = m.model;
    m.content.forEach((x, i) => {
      const id = (x.id || d.uuid + ':' + i);
      if (x.type === 'tool_use') {
        let cat = TOOL_CAT[x.name] || (x.name.startsWith('mcp__') ? 'net' : 'exec');
        let target = toolTarget(x.name, x.input);
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

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'claude',
  label: 'Claude Code',
  defaultDir: (env, home) => env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'projects') : path.join(home, '.claude', 'projects'),
  fileFilter: (f) => f.endsWith('.jsonl'),
  skipDir: (name) => name === 'memory',
  newContext(file) {
    // ~/.claude/projects/-Users-me-dev-app/<session>.jsonl -> "app" until a line's cwd says better
    const dir = path.basename(path.dirname(file));
    return baseContext(path.basename(file, '.jsonl'), dir.split('-').filter(Boolean).pop() || dir);
  },
  parseLine,
  primeLines: 12,
};
