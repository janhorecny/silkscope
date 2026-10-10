#!/usr/bin/env node
import { exec } from 'node:child_process';
import { startServer } from '../server/server.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const val = (name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
};

if (flag('help') || flag('h')) {
  console.log(`
  agent-swarm — live visualiser for Claude Code and Codex activity

  Usage: agent-swarm [options]

    --port <n>          port to listen on (default 7777, auto-increments if busy)
    --host <addr>       bind address (default 127.0.0.1)
    --no-open           do not open the browser
    --demo              start with the synthetic demo feed
    --hours <n>         hours of history to replay on load (default 8)
    --claude-dir <dir>  Claude Code projects dir (default ~/.claude/projects)
    --codex-dir <dir>   Codex sessions dir (default ~/.codex/sessions)
`);
  process.exit(0);
}

const { url, watcher } = await startServer({
  port: Number(val('port')) || undefined,
  host: val('host'),
  demo: flag('demo'),
  backfillHours: val('hours') ? Number(val('hours')) : undefined,
  claudeDir: val('claude-dir'),
  codexDir: val('codex-dir'),
});

const target = flag('demo') ? `${url}/?demo=1` : url;
const g = '\x1b[38;5;43m', p = '\x1b[38;5;205m', d = '\x1b[2m', r = '\x1b[0m';
console.log(`
  ${g}◉ AGENT SWARM${r} ${d}// live crawler for coding agents${r}

  ${p}▸${r} ${target}
  ${d}sources:${r} ${watcher.sources.map((s) => `${s.agent} ${d}${s.dir}${r}`).join('  ') || 'none found (demo mode available)'}
  ${d}tracked files:${r} ${watcher.stats.files}   ${d}history events:${r} ${watcher.history.length}
`);

if (!flag('no-open')) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${target}"`, () => {});
}
