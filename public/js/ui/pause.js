// Pause overlay: the mark in the centre and a play button. Data keeps arriving underneath, so it
// counts what was recorded while frozen. The scene stops drawing while this is up (see main.js).

export class PauseOverlay {
  constructor({ bus, scene, store }) {
    this.el = document.querySelector('#pauseOverlay');
    this.count = this.el.querySelector('.pz-count');
    this.store = store;
    this.el.querySelector('.pz-play').addEventListener('click', () => scene.setPaused(false));
    bus.on('pause', (p) => this.#show(p));
  }

  #show(paused) {
    clearInterval(this.timer);
    if (paused) {
      this.base = this.store.total;
      this.count.textContent = '0';
      this.timer = setInterval(() => { this.count.textContent = (this.store.total - this.base).toLocaleString('en'); }, 250);
      this.el.hidden = false;
      requestAnimationFrame(() => this.el.classList.add('on'));
    } else {
      this.el.classList.remove('on');
      setTimeout(() => { if (!this.el.classList.contains('on')) this.el.hidden = true; }, 260);
    }
  }
}
