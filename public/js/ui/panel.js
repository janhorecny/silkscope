// Base for every DOM widget. A panel owns one root element: either an existing one from
// index.html ({ el }) or a new bottom-HUD box ({ title, badge, body }) with the standard
// `.panel > header(span + em badge) + body` markup. The HUD calls update(state) at 4 Hz and the
// optional frame(dt, now) every animation frame; reset() when the picture is rebuilt.
// The set* helpers write to the DOM only when the value actually changed.
//
// Panel interface: { id, update?(state), frame?(dt, now), reset?() }
//   state = { now, store, scene, feed, active, overview, heat }   (see hud.js)

export class Panel {
  constructor(ctx, { el, title, badge = '', badgeClass = 'mint', badgeId, body = '', parent = '#hud' } = {}) {
    this.ctx = ctx;
    if (el) {
      this.el = typeof el === 'string' ? document.querySelector(el) : el;
    } else {
      this.el = document.createElement('div');
      this.el.className = 'panel';
      this.el.innerHTML = `<header><span>${title}</span><em${badgeId ? ` id="${badgeId}"` : ''} class="${badgeClass}">${badge}</em></header>${body}`;
      document.querySelector(parent).appendChild(this.el);
      this.badgeEl = this.el.querySelector('header em');
    }
  }

  $(sel) { return this.el.querySelector(sel); }
  badge(text, cls) { setText(this.badgeEl, text); if (cls) setClass(this.badgeEl, cls); }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Last written values live on the element itself, so any module can use these helpers.
export function setText(el, v) {
  v = String(v);
  if (el._text !== v) { el._text = v; el.textContent = v; }
}
export function setHTML(el, v) {
  if (el._html !== v) { el._html = v; el.innerHTML = v; }
}
export function setClass(el, v) {
  if (el.className !== v) el.className = v;
}
export function toggleClass(el, cls, on) {
  if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}
export function setStyle(el, prop, v) {
  const k = '_s_' + prop;
  if (el[k] !== v) { el[k] = v; if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v; }
}

// Hi-DPI canvas sizing that only reallocates the bitmap when the element size changes.
// Returns the CSS size; the context is left scaled ×2 and cleared.
export function fitCanvas(g) {
  const cv = g.canvas, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * 2 || cv.height !== h * 2) { cv.width = w * 2; cv.height = h * 2; }
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.clearRect(0, 0, w, h);
  return [w, h];
}
