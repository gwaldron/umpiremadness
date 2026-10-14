// A Session runs one game: a list (or endless stream) of events, with scoring, streaks and lives.
import { audio } from '../audio.js';
import { input } from '../input.js';
import { pick, shuffle, weighted, clamp, chance } from '../util.js';
import { DIV, DIVISIONS, gameRole, GAME_NAMES } from '../data/divisions.js';
import { situationsFor, SITUATIONS, SOFTBALL_ENABLED } from '../data/situations.js';
import { LIFE } from '../data/life.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { levelFromXp, rankFor, saveProfile } from '../storage.js';
import { AtBatEvent } from '../scenes/plate.js';
import { BasePlayEvent } from '../scenes/base.js';
import { SituationEvent } from '../scenes/situation.js';
import { LifeEvent } from '../scenes/life.js';
import { KITS, SKINS, UMP_SHIRTS, UMP_CAPS } from '../render/figures.js';
import { POS, UMP_SPOTS } from '../render/field.js';

export class GameState {
  constructor() {
    this.inning = 1;
    this.top = true;
    this.outs = 0;
    this.runners = [];
  }
  label() { return `${this.top ? 'TOP' : 'BOT'} ${this.inning}`; }
  forceAdvance() {
    const r = new Set(this.runners);
    if (r.has(1)) {
      if (r.has(2)) r.add(3);
      r.add(2);
    }
    r.add(1);
    this.runners = [...r].sort();
  }
  randomizeAfterPlay() {
    if (chance(0.55)) this.outs++;
    else if (chance(0.7)) this.forceAdvance();
    else this.runners = [...new Set([...this.runners.map((b) => Math.min(3, b + 1)), 2])].filter((b) => b <= 3).sort();
  }
  nextHalf() {
    this.outs = 0;
    this.runners = [];
    if (this.top) this.top = false;
    else { this.top = true; this.inning++; }
  }
}

class InfoEvent {
  constructor(session, spec) {
    this.s = session;
    this.spec = spec;
    this.kind = 'info';
    this.allowMove = false;
  }
  start() {
    this.s.hud.prompt('', '');
    this.s.rig.set({ x: 0, y: 50 }, 70, 0.62);
    this.s.hud.verdict({ correct: true, title: this.spec.title, sub: this.spec.sub || '', body: this.spec.body, extraHtml: this.spec.html || '', card: this.spec.card || null, scored: null }, () => this.s.eventDone(true));
  }
  update() {}
  onAction() { return false; }
  render(g) {
    this.s.field.draw(g, this.s.cam, { actors: this.s.idleActors() });
  }
}

