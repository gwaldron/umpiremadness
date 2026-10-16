// UMP CAM: a slow-motion close-up of the bag at the critical moment.
// What you can see depends on how good your angle, distance, and stillness were.
import { clamp, lerp, easeOut, easeIn } from '../util.js';
import { audio } from '../audio.js';

export class UmpCam {
  constructor(o) {
    this.o = o;
    const evs = [o.tb, o.tr];
    if (o.type === 'tag') evs.push(o.tt);
    this.tFirst = Math.min(...evs);
    this.tLast = Math.max(...evs) + (o.dropped ? 0.15 : 0);
    this.t0 = this.tFirst - 0.6;
    this.t1 = this.tLast + 0.6;
    this.speed = o.speed || 0.3;
    this.ct = this.t0;
    this.real = 0;
    this.seenAt = null; // real seconds when all decisive events have happened
    this.played = new Set();
    this.off = null;
    this.q = o.quality || { angle: 1, distS: 1, occl: false, moving: false };
    this.puffs = [];
    this.flash = 0;
    this.fx = [];
    // Comic sound-effect words only show up when you actually had a good look at the play
    this.clear = this.q.angle >= 0.45 && !this.q.occl && this.q.distS >= 0.7 && !this.q.moving;
  }

  _word(text, u, z, color) {
    if (this.clear) this.fx.push({ text, u, z, color, born: this.real });
  }

  update(dt) {
    this.real += dt;
    this.ct = Math.min(this.t1, this.ct + dt * this.speed);
    const o = this.o;
    const once = (key, t, fn) => {
      if (!this.played.has(key) && this.ct >= t) { this.played.add(key); fn(); }
    };
    once('ball', o.tb, () => { audio.pop(); this.flash = 0.25; this._word('POP!', o.type === 'force' ? -1.25 : -0.6, 3.1, '#ffd34d'); });
    once('foot', o.tr, () => { audio.thud(); this.puffs.push({ t: this.ct, x: 0.4 }); if (o.type === 'tag') audio.slide(); this._word(o.slide === 'head' ? 'SLAP!' : 'TAP!', 1.1, 0.9, '#ffffff'); });
    if (o.type === 'tag' && !o.missed) once('tag', o.tt, () => { audio.tick(); this.flash = 0.2; this._word('TAG!', 0.9, 1.8, '#ff9a3c'); });
    if (o.dropped) once('drop', o.dropT, () => { audio.tick(); this._word('DROP!', -0.6, 1.6, '#ff4d5a'); });
    if (this.seenAt === null && this.ct >= this.tLast) this.seenAt = this.real;
    this.flash = Math.max(0, this.flash - dt);
  }

  get finished() {
    return this.ct >= this.t1;
  }

