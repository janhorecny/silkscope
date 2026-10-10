// Screen-space backdrop: a faint katakana/hex matrix rain (rendered at half resolution into its
// own canvas, advanced every 55 ms) and a parallax star field.

import { TAU, rand, pick, rgbaQ } from '../../core/util.js';
import { FONT } from '../../core/config.js';

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789ABCDEF<>{}[]=+*:;/\\|'.split('');
const STAR_RGB = [200, 210, 230];

export class BackgroundLayer {
  id = 'background';
  views = ['crawler', 'neural'];
  space = 'screen';

  constructor() {
    this.stars = Array.from({ length: 520 }, () => ({
      x: Math.random(), y: Math.random(), d: Math.pow(Math.random(), 2) * 0.6 + 0.05,
      s: Math.random() < 0.06 ? 1.6 : 0.8, ph: rand(TAU),
    }));
    this.rainCv = document.createElement('canvas');
    this.rainG = this.rainCv.getContext('2d');
    this.rainCols = [];
    this.rainNext = 0;
  }

  resize(W, H) {
    this.rainCv.width = Math.ceil(W / 2);
    this.rainCv.height = Math.ceil(H / 2);
    const cols = Math.ceil(this.rainCv.width / 8);
    this.rainCols = Array.from({ length: cols }, () => ({ y: rand(-60, 0), v: rand(0.4, 1.3), on: Math.random() < 0.55 }));
  }

  pixels() { return this.rainCv.width * this.rainCv.height; }

  draw(g, w) {
    if (w.matrix && w.quality > 0 && !w.reduced) this.#rain(g, w);
    this.#stars(g, w);
  }

  #rain(g, w) {
    const rg = this.rainG, cw = this.rainCv.width, ch = this.rainCv.height, now = w.now;
    if (now > this.rainNext) {
      this.rainNext = now + 55;
      rg.fillStyle = 'rgba(5,6,8,0.16)';
      rg.fillRect(0, 0, cw, ch);
      rg.font = `9px ${FONT}`;
      const heat = w.world.activeCluster ? w.world.activeCluster.heat : 0;
      const green = `rgba(95,252,189,${0.55 + heat * 0.3})`;
      for (let i = 0; i < this.rainCols.length; i++) {
        const c = this.rainCols[i];
        if (!c.on) { if (Math.random() < 0.002) c.on = true; continue; }
        const y = c.y * 10;
        rg.fillStyle = Math.random() < 0.08 ? 'rgba(220,255,240,0.85)' : green;
        rg.fillText(pick(GLYPHS), i * 8, y);
        c.y += c.v * (1 + heat);
        if (y > ch + 20) { c.y = rand(-30, 0); c.v = rand(0.4, 1.3); c.on = Math.random() < 0.6; }
      }
    }
    g.globalAlpha = w.neural ? 0.08 : 0.15;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.rainCv, 0, 0, w.W, w.H);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = 1;
  }

  #stars(g, w) {
    const W = w.W, H = w.H, t = w.now / 1000, cam = w.cam;
    const n = w.quality < 0.5 ? 180 : this.stars.length;
    for (let i = 0; i < n; i++) {
      const s = this.stars[i];
      const px = ((s.x * W - cam.x * s.d * cam.z * 0.25) % W + W) % W;
      const py = ((s.y * H - cam.y * s.d * cam.z * 0.25) % H + H) % H;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (0.5 + s.d * 3) + s.ph));
      g.fillStyle = rgbaQ(STAR_RGB, a * (0.3 + s.d));
      g.fillRect(px, py, s.s, s.s);
    }
  }
}