export class Session {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.profile = app.profile;
    this.cam = app.cam;
    this.rig = app.rig;
    this.field = app.field;
    this.hud = app.hud;
    this.div = DIV[cfg.div || 'AA'];
    this.game = new GameState();
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.calls = 0;
    this.correctCalls = 0;
    this.idx = -1;
    this.events = cfg.events || null;
    this.eventStatus = [];
    this.lives = cfg.lives ?? null;
    this.timeLeft = cfg.timeLimit ?? null;
    this.ended = false;
    this.paused = false;
    this.shakeAmt = 0;
    this.newAchievements = [];
    this.lastSlot = null;
    this.lastUmpPos = null;
    this.ev = null;
    const look = this.profile.look;
    this.umpKit = { ...KITS.ump, jersey: UMP_SHIRTS[look.shirt] || UMP_SHIRTS.navy, cap: UMP_CAPS[look.cap] || UMP_CAPS.black };
    this.umpKit.shade = this.umpKit.jersey;
    this.umpSkin = SKINS[look.skin ?? 1] || SKINS[1];
    const hs = this.profile.settings.hints;
    this.tutorial = this.mode === 'camp';
    this.hints = hs === 'on' || (hs === 'auto' && (this.div.hints || this.tutorial));
    this.zoneHelper = hs !== 'off' && (this.div.zoneHelper || this.tutorial);
    this._idle = null;
  }

  start() {
    const hud = this.hud;
    hud.show();
    hud.setScore(0);
    hud.setStreak(0, 1);
    hud.setDivision(this.cfg.badge || this.div.name.toUpperCase());
    hud.setInning(this.game.label());
    if (this.lives !== null) hud.setLives(this.lives, this.cfg.lives);
    else if (this.timeLeft !== null) hud.setTime(this.timeLeft);
    else hud.setLives(null);
    hud.setProgress(this.events ? this.events.map(() => null) : null, 0);
    audio.startCrowd();
    if (this.field.setTimeOfDay) this.field.setTimeOfDay(this.cfg.night ? 'night' : 'day');
    document.body.classList.add('ingame');
    this.next();
  }

  moveHint() {
    return input.mode === 'gamepad' ? 'the left stick' : input.mode === 'touch' ? 'the thumbstick (drag anywhere)' : 'WASD / arrow keys';
  }

  idleActors() {
    if (this._idle) return this._idle;
    const list = [];
    let i = 0;
    for (const k of ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF']) list.push({ ...POS[k], kit: KITS.def, skin: SKINS[i++ % SKINS.length], pose: k === 'C' ? 'catcher' : 'ready', glove: 'F' });
    list.push({ ...UMP_SPOTS.A, kit: this.umpKit, skin: this.umpSkin, pose: 'set' });
    list.push({ ...UMP_SPOTS.PU, kit: this.umpKit, skin: SKINS[2], pose: 'set', mask: true });
    this._idle = list;
    return list;
  }

  shake(px) {
    if (this.profile.settings.shake) this.shakeAmt = Math.max(this.shakeAmt, px * this.app.dpr);
  }

  // ---------- event flow ----------
  _make(spec) {
    if (spec.div) this.div = DIV[spec.div] || this.div;
    switch (spec.type) {
      case 'atbat': return new AtBatEvent(this, spec);
      case 'base': return new BasePlayEvent(this, spec);
      case 'sit': return new SituationEvent(this, spec);
      case 'life': return new LifeEvent(this, spec);
      default: return new InfoEvent(this, spec);
    }
  }

  next() {
    if (this.ended) return;
    this.idx++;
    let spec;
    if (this.events) {
      if (this.idx >= this.events.length) return this.finish();
      spec = this.events[this.idx];
    } else {
      spec = this.cfg.gen(this, this.idx);
    }
    this.hud.setProgress(this.events ? this.eventStatus.concat(this.events.slice(this.eventStatus.length).map(() => null)) : null, this.idx);
    this.hud.setInning(this.game.label());
    this.hud.tip(null);
    this.hud.kzone(null);
    this.ev = this._make(spec);
    this.evCorrect = null;
    this.ev.start();
  }

  eventDone(skipStatus = false) {
    if (this.ended) return;
    if (!skipStatus && this.events) this.eventStatus[this.idx] = this.evCorrect !== false;
    else if (this.events) this.eventStatus[this.idx] = undefined;
    if (this.gameOver) return this.finish();
    if (this.timeLeft !== null && this.timeLeft <= 0) return this.finish();
    setTimeout(() => this.next(), 120);
  }

  showVerdict(v, cb) {
    this.hud.verdict(v, cb);
  }

  // ---------- scoring ----------
  record(res) {
    const p = this.profile;
    const st = p.stats;
    const base = { pitch: 100, base: 150, sit: 200, life: 150 }[res.kind] || 100;
    const items = [];
    if (res.correct) items.push({ label: 'Right call', pts: base });
    else items.push({ label: 'Missed call', pts: 0 });
    if (res.correct && res.timing === 'perfect') items.push({ label: 'Perfect timing', pts: 50 });
    if (res.timing === 'early') items.push({ label: 'Quick trigger', pts: -50 });
    if (res.timing === 'late') items.push({ label: 'Slow call', pts: -10 });
    if (res.painted) items.push({ label: 'Painted corner', pts: 50 });
    if (res.framedFoiled) items.push({ label: 'Frame job foiled', pts: 30 });
    if (res.kind === 'pitch' && res.slotOk) items.push({ label: 'In the slot', pts: 20 });
    if (res.bangBang) items.push({ label: 'Bang-bang!', pts: 75 });
    for (const b of res.bonus || []) if (res.correct || b.pts < 0) items.push(b);
    if (res.correct) this.streak++;
    else this.streak = 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const mult = 1 + Math.min(3, Math.floor(this.streak / 5));
    const sum = items.reduce((a, b) => a + b.pts, 0);
    const points = res.correct ? Math.round(sum * mult) : Math.max(-75, Math.min(0, sum));
    this.score = Math.max(0, this.score + points);
    this.calls++;
    if (res.correct) this.correctCalls++;
    if (this.evCorrect !== false) this.evCorrect = res.correct;

    // Stats
    st.calls++;
    if (res.correct) st.correct++;
    const kk = { pitch: 'pitch', base: 'base', sit: 'sit', life: 'life' }[res.kind];
    if (kk) { st[kk]++; if (res.correct) st[kk + 'Ok']++; }
    st.maxStreak = Math.max(st.maxStreak, this.streak);
    if (res.timing === 'perfect' && res.correct) st.perfectTiming++;
    if (res.timing === 'early') st.early++;
    if (res.painted) st.painted++;
    if (res.framedFoiled) st.framedFoiled++;
    if (res.bangBang) st.bangBang++;
    if (res.grade === 'A') st.angleA++;
    if (res.startOk === true) st.startOk++;
    if (res.kind === 'pitch' && res.slotOk) st.slotOk++;
    if (res.strikeThree && res.correct) st.strikeThrees++;
    if (input.usedGamepad) st.gamepad = 1;
    // Rule cards
    let newCard = false;
    const touch = (id, ok) => {
      if (!id) return;
      if (!p.cards[id]) { p.cards[id] = { seen: 0, correct: 0 }; newCard = newCard || id === res.card; }
      p.cards[id].seen++;
      if (ok) p.cards[id].correct++;
    };
    touch(res.card, res.correct);
    if (res.kind === 'pitch') {
      touch('slot', !!res.slotOk);
      if (res.timing) touch('timing', res.timing === 'perfect');
    }
    for (const x of res.extraCards || []) touch(x.id, x.correct);
    const cat = st.catTotals[res.card] || (st.catTotals[res.card] = { n: 0, ok: 0 });
    cat.n++;
    if (res.correct) cat.ok++;

    // HUD juice
    const hud = this.hud;
    hud.setScore(this.score);
    hud.setStreak(this.streak, mult);
    hud.floater(`${points >= 0 ? '+' : ''}${points}`, points < 0 || !res.correct, 50, 30);
    if (res.correct) {
      this.field.cheer(res.kind === 'pitch' ? (res.strikeThree ? 0.9 : 0.3) : 0.85);
      if (this.streak > 0 && this.streak % 5 === 0) {
        audio.streak(this.streak / 5);
        if (this.streak === 5 || this.streak === 15) audio.rally();
        if (this.streak === 10) { audio.charge(); hud.stamp('ON FIRE!', 'gold'); audio.cheer(1); }
      }
    } else {
      input.rumble(0.8, 0.4, 220);
      this.shake(8);
      setTimeout(() => (Math.random() < 0.65 ? audio.aww() : audio.boo()), 350);
    }
    // Lives / blitz
    if (!res.correct && this.lives !== null) {
      this.lives--;
      hud.setLives(this.lives, this.cfg.lives);
      if (this.lives <= 0) {
        this.gameOver = true;
        st.ejections++;
        setTimeout(() => { hud.stamp("YOU'RE EJECTED!", 'bad'); audio.boo(); }, 900);
      }
    }
    if (!res.correct && this.timeLeft !== null) {
      this.timeLeft = Math.max(0, this.timeLeft - 3);
      hud.floater('-3 sec', true, 50, 22);
    }
    // Difficulty ramp in endless modes
    if (this.cfg.ramp && res.correct && this.correctCalls % this.cfg.ramp === 0) {
      const i = DIVISIONS.findIndex((d) => d.id === this.div.id);
      if (i < DIVISIONS.length - 1) {
        this.div = DIVISIONS[i + 1];
        hud.setDivision(this.div.name.toUpperCase());
        setTimeout(() => hud.stamp(`LEVEL UP: ${this.div.name.toUpperCase()}!`, 'gold'), 600);
      }
    }
    this.checkAchievements();
    this.app.save();
    return { items, points, mult, correct: res.correct, newCard };
  }

  checkAchievements(extra = {}) {
    const p = this.profile;
    const level = levelFromXp(p.xp);
    for (const a of ACHIEVEMENTS) {
      if (p.achievements[a.id]) continue;
      let ok = false;
      try { ok = a.check(p, { level, ...extra }); } catch (e) { ok = false; }
      if (ok) {
        p.achievements[a.id] = Date.now();
        this.newAchievements.push(a);
        this.app.toast({ icon: a.icon, kicker: 'ACHIEVEMENT UNLOCKED', title: a.name, desc: a.desc });
        audio.achievement();
        input.rumble(0.5, 1, 350);
      }
    }
  }

  // ---------- loop ----------
  update(dt) {
    if (this.paused || this.ended) return;
    if (this.timeLeft !== null) {
      const before = Math.ceil(this.timeLeft);
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.hud.setTime(this.timeLeft);
      if (Math.ceil(this.timeLeft) !== before && this.timeLeft <= 5) audio.countdown();
      if (this.timeLeft <= 0) { this.hud.stamp("TIME!", 'gold'); return this.finish(); }
    }
    this.shakeAmt *= Math.pow(0.02, dt);
    if (this.shakeAmt < 0.3) this.shakeAmt = 0;
    this.cam.shake = this.shakeAmt;
    if (this.hud.bug) this.field.board = { ...this.hud.bug, line: `${this.game.label()} · ${this.score.toLocaleString()} PTS` };
    if (this.ev) {
      if (!(this.ev instanceof AtBatEvent)) this.rig.update(dt);
      this.ev.update(dt);
    }
    input.stickEnabled = !!(this.ev && this.ev.allowMove);
  }

  render(g) {
    if (this.ev) this.ev.render(g);
  }

  onAction(act) {
    if (this.ended) return;
    if (act === 'START' || act === 'ESC') { this.app.pauseGame(); return; }
    if (this.hud.handleAction(act)) return;
    if (this.ev && this.ev.onAction) this.ev.onAction(act);
  }

  quit() {
    this.ended = true;
    this._teardown();
  }

  _teardown() {
    if (this.field.setTimeOfDay) this.field.setTimeOfDay('day');
    audio.stopCrowd();
    input.stickEnabled = false;
    this.hud.hide();
    document.body.classList.remove('ingame');
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    const p = this.profile;
    const acc = this.calls ? this.correctCalls / this.calls : 0;
    let stars = 0;
    if (acc >= 0.6) stars = 1;
    if (acc >= 0.8) stars = 2;
    if (acc >= 0.95) stars = 3;
    const xpGain = Math.round(this.score / 10) + (this.calls >= 5 ? 50 : 0);
    const oldLevel = levelFromXp(p.xp);
    p.xp += xpGain;
    const newLevel = levelFromXp(p.xp);
    p.stats.games++;
    let record = null;
    if (this.mode === 'career') {
      const key = `${this.cfg.div}-${this.cfg.gameIndex}`;
      const prev = p.career[key] || { stars: 0, best: 0 };
      p.career[key] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, this.score) };
      if (stars === 3 && prev.stars < 3) p.stats.threeStars++;
      if (acc === 1 && this.calls >= 5) p.stats.perfectGames++;
      record = this.score > prev.best;
    } else if (this.cfg.bestKey) {
      const val = this.mode === 'blitz' ? this.correctCalls : this.score;
      record = val > (p.best[this.cfg.bestKey] || 0);
      if (record) p.best[this.cfg.bestKey] = val;
    }
    if (newLevel > oldLevel) {
      setTimeout(() => {
        this.app.toast({ icon: '⬆️', kicker: 'LEVEL UP!', title: `Level ${newLevel} · ${rankFor(newLevel)}`, desc: 'New gear may be unlocked in the Locker Room!', cls: 'level' });
        audio.levelUp();
      }, 600);
    }
    this.checkAchievements({ level: newLevel });
    this.app.save();
    this._teardown();
    this.app.showResults({
      mode: this.mode, cfg: this.cfg, score: this.score, calls: this.calls, correct: this.correctCalls, acc, stars,
      xpGain, levelUp: newLevel > oldLevel ? newLevel : null, bestStreak: this.bestStreak, record,
      achievements: this.newAchievements, gameOver: !!this.gameOver, div: this.div,
    });
  }
}

