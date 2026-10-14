// In-game HUD (DOM overlay on top of the canvas).
import { el, mini, lessonUrl, escapeHtml } from '../util.js';
import { RULE } from '../data/rules.js';
import { drawKZone } from '../scenes/plate.js';
import { faceSvg } from '../scenes/life.js';
import { audio } from '../audio.js';

const KEYS = { A: 'J', B: 'K', X: 'U', Y: 'I' };
export function glyph(btn, extra = '') {
  return `<span class="glyph ${extra}" data-btn="${btn}" data-pad="${btn}" data-key="${KEYS[btn] || btn}"></span>`;
}

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.$ = (id) => document.getElementById(id);
    this.optHandler = null;
    this.optList = [];
    this.verdictHandler = null;
    this.dialogHandler = null;
    this.$('pauseBtn').addEventListener('click', () => this.onPause && this.onPause());
  }

  show() { this.root.hidden = false; }
  hide() {
    this.root.hidden = true;
    this.options(null);
    this.verdict(null);
    this.dialog(null);
    this.kzone(null);
    this.tip(null);
    this.timer(null);
  }

  setBug({ balls = 0, strikes = 0, outs = 0, runners = [] } = {}) {
    this.bug = { balls, strikes, outs };
    this.$('bugCount').innerHTML = `<b>${balls}</b>-<b>${strikes}</b>`;
    const outsEl = this.$('bugOuts').children;
    for (let i = 0; i < 2; i++) outsEl[i].classList.toggle('on', i < Math.min(outs, 2));
    for (const i of this.$('bugDiamond').children) i.classList.toggle('on', runners.includes(Number(i.dataset.b)));
  }
  setDivision(t) { this.$('bugDiv').textContent = t; }
  setInning(t) { this.$('bugInn').textContent = t; }
  setScore(n) { this.$('hudScore').textContent = n.toLocaleString(); }
  setStreak(streak, mult) {
    const s = this.$('hudStreak');
    if (streak >= 3) {
      s.textContent = `🔥 ${streak} STREAK · x${mult}`;
      s.classList.toggle('fire', streak >= 10);
    } else {
      s.textContent = mult > 1 ? `x${mult}` : '';
      s.classList.remove('fire');
    }
  }
  setLives(n, max = 3) {
    const l = this.$('hudLives');
    if (n === null || n === undefined) { l.textContent = ''; return; }
    l.textContent = '🧢'.repeat(Math.max(0, n)) + '⚫'.repeat(Math.max(0, max - n));
  }
  setTime(sec) {
    const l = this.$('hudLives');
    l.textContent = sec === null ? '' : `⏱️ ${Math.ceil(sec)}`;
  }
  setProgress(list, cur) {
    const p = this.$('hudProgress');
    if (!list) { p.innerHTML = ''; return; }
    p.innerHTML = list.map((st, i) => `<i class="${i === cur ? 'cur' : st === true ? 'ok' : st === false ? 'bad' : ''}"></i>`).join('');
  }

  prompt(main, sub) {
    const p = this.$('prompt');
    const m = p.querySelector('.prompt-main');
    if (m.textContent !== (main || '')) {
      m.textContent = main || '';
      p.classList.remove('flash');
      void p.offsetWidth;
      if (main) p.classList.add('flash');
    }
    p.querySelector('.prompt-sub').textContent = sub || '';
  }
  promptMain(main) { this.prompt(main, this.$('prompt').querySelector('.prompt-sub').textContent); }
  promptSub(sub) {
    const s = this.$('prompt').querySelector('.prompt-sub');
    if (s.textContent !== sub) s.textContent = sub || '';
  }

  // Call buttons. list: [{btn, id, label, sub, big, small}]
  options(list, onPick) {
    const box = this.$('options');
    box.innerHTML = '';
    this.optList = list || [];
    this.optHandler = list ? onPick : null;
    if (!list) return;
    for (const o of list) {
      const b = el('button', { class: `opt${o.big ? ' big' : ''}`, 'data-btn': o.btn, type: 'button' });
      b.innerHTML = `${glyph(o.btn, 'opt-glyph')}<span>${escapeHtml(o.label)}${o.sub ? `<small>${escapeHtml(o.sub)}</small>` : ''}</span>`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this._pick(o.btn); });
      box.append(b);
    }
  }
  _pick(btn) {
    const o = this.optList.find((x) => x.btn === btn);
    if (!o || !this.optHandler) return false;
    const h = this.optHandler;
    this.optHandler = null;
    const b = this.$('options').querySelector(`[data-btn="${btn}"]`);
    if (b) b.classList.add('hit');
    audio.select();
    h(o.id);
    return true;
  }

  stamp(text, cls = '') {
    const s = this.$('stamp');
    s.className = 'stamp';
    s.textContent = text;
    void s.offsetWidth;
    s.className = `stamp go ${cls}`;
    audio.stamp();
  }

  floater(text, bad = false, x = 50, y = 46) {
    const f = el('div', { class: `floater${bad ? ' bad' : ''}`, style: { left: `${x}%`, top: `${y}%` } }, text);
    this.$('floaters').append(f);
    setTimeout(() => f.remove(), 1400);
  }

  tip(html) {
    const t = this.$('coachTip');
    if (!html) { t.hidden = true; return; }
    t.innerHTML = html;
    t.hidden = false;
  }

  timer(frac) {
    const t = this.$('timerbar');
    if (frac === null || frac === undefined) { t.classList.remove('on'); return; }
    t.classList.add('on');
    t.firstElementChild.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  }

  kzone(info) {
    const k = this.$('kzone');
    if (!info) { k.hidden = true; return; }
    k.hidden = false;
    const c = k.querySelector('canvas');
    drawKZone(c, info);
    const inches = Math.abs(info.margin * 12);
    const where = info.strike ? (inches < 1 ? 'painted the edge!' : `${inches.toFixed(1)}" inside the zone`) : `${inches.toFixed(1)}" off the zone`;
    k.querySelector('.kz-label').innerHTML = `<span style="color:${info.strike ? '#ff7a7a' : '#7cc0ff'}">${info.strike ? 'STRIKE' : 'BALL'}</span> · ${where}`;
  }

  verdict(v, onContinue) {
    const box = this.$('verdict');
    if (!v) { box.hidden = true; this.verdictHandler = null; return; }
    const card = v.card && RULE[v.card];
    const sc = v.scored;
    let pts = '';
    if (sc && sc.items) {
      pts = `<div class="points">${sc.items.map((i) => `<span class="pt ${i.pts >= 0 ? 'plus' : 'minus'}">${i.pts >= 0 ? '+' : ''}${i.pts} ${escapeHtml(i.label)}</span>`).join('')}${sc.mult > 1 && sc.correct ? `<span class="pt mult">x${sc.mult} streak</span>` : ''}<span class="pt mult">= ${sc.points >= 0 ? '+' : ''}${sc.points}</span></div>`;
    }
    box.className = `verdict${v.correct ? '' : ' bad'}`;
    box.innerHTML = `
      <div class="vhead"><div class="vicon">${v.correct ? '✅' : '❌'}</div>
        <div><div class="vtitle">${escapeHtml(v.title)}</div><div class="vsub">${escapeHtml(v.sub || '')}</div></div></div>
      <div class="vbody"><p>${mini(v.body || '')}</p>${v.extraHtml || ''}</div>
      ${card ? `<div class="rulecard-mini"><span class="rc-ico">${card.icon}</span><div><b>${escapeHtml(card.title)}</b> rule card ${sc && sc.newCard ? '<b style="color:#2fd67b">· NEW!</b>' : ''}<br><a class="lesson" href="${lessonUrl(card.lesson)}" target="_blank" rel="noopener">📖 Bootcamp lesson →</a></div></div>` : ''}
      ${v.note ? `<div class="vsub" style="margin-top:8px">${escapeHtml(v.note)}</div>` : ''}
      ${pts}
      <div class="vfoot"><span></span><button class="btn big" id="vcont" type="button">${glyph('A')} CONTINUE</button></div>`;
    box.hidden = false;
    this.verdictHandler = onContinue;
    box.querySelector('#vcont').addEventListener('click', () => this._continue());
    if (v.correct) audio.correct(); else audio.wrong();
  }
  _continue() {
    if (!this.verdictHandler) return false;
    const h = this.verdictHandler;
    this.verdict(null);
    audio.select();
    h();
    return true;
  }

  dialog(d, onPick) {
    const box = this.$('verdict');
    if (!d) { if (this.dialogHandler) { box.hidden = true; } this.dialogHandler = null; return; }
    box.className = 'verdict';
    box.style.setProperty('--vc', '#ffd34d');
    box.innerHTML = `
      <div class="vtitle" style="color:#ffd34d">${d.mood === 'storm' ? 'SAFETY CHECK' : d.mood === 'nice' ? 'UMP LIFE' : 'INCOMING!'}</div>
      <div class="coach-card">${faceSvg(d.mood)}<div class="bubble"><span class="who">${escapeHtml(d.who)} · ${escapeHtml(d.role)}</span>${mini(d.text)}</div></div>
      <div class="vsub">What do you do?</div>
      <div class="options" style="position:static;flex-direction:column;align-items:stretch;padding:0;margin-top:10px">
        ${d.options.map((o) => `<button class="opt" data-btn="${o.btn}" type="button" style="max-width:none">${glyph(o.btn, 'opt-glyph')}<span>${escapeHtml(o.label)}</span></button>`).join('')}
      </div>`;
    box.hidden = false;
    this.dialogHandler = onPick;
    this.optList = d.options;
    this.optHandler = (id) => { const h = this.dialogHandler; this.dialogHandler = null; box.style.removeProperty('--vc'); h && h(id); };
    for (const b of box.querySelectorAll('.opt')) b.addEventListener('click', () => this._pick(b.dataset.btn));
  }

  // Route a controller/keyboard action. Returns true if consumed.
  handleAction(act) {
    if (this.verdictHandler) {
      if (act === 'A') return this._continue();
      return true;
    }
    if (this.optHandler && ['A', 'B', 'X', 'Y'].includes(act)) {
      return this._pick(act) || true;
    }
    return false;
  }
}
