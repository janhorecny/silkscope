// Tiny event bus: the only channel between core, renderer and UI. Handlers run in
// registration order and synchronously, so emit() ordering is part of the contract.
//
// Events:
//   setting  {key, value}          a user setting changed (also emitted once per key at boot)
//   view     'crawler'|'neural'    the scene's look changed
//   event    {ev, res, animate}    feed: an event passed the filter and was folded into the store
//   reset                          feed: about to rebuild everything for a new filter
//   rebuild  {sessions}            feed: silent rebuild done; recent sessions to re-place
//   watch    {id, session, announce}  feed: the watched instance changed (null = all)
//   replay   {count} | {done:true} feed: animated history replay started / ended
//   demo     {on}                  feed: demo feed started / stopped
//   idle                           nothing to show yet (no history, no demo)
//   hello    {hello, first}        stream: (re)connected; payload {sources, files, history, demo}
//   ev       event                 stream: one live event
//   ping     stats                 stream: server process stats
//   live     bool                  stream: connection state
//   camera   {mode, focus}         scene: camera mode / focused section changed
//   inspect  selection|null        scene or UI: open / close the inspector
//   toggle   'perf'|'help'         UI: toggle a floating panel
//   pause    bool                  scene: motion frozen / resumed (pause overlay, toolbar)
export class Bus {
  #h = new Map();

  on(type, fn) {
    let list = this.#h.get(type);
    if (!list) this.#h.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.#h.get(type);
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    const list = this.#h.get(type);
    if (!list) return;
    // Copy only when needed: a handler may unsubscribe while we iterate.
    for (const fn of list.length > 1 ? list.slice() : list) fn(payload);
  }
}
