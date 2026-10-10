// The swarm: reach bursts, silk draglines, tentacles and the crawler bodies (crawler view) or
// loci of attention (neural view). Spider owns its own drawing; this layer orders the passes.

import { rgbaQ } from '../../core/util.js';

export class CrawlersLayer {
  id = 'crawlers';
  views = ['crawler', 'neural'];

  draw(g, w) {
    const spiders = w.world.spiders, z = w.z, now = w.now, neural = w.neural;
    for (const b of w.world.bursts) {
      g.fillStyle = rgbaQ(b.rgb, b.life * 0.9);
      g.fillRect(b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
    }
    for (const sp of spiders.values()) sp.drawSilk(g, z, now);
    const abstract = neural || w.quality < 0.5 || w.reduced;
    for (const sp of spiders.values()) sp.drawTentacles(g, z, now, abstract);
    // Bodies are opaque shells in the crawler view; in the neural view loci add light.
    g.globalCompositeOperation = neural ? 'lighter' : 'source-over';
    const multi = w.world.single || spiders.size > 1;
    for (const sp of spiders.values()) {
      const focused = sp === w.prim && multi;
      if (neural) sp.drawLocus(g, z, now, focused); else sp.drawBody(g, z, now, focused);
    }
  }
}
