import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Watcher } from '../server/watcher.mjs';
import claude from '../server/sources/claude.mjs';

// Real Claude-shaped lines through the real adapter, with fast poll/scan intervals.
let dir, proj, w;
const events = [];
const line = (n) => JSON.stringify({ type: 'user', uuid: 'u' + n, timestamp: new Date(Date.now() + n).toISOString(),
  cwd: '/x/demo', message: { content: 'prompt ' + n } }) + '\n';
const ids = () => events.map((e) => e.id);
const waitFor = async (pred, ms = 2000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out; got ' + JSON.stringify(ids()));
    await new Promise((r) => setTimeout(r, 15));
  }
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silkscope-test-'));
  proj = path.join(dir, '-tmp-demo');
  fs.mkdirSync(path.join(proj, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'old.jsonl'), line(1) + line(2));
  fs.writeFileSync(path.join(proj, 'memory', 'ignored.jsonl'), line(99));
  w = await new Watcher({ sources: [{ adapter: claude, dir }, { adapter: claude, dir: path.join(dir, 'missing') }], interval: 20, scanInterval: 40 }).start();
  w.on('event', (ev) => events.push(ev));
});

after(() => { w.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('backfills existing files, skips missing dirs and skipDir', () => {
  assert.equal(w.sources.length, 1);
  assert.deepEqual(w.history.map((e) => e.id), ['u1', 'u2']);
  assert.equal(w.history[0].project, 'demo');
  assert.deepEqual([w.stats.files, w.stats.backfilledFiles], [1, 1]);
});

test('tails appended lines and buffers a partial line', async () => {
  const f = path.join(proj, 'old.jsonl');
  fs.appendFileSync(f, line(3));
  await waitFor(() => ids().includes('u3'));
  const l4 = line(4);
  fs.appendFileSync(f, l4.slice(0, 20));
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!ids().includes('u4'), 'half a line must not be parsed');
  fs.appendFileSync(f, l4.slice(20));
  await waitFor(() => ids().includes('u4'));
  assert.equal(ids().filter((i) => i === 'u4').length, 1);
});

test('picks up a newly created file in a new directory', async () => {
  const sub = path.join(dir, '-tmp-other');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'new.jsonl'), line(5));
  await waitFor(() => ids().includes('u5'));
  assert.equal(w.stats.files, 2);
  fs.appendFileSync(path.join(sub, 'new.jsonl'), line(6));
  await waitFor(() => ids().includes('u6'));
});

test('truncation resets the offset and re-reads from the start', async () => {
  const f = path.join(proj, 'old.jsonl');
  fs.writeFileSync(f, line(7));
  await waitFor(() => ids().includes('u7'));
  assert.ok(w.stats.active >= 1);
});
