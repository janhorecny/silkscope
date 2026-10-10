// Fixture tests for the Codex and pi adapters, built from the shapes documented in
// server/sources/codex.mjs and pi.mjs (Codex 0.104 → 0.147, pi 0.86). Plus the client store's
// duplicate-result rule, which Codex relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import codex from '../server/sources/codex.mjs';
import pi from '../server/sources/pi.mjs';
import { Store } from '../public/js/core/store.js';

const run = (adapter, file, lines) => {
  const ctx = adapter.newContext(file);
  return lines.flatMap((l) => adapter.parseLine(l, ctx));
};
const T = '2026-10-10T10:00:00.000Z';
const ri = (payload) => ({ timestamp: T, type: 'response_item', payload });
const em = (payload) => ({ timestamp: T, type: 'event_msg', payload });

test('codex: session_meta nested under meta, turn_context cwd', () => {
  const evs = run(codex, '/x/rollout-1.jsonl', [
    { timestamp: T, type: 'session_meta', payload: { meta: { id: 'S1', cwd: '/w/api' } } },
    { timestamp: T, type: 'turn_context', payload: { cwd: '/w/web', model: 'gpt-5-codex' } },
    em({ type: 'user_message', message: 'go' }),
  ]);
  assert.equal(evs[0].session, 'S1');
  assert.equal(evs[0].project, 'web');
  assert.equal(evs[0].model, 'gpt-5-codex');
});

test('codex: every shell spelling classifies the command', () => {
  const evs = run(codex, '/x/r.jsonl', [
    ri({ type: 'function_call', name: 'shell', call_id: 'a', arguments: JSON.stringify({ command: ['bash', '-lc', 'cat README.md'] }) }),
    ri({ type: 'function_call', name: 'shell_command', call_id: 'b', arguments: JSON.stringify({ command: 'rg TODO' }) }),
    ri({ type: 'function_call', name: 'exec_command', call_id: 'c', arguments: JSON.stringify({ cmd: 'npm test' }) }),
    ri({ type: 'custom_tool_call', name: 'exec', call_id: 'd', input: 'curl -s https://x.dev' }),
    ri({ type: 'local_shell_call', call_id: 'e', action: { command: ['bash', '-lc', 'git status'] } }),
  ]);
  assert.deepEqual(evs.map((e) => [e.id, e.cat]), [['a', 'read'], ['b', 'search'], ['c', 'exec'], ['d', 'net'], ['e', 'search']]);
  assert.equal(evs[0].target, 'README.md');
});

test('codex: apply_patch as custom tool and function, MCP by namespace and by name', () => {
  const patch = '*** Begin Patch\n*** Update File: src/db.ts\n*** Add File: src/new.ts\n*** End Patch';
  const evs = run(codex, '/x/r.jsonl', [
    ri({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: patch }),
    ri({ type: 'function_call', name: 'apply_patch', call_id: 'p2', arguments: JSON.stringify({ input: patch }) }),
    ri({ type: 'function_call', namespace: 'mcp__node_repl__', name: 'js', call_id: 'm1', arguments: '{"code":"1+1"}' }),
    ri({ type: 'function_call', name: 'mcp__context7__query-docs', call_id: 'm2', arguments: '{"q":"react"}' }),
    ri({ type: 'function_call', name: 'update_plan', call_id: 'u1', arguments: '{"plan":[{},{}]}' }),
  ]);
  assert.deepEqual(evs.map((e) => [e.cat, e.verb, e.target]), [
    ['edit', 'patch', 'db.ts, new.ts'], ['edit', 'patch', 'db.ts, new.ts'],
    ['net', 'node_repl:js', '1+1'], ['net', 'context7:query-docs', 'react'], ['agent', 'plan', '2 steps'],
  ]);
});