// ---------- Game builders ----------
function pickSituations(div, n, exclude = []) {
  let pool = situationsFor(div).filter((s) => !exclude.includes(s.id));
  const out = [];
  // AA/AAA games should feature their local rules
  if (div.local) {
    const local = pool.filter((s) => s.divs && s.divs.includes(div.id) && (s.card === 'local-aa' || s.card === 'local-aaa'));
    if (local.length) out.push(pick(local));
  }
  pool = pool.filter((s) => !out.includes(s));
  while (out.length < n && pool.length) {
    const s = weighted(pool.map((x) => [x, x.weight || 1]));
    out.push(s);
    pool = pool.filter((x) => x !== s);
  }
  return shuffle(out);
}

export function buildCareer(divId, idx) {
  const div = DIV[divId];
  const role = gameRole(divId, idx);
  const life = shuffle(LIFE);
  let plan;
  if (role === 'plate') plan = ['ab', 'ab', 'sit', 'ab', 'life', 'sit', 'ab'];
  else if (role === 'bases') plan = ['base', 'base', 'sit', 'base', 'life', 'sit', 'base', 'sit'];
  else plan = ['ab', 'base', 'sit', 'ab', 'base', 'life', 'sit', 'ab', 'base', 'sit'];
  const sits = pickSituations(div, plan.filter((x) => x === 'sit').length);
  let si = 0, li = 0;
  const events = plan.map((k) => {
    if (k === 'ab') return { type: 'atbat' };
    if (k === 'base') return { type: 'base' };
    if (k === 'sit') return { type: 'sit', def: sits[si++ % sits.length] };
    return { type: 'life', def: life[li++] };
  });
  return {
    mode: 'career', div: divId, gameIndex: idx, role, events,
    title: (GAME_NAMES[divId] || [])[idx] || `Game ${idx + 1}`,
    night: /Lights|Night|World Series Championship/.test((GAME_NAMES[divId] || [])[idx] || ''),
  };
}

