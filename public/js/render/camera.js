// The camera. "The world moves, not the crawler": in auto mode it tracks the watched crawler with
// a slow dolly-in and cuts (pull-out-and-punch-in flights) on section changes; with all instances
// it holds a calm wide shot leaning toward the busy section. focus/free/overview are user modes
// that fall back to auto after a while. cinematic | calm | still set how much it moves on its own.

import { clamp, lerp, damp, easeInOutCubic } from '../core/util.js';

export const WORLD = { x0: -1000, y0: -780, x1: 920, y1: 900 };

export class Camera {
  constructor() {
    this.W = 1; this.H = 1;
    this.ov = { x: 0, y: 0, z: 1 }; // overview framing, recomputed on resize
    this.cam = { x: 0, y: 0, z: 0.5 };  // mutated in place: other modules hold the reference
    this.camT = { x: 0, y: 0, z: 0.5 };
    this.mode = 'auto';        // auto | focus | free | overview
    this.cameraMode = 'cinematic'; // cinematic | calm | still
    this.reduced = false;
    this.focusCluster = null;
    this.followSpider = null;
    this.flight = null;
    this.lastFlightEnd = 0;
    this.freeUntil = 0;
    this.onChange = () => {};  // (mode, focusCluster)
  }

  resize(W, H) {
    this.W = W; this.H = H;
    const w = WORLD.x1 - WORLD.x0, h = WORLD.y1 - WORLD.y0;
    this.ov.x = (WORLD.x0 + WORLD.x1) / 2;
    this.ov.y = (WORLD.y0 + WORLD.y1) / 2;
    this.ov.z = Math.min(W / w, H / h) * 0.98;
  }

  // Jump straight to the overview framing (first frame).
  snapOverview() { Object.assign(this.cam, this.ov); }

  // Scalar transforms for hot loops; toWorld/toScreen return pairs for the rare callers.
  sx(wx) { return (wx - this.cam.x) * this.cam.z + this.W / 2; }
  sy(wy) { return (wy - this.cam.y) * this.cam.z + this.H / 2; }
  toWorld(sx, sy) { return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.H / 2) / this.cam.z + this.cam.y]; }
  toScreen(wx, wy) { return [this.sx(wx), this.sy(wy)]; }

  // World-space view rectangle with a margin, for culling (written into `out`).
  viewRect(margin, out) {
    const z = this.cam.z;
    out.x0 = (-margin - this.W / 2) / z + this.cam.x;
    out.y0 = (-margin - this.H / 2) / z + this.cam.y;
    out.x1 = (this.W + margin - this.W / 2) / z + this.cam.x;
    out.y1 = (this.H + margin - this.H / 2) / z + this.cam.y;
    return out;
  }

  setMode(m) {
    this.mode = m;
    if (m === 'free') { this.freeUntil = performance.now() + 15000; this.flight = null; }
    if (m !== 'focus') this.focusCluster = null;
    this.onChange(this.mode, this.focusCluster);
  }

  focus(cluster) {
    this.focusCluster = cluster;
    this.mode = 'focus';
    this.freeUntil = performance.now() + 25000;
    this.fly(performance.now(), 0.25);
    this.onChange(this.mode, cluster);
  }

  // A new instance (or all) is being watched.
  watch() {
    this.followSpider = null;
    this.focusCluster = null;
    this.mode = 'auto';
    this.fly(performance.now(), 0.35);
    this.onChange(this.mode, null);
  }

  fly(now, dip = 0.42) {
    if (this.cameraMode === 'still') return;
    if (this.cameraMode === 'calm' || this.reduced) dip = 0;
    this.flight = { x0: this.cam.x, y0: this.cam.y, z0: this.cam.z, t0: now, dur: 950, dip };
  }

  // A crawler is changing section: cut to it if it is the one being watched. Skipped if the last
  // cut just ended, so think/exec ping-pong stays calm.
  onTravel(sp, now, backlog, single) {
    const watched = single ? sp.session === single : sp === this.followSpider;
    if (this.cameraMode === 'cinematic' && watched && this.mode === 'auto' && now - this.lastFlightEnd > 700 && backlog < 12) this.fly(now);
  }

  // User drag (screen pixels).
  pan(dx, dy) {
    const z = this.cam.z;
    this.camT.x -= dx / z; this.camT.y -= dy / z;
    this.cam.x -= dx / z; this.cam.y -= dy / z;
    this.setMode('free');
  }

  // User wheel: zoom around the cursor.
  zoomAt(mx, my, deltaY) {
    const [wx, wy] = this.toWorld(mx, my);
    const ov = this.ov.z;
    const z = clamp(this.camT.z * Math.exp(-deltaY * 0.0015), ov * 0.6, ov * 8);
    this.camT.z = z;
    this.camT.x = wx - (mx - this.W / 2) / z;
    this.camT.y = wy - (my - this.H / 2) / z;
    this.setMode('free');
  }

  update(dt, now, world) {
    if ((this.mode === 'free' || this.mode === 'focus') && now > this.freeUntil) this.setMode('auto');
    const ov = this.ov, camT = this.camT, cam = this.cam;
    let lam = 1.6;
    const sp = world.single ? world.spiders.get(world.single) : this.followSpider;
    const still = this.cameraMode === 'still' && this.mode === 'auto';
    if (still) {
      // Still camera: never moves on its own; only the user pans and zooms.
    } else if (this.mode === 'overview' || (this.mode === 'auto' && !sp)) {
      // All instances: a calm wide shot that only leans toward the busy section.
      camT.x = ov.x; camT.y = ov.y; camT.z = ov.z;
      const act = world.activeCluster;
      if (this.mode === 'auto' && act && now - world.lastActivity < 30000) {
        camT.x = lerp(ov.x, act.x, 0.1);
        camT.y = lerp(ov.y, act.y, 0.1);
        camT.z = ov.z * 1.06;
      }
      lam = 0.7;
    } else if (this.mode === 'focus' && this.focusCluster) {
      camT.x = this.focusCluster.x; camT.y = this.focusCluster.y; camT.z = ov.z * 2.3;
      lam = 2.5;
    } else if (this.mode === 'auto' && sp) {
      // Tight follow with a slow dolly-in while the crawler stays in one section.
      const dwell = clamp((now - sp.enteredAt) / 9000, 0, 1);
      camT.x = sp.cluster ? lerp(sp.cluster.x, sp.x, 0.55) : sp.x;
      camT.y = sp.cluster ? lerp(sp.cluster.y, sp.y, 0.55) : sp.y;
      const cine = this.cameraMode === 'cinematic';
      camT.z = ov.z * (2.1 + (cine ? dwell * 0.75 : 0.2));
      lam = cine ? 3 : 1.3;
    }
    if (this.mode === 'free') lam = 10;
    if (this.flight) {
      const f = this.flight;
      const p = clamp((now - f.t0) / f.dur, 0, 1), e = easeInOutCubic(p);
      cam.x = lerp(f.x0, camT.x, e);
      cam.y = lerp(f.y0, camT.y, e);
      cam.z = lerp(f.z0, camT.z, e) * (1 - f.dip * Math.sin(Math.PI * p));
      if (p >= 1) { this.flight = null; this.lastFlightEnd = now; }
    } else {
      cam.x = damp(cam.x, camT.x, lam, dt);
      cam.y = damp(cam.y, camT.y, lam, dt);
      cam.z = damp(cam.z, camT.z, lam * 0.9, dt);
    }
  }
}