test('codex: one action per call id across function_call + exec_command_begin', () => {
  const evs = run(codex, '/x/r.jsonl', [
    ri({ type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"command":["bash","-lc","npm test"]}' }),
    em({ type: 'exec_command_begin', call_id: 'c1', command: ['bash', '-lc', 'npm test'] }),
    em({ type: 'exec_command_end', call_id: 'c1', exit_code: 1, aggregated_output: 'fail' }),
    ri({ type: 'function_call_output', call_id: 'c1', output: 'Exit code: 1\nWall time: 1s\nOutput:\nfail' }),
  ]);
  assert.equal(evs.filter((e) => e.cat !== 'result').length, 1);
  const results = evs.filter((e) => e.cat === 'result');
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ref === 'c1' && r.status === 'error'));
  assert.notEqual(results[0].id, results[1].id);
});

test('codex: outcome sources: JSON exit code, text exit code, patch success, MCP isError', () => {
  const evs = run(codex, '/x/r.jsonl', [
    ri({ type: 'function_call_output', call_id: 'a', output: JSON.stringify({ output: 'x', metadata: { exit_code: 0 } }) }),
    ri({ type: 'custom_tool_call_output', call_id: 'b', output: 'Exit code: 2\nOutput:\n' }),
    em({ type: 'patch_apply_end', call_id: 'c', success: false, stderr: 'conflict' }),
    em({ type: 'mcp_tool_call_end', call_id: 'd', result: { Ok: { isError: true, content: [] } } }),
    em({ type: 'mcp_tool_call_end', call_id: 'e', result: { Err: 'timeout' } }),
  ]);
  assert.deepEqual(evs.map((e) => e.status), ['ok', 'error', 'error', 'error', 'error']);
});

test('codex: newer item_started / item_completed transport', () => {
  const evs = run(codex, '/x/r.jsonl', [
    em({ type: 'item_started', item: { type: 'CommandExecution', id: 'i1', command: ['/bin/zsh', '-lc', 'pnpm build'] } }),
    em({ type: 'item_completed', item: { type: 'CommandExecution', id: 'i1', exit_code: 0, aggregated_output: 'ok' } }),
    em({ type: 'item_completed', item: { type: 'file_change', id: 'i2', changes: [{ path: '/w/a.ts' }], status: 'completed' } }),
    em({ type: 'item_completed', item: { type: 'WebSearch', id: 'i3', query: 'vite config' } }),
  ]);
  assert.deepEqual(evs.map((e) => [e.cat, e.status]), [['exec', 'pending'], ['result', 'ok'], ['edit', 'ok'], ['net', 'ok']]);
  assert.equal(evs[2].target, 'a.ts');
});

test('codex: web search call and reasoning, unique ids in the same millisecond', () => {
  const evs = run(codex, '/x/r.jsonl', [
    ri({ type: 'web_search_call', id: 'w1', action: { type: 'search', query: 'node sqlite' } }),
    em({ type: 'agent_message', message: 'one' }),
    em({ type: 'agent_message', message: 'two' }),
  ]);
  assert.equal(evs[0].cat, 'net');
  assert.notEqual(evs[1].id, evs[2].id);
});

