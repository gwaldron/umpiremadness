// Unified input: keyboard, Xbox/standard gamepads, and touch (floating thumbstick + on-screen buttons).
// Everything is translated into a small set of action names:
//   A B X Y START BACK LB RB UP DOWN LEFT RIGHT ESC
import { clamp } from './util.js';

const KEYMAP = {
  KeyJ: 'A', Digit1: 'A', Numpad1: 'A', Enter: 'A', Space: 'A', NumpadEnter: 'A',
  KeyK: 'B', Digit2: 'B', Numpad2: 'B',
  KeyU: 'X', Digit3: 'X', Numpad3: 'X',
  KeyI: 'Y', Digit4: 'Y', Numpad4: 'Y',
  Escape: 'ESC', KeyP: 'START', Backspace: 'BACK', Tab: 'BACK',
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
  KeyQ: 'LB', KeyE: 'RB',
};

// Standard Gamepad mapping (Xbox layout)
const PADMAP = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 8: 'BACK', 9: 'START', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT' };

class InputManager {
  constructor() {
    this.held = new Set();
    this.mode = 'keyboard';
    this.padPrev = {};
    this.padIndex = null;
    this.stickNav = { dir: null, t: 0 };
    this.move = { x: 0, y: 0 };
    this.padMove = { x: 0, y: 0 };
    this.touchMove = { x: 0, y: 0 };
    this.stickEnabled = false;
    this.touch = null; // {id, ox, oy, x, y}
    this.listeners = new Set();
    this.onModeChange = null;
    this.usedGamepad = false;
    this.unlockHooks = [];
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      const act = KEYMAP[e.code];
      this._gesture();
      if (!act) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      // Let Tab work normally for accessibility unless a game action consumes it.
      if (e.code === 'Tab') return;
      e.preventDefault();
      this._setMode('keyboard');
      if (!e.repeat || ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(act)) this._press(act, e.repeat);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) this.padIndex = null;
    });

    // Touch / pointer thumbstick on the canvas.
    canvas.addEventListener('pointerdown', (e) => {
      this._gesture();
      if (e.pointerType === 'touch' || e.pointerType === 'pen') this._setMode('touch');
      if (!this.stickEnabled || this.touch) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture?.(e.pointerId);
      this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
      this._updateTouchMove();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.touch || e.pointerId !== this.touch.id) return;
      this.touch.x = e.clientX;
      this.touch.y = e.clientY;
      this._updateTouchMove();
    });
    const end = (e) => {
      if (!this.touch || e.pointerId !== this.touch.id) return;
      this.touch = null;
      this.touchMove = { x: 0, y: 0 };
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('touchstart', () => { this._gesture(); this._setMode('touch'); }, { passive: true });
    window.addEventListener('mousedown', () => this._gesture());
  }

  onUnlock(fn) { this.unlockHooks.push(fn); }
  _gesture() {
    for (const fn of this.unlockHooks) fn();
  }

  _updateTouchMove() {
    const t = this.touch;
    const R = 60;
    let dx = t.x - t.ox, dy = t.y - t.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      // Drag the origin along so the stick never feels "stuck".
      t.ox = t.x - (dx / l) * R;
      t.oy = t.y - (dy / l) * R;
      dx = t.x - t.ox; dy = t.y - t.oy;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / R);
    const ang = Math.atan2(dy, dx);
    const mag = m < 0.15 ? 0 : (m - 0.15) / 0.85;
    this.touchMove = { x: Math.cos(ang) * mag, y: -Math.sin(ang) * mag };
  }

  _setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    document.body.dataset.input = m;
    this.onModeChange?.(m);
  }

  _press(act, repeat = false) {
    for (const fn of this.listeners) fn(act, repeat);
  }

  // Inject an action from on-screen UI (touch buttons).
  inject(act) {
    this._gesture();
    this._press(act);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  poll(dt) {
    // Keyboard movement
    let kx = 0, ky = 0;
    if (this.held.has('ArrowLeft') || this.held.has('KeyA')) kx -= 1;
    if (this.held.has('ArrowRight') || this.held.has('KeyD')) kx += 1;
    if (this.held.has('ArrowUp') || this.held.has('KeyW')) ky += 1;
    if (this.held.has('ArrowDown') || this.held.has('KeyS')) ky -= 1;
    const kl = Math.hypot(kx, ky) || 1;
    kx /= kl; ky /= kl;

    // Gamepad
    this.padMove = { x: 0, y: 0 };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    if (pads) {
      if (this.padIndex !== null && pads[this.padIndex]) pad = pads[this.padIndex];
      else for (const p of pads) if (p && p.connected) { pad = p; this.padIndex = p.index; break; }
    }
    if (pad) {
      for (const [idx, act] of Object.entries(PADMAP)) {
        const b = pad.buttons[idx];
        const down = !!b && (b.pressed || b.value > 0.5);
        const was = !!this.padPrev[idx];
        if (down && !was) {
          this._gesture();
          this._setMode('gamepad');
          this.usedGamepad = true;
          this._press(act);
        }
        this.padPrev[idx] = down;
      }
      // Triggers as aliases: RT = A (strike/out), LT = B (ball/safe)
      for (const [idx, act] of [[7, 'A'], [6, 'B']]) {
        const b = pad.buttons[idx];
        const down = !!b && b.value > 0.6;
        const was = !!this.padPrev['t' + idx];
        if (down && !was) { this._setMode('gamepad'); this._press(act); }
        this.padPrev['t' + idx] = down;
      }
      let ax = pad.axes[0] || 0, ay = -(pad.axes[1] || 0);
      const mag = Math.hypot(ax, ay);
      const dz = 0.22;
      if (mag < dz) { ax = 0; ay = 0; } else {
        const s = Math.min(1, (mag - dz) / (1 - dz)) / mag;
        ax *= s; ay *= s;
        this._setMode('gamepad');
        this.usedGamepad = true;
      }
      // D-pad also moves
      if (pad.buttons[12]?.pressed) ay = 1;
      if (pad.buttons[13]?.pressed) ay = -1;
      if (pad.buttons[14]?.pressed) ax = -1;
      if (pad.buttons[15]?.pressed) ax = 1;
      this.padMove = { x: ax, y: ay };

      // Stick → menu navigation with key-repeat feel
      let dir = null;
      const sx = pad.axes[0] || 0, sy = pad.axes[1] || 0;
      if (Math.abs(sx) > 0.6 || Math.abs(sy) > 0.6) {
        dir = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'RIGHT' : 'LEFT') : (sy > 0 ? 'DOWN' : 'UP');
      }
      if (dir !== this.stickNav.dir) {
        this.stickNav = { dir, t: 0.38 };
        if (dir) this._press(dir);
      } else if (dir) {
        this.stickNav.t -= dt;
        if (this.stickNav.t <= 0) { this.stickNav.t = 0.12; this._press(dir, true); }
      }
    }

    const mx = kx + this.padMove.x + this.touchMove.x;
    const my = ky + this.padMove.y + this.touchMove.y;
    const ml = Math.hypot(mx, my);
    this.move = ml > 1 ? { x: mx / ml, y: my / ml } : { x: mx, y: my };
  }

  rumble(strong = 0.6, weak = 0.6, ms = 180) {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = this.padIndex !== null ? pads[this.padIndex] : null;
      if (pad && pad.vibrationActuator && this.mode === 'gamepad') {
        pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) });
      } else if (this.mode === 'touch' && navigator.vibrate) {
        navigator.vibrate(Math.min(ms, 200));
      }
    } catch (e) { /* ignore */ }
  }

  drawStick(g, dpr) {
    if (!this.stickEnabled || !this.touch || this.touch.mouse) return;
    const t = this.touch;
    const rect = this.canvas.getBoundingClientRect();
    const ox = (t.ox - rect.left) * dpr, oy = (t.oy - rect.top) * dpr;
    const x = (t.x - rect.left) * dpr, y = (t.y - rect.top) * dpr;
    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = '#0b1530';
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 3 * dpr;
    g.beginPath(); g.arc(ox, oy, 60 * dpr, 0, Math.PI * 2); g.fill(); g.stroke();
    g.globalAlpha = 0.9;
    g.fillStyle = '#ffd34d';
    g.beginPath(); g.arc(x, y, 26 * dpr, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

export const input = new InputManager();