  // ---------- drawing ----------
  render(g, rect, dpr = 1) {
    const q = this.q;
    const block = q.distS >= 0.85 ? 1 : Math.round(lerp(8, 2, clamp((q.distS - 0.3) / 0.55, 0, 1)));
    // Frame
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    const r = 18 * dpr;
    roundRect(g, rect.x - 6 * dpr, rect.y - 6 * dpr, rect.w + 12 * dpr, rect.h + 12 * dpr, r);
    g.fillStyle = '#0b1530';
    g.fill();
    g.lineWidth = 4 * dpr;
    g.strokeStyle = '#ffd34d';
    g.stroke();
    g.restore();

    // Scene into an offscreen canvas (lower res = blurry/pixelated view)
    const w = Math.max(16, Math.floor(rect.w / block)), h = Math.max(16, Math.floor(rect.h / block));
    if (!this.off || this.off.width !== w || this.off.height !== h) {
      this.off = document.createElement('canvas');
      this.off.width = w;
      this.off.height = h;
    }
    this._rectW = rect.w;
    this._rectH = rect.h;
    const og = this.off.getContext('2d');
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.clearRect(0, 0, w, h);
    let jx = 0, jy = 0;
    if (q.moving) {
      jx = Math.sin(this.real * 37) * w * 0.012;
      jy = Math.cos(this.real * 29) * h * 0.012;
    }
    og.translate(jx, jy);
    this._scene(og, w, h);
    g.save();
    roundRect(g, rect.x, rect.y, rect.w, rect.h, r * 0.7);
    g.clip();
    g.imageSmoothingEnabled = block <= 1;
    g.drawImage(this.off, rect.x, rect.y, rect.w, rect.h);
    // Occluding body (the fielder's back is in your way!)
    if (q.occl) {
      const cx = rect.x + rect.w * 0.44, cy = rect.y + rect.h * 0.45;
      const grd = g.createRadialGradient(cx, cy, rect.h * 0.1, cx, cy, rect.h * 0.62);
      grd.addColorStop(0, 'rgba(225,230,240,0.97)');
      grd.addColorStop(0.55, 'rgba(205,212,225,0.9)');
      grd.addColorStop(1, 'rgba(205,212,225,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(cx, cy, rect.w * 0.3, rect.h * 0.62, -0.15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(31,95,224,0.85)';
      g.font = `${rect.h * 0.16}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.fillText('7', cx, cy + rect.h * 0.02);
    }
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`;
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    // Comic words
    if (this._map) {
      const m = this._map;
      for (const f of this.fx) {
        const age = this.real - f.born;
        if (age > 1.6) continue;
        const k = Math.min(1, age / 0.15);
        const size = rect.h * 0.13 * (0.6 + 0.4 * k) * (1 + Math.max(0, 0.3 - age));
        const x = rect.x + m.X(f.u) * m.sx, y = rect.y + m.Y(f.z) * m.sy - age * rect.h * 0.04;
        g.save();
        g.globalAlpha = Math.min(1, 2 - age * 1.25);
        g.translate(x, y);
        g.rotate(-0.12);
        g.font = `${size}px Bungee, Impact, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = size * 0.16;
        g.strokeStyle = '#0b1530';
        g.strokeText(f.text, 0, 0);
        g.fillStyle = f.color;
        g.fillText(f.text, 0, 0);
        g.restore();
      }
    }
    // vignette + scanlines for the TV look
    const vg = g.createRadialGradient(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.h * 0.3, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = rect.y; y < rect.y + rect.h; y += 4 * dpr) g.fillRect(rect.x, y, rect.w, 1 * dpr);
    g.restore();

    // Labels
    g.save();
    const fs = Math.max(11, rect.h * 0.065);
    g.font = `${fs}px Bungee, Impact, sans-serif`;
    g.textBaseline = 'top';
    g.fillStyle = (Math.floor(this.real * 2) % 2) ? '#ff4d5a' : '#7a1d24';
    g.beginPath(); g.arc(rect.x + fs * 0.9, rect.y + fs * 1.05, fs * 0.32, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.fillText(`UMP CAM · ${this.o.baseName}`, rect.x + fs * 1.5, rect.y + fs * 0.5);
    g.textAlign = 'right';
    g.fillStyle = '#ffd34d';
    const sp = this.ct >= this.t1 ? 'REPLAY DONE' : `SLOW-MO ${this.speed.toFixed(1)}x`;
    g.fillText(sp, rect.x + rect.w - fs * 0.6, rect.y + fs * 0.5);
    // timeline scrubber
    const k = (this.ct - this.t0) / (this.t1 - this.t0);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(rect.x + rect.w * 0.55, rect.y + rect.h - fs * 0.9, rect.w * 0.4, 4 * dpr);
    g.fillStyle = '#ffd34d';
    g.fillRect(rect.x + rect.w * 0.55, rect.y + rect.h - fs * 0.9, rect.w * 0.4 * k, 4 * dpr);
    g.restore();
  }

  _scene(g, W, H) {
    const o = this.o;
    const q = this.q;
    const t = this.ct;
    const fx = 0.25 + 0.75 * clamp(q.angle, 0, 1);
    const S = H / 4.6; // pixels per foot
    const gy = H * 0.8; // ground line
    const mir = o.mirror ? -1 : 1;
    const X = (u) => W / 2 + u * S * fx * mir;
    const Y = (z) => gy - z * S;
    this._map = { X, Y, sx: this._rectW / W, sy: this._rectH / H };

    // Backdrop: outfield grass & sky band, dirt
    const sky = g.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#2f7f2c');
    sky.addColorStop(1, '#4caf46');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, gy);
    g.fillStyle = '#c98b52';
    g.fillRect(0, gy - S * 0.15, W, H);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 18; i++) g.fillRect((i * 97) % W, gy + ((i * 37) % (H - gy)), S * 0.3, S * 0.05);

    // Base
    const bw = 1.25 / 2;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(X(-bw), Y(0.12)); g.lineTo(X(bw), Y(0.12)); g.lineTo(X(bw + 0.1), Y(-0.08)); g.lineTo(X(-bw - 0.1), Y(-0.08));
    g.closePath(); g.fill();
    g.fillStyle = '#d9dde6';
    g.fillRect(Math.min(X(-bw - 0.1), X(bw + 0.1)), Y(-0.08), Math.abs(X(bw + 0.1) - X(-bw - 0.1)), S * 0.08);

    if (o.type === 'force') this._force(g, X, Y, S, t);
    else this._tag(g, X, Y, S, t);

    // dust puffs
    for (const p of this.puffs) {
      const age = (t - p.t) / 0.4;
      if (age > 1) continue;
      g.fillStyle = `rgba(214,170,120,${0.6 * (1 - age)})`;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI;
        g.beginPath();
        g.arc(X(p.x + Math.cos(a) * age * 0.9), Y(0.1 + Math.sin(a) * age * 0.5), S * 0.18 * (1 - age * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  _ball(g, X, Y, S, u, z) {
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = Math.max(1, S * 0.02);
    g.beginPath(); g.arc(X(u), Y(z), S * 0.15, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = '#d0302f';
    g.lineWidth = Math.max(1, S * 0.02);
    g.beginPath(); g.arc(X(u) - S * 0.12, Y(z), S * 0.1, -0.9, 0.9); g.stroke();
  }

  _limb(g, pts, w, color) {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }

  _shoe(g, x, y, S, dir, color = '#141418') {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x + dir * S * 0.12, y - S * 0.1, S * 0.42, S * 0.15, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8e8e8';
    g.fillRect(x - S * 0.3, y - S * 0.02, S * 0.7, S * 0.05);
  }

  _glove(g, x, y, S, closed) {
    g.fillStyle = '#7a4a22';
    g.beginPath();
    if (closed) g.ellipse(x, y, S * 0.38, S * 0.3, 0, 0, Math.PI * 2);
    else g.ellipse(x, y, S * 0.42, S * 0.48, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a3416';
    g.beginPath(); g.ellipse(x + S * 0.05, y, S * 0.2, S * 0.24, 0.3, 0, Math.PI * 2); g.fill();
  }

  _force(g, X, Y, S, t) {
    const o = this.o;
    // Fielder: leg on the bag (left side), glove reaching toward the throw (left)
    let footU = -0.35, footZ = 0.02;
    if (o.pulled !== null && o.pulled !== undefined && t > o.pulled) {
      const k = easeOut(clamp((t - o.pulled) / 0.18, 0, 1));
      footU = lerp(-0.35, -1.7, k);
      footZ = lerp(0.02, 0.5, Math.sin(k * Math.PI)) + 0.02;
    }
    const hip = [X(-2.1), Y(3.4)];
    const knee = [X(lerp(-1.0, -1.5, footU < -1 ? 1 : 0)), Y(1.5)];
    this._limb(g, [hip, knee, [X(footU), Y(footZ + 0.2)]], S * 0.42, '#c3c9d4');
    this._shoe(g, X(footU), Y(footZ), S, -1 * (this.o.mirror ? -1 : 1));
    // Glove
    const gloveU = -1.25, gloveZ = 2.4;
    const closed = t >= o.tb && !(o.dropped && t > o.dropT);
    this._limb(g, [[X(-2.6), Y(3.6)], [X(-1.9), Y(2.8)], [X(gloveU - 0.1), Y(gloveZ)]], S * 0.26, '#f4f6fa');
    this._glove(g, X(gloveU), Y(gloveZ), S, closed);
    // Ball: from the left into the glove
    if (t < o.tb) {
      const k = clamp((t - (o.tb - 0.35)) / 0.35, 0, 1);
      if (k > 0) this._ball(g, X, Y, S, lerp(-5.5, gloveU, k), lerp(2.6, gloveZ, k));
    } else if (o.dropped && t > o.dropT) {
      const d = t - o.dropT;
      const z = Math.max(0.15, gloveZ - 9 * d * d - 1.5 * d);
      this._ball(g, X, Y, S, gloveU + d * 1.2, z);
    } else {
      this._ball(g, X, Y, S, gloveU + 0.05, gloveZ + 0.05);
    }
    // Runner: leg from the right, foot lands on the bag at tr
    const startU = 4.5;
    let fu, fz;
    if (t < o.tr) {
      const k = clamp((t - (o.tr - 0.32)) / 0.32, 0, 1);
      fu = lerp(startU, 0.35, k);
      fz = 0.05 + Math.sin(k * Math.PI) * 0.7;
    } else {
      const d = t - o.tr;
      fu = 0.35 - d * 2.5;
      fz = 0.05 + (d > 0.12 ? Math.sin(Math.min(1, (d - 0.12) / 0.3) * Math.PI) * 0.6 : 0);
    }
    const rh = [X(fu + 1.7), Y(3.3)];
    const rk = [X(fu + 0.9), Y(1.6 + fz * 0.4)];
    this._limb(g, [rh, rk, [X(fu + 0.1), Y(fz + 0.25)]], S * 0.42, '#eef0f3');
    this._limb(g, [rk, [X(fu + 0.1), Y(fz + 0.25)]], S * 0.3, '#a3121f');
    this._shoe(g, X(fu), Y(fz), S, -1 * (this.o.mirror ? -1 : 1));
  }

  _tag(g, X, Y, S, t) {
    const o = this.o;
    const head = o.slide === 'head';
    // Fielder legs straddle the bag on the left
    this._limb(g, [[X(-1.6), Y(3.4)], [X(-1.2), Y(1.6)], [X(-1.1), Y(0.2)]], S * 0.42, '#c3c9d4');
    this._shoe(g, X(-1.1), Y(0.02), S, -1);
    // Runner sliding in from the right
    let tip;
    if (t < o.tr) {
      const k = clamp((t - (o.tr - 0.5)) / 0.5, 0, 1);
      tip = lerp(5.5, 0.45, easeOut(k));
    } else tip = 0.45 - Math.min(0.15, (t - o.tr) * 0.6);
    if (head) {
      // diving back: arm + hand reaching for the bag
      this._limb(g, [[X(tip + 3.6), Y(0.75)], [X(tip + 1.6), Y(0.55)]], S * 0.9, '#d62839');
      this._limb(g, [[X(tip + 1.7), Y(0.55)], [X(tip + 0.15), Y(0.3)]], S * 0.26, o.skin || '#e0ac69');
      g.fillStyle = '#a3121f';
      g.beginPath(); g.arc(X(tip + 2.1), Y(0.95), S * 0.42, 0, Math.PI * 2); g.fill();
      g.fillStyle = o.skin || '#e0ac69';
      g.beginPath(); g.arc(X(tip + 0.15), Y(0.3), S * 0.16, 0, Math.PI * 2); g.fill();
    } else {
      this._limb(g, [[X(tip + 4.8), Y(1.0)], [X(tip + 2.4), Y(0.55)], [X(tip + 0.4), Y(0.3)]], S * 0.42, '#eef0f3');
      this._limb(g, [[X(tip + 1.3), Y(0.4)], [X(tip + 0.4), Y(0.3)]], S * 0.3, '#a3121f');
      this._shoe(g, X(tip), Y(0.2), S, -1 * (this.o.mirror ? -1 : 1));
      // dirt spray while sliding
      if (t < o.tr + 0.1 && t > o.tr - 0.5) {
        g.fillStyle = 'rgba(214,170,120,0.55)';
        for (let i = 0; i < 5; i++) {
          g.beginPath(); g.arc(X(tip + 0.6 + i * 0.25), Y(0.2 + (i % 2) * 0.25), S * 0.1, 0, Math.PI * 2); g.fill();
        }
      }
    }
    // Tag target on the runner's leg (or hand), measured from the tip
    const tagPoint = (time) => {
      let tp;
      if (time < o.tr) {
        const k = clamp((time - (o.tr - 0.5)) / 0.5, 0, 1);
        tp = lerp(5.5, 0.45, easeOut(k));
      } else tp = 0.3;
      return tp + (head ? 0.5 : 0.9);
    };
    // Glove: catch the throw at tb (up high), then sweep down to tag at tt
    const hi = { u: -0.6, z: 2.5 };
    const tgt = { u: tagPoint(o.tt), z: o.missed ? 1.3 : 0.62 };
    let gu, gz;
    if (t <= o.tb) { gu = hi.u; gz = hi.z; }
    else if (t <= o.tt) {
      const k = easeIn(clamp((t - o.tb) / Math.max(0.05, o.tt - o.tb), 0, 1));
      gu = lerp(hi.u, tgt.u, k); gz = lerp(hi.z, tgt.z, k);
    } else {
      const k = clamp((t - o.tt) / 0.35, 0, 1);
      gu = lerp(tgt.u, tgt.u - 0.2, k); gz = lerp(tgt.z, o.missed ? 1.6 : 0.9, k);
    }
    this._limb(g, [[X(-2.4), Y(3.6)], [X((gu - 2.4) / 2), Y((gz + 3.4) / 2)], [X(gu - 0.15), Y(gz + 0.05)]], S * 0.26, '#f4f6fa');
    const ballInGlove = t >= o.tb && !o.empty && !(o.dropped && t > o.dropT);
    this._glove(g, X(gu), Y(gz), S, ballInGlove);
    // Bare hand (holding the ball if the tag was made with an empty glove)
    const bh = { u: -1.9, z: 2.1 };
    g.fillStyle = '#e0ac69';
    this._limb(g, [[X(-2.7), Y(3.5)], [X(bh.u), Y(bh.z)]], S * 0.24, '#f4f6fa');
    g.beginPath(); g.arc(X(bh.u), Y(bh.z), S * 0.15, 0, Math.PI * 2); g.fill();
    // Ball
    if (t < o.tb) {
      const k = clamp((t - (o.tb - 0.35)) / 0.35, 0, 1);
      if (k > 0) this._ball(g, X, Y, S, lerp(-5.5, hi.u, k), lerp(2.7, hi.z, k));
    } else if (o.empty) {
      this._ball(g, X, Y, S, bh.u + 0.1, bh.z + 0.12);
    } else if (o.dropped && t > o.dropT) {
      const d = t - o.dropT;
      this._ball(g, X, Y, S, tgt.u + d * 2.2, Math.max(0.15, tgt.z + 2.5 * d - 12 * d * d));
    } else {
      this._ball(g, X, Y, S, gu + 0.05, gz + 0.06);
    }
  }
}

function roundRect(g, x, y, w, h, r, append = false) {
  if (!append) g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// The 3D UMP CAM: the scene itself is rendered by the WebGL inset camera from the umpire's eyes.
// This class keeps the timing/sounds of UmpCam and draws only the TV frame, labels and comic words.
export class UmpCam3D extends UmpCam {
  constructor(o) {
    super(o);
    this.points = o.points || {};
  }

  _word(text, u, z, color) {
    if (!this.clear) return;
    const key = { 'POP!': 'glove', 'TAP!': 'bag', 'SLAP!': 'bag', 'TAG!': 'tag', 'DROP!': 'glove' }[text];
    this.fx.push({ text, color, born: this.real, world: this.points[key] || this.points.bag });
  }

  // rect in canvas pixels; project(worldPoint) -> {x, y} in canvas pixels
  renderOverlay(g, rect, dpr, project) {
    const r = 18 * dpr;
    const W = g.canvas.width, H = g.canvas.height;
    g.save();
    // dim everything except the inset
    g.beginPath();
    g.rect(0, 0, W, H);
    roundRect(g, rect.x, rect.y, rect.w, rect.h, r * 0.7, true);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fill('evenodd');
    // frame
    roundRect(g, rect.x - 5 * dpr, rect.y - 5 * dpr, rect.w + 10 * dpr, rect.h + 10 * dpr, r);
    roundRect(g, rect.x, rect.y, rect.w, rect.h, r * 0.7, true);
    g.fillStyle = '#0b1530';
    g.fill('evenodd');
    roundRect(g, rect.x - 5 * dpr, rect.y - 5 * dpr, rect.w + 10 * dpr, rect.h + 10 * dpr, r);
    g.lineWidth = 4 * dpr;
    g.strokeStyle = '#ffd34d';
    g.stroke();
    g.restore();

    g.save();
    roundRect(g, rect.x, rect.y, rect.w, rect.h, r * 0.7);
    g.clip();
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    // comic words, anchored to the real 3D spots
    for (const f of this.fx) {
      const age = this.real - f.born;
      if (age > 1.6 || !f.world) continue;
      const p = project(f.world);
      if (!p) continue;
      const k = Math.min(1, age / 0.15);
      const size = rect.h * 0.13 * (0.6 + 0.4 * k) * (1 + Math.max(0, 0.3 - age));
      g.save();
      g.globalAlpha = Math.min(1, 2 - age * 1.25);
      g.translate(p.x, p.y - rect.h * 0.08 - age * rect.h * 0.04);
      g.rotate(-0.12);
      g.font = `${size}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = size * 0.16;
      g.strokeStyle = '#0b1530';
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
    // TV look: vignette + scanlines
    const vg = g.createRadialGradient(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.h * 0.35, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = vg;
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = rect.y; y < rect.y + rect.h; y += 4 * dpr) g.fillRect(rect.x, y, rect.w, 1 * dpr);
    g.restore();

    // labels
    g.save();
    const fs = Math.max(11, rect.h * 0.065);
    g.font = `${fs}px Bungee, Impact, sans-serif`;
    g.textBaseline = 'top';
    g.fillStyle = (Math.floor(this.real * 2) % 2) ? '#ff4d5a' : '#7a1d24';
    g.beginPath(); g.arc(rect.x + fs * 0.9, rect.y + fs * 1.05, fs * 0.32, 0, Math.PI * 2); g.fill();
    g.lineWidth = fs * 0.18;
    g.strokeStyle = 'rgba(11,21,48,0.85)';
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    const label = this.callLabel || `UMP CAM · ${this.o.baseName}`;
    g.strokeText(label, rect.x + fs * 1.5, rect.y + fs * 0.5);
    g.fillText(label, rect.x + fs * 1.5, rect.y + fs * 0.5);
    g.textAlign = 'right';
    g.fillStyle = '#ffd34d';
    const sp = this.callLabel ? 'LIVE' : this.ct >= this.t1 ? 'REPLAY DONE' : `SLOW-MO ${this.speed.toFixed(1)}x`;
    g.strokeText(sp, rect.x + rect.w - fs * 0.6, rect.y + fs * 0.5);
    g.fillText(sp, rect.x + rect.w - fs * 0.6, rect.y + fs * 0.5);
    const k = (this.ct - this.t0) / (this.t1 - this.t0);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(rect.x + rect.w * 0.55, rect.y + rect.h - fs * 0.9, rect.w * 0.4, 4 * dpr);
    g.fillStyle = '#ffd34d';
    g.fillRect(rect.x + rect.w * 0.55, rect.y + rect.h - fs * 0.9, rect.w * 0.4 * Math.min(1, k), 4 * dpr);
    g.restore();
  }
}
