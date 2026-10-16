// Rule situations: a scripted play runs on the field, freezes at the key moment, and asks for the ruling.
import { audio } from '../audio.js';
import { input } from '../input.js';
import { voices } from '../voice.js';
import { clamp, lerp, pick } from '../util.js';
import { Timeline, setupDefense, setupRunners, setupBatter, setupUmps } from './timeline.js';

export class SituationEvent {
  constructor(session, spec) {
    this.s = session;
    this.div = session.div; // session._make() already switched divisions if the spec named one
    this.def = spec.def;
    this.kind = 'sit';
    this.v = this.def.variant ? this.def.variant(this.div) : {};
    this.setup = this.def.setup(this.v, this.div);
    this.steps = this.def.steps(this.v, this.div);
    this.tl = new Timeline();
    const tl = this.tl;
    setupDefense(tl, this.setup.defense || {});
    if (this.setup.batter !== false) setupBatter(tl, this.setup.hand || 'R');
    setupRunners(tl, this.setup.runners || []);
    setupUmps(tl, this.setup.runners || [], session.umpKit, this.setup.bu !== false);
    const built = this.def.build(tl, this.v, this.div) || {};
    this.pauses = built.pauses || [built.pause || 2];
    this.camFn = built.cam || null;
    this.scuffFn = built.scuffs || null; // marks on the ground (where a ball hit the turf, cleat marks)
    this.markFn = built.markers || null; // rings on the ground at a moment to watch
    this.words = built.words || []; // [{ t, text }]: a big callout on screen for a moment ("TAG!")
    this.insetFn = built.inset || null; // picture-in-picture of a second thing to watch: (t) => { eye, target, fov, label, flash }
    if (built.init) built.init(session);
    this.slow = built.slow || [];
    // REPLAY rewinds to here: the build's pick, else a bit before the first slow-motion moment, else the start
    this.replayT = built.replay ?? (this.slow.length ? Math.max(0, this.slow[0][0] - 2.5) : 0); // [[t0, t1], ...]: slow motion so a quick moment at the plate can be seen
    this.endT = built.end || tl.duration + 0.8;
    this.t = 0;
    this.stepIdx = 0;
    this.state = 'intro';
    this.timeScale = 1;
    // you are the base umpire: move with the stick like on base plays (the script no longer moves you)
    const bu = tl.actors.BU;
    this.bu = bu ? { x: bu.x, y: bu.y, vx: 0, vy: 0 } : null;
    if (bu) { bu.ring = true; bu.you = true; }
    this.allowMove = !!bu;
    tl.sample(0);
  }

  start() {
    const hud = this.s.hud;
    const st = this.setup;
    hud.setBug({ balls: st.balls || 0, strikes: st.strikes || 0, outs: st.outs || 0, runners: st.runners || [] });
    const divTag = st.divLabel || this.div.full;
    hud.prompt(this.def.title.toUpperCase(), `${divTag} · ${st.text}`);
    hud.options([{ btn: 'A', id: 'go', label: 'PLAY IT!', big: true }], () => this._run());
    this.introT = 0;
    this._frame(0, true);
  }

  _run() {
    if (this.state !== 'intro') return;
    this.state = 'play';
    this.s.hud.options(null);
    this.s.hud.promptMain('');
  }

  onAction() { return false; }

  update(dt) {
    if (this.state === 'intro') {
      this.introT += dt;
      if (this.introT > 3.5) this._run();
      this.tl.sample(0);
      this._moveUmp(dt);
      this._frame(dt);
      return;
    }
    if (this.state === 'play' || this.state === 'after' || this.state === 'replay') {
      const pauseAt = this.state === 'after' ? Infinity : this.pauses[this.stepIdx];
      const until = pauseAt - this.t;
      const slow = this.slow.some(([a, b]) => this.t >= a && this.t <= b);
      this.timeScale = until < 0.45 || slow ? lerp(this.timeScale, 0.3, 0.2) : lerp(this.timeScale, 1, 0.2);
      this.t = Math.min(this.t + dt * this.timeScale, pauseAt);
      this.tl.sample(this.t);
      this._moveUmp(dt);
      this._frame(dt);
      if (this.state === 'play' && this.t >= pauseAt) this._ask();
      else if (this.state === 'replay' && this.t >= pauseAt) this._ask(true);
      return;
    }
    if (this.state === 'ask') {
      this.askT += dt;
      this._moveUmp(dt);
      this._frame(dt);
    }
  }

