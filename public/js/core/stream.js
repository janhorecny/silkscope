// SSE client for /stream. EventSource retries on its own after a dropped connection; when the
// browser gives up (readyState CLOSED: server down at connect time, HTTP error) we reconnect
// ourselves with exponential backoff. Emits on the bus:
//   hello {hello, first}  ev <event>  ping <server stats>  live <bool>

export class Stream {
  constructor(url, bus) {
    this.url = url;
    this.bus = bus;
    this.first = true; // only the first hello replays history; reconnects keep the live picture
    this.delay = 1000;
    this.es = null;
  }

  connect() {
    const es = (this.es = new EventSource(this.url));
    es.addEventListener('hello', (m) => {
      const hello = JSON.parse(m.data);
      this.delay = 1000;
      this.bus.emit('live', true);
      const first = this.first;
      this.first = false;
      this.bus.emit('hello', { hello, first });
    });
    es.addEventListener('ping', (m) => this.bus.emit('ping', JSON.parse(m.data)));
    es.addEventListener('ev', (m) => this.bus.emit('ev', JSON.parse(m.data)));
    es.onerror = () => {
      this.bus.emit('live', false);
      if (es.readyState !== EventSource.CLOSED) return;
      es.close();
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(30000, this.delay * 2);
    };
    return this;
  }
}
