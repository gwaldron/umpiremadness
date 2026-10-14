// Confetti bursts for big moments (streaks, bang-bang calls, level ups, results).
// A fixed canvas between the field and the HUD; the loop only runs while pieces are alive.

const COLORS = ['#ffd34d', '#ff4d5a', '#35d07f', '#4da3ff', '#ffffff', '#ff8a1f', '#b26bff'];

class Confetti {
  constructor() {
    this.parts = [];
    this.running = false;
    this.cv = null;
  }

  _ensure() {
    if (this.cv) return true;
    if (typeof document === 'undefined') return false;
    this.cv = document.createElement('canvas');
    this.cv.id = 'fx';
    this.cv.setAttribute('aria-hidden', 'true');
    document.body.append(this.cv);
    this.g = this.cv.getContext('2d');
    return true;
  }

  get reduced() {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // x, y in 0..1 of the screen; power scales the launch speed
  burst({ x = 0.5, y = 0.4, n = 60, power = 1, colors = COLORS } = {}) {
    if (this.reduced || !this._ensure()) return;
    const W = innerWidth, H = innerHeight;
    const s = Math.min(W, H) / 700;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const v = (420 + Math.random() * 520) * power * s;
      this._add(x * W, y * H, Math.cos(a) * v, Math.sin(a) * v, colors, s);
    }
    this._start();
  }

  // pieces falling from the top edge
  rain({ n = 140, colors = COLORS } = {}) {
    if (this.reduced || !this._ensure()) return;
    const W = innerWidth, H = innerHeight;
    const s = Math.min(W, H) / 700;
    for (let i = 0; i < n; i++) {
      this._add(Math.random() * W, -20 - Math.random() * H * 0.5, (Math.random() - 0.5) * 120 * s, 60 + Math.random() * 160 * s, colors, s);
    }
    this._start();
  }

  _add(x, y, vx, vy, colors, s) {
    if (this.parts.length > 700) this.parts.shift();
    this.parts.push({
      x, y, vx, vy,
      w: (7 + Math.random() * 7) * s, h: (4 + Math.random() * 5) * s,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 14,
      flip: Math.random() * Math.PI * 2, vf: 6 + Math.random() * 10,
      c: colors[(Math.random() * colors.length) | 0],
      life: 2.6 + Math.random() * 1.6,
      sway: Math.random() * Math.PI * 2,
    });
  }

  _start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  _frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const cv = this.cv, g = this.g;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const drag = Math.exp(-dt * 2.2);
    let w = 0;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 40) continue;
      p.vx *= drag;
      p.vy = p.vy * drag + 900 * dt * Math.min(1, Math.min(W, H) / 700);
      p.sway += dt * 5;
      p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      p.flip += p.vf * dt;
      g.save();
      g.globalAlpha = Math.min(1, p.life * 1.5);
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.scale(1, Math.cos(p.flip));
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
      this.parts[w++] = p;
    }
    this.parts.length = w;
    if (w) requestAnimationFrame((t) => this._frame(t));
    else { this.running = false; g.clearRect(0, 0, W, H); }
  }
}

export const confetti = new Confetti();
