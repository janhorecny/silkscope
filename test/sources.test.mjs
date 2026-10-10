import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseLine as parseClaudeLine } from '../server/sources/claude.mjs';
import { parseLine as parseCodexLine } from '../server/sources/codex.mjs';
import { classifyShell, unwrapShell } from '../server/sources/shell.mjs';
import { ADAPTERS } from '../server/sources/index.mjs';
import { CATEGORIES, INTERNAL, baseContext } from '../server/events.mjs';
import { resolveSources } from '../server/server.mjs';

const ctx = () => baseContext('s', 'p');

test('claude tool_use maps to categories and targets', () => {
  const c = ctx();
  const evs = parseClaudeLine({
    type: 'assistant', uuid: 'u1', timestamp: '2026-10-10T10:00:00Z', cwd: '/x/my-app', sessionId: 'S1',
    message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/my-app/src/App.tsx' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'rg TODO src' } },
      { type: 'tool_use', id: 't3', name: 'mcp__context7__query-docs', input: { q: 'react' } },
    ] },
  }, c);
  assert.deepEqual(evs.map((e) => [e.cat, e.target]), [['read', 'App.tsx'], ['search', 'rg TODO src'], ['net', 'react']]);
  assert.equal(evs[0].project, 'my-app');
  assert.equal(evs[0].session, 'S1');
  assert.equal(evs[0].tokens, 15);
  assert.equal(evs[0].status, 'pending');
});

test('claude tool_result error resolves by tool_use_id', () => {
  const [r] = parseClaudeLine({ type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'boom' }] } }, ctx());
  assert.equal(r.cat, 'result');
  assert.equal(r.ref, 't2');
  assert.equal(r.status, 'error');
});

test('claude prompt strips command wrappers and skips meta', () => {
  const [p] = parseClaudeLine({ type: 'user', uuid: 'u3', message: { content: '<command-name>/goal</command-name><command-args>build it</command-args>' } }, ctx());
  assert.equal(p.cat, 'prompt');
  assert.match(p.detail, /build it/);
  assert.equal(parseClaudeLine({ type: 'user', isMeta: true, message: { content: 'x' } }, ctx()).length, 0);
});

test('codex rollout: session_meta, shell, patch, outputs, messages', () => {
  const c = ctx();
  parseCodexLine({ type: 'session_meta', payload: { id: 'CX1', cwd: '/home/me/api-server' } }, c);
  const shell = parseCodexLine({ type: 'response_item', timestamp: '2026-10-10T10:00:00Z', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } }, c);
  assert.deepEqual([shell[0].cat, shell[0].target, shell[0].session, shell[0].project], ['exec', 'npm test', 'CX1', 'api-server']);
  const read = parseCodexLine({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c2', arguments: JSON.stringify({ cmd: 'sed -n 1,80p src/server.ts' }) } }, c);
  assert.deepEqual([read[0].cat, read[0].target], ['read', 'server.ts']);
  const patch = parseCodexLine({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c3', input: '*** Begin Patch\n*** Update File: src/db.ts\n@@\n' } }, c);
  assert.deepEqual([patch[0].cat, patch[0].target], ['edit', 'db.ts']);
  const out = parseCodexLine({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'fail', metadata: { exit_code: 1 } }) } }, c);
  assert.deepEqual([out[0].cat, out[0].ref, out[0].status], ['result', 'c1', 'error']);
  const out2 = parseCodexLine({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: 'Chunk ID: x\nWall time: 0.1s\nProcess exited with code 0\nOutput:\nok' } }, c);
  assert.equal(out2[0].status, 'ok');
  const um = parseCodexLine({ type: 'event_msg', payload: { type: 'user_message', message: 'fix the tests' } }, c);
  assert.equal(um[0].cat, 'prompt');
  const tk = parseCodexLine({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } } } }, c);
  assert.equal(tk[0].tokens, 80);
});

test('shell classification', () => {
  assert.equal(classifyShell('cd /x && git status').cat, 'search');
  assert.equal(classifyShell('curl -s https://a.b').cat, 'net');
  assert.equal(classifyShell('cat README.md').target, 'README.md');
  assert.equal(classifyShell('npm run build').cat, 'exec');
});

test('unwrapShell strips sh -c wrappers', () => {
  assert.equal(unwrapShell(['bash', '-lc', 'npm test']), 'npm test');
  assert.equal(unwrapShell(['/bin/zsh', '-c', 'ls', '-la']), 'ls -la');
  assert.equal(unwrapShell(['git', 'status']), 'git status');
});

