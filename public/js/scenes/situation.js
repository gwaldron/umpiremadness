// Rule situations: a scripted play runs on the field, freezes at the key moment, and asks for the ruling.
import { audio } from '../audio.js';
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
    this.endT = built.end || tl.duration + 0.8;
    this.t = 0;
    this.stepIdx = 0;
    this.state = 'intro';
    this.timeScale = 1;
    this.allowMove = false;
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
      this._frame(dt);
      return;
    }
    if (this.state === 'play' || this.state === 'after') {
      const pauseAt = this.state === 'play' ? this.pauses[this.stepIdx] : Infinity;
      const until = pauseAt - this.t;
      this.timeScale = until < 0.45 ? lerp(this.timeScale, 0.3, 0.2) : 1;
      this.t = Math.min(this.t + dt * this.timeScale, pauseAt);
      this.tl.sample(this.t);
      this._frame(dt);
      if (this.state === 'play' && this.t >= pauseAt) this._ask();
      return;
    }
    if (this.state === 'ask') {
      this.askT += dt;
      this._frame(dt);
    }
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
    rig.set({ x: f.x, y: f.y }, f.ext, f.pitch || 0.7);
    if (snap) rig.snap();
  }

  _ask() {
    this.state = 'ask';
    this.askT = 0;
    const st = this.steps[this.stepIdx];
    const hud = this.s.hud;
    audio.whoosh();
    hud.prompt(st.q || "WHAT'S THE CALL?", st.sub || '');
    hud.options(st.options, (id) => this._answer(id));
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
    s.field.draw(g, s.cam, { actors: this.tl.list(), ball: this.tl.ball, markers: this.def.markers ? this.def.markers(this.v, this.t) : [] });
  }
}