test('pi: header, prompts, tool calls with results, usage counted once', () => {
  const file = '/h/.pi/agent/sessions/--Users-me-dev-shop--/2026-09-08T17-24-13-943Z_abc.jsonl';
  const evs = run(pi, file, [
    { type: 'session', id: 'abc', cwd: '/Users/me/dev/shop', timestamp: T },
    { type: 'model_change', modelId: 'claude-sonnet-5-5' },
    { type: 'message', id: 'm1', timestamp: T, message: { role: 'user', content: [{ type: 'text', text: 'fix the build' }] } },
    { type: 'message', id: 'm2', timestamp: T, message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2 }, content: [
      { type: 'thinking', thinking: 'look at the config' },
      { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'npm run build' } },
      { type: 'toolCall', id: 't2', name: 'read', arguments: { path: '/Users/me/dev/shop/vite.config.ts' } },
      { type: 'toolCall', id: 't3', name: 'edit', arguments: { path: 'src/App.tsx', edits: [] } },
      { type: 'toolCall', id: 't4', name: 'web_search', arguments: { queries: ['vite 7 config'] } },
    ] } },
    { type: 'message', id: 'm3', timestamp: T, message: { role: 'toolResult', toolCallId: 't1', toolName: 'bash', isError: true, content: [{ type: 'text', text: 'boom' }] } },
    { type: 'message', id: 'm4', timestamp: T, message: { role: 'toolResult', toolCallId: 't2', toolName: 'read', isError: false, content: [] } },
  ]);
  const acts = evs.filter((e) => e.cat !== 'result');
  assert.deepEqual(acts.map((e) => [e.cat, e.target]), [
    ['prompt', 'fix the build'], ['think', 'look at the config'], ['exec', 'npm run build'],
    ['read', 'vite.config.ts'], ['edit', 'App.tsx'], ['net', 'vite 7 config'],
  ]);
  assert.equal(acts[0].project, 'shop');
  assert.equal(acts[0].session, 'abc');
  assert.equal(acts[0].model, 'claude-sonnet-5-5');
  assert.equal(acts.reduce((n, e) => n + (e.tokens || 0), 0), 17);
  const res = evs.filter((e) => e.cat === 'result');
  assert.deepEqual(res.map((r) => [r.ref, r.status]), [['t1', 'error'], ['t2', 'ok']]);
});

test('pi: project falls back to the encoded directory before the header', () => {
  const ctx = pi.newContext('/h/.pi/agent/sessions/--Users-me-dev-blog--/2026_x1.jsonl');
  assert.equal(ctx.project, 'blog');
  assert.equal(ctx.session, 'x1');
});

test('store: a second result for the same call only upgrades ok -> error', () => {
  const s = new Store();
  const base = { agent: 'codex', session: 's', project: 'p', ts: 1 };
  s.ingest({ ...base, id: 'c1', cat: 'exec', verb: 'shell', target: 'npm test', status: 'pending' });
  assert.equal(s.ingest({ ...base, id: 'c1:r1', cat: 'result', ref: 'c1', status: 'ok' }).kind, 'result');
  assert.equal(s.ingest({ ...base, id: 'c1:r2', cat: 'result', ref: 'c1', status: 'ok' }).kind, null);
  assert.deepEqual([s.ok, s.err, s.pending], [1, 0, 0]);
  assert.equal(s.ingest({ ...base, id: 'c1:r3', cat: 'result', ref: 'c1', status: 'error' }).kind, 'result');
  assert.deepEqual([s.ok, s.err, s.flags], [0, 1, 1]);
});

import droid from '../server/sources/droid.mjs';
import gemini from '../server/sources/gemini.mjs';
import opencode from '../server/sources/opencode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('droid: session_start, Anthropic-style tool blocks', () => {
  const evs = run(droid, '/h/.factory/sessions/-Users-me-dev-shop/abc.jsonl', [
    { type: 'session_start', id: 'abc', cwd: '/Users/me/dev/shop', title: 't' },
    { type: 'message', id: 'm1', timestamp: T, message: { role: 'user', content: [{ type: 'text', text: 'run the tests' }] } },
    { type: 'message', id: 'm2', timestamp: T, message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'u1', name: 'Execute', input: { command: 'npm test' } },
      { type: 'tool_use', id: 'u2', name: 'Create', input: { file_path: '/x/new.ts' } },
      { type: 'tool_use', id: 'u3', name: 'Grep', input: { pattern: 'TODO' } },
    ] } },
    { type: 'message', id: 'm3', timestamp: T, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true, content: 'fail' }] } },
  ]);
  assert.deepEqual(evs.map((e) => [e.cat, e.target ?? e.ref]), [['prompt', 'run the tests'], ['exec', 'npm test'], ['edit', 'new.ts'], ['search', 'TODO'], ['result', 'u1']]);
  assert.equal(evs[0].project, 'shop');
  assert.equal(evs.at(-1).status, 'error');
});