// Rookie Camp has two levels. New umps start in Minors (AA/AAA rules: no infield fly,
// no dropped third strike). Majors Camp adds those.
export function buildCamp(level = 'minors') {
  const sit = (id) => SITUATIONS.find((s) => s.id === id);
  const life = (id) => LIFE.find((l) => l.id === id);
  if (level === 'majors') {
    return {
      mode: 'camp', level: 'majors', div: 'MAJ', title: 'Majors Camp', badge: 'CAMP',
      events: [
        { type: 'info', title: 'WELCOME TO MAJORS CAMP!', sub: 'Majors rules: the full Little League rulebook', body: "In **Majors**, pitches are faster and two rules switch on that **Minors doesn't use**: the **uncaught (dropped) third strike** and the **infield fly**. Let's try both. First, set up in **the slot** and call a few pitches.", card: 'strike-zone' },
        { type: 'atbat', forceKinds: ['take', 'swingMiss', 'take'], maxPitches: 3, tutorial: true },
        { type: 'info', title: 'DROPPED THIRD STRIKE', sub: 'Two strikes. Here comes the pitch…', body: "If strike three **isn't legally caught**, the batter may run when **first base is open** or there are **two outs**. With first base **occupied** and **fewer than two outs**, the batter is simply **out**. Signal strike three, and only say \"out\" if the batter is out.", card: 'uncaught-third-strike' },
        { type: 'atbat', strikes: 2, outs: 1, runners: [], forceKinds: ['u3k'], maxPitches: 1, tutorial: true },
        { type: 'info', title: 'THE INFIELD FLY', sub: 'Four boxes to check', body: "**Fewer than two outs**, runners on **1st & 2nd** (or bases loaded), a **fair fly ball** (not a line drive or bunt) that an infielder can catch with **ordinary effort**. All four? \"Infield fly, batter's out!\"", card: 'infield-fly' },
        { type: 'sit', def: sit('iff'), div: 'MAJ' },
        { type: 'info', title: 'TURN TWO', sub: 'Runner on first: start in B, outside the baseline', body: 'With a runner on first, ground balls can become **double plays**. Get an angle on the force at second, make the call, then **turn** and get the best look you can at first.', card: 'double-play' },
        { type: 'base', play: 'dp', tutorial: true },
        { type: 'life', def: life('rule-question') },
      ],
    };
  }
  return {
    mode: 'camp', level: 'minors', div: 'AA', title: 'Minors Camp', badge: 'CAMP',
    events: [
      { type: 'info', title: 'WELCOME TO ROOKIE CAMP!', sub: 'You are the umpire. Every call is yours.', body: "First up: **the plate**. You'll see the pitch from behind the catcher. Get into **the slot** (between the batter and catcher), watch the ball **all the way into the glove**, pause, then make the call: **STRIKE** or **BALL**. A faint box shows the strike zone while you learn. It disappears in tougher divisions!", card: 'strike-zone' },
      { type: 'atbat', forceKinds: ['take', 'take', 'swingMiss', 'take'], maxPitches: 4, outs: 0, runners: [], tutorial: true },
      { type: 'info', title: 'NOW: THE BASES', sub: "Two-umpire crew: you're the base umpire", body: "Before each pitch, run to your **starting spot**: **A** (bases empty, foul ground behind first base), **B** (runner on 1st only), or **C** (runner on 2nd or 3rd). On Little League's 60-foot diamond, **B and C are outside the baselines**. When the ball is hit, **move for an angle**, then **STOP** before the play. The **UMP CAM** shows the bag in slow motion: the better your angle, the clearer the picture.", card: 'abc' },
      { type: 'base', play: 'force1B', runners: [], tutorial: true },
      { type: 'base', play: 'steal2B', tutorial: true },
      { type: 'info', title: 'KNOW YOUR RULES', sub: 'Situations, local rules & myths', body: "Some plays freeze at the key moment and ask **\"What's the call?\"** Every one links to its **Umpire Bootcamp lesson**, and you collect a **rule card** for each. Let's start simple: **fair or foul?**", card: 'fair-foul' },
      { type: 'sit', def: sit('fairfoul'), div: 'AA' },
      { type: 'life', def: life('tie-coach') },
    ],
  };
}

