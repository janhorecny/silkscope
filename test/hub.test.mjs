import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventHub } from '../server/hub.mjs';

// Minimal stand-in for an http.ServerResponse whose socket we control.
function fakeClient() {
  const res = new EventEmitter();
  Object.assign(res, { chunks: [], writableLength: 0, destroyed: false,
    writeHead() {}, write(s) { this.chunks.push(s); return true; }, end() {}, destroy() { this.destroyed = true; this.emit('close'); } });
  return { req: new EventEmitter(), res };
}

test('hello, broadcast, drop while stalled, resume on drain, remove on close', () => {
  const hub = new EventHub({ stats: () => ({}), pingMs: 1e6 });
  const a = fakeClient(), b = fakeClient();
  hub.add(a.req, a.res, { history: [] });
  hub.add(b.req, b.res, { history: [] });
  assert.match(a.res.chunks[0], /^event: hello\n/);
  b.res.writableLength = 2 * 1024 * 1024; // b's socket stopped reading
  hub.broadcast('ev', { id: 1 });
  assert.equal(a.res.chunks.length, 2);
  assert.equal(b.res.chunks.length, 1);
  b.res.writableLength = 0; b.res.emit('drain');
  hub.broadcast('ev', { id: 2 });
  assert.match(b.res.chunks.at(-1), /"id":2/);
  a.req.emit('close');
  assert.equal(hub.clients.size, 1);
  hub.close();
});
