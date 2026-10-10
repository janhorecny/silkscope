// Helpers shared by adapters: text clipping and shell command classification
// (Claude's Bash tool and Codex's shell both end up here).

import path from 'node:path';

export const clip = (s, n = 160) => {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
export const base = (p) => (p ? path.basename(String(p)) : '');

const READ_CMDS = /^(cat|head|tail|less|more|nl|bat|sed\s+-n|wc|file|stat|xxd|jq)\b/;
const SEARCH_CMDS = /^(rg|grep|egrep|ag|ack|find|fd|ls|tree|locate|git\s+(grep|log|ls-files|status|diff|show|blame))\b/;
const NET_CMDS = /^(curl|wget|http|gh\s+api|ssh|scp|ping)\b/;
const EDIT_CMDS = /^(apply_patch|patch|tee|mv|cp|rm|mkdir|touch|git\s+(apply|commit|checkout|add|mv|rm))\b/;

// ['bash', '-lc', 'npm test'] -> 'npm test'
export function unwrapShell(cmd) {
  if (Array.isArray(cmd)) {
    if (cmd.length >= 3 && /(^|\/)(ba|z)?sh$/.test(cmd[0]) && /^-l?c$/.test(cmd[1])) return cmd.slice(2).join(' ');
    return cmd.join(' ');
  }
  return String(cmd || '');
}

// Classified by the first verb after leading `cd … &&`, `sudo`, `env X=Y`.
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
