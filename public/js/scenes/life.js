// "Ump life" moments: a quick conversation or decision with three choices.
import { pick, shuffle } from '../util.js';
import { audio } from '../audio.js';

export class LifeEvent {
  constructor(session, spec) {
    this.s = session;
    this.kind = 'life';
    this.def = spec.def;
    this.allowMove = false;
    const btns = ['A', 'B', 'X'];
    this.options = shuffle(this.def.options).map((o, i) => ({ btn: btns[i], id: o.id, label: o.label }));
    this.t = 0;
  }

  start() {
    const s = this.s;
    s.rig.set({ x: 0, y: 40 }, 70, 0.6);
    if (this.def.mood === 'mad') audio.boo();
    s.hud.prompt('', '');
    s.hud.dialog({ ...this.def, options: this.options }, (id) => this._answer(id));
  }

  _answer(id) {
    const s = this.s;
    const d = this.def;
    const correct = id === d.answer;
    s.hud.dialog(null);
    const res = { kind: 'life', sub: d.id, correct, card: d.card, timing: null, bonus: [], call: id, truth: d.answer };
    const scored = s.record(res);
    const lbl = (v) => (this.options.find((o) => o.id === v) || {}).label || v;
    s.showVerdict({
      correct,
      title: correct ? pick(['COOL HEAD!', 'PRO MOVE!', 'GAME MANAGED!']) : 'NOT THE BEST MOVE',
      sub: correct ? 'You handled it like a pro' : `Better choice: ${lbl(d.answer)}`,
      body: d.explain,
      card: d.card,
      scored,
    }, () => s.eventDone());
  }

  onAction() { return false; }
  update() {}
  render(g) {
    const s = this.s;
    s.field.draw(g, s.cam, { actors: s.idleActors() });
    g.fillStyle = 'rgba(8,14,34,0.45)';
    g.fillRect(0, 0, s.cam.w, s.cam.h);
  }
}

export function faceSvg(mood = 'mad', cap = '#a3121f') {
  if (mood === 'storm') return '<svg viewBox="0 0 80 80" class="coach-face"><text x="40" y="58" font-size="54" text-anchor="middle">⛈️</text></svg>';
  const skin = pick(['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']);
  const brow = mood === 'mad' ? '<path d="M24 33 L35 37 M56 33 L45 37" stroke="#222" stroke-width="3.5" stroke-linecap="round"/>' : mood === 'confused' ? '<path d="M24 34 L35 32 M45 30 L56 33" stroke="#222" stroke-width="3" stroke-linecap="round"/>' : '<path d="M25 33 Q30 30 35 33 M45 33 Q50 30 55 33" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>';
  const mouth = mood === 'mad' ? '<ellipse cx="40" cy="56" rx="9" ry="6" fill="#5a1010"/>' : mood === 'confused' ? '<path d="M32 56 Q40 52 48 57" stroke="#3a1a1a" stroke-width="3" fill="none" stroke-linecap="round"/>' : '<path d="M30 53 Q40 62 50 53" stroke="#3a1a1a" stroke-width="3" fill="none" stroke-linecap="round"/>';
  const extra = mood === 'mad' ? '<text x="66" y="22" font-size="16">💢</text>' : mood === 'confused' ? '<text x="64" y="22" font-size="18" font-family="Bungee, Impact" fill="#ffd34d">?</text>' : '';
  return `<svg viewBox="0 0 80 80" class="coach-face">
    <circle cx="40" cy="44" r="25" fill="${skin}"/>
    <path d="M14 36 Q16 12 40 12 Q64 12 66 36 Z" fill="${cap}"/>
    <path d="M14 36 Q40 30 74 38 L72 42 Q40 36 14 40 Z" fill="${cap}" opacity="0.85"/>
    ${brow}
    <circle cx="31" cy="42" r="3" fill="#222"/><circle cx="49" cy="42" r="3" fill="#222"/>
    ${mouth}${extra}
  </svg>`;
}
