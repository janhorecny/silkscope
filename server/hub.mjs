// Server-sent events fan-out: one `hello` per client, `ev` broadcast to all, `ping` every 2 s.

const MAX_BUFFERED = 1024 * 1024; // bytes queued for one client before its live events are dropped
const MAX_STALLED_MS = 15e3;      // stalled this long: close it, EventSource reconnects with a fresh hello

export class EventHub {
  /** @param {{ stats: () => object, pingMs?: number }} opts  stats() is the `ping` payload */
  constructor({ stats, pingMs = 2000 }) {
    this.stats = stats;
    this.pingMs = pingMs;
    this.clients = new Set(); // { res, ping, stalledAt }
    this.dropped = 0;
  }

  add(req, res, hello) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const c = { res, stalledAt: 0 };
    // hello carries the whole history and may exceed the buffer limit on its own; that's fine, it's bounded.
    res.write(frame('hello', hello));
    c.ping = setInterval(() => this.#send(c, frame('ping', this.stats())), this.pingMs);
    res.on('drain', () => { c.stalledAt = 0; });
    this.clients.add(c);
    const drop = () => { clearInterval(c.ping); this.clients.delete(c); };
    req.on('close', drop);
    res.on('close', drop);
  }

  broadcast(name, data) {
    if (!this.clients.size) return;
    const msg = frame(name, data);
    for (const c of this.clients) this.#send(c, msg);
  }

  close() {
    for (const c of this.clients) { clearInterval(c.ping); c.res.end(); }
    this.clients.clear();
  }

  // A slow reader must not make us queue unbounded data: skip its frames until 'drain'.
  #send(c, msg) {
    if (c.res.writableLength > MAX_BUFFERED) {
      const now = Date.now();
      if (!c.stalledAt) c.stalledAt = now;
      else if (now - c.stalledAt > MAX_STALLED_MS) c.res.destroy();
      this.dropped++;
      return;
    }
    c.res.write(msg);
  }
}

const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
