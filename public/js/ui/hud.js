// Registry for the DOM side. Panels are mounted in order (bottom-HUD boxes appear in that
// order); update(state) fans out at 4 Hz with one shared snapshot, frame(dt, now) every frame.
// A new panel = one file in panels/ + one add() line in main.js.

export class Hud {
  constructor(ctx) {
    this.ctx = ctx; // { store, scene, feed, bus, settings }
    this.panels = [];
    this.errors = 0;
    ctx.bus.on('reset', () => { for (const p of this.panels) p.reset?.(); });
    setInterval(() => this.update(), 250);
  }

  add(PanelClass, opts) {
    const p = new PanelClass(this.ctx, opts);
    this.panels.push(p);
    return p;
  }

  get(id) { return this.panels.find((p) => p.id === id); }

  // 4 Hz: one snapshot shared by every panel (store.heat() is computed once, not per panel).
  update() {
    const { store, scene, feed } = this.ctx;
    const state = {
      now: Date.now(), store, scene, feed,
      active: scene.activeCluster, overview: scene.mode === 'overview', heat: store.heat(12),
    };
    for (const p of this.panels) {
      try { p.update?.(state); } catch (err) { if (this.errors++ < 5) console.error(`[swarm] panel ${p.id}`, err); }
    }
  }

  frame(now, dt) {
    for (const p of this.panels) p.frame?.(dt, now);
  }
}