  // The base umpire follows your stick (same feel as the base plays)
  _moveUmp(dt) {
    const u = this.bu;
    if (!u) return;
    const a = this.tl.actors.BU;
    const m = this.state === 'play' || this.state === 'intro' ? input.move : { x: 0, y: 0 };
    const tvx = m.x * 17, tvy = m.y * 17;
    const k = Math.min(1, (70 * dt) / Math.max(1, Math.hypot(tvx - u.vx, tvy - u.vy)));
    u.vx += (tvx - u.vx) * k;
    u.vy += (tvy - u.vy) * k;
    u.x = clamp(u.x + u.vx * dt, -75, 75);
    u.y = clamp(u.y + u.vy * dt, -15, 140);
    a.x = u.x; a.y = u.y;
    a.vis = Math.min(innerWidth, innerHeight) < 600 ? 1.6 : 1.2;
    const sp = Math.hypot(u.vx, u.vy);
    if (sp > 2) {
      a.pose = 'run';
      a.dist = (a.dist || 0) + sp * dt;
      a.phase = (a.dist / 5.2) % 1;
      if (Math.abs(u.vx) > 1) a.facing = u.vx > 0 ? 1 : -1;
    } else a.pose = 'set';
  }

  _frame(dt, snap = false) {
    const rig = this.s.rig;
    let f;
    if (this.camFn) f = this.camFn(this.t, this.tl);
    if (!f) {
      const b = this.tl.ball;
      const c = { x: 0, y: 52 };
      const tx = b.visible ? lerp(c.x, b.x, 0.55) : c.x;
      const ty = b.visible ? lerp(c.y, b.y, 0.55) : c.y;
      const ext = clamp(Math.max(Math.abs(b.x - tx), Math.abs(b.y - ty) * 0.8) + 34, 52, 120);
      f = { x: tx, y: ty, ext };
    }
    // (a side-on yaw is 3D only: the flat 2D figures are drawn for the view from behind home)
    rig.set({ x: f.x, y: f.y }, f.ext, f.pitch || 0.7, this.s.field.is3d ? f.yaw ?? null : null);
    if (snap) rig.snap();
  }

  _ask(again = false) {
    this.state = 'ask';
    if (!again) this.askT = 0;
    const st = this.steps[this.stepIdx];
    const hud = this.s.hud;
    if (!again) audio.whoosh();
    hud.prompt(st.q || "WHAT'S THE CALL?", st.sub || '');
    hud.options([...st.options, { btn: 'Y', id: '__replay', label: 'REPLAY', sub: 'Watch it again', small: true }], (id) => (id === '__replay' ? this._replay() : this._answer(id)));
  }

  // Not sure? Run the play back from just before the key moment, then make the call.
  _replay() {
    if (this.state !== 'ask') return;
    const tl = this.tl;
    for (const e of tl.events) if (e.t >= this.replayT) tl.fired.delete(e); // the sounds and puffs happen again
    tl.ball.trail.length = 0;
    this.t = this.replayT;
    tl.t = this.t;
    this.timeScale = 1;
    this.state = 'replay';
    this.s.hud.options(null);
    this.s.hud.prompt('⏪ REPLAY', 'Watch closely…');
    this.s.hud.stamp('REPLAY', 'gold');
  }

  _answer(id) {
    if (this.state !== 'ask') return;
    const st = this.steps[this.stepIdx];
    const hud = this.s.hud;
    hud.options(null);
    const correct = id === st.answer;
    const quick = this.askT < 6;
    const res = {
      kind: 'sit', sub: this.def.id, correct, card: st.card || this.def.card,
      timing: null, bonus: quick ? [{ label: 'Quick decision', pts: 50 }] : [],
      call: id, truth: st.answer, division: this.div.id,
    };
    const scored = this.s.record(res);
    const label = (v) => (st.options.find((o) => o.id === v) || {}).label || v;
    if (st.say && id === st.answer) voices.ump(st.say);
    hud.stamp(correct ? 'CORRECT!' : 'NOPE!', correct ? 'good' : 'bad');
    this.state = 'after';
    setTimeout(() => {
      this.s.showVerdict({
        correct,
        title: correct ? pick(['BY THE BOOK!', 'NAILED IT!', 'RULES GURU!', 'CORRECT!']) : 'NOT QUITE',
        sub: `You: ${label(id)} · Correct: ${label(st.answer)}`,
        body: st.explain,
        card: st.card || this.def.card,
        scored,
      }, () => {
        this.stepIdx++;
        if (this.stepIdx < this.steps.length) {
          this.state = 'play';
          return;
        }
        this.s.eventDone();
      });
    }, 650);
  }

