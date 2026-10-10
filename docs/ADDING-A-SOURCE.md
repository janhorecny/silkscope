# Adding a source

A source is one agent whose transcripts Silkscope can tail. Claude Code and Codex ship today.
Adding another agent is one server file, one registry line, one client style entry and a few tests.
The watcher, the `--sources` flag and the `--<id>-dir` flag pick a new adapter up automatically.

This guide builds a hypothetical `aider` adapter. The transcript format below is invented for the
example; read real files from the agent you are adding and anonymise a few lines for the tests.

## Constraints

- The watcher reads **line-delimited JSON**: it splits appended bytes on `\n`, calls `JSON.parse`
  on each complete line and hands the object to your adapter. Lines that fail to parse are skipped.
  A format that is not JSONL needs watcher changes first.
- Files must be **append-only** for live tailing. A file that shrinks is re-read from the start.
- Transcripts must live under one directory tree (searched up to 6 levels deep; directories starting
  with `.` and `node_modules` are always skipped).

## 1. The adapter interface

Defined as JSDoc in `server/events.mjs`:

```js
/**
 * @typedef {Object} SourceAdapter
 * @property {string} id                                   becomes `agent` on events and the `--<id>-dir` flag
 * @property {string} label                                human name for the CLI banner
 * @property {(env: NodeJS.ProcessEnv, home: string) => string} defaultDir
 * @property {(file: string) => boolean} fileFilter        which files under the dir are transcripts
 * @property {(name: string) => boolean} [skipDir]         directory names never worth walking into
 * @property {(file: string) => SourceContext} newContext
 * @property {(obj: any, ctx: SourceContext) => SwarmEvent[]} parseLine   one parsed JSONL line in, 0..n events out
 * @property {number} primeLines                           head lines parsed for context before tail backfill
 */

/**
 * @typedef {Object} SourceContext
 * @property {string} session
 * @property {string} project
 * @property {string} model
 * @property {Set<string>} seen  scratch set for de-duplication; cleared after head priming
 */

export const baseContext = (session, project = '') => ({ session, project, model: '', seen: new Set() });
```

| Member | Called | Notes |
|-|-|-|
| `id` | | Lowercase, no spaces. Used as `ev.agent`, in `--sources`, in `--<id>-dir`, and as the key of the client style. |
| `label` | CLI `--help` and banner | |
| `defaultDir(env, home)` | Once at start-up | Must return an absolute path. Honour the agent's own env var if it has one (Claude: `CLAUDE_CONFIG_DIR`, Codex: `CODEX_HOME`). If the directory does not exist the source is silently dropped. |
| `fileFilter(file)` | For every file during discovery | Full path in, boolean out. |
| `skipDir(name)` | For every sub-directory name | Optional. Claude skips `memory`. |
| `newContext(file)` | Once per tracked file | Return `baseContext(session, project)` plus any fields you need. Derive a sensible fallback session (file name) and project. |
| `parseLine(obj, ctx)` | For every complete line | Must not throw on unexpected input (exceptions are caught, but the whole line is lost). Return `[]` for lines you ignore. May mutate `ctx` (session, project, model). |
| `primeLines` | Before backfilling a file | Number of head lines parsed only to fill `ctx` (events are discarded, then `ctx.seen` is cleared). Use it when the session id or cwd appears only at the top of the file (Codex `session_meta`). `0` disables priming. |

Rules for the events you return (full schema in [EVENTS.md](EVENTS.md)):

- Always set `id`, `ts`, `agent`, `session`, `project`, `cat`.
- `cat` must be one of `prompt think read search edit exec net agent result tokens`.
- Give every tool call `status: 'pending'` and an `id` equal to the agent's call id, and emit the
  output later as `{ cat: 'result', ref: <call id>, status: 'ok' | 'error', detail }`.
- Keep `target` short (it is a node label on the map; `clip(s, 40)` is typical) and `detail`
  clipped (400 to 600 chars).