test('gemini: re-appended message emits each tool call once and its result once', () => {
  const file = '/h/.gemini/tmp/storefront/chats/session-2026-10-10T10-00-x.jsonl';
  const msg = (status) => ({ id: 'g1', timestamp: T, type: 'gemini', content: '', model: 'gemini-3-pro',
    toolCalls: [{ id: 'c1', name: 'run_shell_command', args: { command: 'npm test' }, status }] });
  const evs = run(gemini, file, [
    { sessionId: 'S', projectHash: 'h', startTime: T },
    { id: 'u1', timestamp: T, type: 'user', content: 'fix it' },
    msg('executing'), msg('executing'), msg('error'), msg('error'),
    { $set: { summary: 'x' } },
  ]);
  assert.deepEqual(evs.map((e) => [e.cat, e.status]), [['prompt', 'ok'], ['exec', 'pending'], ['result', 'error']]);
  assert.equal(evs[0].project, 'storefront');
  assert.equal(evs[0].session, 'S');
});

test('opencode: reads a real-shaped SQLite database, then polls only new writes', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return t.skip('node:sqlite not available'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silkscope-oc-'));
  const db = new DatabaseSync(path.join(dir, 'opencode.db'));
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_updated INTEGER, data TEXT);`);
  const now = Date.now();
  db.prepare('INSERT INTO session VALUES (?,?,?)').run('s1', '/Users/me/dev/shop', now);
  db.prepare('INSERT INTO message VALUES (?,?,?)').run('mu', 's1', JSON.stringify({ role: 'user' }));
  db.prepare('INSERT INTO message VALUES (?,?,?)').run('ma', 's1', JSON.stringify({ role: 'assistant', modelID: 'm' }));
  const part = db.prepare('INSERT OR REPLACE INTO part VALUES (?,?,?,?,?)');
  part.run('p1', 'mu', 's1', now - 50, JSON.stringify({ type: 'text', text: 'add tests', time: { start: 1, end: 2 } }));
  part.run('p2', 'ma', 's1', now - 40, JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' }, metadata: { exit: 1 } } }));
  part.run('p3', 'ma', 's1', now - 30, JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'running', input: { filePath: '/x/a.ts' } } }));

  const h = await opencode.open(dir);
  const first = opencode.backfill(h, now - 3600e3, 100);
  assert.deepEqual(first.map((e) => [e.cat, e.status]), [['prompt', 'ok'], ['exec', 'pending'], ['result', 'error'], ['read', 'pending']]);
  assert.equal(first[0].project, 'shop');
  assert.deepEqual(opencode.poll(h), []);

  part.run('p3', 'ma', 's1', Date.now() + 5, JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: '/x/a.ts' } } }));
  const next = opencode.poll(h);
  assert.deepEqual(next.map((e) => [e.cat, e.ref, e.status]), [['result', 'p3', 'ok']]);
  opencode.close(h);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

import { startDemo } from '../public/js/core/demo.js';
import { CATEGORIES } from '../public/js/core/config.js';

test('demo: warm start is deterministic per seed, English, and well-formed', () => {
  const take = (seed) => {
    const evs = [];
    const stop = startDemo(() => {}, { seed, warm: true, past: (ev) => evs.push(ev) });
    stop();
    return evs;
  };
  const a = take(7), b = take(7), c = take(8);
  const sig = (evs) => evs.map((e) => `${e.session}|${e.cat}|${e.target}|${e.status}`).join('\n');
  assert.ok(a.length > 50);
  assert.equal(sig(a), sig(b));
  assert.notEqual(sig(a), sig(c));
  const cats = new Set([...CATEGORIES.map((x) => x.key), 'result']);
  assert.ok(a.every((e) => cats.has(e.cat) && e.demo === true && e.session && e.project));
  assert.equal(new Set(a.map((e) => e.agent)).size, 5);
  assert.ok(a.some((e) => e.cat === 'result' && e.status === 'error'), 'stories include failing tests');
  assert.ok(a.filter((e) => typeof e.target === 'string').every((e) => /^[\x20-\x7E·…]+$/.test(e.target)), 'targets are plain English/ASCII');
});