export const ARCADE = {
  plate: {
    mode: 'plate', title: 'Plate Survival', badge: 'SURVIVAL', div: 'AA', lives: 3, ramp: 8, bestKey: 'plate',
    gen: () => ({ type: 'atbat' }),
  },
  bases: {
    mode: 'bases', title: 'Base Hustle', badge: 'HUSTLE', div: 'AA', lives: 3, ramp: 4, bestKey: 'bases',
    gen: () => ({ type: 'base' }),
  },
  rumble: {
    mode: 'rumble', title: 'Rulebook Rumble', badge: 'RUMBLE', div: 'MAJ', bestKey: 'rumble',
    events: null,
  },
  blitz: {
    mode: 'blitz', title: 'Strike Zone Blitz', badge: 'BLITZ', div: 'AAA', timeLimit: 60, bestKey: 'blitz', ramp: 10,
    gen: () => ({ type: 'atbat', fast: true, only: ['take', 'take', 'take', 'swingMiss'], maxPitches: 99 }),
  },
};

export function buildRumble() {
  const pool = SITUATIONS.filter((s) => SOFTBALL_ENABLED || !s.softball);
  const picks = shuffle(pool).slice(0, 12);
  const events = picks.map((def) => {
    const divs = def.divs ? def.divs : ['AA', 'AAA', 'MAJ', 'MAJ', 'AS', 'WS'];
    const d = pick(divs);
    return { type: 'sit', def, div: d };
  });
  return { ...ARCADE.rumble, events };
}