- Set `model` on the first event of a line once known (`if (out.length && ctx.model) out[0].model = ctx.model`).
- Shell commands: run them through `classifyShell()` from `./shell.mjs` so they land in the same
  sections as Claude's and Codex's.

## 2. Worked example: `server/sources/aider.mjs`

Assume the hypothetical format writes `~/.aider/sessions/<project>/<session>.jsonl` with lines like:

```json
{"ts":"2026-10-10T10:00:00Z","kind":"meta","cwd":"/home/me/api","model":"gpt-5"}
{"ts":"2026-10-10T10:00:01Z","kind":"user","text":"add rate limiting"}
{"ts":"2026-10-10T10:00:03Z","kind":"edit","id":"e1","file":"src/limiter.py"}
{"ts":"2026-10-10T10:00:04Z","kind":"run","id":"r1","cmd":"pytest -q"}
{"ts":"2026-10-10T10:00:09Z","kind":"run_result","id":"r1","exit":1,"output":"1 failed"}
{"ts":"2026-10-10T10:00:10Z","kind":"usage","tokens":2310}
```

```js
// Aider (hypothetical JSONL format): ~/.aider/sessions/<project>/<session>.jsonl
// The first line carries cwd and model, hence primeLines.

import path from 'node:path';
import { baseContext } from '../events.mjs';
import { clip, base, classifyShell } from './shell.mjs';

export function parseLine(d, ctx) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  const ts = Date.parse(d.ts) || Date.now();
  if (d.kind === 'meta') {
    ctx.project = base(d.cwd) || ctx.project;
    if (d.model) ctx.model = d.model;
    return out;
  }
  const common = { agent: 'aider', session: ctx.session, project: ctx.project, ts };

  if (d.kind === 'user' && d.text) {
    const t = clip(d.text, 400);
    out.push({ ...common, id: `aider-u-${ts}`, cat: 'prompt', verb: 'prompt', target: clip(t, 42), detail: t, status: 'ok' });
  } else if (d.kind === 'edit') {
    out.push({ ...common, id: d.id, cat: 'edit', verb: 'edit', target: base(d.file), detail: clip(d.file, 600), status: 'pending' });
  } else if (d.kind === 'run' && d.cmd) {
    const s = classifyShell(d.cmd);
    out.push({ ...common, id: d.id, cat: s.cat, verb: s.verb === 'run' ? 'shell' : s.verb, target: s.target, detail: clip(d.cmd, 600), status: 'pending' });
  } else if (d.kind === 'run_result') {
    out.push({ ...common, id: d.id + ':r', cat: 'result', ref: d.id, status: d.exit === 0 ? 'ok' : 'error', detail: clip(d.output, 400) });
  } else if (d.kind === 'usage' && d.tokens) {
    out.push({ ...common, id: `aider-t-${ts}`, cat: 'tokens', tokens: d.tokens });
  }
  if (out.length && ctx.model) out[0].model = ctx.model;
  return out;
}

/** @type {import('../events.mjs').SourceAdapter} */
export default {
  id: 'aider',
  label: 'Aider',
  defaultDir: (env, home) => env.AIDER_HOME ? path.join(env.AIDER_HOME, 'sessions') : path.join(home, '.aider', 'sessions'),
  fileFilter: (f) => f.endsWith('.jsonl'),
  newContext: (file) => baseContext(path.basename(file, '.jsonl'), path.basename(path.dirname(file))),
  parseLine,
  primeLines: 1,
};
```

Export `parseLine` as a named export too, so tests can call it directly.

## 3. Register it: `server/sources/index.mjs`

```js
import claude from './claude.mjs';
import codex from './codex.mjs';
import aider from './aider.mjs';

/** @type {import('../events.mjs').SourceAdapter[]} */
export const ADAPTERS = [claude, codex, aider];
```

That is all the server needs. `npm start -- --help` (or `silkscope --help`) now lists `--aider-dir <dir>`,
`--sources claude,aider` works, and the banner shows the directory when it exists.

## 4. Client