test('claude usage is counted once per message id', () => {
  const c = ctx();
  const line = (uuid) => ({ type: 'assistant', uuid, message: { id: 'm9', usage: { input_tokens: 7 }, content: [{ type: 'text', text: 'hi' }] } });
  assert.equal(parseClaudeLine(line('a'), c)[0].tokens, 7);
  assert.equal(parseClaudeLine(line('b'), c)[0].tokens, 0);
});

test('every adapter is complete and emits only known categories', () => {
  const known = new Set([...CATEGORIES, ...INTERNAL]);
  const samples = {
    claude: [{ type: 'assistant', uuid: 'u', message: { content: [{ type: 'tool_use', id: 't', name: 'Weird', input: {} }, { type: 'thinking', thinking: 'hm' }] } },
      { type: 'user', uuid: 'v', message: { content: 'hello' } }],
    codex: [{ type: 'response_item', payload: { type: 'web_search_call', action: { query: 'q' } } },
      { type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: 'p', arguments: '{"plan":[1,2]}' } }],
    pi: [{ type: 'message', id: 'm', message: { role: 'assistant', content: [{ type: 'toolCall', id: 't', name: 'mystery', arguments: {} }] } },
      { type: 'message', id: 'n', message: { role: 'toolResult', toolCallId: 't', isError: false, content: [] } }],
    gemini: [{ id: 'g', type: 'gemini', content: 'ok', toolCalls: [{ id: 'c', name: 'run_shell_command', args: { command: 'ls' }, status: 'success' }] }],
    droid: [{ type: 'message', id: 'd', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'u', name: 'Execute', input: { command: 'npm test' } }] } }],
  };
  for (const a of ADAPTERS) {
    for (const k of ['id', 'label', 'defaultDir']) assert.ok(a[k], `${a.id}.${k}`);
    assert.ok(path.isAbsolute(a.defaultDir({}, '/home/me')));
    if (a.kind === 'db') {
      for (const k of ['open', 'backfill', 'poll']) assert.equal(typeof a[k], 'function', `${a.id}.${k}`);
      continue;
    }
    for (const k of ['fileFilter', 'newContext', 'parseLine']) assert.ok(a[k], `${a.id}.${k}`);
    assert.equal(typeof a.primeLines, 'number');
    const c = a.newContext('/x/-Users-me-dev-app/abc.jsonl');
    assert.equal(c.session, 'abc');
    assert.ok(c.seen instanceof Set);
    for (const line of samples[a.id] || []) {
      for (const ev of a.parseLine(line, c)) {
        assert.ok(known.has(ev.cat), `${a.id}: ${ev.cat}`);
        assert.equal(ev.agent, a.id);
        for (const k of ['id', 'ts', 'session', 'project']) assert.ok(k in ev, `${a.id} event lacks ${k}`);
      }
    }
  }
});

test('claude project falls back to the encoded dir name', () => {
  const claude = ADAPTERS.find((a) => a.id === 'claude');
  assert.equal(claude.newContext('/p/-Users-me-dev-my-app/s.jsonl').project, 'app');
  assert.equal(claude.defaultDir({ CLAUDE_CONFIG_DIR: '/cfg' }, '/h'), path.join('/cfg', 'projects'));
});

test('resolveSources: --sources filter, explicit dirs, env defaults', () => {
  const env = { CODEX_HOME: '/cx', PI_CODING_AGENT_DIR: '/pa' };
  const dirs = Object.fromEntries(resolveSources({}, env, '/h').map((s) => [s.adapter.id, s.dir]));
  assert.equal(dirs.claude, path.join('/h', '.claude', 'projects'));
  assert.equal(dirs.codex, path.join('/cx', 'sessions'));
  assert.equal(dirs.pi, path.join('/pa', 'sessions'));
  assert.equal(resolveSources({}, { PI_CODING_AGENT_SESSION_DIR: '/ps' }, '/h').find((s) => s.adapter.id === 'pi').dir, '/ps');
  assert.deepEqual(resolveSources({ sources: ['codex'], dirs: { codex: '/d' } }, env, '/h').map((s) => [s.adapter.id, s.dir]), [['codex', '/d']]);
  assert.equal(resolveSources({ claudeDir: '/c' }, env, '/h')[0].dir, '/c');
});