  render(g) {
    const s = this.s;
    s.field.draw(g, s.cam, { actors: this.tl.list(), ball: this.tl.ball, markers: [...(this.def.markers ? this.def.markers(this.v, this.t) : []), ...(this.markFn ? this.markFn(this.t) : [])], scuffs: this.scuffFn ? this.scuffFn(this.t) : [] });
    const pip = this.insetFn && this.insetFn(this.t);
    if (pip) this._inset(g, pip);
    const w = this.words.find((q) => this.t >= q.t && this.t < q.t + 0.9);
    if (w) this._word(g, w.text, (this.t - w.t) / 0.9);
  }

  _word(g, text, k) {
    const s = this.s, W = s.cam.w, H = s.cam.h;
    const size = Math.min(W * 0.16, H * 0.12) * (1 + 0.25 * Math.max(0, 1 - k * 6));
    g.save();
    g.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
    g.font = `${size}px Bungee, Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = size * 0.16;
    g.strokeStyle = '#10203a';
    g.strokeText(text, W / 2, H * 0.3);
    g.fillStyle = '#ffd34d';
    g.fillText(text, W / 2, H * 0.3);
    g.restore();
  }

  // A boxed second view in the corner (3D), or just its banner in 2D
  _inset(g, f) {
    const s = this.s, W = s.cam.w, H = s.cam.h, dpr = s.app.dpr;
    const portrait = H > W;
    const w = portrait ? W * 0.56 : Math.min(W * 0.34, H * 0.55);
    const h = s.field.is3d ? w * 0.7 : w * 0.22;
    // corner: the play picks where it won't cover the action (default: top right, or low on a tall screen)
    const c = f.corner || (portrait ? 'br' : 'tr');
    const rect = { x: c[1] === 'l' ? 12 * dpr : W - w - 12 * dpr, y: c[0] === 'b' ? (portrait ? H * 0.62 : H * 0.94 - h) : portrait ? H * 0.19 : H * 0.14, w, h };
    if (s.field.is3d && s.field.drawInset) {
      const css = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };
      s.field.drawInset({ eye: f.eye, target: f.target, fov: f.fov }, css, { actors: this.tl.list(), ball: this.tl.ball }, 1);
    } else {
      g.fillStyle = 'rgba(12,22,44,0.88)';
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    g.save();
    g.lineWidth = 3 * dpr;
    g.strokeStyle = f.flash ? '#ffffff' : '#ffd34d';
    g.strokeRect(rect.x, rect.y, rect.w, rect.h);
    const fs = Math.max(11 * dpr, rect.w * 0.065);
    g.font = `${fs}px Bungee, Impact, sans-serif`;
    g.textBaseline = 'middle';
    const tw = g.measureText(f.label).width;
    g.fillStyle = '#ffd34d';
    g.fillRect(rect.x, rect.y, tw + fs * 0.9, fs * 1.5);
    g.fillStyle = '#10203a';
    g.fillText(f.label, rect.x + fs * 0.45, rect.y + fs * 0.78);
    if (f.flash) {
      let big = rect.w * 0.13;
      g.font = `${big}px Bungee, Impact, sans-serif`;
      big = Math.min(big, (big * rect.w * 0.9) / g.measureText(f.flash).width); // long words shrink to fit
      g.font = `${big}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = big * 0.16;
      g.strokeStyle = '#10203a';
      const yy = s.field.is3d ? rect.y + rect.h * 0.86 : rect.y + rect.h * 0.62;
      g.strokeText(f.flash, rect.x + rect.w / 2, yy);
      g.fillStyle = '#ffffff';
      g.fillText(f.flash, rect.x + rect.w / 2, yy);
    }
    g.restore();
  }
}
