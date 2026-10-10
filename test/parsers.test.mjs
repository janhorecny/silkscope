import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeLine, parseCodexLine, classifyShell } from '../server/parsers.mjs';

const ctx = () => ({ session: 's', project: 'p', seenMsg: new Set(), model: '' });

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
