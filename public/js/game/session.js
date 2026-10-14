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
    this.s.hud.verdict({ correct: true, info: true, title: this.spec.title, sub: this.spec.sub || '', body: this.spec.body, extraHtml: this.spec.html || '', card: this.spec.card || null, scored: null }, () => this.s.eventDone(true));
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
// no dropped third strike). Majors Camp adds those. Each camp is a full practice session:
// stations of drills with a coach card between them, ending with a no-hints scrimmage.
export function buildCamp(level = 'minors') {
  const sit = (id) => SITUATIONS.find((s) => s.id === id);
  const life = (id) => LIFE.find((l) => l.id === id);
  const card = (n, total, title, sub, body, rule) => ({ type: 'info', title: `STATION ${n} OF ${total}: ${title}`, sub, body, card: rule });
  const ab = (extra = {}) => ({ type: 'atbat', tutorial: true, ...extra });
  const bp = (play, extra = {}) => ({ type: 'base', play, tutorial: true, ...extra });
  const sq = (id, div) => ({ type: 'sit', def: sit(id), div });

  if (level === 'majors') {
    const T = 7;
    return {
      mode: 'camp', level: 'majors', div: 'MAJ', title: 'Majors Camp', badge: 'CAMP',
      events: [
        { type: 'info', title: 'WELCOME TO MAJORS CAMP!', sub: 'The full Little League rulebook — about 15 minutes', body: "Majors means **faster pitching**, **runners who can really run**, and two rules that **Minors doesn't use**: the **uncaught (dropped) third strike** and the **infield fly**. You'll work through **7 stations**, then finish with a **scrimmage** — no hints allowed. Let's go!", card: 'strike-zone' },
        // 1 — faster pitching
        card(1, T, 'FASTER HEAT', 'Majors pitchers throw a lot harder', "The ball gets to the plate **fast**. Get set in the slot **before** the pitch, stay still, and track it all the way into the mitt. Don't guess early — a quick trigger costs points even when you're right.", 'timing'),
        ab({ forceKinds: ['take', 'take', 'swingMiss', 'take', 'take'], maxPitches: 5 }),
        ab({ maxPitches: 6 }),
        ab({ maxPitches: 6 }),
        // 2 — dropped third strike
        card(2, T, 'DROPPED THIRD STRIKE', 'Two strikes. Ball in the dirt. Now what?', "If strike three **isn't legally caught**, the batter may run when **first base is open** or there are **two outs**. With first base **occupied** and **fewer than two outs**, the batter is **out**. Watch the scoreboard: runners and outs decide it!", 'uncaught-third-strike'),
        ab({ strikes: 2, outs: 1, runners: [], forceKinds: ['u3k'], maxPitches: 1 }),
        ab({ strikes: 2, outs: 0, runners: [1], forceKinds: ['u3k'], maxPitches: 1 }),
        ab({ strikes: 2, outs: 2, runners: [1, 2], forceKinds: ['u3k'], maxPitches: 1 }),
        ab({ strikes: 2, outs: 1, runners: [2], forceKinds: ['u3k'], maxPitches: 1 }),
        // 3 — infield fly
        card(3, T, 'THE INFIELD FLY', 'Four boxes to check, every time', "**Fewer than two outs**, runners on **1st & 2nd** (or bases loaded), a **fair fly ball** — not a line drive or a bunt — that an infielder can catch with **ordinary effort**. All four boxes? \"Infield fly, batter's out!\" Any box missing? **No call.**", 'infield-fly'),
        sq('iff', 'MAJ'), sq('iff', 'MAJ'), sq('iff', 'MAJ'),
        // 4 — the double play
        card(4, T, 'TURN TWO', 'Runner on first: start in B — outside the baseline', "With a runner on first, ground balls become **double plays**. Get an angle on the force at **second**, sell the call, then **turn** and get the best look you can at **first**. Two calls, one play.", 'double-play'),
        bp('dp'), bp('dp'),
        // 5 — steals and back-picks
        card(5, T, 'RUNNERS ON THE MOVE', 'Tag plays: watch the glove AND the bag', "On steals and back-picks it's a **tag play**. You need **daylight** between the glove and the runner. Watch for **missed tags**, **dropped balls**, and the sneaky **empty glove** (ball still in his other hand!).", 'tag-play'),
        bp('steal2B'), bp('steal3B'), bp('pickoff1B'), bp('force1B'),
        // 6 — rules that trip up rookies
        card(6, T, 'RULES THAT FOOL ROOKIES', 'Appeals, timing plays and interference', "Some plays freeze and ask **\"What's the call?\"** These are the ones that fool new umpires: **appeals** (say nothing until they appeal!), **timing plays** (does the run count?), and **interference** vs. **obstruction**.", 'appeal-tagup'),
        sq('tagup', 'MAJ'), sq('timing', 'MAJ'), sq('ci', 'MAJ'), sq('lane', 'MAJ'), sq('obs-rundown', 'MAJ'),
        // 7 — game management
        card(7, T, 'RUNNING THE GAME', 'Coaches, safety, and keeping your cool', 'Big games bring loud coaches and tough moments. Answer **rule** questions clearly, don\'t argue **judgment** calls, and **safety always comes first**.', 'handling-questions'),
        { type: 'life', def: life('rule-question') }, { type: 'life', def: life('lightning') }, { type: 'life', def: life('calm-ejection') },
        // Scrimmage
        { type: 'info', title: 'SCRIMMAGE TIME!', sub: 'Final exam — no zone box, no gold rings, no tips', body: "You've seen it all. Now it's a real game: **plate**, **bases**, and **rules**, with **no hints**. Show what you learned!", card: 'signals' },
        ab({ tutorial: false, exam: true, maxPitches: 6 }),
        bp(null, { tutorial: false, exam: true }),
        ab({ tutorial: false, exam: true, maxPitches: 6 }),
        sq('basepath', 'MAJ'),
        bp(null, { tutorial: false, exam: true }),
        ab({ tutorial: false, exam: true, maxPitches: 6 }),
        sq('hit-runner', 'MAJ'),
        bp(null, { tutorial: false, exam: true }),
        { type: 'life', def: life('partner-help') },
      ],
    };
  }

  const T = 7;
  return {
    mode: 'camp', level: 'minors', div: 'AA', title: 'Minors Camp', badge: 'CAMP',
    events: [
      { type: 'info', title: 'WELCOME TO ROOKIE CAMP!', sub: 'You are the umpire. Every call is yours. (About 15 minutes)', body: "You'll work through **7 training stations** — balls and strikes, the slot, the bases, angles, rules, and handling coaches — then finish with a **scrimmage** where the hints are turned off. Ready? Let's play ball!", card: 'strike-zone' },
      // 1 — balls and strikes
      card(1, T, 'BALLS & STRIKES', 'You see the pitch from behind the catcher', "Watch the ball **all the way into the glove**, pause, then call **STRIKE** or **BALL**. The faint yellow box is the strike zone: **armpits** to **top of the knees**, over the plate. It's only there while you learn!", 'strike-zone'),
      ab({ forceKinds: ['take', 'take', 'take', 'take'], maxPitches: 4, outs: 0, runners: [] }),
      ab({ forceKinds: ['take', 'swingMiss', 'take', 'take', 'swingMiss'], maxPitches: 5 }),
      ab({ maxPitches: 5 }),
      // 2 — the slot and timing
      card(2, T, 'THE SLOT & YOUR TIMING', 'Where you stand changes what you see', "Stand **straight behind the catcher** and his helmet blocks the plate. Slide into **the slot** — the gap between batter and catcher — with your chin just above the catcher's helmet. And don't rush: calling **before** the ball hits the glove is a **quick trigger**!", 'slot'),
      ab({ maxPitches: 6 }),
      ab({ maxPitches: 6 }),
      ab({ maxPitches: 6 }),
      // 3 — the base positions
      card(3, T, 'A, B & C', 'Where the base umpire starts', "Before each pitch, run to your **starting spot**. **A**: bases empty, foul ground behind first. **B**: runner on 1st only. **C**: runner on 2nd or 3rd. On Little League's 60-foot diamond, **B and C are outside the baselines**.", 'abc'),
      bp('force1B', { runners: [] }),
      bp('steal2B'),
      bp('steal3B'),
      // 4 — angles
      card(4, T, 'GET THE ANGLE', 'The UMP CAM shows what YOU can see', "When the ball is hit, **move for an angle** — about **90°** to the throw on a force play, or to the slide on a tag. Then **STOP** before the play. A great angle gives you a crystal-clear UMP CAM. A bad one... good luck! The gold ring shows a great spot while you learn.", 'angles'),
      bp('force1B'), bp('force1B', { runners: [2] }), bp('pickoff1B'), bp('steal2B'),
      // 5 — rules
      card(5, T, 'FAIR, FOUL, CATCH?', 'Calls the plate umpire owns', "The plate umpire has **every fair/foul call** and **every catch/no-catch call** on the field. Remember: the lines and bases are **fair**, and a catch needs **secure possession**.", 'fair-foul'),
      sq('fairfoul', 'AA'), sq('fairfoul', 'AA'), sq('catch', 'AA'), sq('catch', 'AA'),
      // 6 — local rules + interference
      card(6, T, 'MINORS RULES', 'FXLL local rules and contact plays', "Minors has its own **local rules**: one base per steal, no stealing home, an outfielder can't make an out at a base in AA, and a warning for leaving early. Plus: who has the right of way when a runner and fielder collide?", 'local-aa'),
      sq('one-base', 'AA'), sq('aa-of', 'AA'), sq('leave-early', 'AAA'), sq('hit-runner', 'AA'), sq('obs-delayed', 'AA'),
      // 7 — game management
      card(7, T, 'COACHES & SAFETY', 'The part of umpiring nobody talks about', 'Stay calm, answer questions in a sentence or two, don\'t argue with the stands, and **always** stop the game for a safety problem.', 'handling-questions'),
      { type: 'life', def: life('tie-coach') }, { type: 'life', def: life('throat-guard') }, { type: 'life', def: life('parent') }, { type: 'life', def: life('signal-ball') },
      // Scrimmage
      { type: 'info', title: 'SCRIMMAGE TIME!', sub: 'Final exam — no zone box, no gold rings, no tips', body: "Now it's a real game. Plate, bases, and rules — **no hints**. Get in the slot, get your angle, and make the call!", card: 'signals' },
      ab({ tutorial: false, exam: true, maxPitches: 6 }),
      bp(null, { tutorial: false, exam: true }),
      ab({ tutorial: false, exam: true, maxPitches: 6 }),
      sq('slide-myth', 'AAA'),
      bp(null, { tutorial: false, exam: true }),
      ab({ tutorial: false, exam: true, maxPitches: 6 }),
      bp(null, { tutorial: false, exam: true }),
      { type: 'life', def: life('swinging-bats') },
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
