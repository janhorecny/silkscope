#!/usr/bin/env node
import { exec } from 'node:child_process';
import { c, bold, dim, link, lockup, spectrum, home, row } from './term.mjs';
import { startServer, VERSION } from '../server/server.mjs';
import { ADAPTERS } from '../server/sources/index.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const val = (name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  return args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1];
};
const ids = ADAPTERS.map((a) => a.id);

const header = () => lockup([
  `${bold(c.silk('silkscope'))} ${dim('v' + VERSION)}`,
  c.mist('watch your coding agents spin'),
  spectrum(),
]);

if (flag('help') || flag('h')) {
  const opt = (name, desc) => `    ${c.spinneret(name.padEnd(20))}${desc}`;
  console.log(`
${header()}

  ${bold('usage')}  silkscope ${dim('[options]')}

${opt('--port <n>', `port to listen on ${dim('(default 7777, next free if busy)')}`)}
${opt('--host <addr>', `bind address ${dim('(default 127.0.0.1)')}`)}
${opt('--no-open', 'do not open the browser')}
${opt('--demo', 'start with the synthetic demo feed')}
${opt('--hours <n>', `hours of history to replay on load ${dim('(default 8)')}`)}
${opt('--sources <ids>', `comma-separated: ${ids.join(',')} ${dim('(default: every one found)')}`)}
${ADAPTERS.map((a) => opt(`--${a.id}-dir <dir>`, `${a.label} transcripts ${dim(`(default ${a.defaultDir({}, '~')})`)}`)).join('\n')}

  ${dim('docs')}  ${link('https://github.com/janhorecny/silkscope#readme')}
`);
  process.exit(0);
}

if (flag('version') || flag('v')) { console.log(VERSION); process.exit(0); }

const sources = val('sources')?.split(',').map((s) => s.trim()).filter(Boolean);
const unknown = sources?.filter((s) => !ids.includes(s));
if (unknown?.length) {
  console.error(`  ${c.venom('⚑')} unknown source: ${unknown.join(', ')} ${dim(`(known: ${ids.join(', ')})`)}`);
  process.exit(1);
}

const hours = val('hours') === undefined ? undefined : Number(val('hours'));
if (hours !== undefined && !(hours >= 0)) {
  console.error(`  ${c.venom('⚑')} --hours expects a number ≥ 0 ${dim(`(got ${val('hours')})`)}`);
  process.exit(1);
}

const t0 = performance.now();
const { url, watcher } = await startServer({
  port: Number(val('port')) || undefined,
  host: val('host'),
  demo: flag('demo'),
  backfillHours: hours,
  sources,
  dirs: Object.fromEntries(ids.map((id) => [id, val(`${id}-dir`)]).filter(([, d]) => d)),
});

const target = flag('demo') ? `${url}/?demo=1` : url;
const ready = Math.round(performance.now() - t0);
const perSource = (id) => [...watcher.files.values()].filter((r) => r.source.agent === id).length;
const srcRows = ADAPTERS.filter((a) => !sources || sources.includes(a.id)).map((a) => {
  const s = watcher.sources.find((x) => x.agent === a.id);
  const name = c.spinneret(a.id.padEnd(8));
  return s ? `${name}${home(s.dir)} ${dim(`· ${perSource(a.id).toLocaleString('en')} transcripts`)}` : `${name}${dim('not found')}`;
});
console.log(`
${header()}

  ${c.venom('▸')} ${bold(link(target))}

${row('sources', srcRows[0] || dim('none found · try --demo'))}
${srcRows.slice(1).map((r) => row('', r)).join('\n')}
${row('history', `${watcher.history.length.toLocaleString('en')} events ready to replay ${dim(`· started in ${ready} ms`)}`)}
${row('privacy', dim(`bound to ${url.replace(/^http:\/\//, '').replace(/:\d+$/, '')} · read-only · no telemetry`))}

  ${dim('ctrl+c to stop')}
`);

// Leave the terminal tidy on ctrl+c.
let streamed = 0;
watcher.on('event', () => streamed++);
const bye = () => {
  console.log(`\n  ${c.spinneret('◆')} silkscope stopped ${dim(`· ${streamed.toLocaleString('en')} live events streamed`)}\n`);
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

if (!flag('no-open')) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${target}"`, () => {});
}