The client knows agents by id in one place: **crawler style** in `AGENTS`
(`public/js/core/config.js`). `body` colours the shell, cilia, caption, glow and the instance-list
dot; `core` the diamond core and pulse ring; `label` is the caption and inspector name. Unknown ids
fall back to a neutral grey style (`agentStyle()`), so a new adapter works before you pick colours.

```js
export const AGENTS = {
  claude: { body: BRAND.spinneret, core: BRAND.venom, label: 'claude' },
  // …
  aider: { body: '#9FB4FF', core: BRAND.pending, label: 'aider' },
};
```

Pick colours that stay distinct from the other crawlers, the section palette and Venom
(`#FF3D7F`), which is reserved for flags (see `brand/BRAND.md`). The **agents** setting builds its
options from `AGENTS` (`all` plus one per id), so the new agent is filterable automatically.

## 4b. Database sources

Some agents keep history in a database instead of an append-only file (opencode uses SQLite). Such
an adapter sets `kind: 'db'` and implements a different trio instead of `fileFilter`, `newContext`,
`parseLine` and `primeLines`:

```js
{
  id, label, kind: 'db', defaultDir(env, home),
  async open(dir) -> handle | null,          // null: not installed / unreadable, silently skipped
  backfill(handle, sinceMs, max) -> SwarmEvent[],  // recent history, oldest first
  poll(handle) -> SwarmEvent[],              // called every watcher tick; only what changed
  sessions?(handle) -> number,               // for the CLI banner and --check
  close?(handle),
}
```

See `server/sources/opencode.mjs`: it opens the database read-only through Node's built-in
`node:sqlite` (Node ≥ 22.5, so still zero dependencies), and skips the query entirely unless the
database or its WAL file changed since the last tick.

## 5. Test it

Add parser tests to `test/sources.test.mjs`, using a few real (anonymised) transcript lines. The
generic test `every adapter is complete and emits only known categories` already iterates
`ADAPTERS`; give it samples for your id:

```js
import { parseLine as parseAiderLine } from '../server/sources/aider.mjs';

test('aider: meta, edit, run, result, tokens', () => {
  const c = baseContext('s', 'p');
  assert.deepEqual(parseAiderLine({ kind: 'meta', cwd: '/home/me/api', model: 'gpt-5' }, c), []);
  const [ed] = parseAiderLine({ ts: '2026-10-10T10:00:03Z', kind: 'edit', id: 'e1', file: 'src/limiter.py' }, c);
  assert.deepEqual([ed.cat, ed.target, ed.project, ed.status, ed.model], ['edit', 'limiter.py', 'api', 'pending', 'gpt-5']);
  const [run] = parseAiderLine({ kind: 'run', id: 'r1', cmd: 'cd src && cat app.py' }, c);
  assert.deepEqual([run.cat, run.target], ['read', 'app.py']);
  const [res] = parseAiderLine({ kind: 'run_result', id: 'r1', exit: 1, output: '1 failed' }, c);
  assert.deepEqual([res.cat, res.ref, res.status], ['result', 'r1', 'error']);
  const [tk] = parseAiderLine({ ts: '2026-10-10T10:00:10Z', kind: 'usage', tokens: 2310 }, c);
  assert.deepEqual([tk.cat, tk.tokens], ['tokens', 2310]);
});
```

and in the `samples` object of the generic test:

```js
aider: [{ kind: 'user', text: 'hello' }, { kind: 'run', id: 'r', cmd: 'npm test' }],
```

The generic test also checks that `defaultDir({}, '/home/me')` is absolute and that
`newContext('/x/-Users-me-dev-app/abc.jsonl').session === 'abc'`, so derive the session from the
file name as above. If your agent has a directory or env-var quirk, add a case to the
`resolveSources` test.

For an end-to-end check, `test/watcher.test.mjs` shows how to run a real `Watcher` on a temp
directory with fast intervals (`interval: 20, scanInterval: 40`).

Then:

```bash
npm test
node bin/silkscope.mjs --sources aider --aider-dir /path/to/sample/transcripts
```

Append a line to a sample file and watch it appear. CI also runs `node --check` on every file.
