// Rule situations. Each one scripts a short play, then asks for the ruling.
// Rulings follow Little League rules as taught in Umpire Bootcamp (FXLL local rules where noted).
import { audio } from '../audio.js';
import { pick, chance, rand, clamp, lerp } from '../util.js';
import { BASES } from '../render/field.js';

const B1 = BASES.first, B2 = BASES.second, B3 = BASES.third, H = BASES.home;
const ONBAG = { 1: { x: B1.x - 0.3, y: B1.y - 0.2 }, 2: { x: B2.x, y: B2.y - 0.5 }, 3: { x: B3.x + 0.3, y: B3.y - 0.2 }, 4: { x: 0.4, y: 0.6 } };

// Baseball first: softball situations are drafted but switched off until the softball phase.
export const SOFTBALL_ENABLED = false;

// ---------- script helpers ----------
function lastKey(tl, id) { const k = tl.actors[id].keys; return k[k.length - 1]; }
export function posAt(tl, id, t) {
  const keys = tl.actors[id].keys;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  if (!k1) return { x: k0.x, y: k0.y };
  const u = clamp((t - k0.t) / (k1.t - k0.t), 0, 1);
  return { x: lerp(k0.x, k1.x, u), y: lerp(k0.y, k1.y, u) };
}
function pitchHit(tl, { t0 = 0.4, swing = true, z = 2.6, catcher = false, bunt = false } = {}) {
  tl.pose('P', t0, 'pitch');
  lastKey(tl, 'P').dur = 1.0;
  tl.hold(0, t0 + 0.8, 'P', 5);
  const tc = t0 + 1.4;
  tl.fly(t0 + 0.8, tc, { x: -1, y: 42, z: 5 }, catcher ? { x: 0, y: -1.5, z } : { x: 0, y: 1.2, z }, 0.3);
  tl.pose('P', t0 + 1.1, 'ready');
  if (swing && tl.actors.BAT) {
    tl.actors.BAT.swingAt = bunt ? tc - 0.02 : tc - 0.17;
    tl.at(tc, () => (bunt ? audio.tick() : audio.crack()));
  }
  if (catcher) tl.at(tc, () => audio.pop());
  return tc;
}
function throwFrom(tl, id, t, to, speed = 65, z = 4.5) {
  const p = posAt(tl, id, t);
  const d = Math.hypot(to.x - p.x, to.y - p.y);
  const t1 = t + d / speed;
  tl.pose(id, t - 0.2, 'throw', { dur: 0.35, facing: to.x >= p.x ? 1 : -1 });
  tl.throwBall(t, t1, { x: p.x, y: p.y, z }, { x: to.x, y: to.y, z: to.z ?? 3.2 });
  tl.pose(id, t + 0.35, 'ready');
  return t1;
}
function batterRuns(tl, t, speed = 16, to = ONBAG[1]) {
  tl.pose('BAT', t, 'stand');
  return tl.runTo('BAT', t + 0.05, to.x, to.y, speed, 'stand');
}
const OUTS = (n) => `${n} out${n === 1 ? '' : 's'}`;
const RUN_TXT = (r) => (r.length === 0 ? 'bases empty' : r.length === 3 ? 'bases loaded' : 'runner' + (r.length > 1 ? 's' : '') + ' on ' + r.map((b) => ['', '1st', '2nd', '3rd'][b]).join(' & '));

// Dramatic "tag at a bag": fielder at base with ball, runner sliding in.
function slideTo(tl, id, t0, t1, base, endOffset = { x: 0, y: 0 }) {
  const p = posAt(tl, id, t0);
  const b = ONBAG[base];
  const sx = lerp(p.x, b.x, 0.8), sy = lerp(p.y, b.y, 0.8);
  const tm = lerp(t0, t1, 0.8);
  tl.move(id, t0, tm, sx, sy, 'run');
  tl.move(id, tm, t1, b.x + endOffset.x, b.y + endOffset.y, 'slide', 'slide');
  return t1;
}

// ---------- the situations ----------
export const SITUATIONS = [
  // ===== INFIELD FLY =====
  {
    // Minors (AA/AAA) don't use the infield fly rule, so it's only quizzed at Majors and above.
    id: 'iff', card: 'infield-fly', title: 'Pop-Up Panic', weight: 3, divs: ['MAJ', 'AS', 'WS'],
    variant(div) {
      const yes = { outs: pick([0, 1]), runners: pick([[1, 2], [1, 2, 3]]), ball: 'popup' };
      const twist = pick(['none', 'none', 'none', 'outs', 'runners', 'liner', 'bunt']);
      const v = { ...yes, twist };
      if (twist === 'outs') v.outs = 2;
      if (twist === 'runners') v.runners = pick([[1], [2, 3], [1, 3], [2]]);
      if (twist === 'liner') v.ball = 'liner';
      if (twist === 'bunt') v.ball = 'bunt';
      v.to = pick([{ x: -16, y: 66, f: 'SS' }, { x: 14, y: 64, f: '2B' }, { x: -34, y: 44, f: '3B' }, { x: 30, y: 46, f: '1B' }]);
      return v;
    },
    setup(v) { return { runners: v.runners, outs: v.outs, text: `${RUN_TXT(v.runners)} · ${OUTS(v.outs)}` }; },
    build(tl, v) {
      const tc = pitchHit(tl, { bunt: v.ball === 'bunt' });
      for (const b of v.runners) {
        const id = 'R' + b;
        const p = tl.actors[id];
        const dir = b === 1 ? { x: -1, y: 1 } : b === 2 ? { x: -1, y: -1 } : { x: 1, y: -1 };
        tl.move(id, tc + 0.1, tc + 0.9, p.x + dir.x * 4, p.y + dir.y * 4, 'ready');
      }
      if (v.ball === 'liner') {
        const f = tl.actors.SS;
        tl.fly(tc, tc + 0.42, { x: 0, y: 1.5, z: 3 }, { x: f.x + 1, y: f.y - 1, z: 4.2 }, 1.5);
        tl.pose('SS', tc + 0.25, 'catchHigh');
        tl.hold(tc + 0.42, tc + 5, 'SS', 4.2);
        tl.at(tc + 0.42, () => audio.pop());
        return { pause: tc + 0.3 };
      }
      if (v.ball === 'bunt') {
        const land = { x: 4, y: 20 };
        tl.fly(tc, tc + 1.7, { x: 0, y: 1.5, z: 2.3 }, { x: land.x, y: land.y, z: 3 }, 13);
        tl.move('P', tc + 0.2, tc + 1.5, land.x, land.y + 1, 'catchHigh');
        tl.hold(tc + 1.7, tc + 5, 'P', 3.4);
        tl.at(tc + 1.7, () => audio.pop());
        tl.pose('BAT', tc + 0.2, 'stand');
        tl.runTo('BAT', tc + 0.3, 20, 19, 14, 'run');
        return { pause: tc + 0.9 };
      }
      const hang = 3.4;
      const f = v.to.f;
      tl.fly(tc, tc + hang, { x: 0, y: 1.5, z: 3 }, { x: v.to.x, y: v.to.y, z: 5.5 }, 62);
      tl.move(f, tc + 0.3, tc + hang - 0.7, v.to.x - 0.4, v.to.y + 0.3, 'catchHigh');
      tl.hold(tc + hang, tc + 7, f, 5.4);
      tl.at(tc + hang, () => audio.pop());
      tl.pose('BAT', tc + 0.2, 'stand');
      tl.runTo('BAT', tc + 0.3, 30, 29, 15, 'stand');
      return { pause: tc + 1.15, cam: (t) => ({ x: v.to.x * 0.5, y: v.to.y * 0.7, ext: 64 }) };
    },
    steps(v, div) {
      const yes = div.iff && v.outs < 2 && v.runners.includes(1) && v.runners.includes(2) && v.ball === 'popup';
      let explain;
      if (yes) explain = 'All four boxes are checked: **fewer than two outs**, runners on **1st & 2nd** (or loaded), a **fair fly ball**, and an infielder can catch it with **ordinary effort**. Call it loud: "Infield fly, batter\'s out!" The ball stays **live** — runners may advance at their own risk.';
      else if (!div.iff && v.ball === 'popup') explain = `In **${div.full}**, the infield fly rule **does not apply** (FXLL local rule). No call — play on. If the ball drops, everybody runs.`;
      else if (v.ball === 'liner') explain = 'A **line drive** is never an infield fly. The rule only covers fly balls — not liners and not bunts.';
      else if (v.ball === 'bunt') explain = 'A popped-up **bunt** is never an infield fly. No call — just watch for the catch.';
      else if (v.outs === 2) explain = 'With **two outs** there\'s no infield fly — the defense just needs one out, so there\'s no cheap double play to protect against.';
      else explain = 'The rule needs runners on **1st & 2nd** or the **bases loaded** — where the defense could let the ball drop for an easy double play. Not here, so no infield fly.';
      return [{
        q: 'POP-UP! WHAT\'S YOUR CALL?',
        options: [
          { btn: 'A', id: 'iff', label: "INFIELD FLY — BATTER'S OUT!", sub: 'Point up, call it loud' },
          { btn: 'B', id: 'none', label: 'NO CALL — PLAY ON', sub: 'Just watch the catch' },
        ],
        answer: yes ? 'iff' : 'none',
        say: yes ? "Infield fly! Batter's out!" : null,
        explain,
      }];
    },
  },

  // ===== BATTED BALL HITS RUNNER =====
  {
    id: 'hit-runner', card: 'interference', title: 'Ball Hits the Runner', weight: 2,
    variant() { return { passed: chance(0.4), outs: pick([0, 1]) }; },
    setup(v) { return { runners: [2], outs: v.outs, text: `runner on 2nd · ${OUTS(v.outs)}` }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      if (!v.passed) {
        // grounder hits the runner in front of the shortstop
        const hit = { x: -15.5, y: 66.5 };
        const th = tc + 1.0;
        tl.ground(tc, th, { x: 0, y: 2 }, hit);
        tl.at(th, () => audio.thud());
        tl.ground(th, th + 0.8, hit, { x: -10, y: 60 });
        tl.move('R2', tc + 0.1, th, hit.x - 0.6, hit.y + 0.6, 'stand');
        tl.move('SS', tc, th, -19, 70, 'ready');
        batterRuns(tl, tc + 0.3, 16);
        return { pause: th + 0.25 };
      }
      // grounder gets past the shortstop, then hits the runner behind him
      tl.move('SS', tc, tc + 0.7, -14, 63, 'tag');
      const through = { x: -18, y: 74 };
      const th = tc + 1.25;
      tl.ground(tc, th, { x: 0, y: 2 }, through);
      tl.at(th, () => audio.thud());
      tl.ground(th, th + 0.9, through, { x: -26, y: 86 });
      tl.move('R2', tc + 0.1, th, through.x, through.y, 'stand');
      batterRuns(tl, tc + 0.3, 16);
      return { pause: th + 0.25 };
    },
    steps(v) {
      return [{
        q: 'THE BALL HIT THE RUNNER!',
        options: [
          { btn: 'A', id: 'out', label: 'INTERFERENCE — RUNNER OUT', sub: 'Dead ball, batter to 1st' },
          { btn: 'B', id: 'live', label: 'PLAY ON — BALL IS LIVE', sub: 'No call' },
          { btn: 'X', id: 'return', label: 'DEAD BALL — NO OUT', sub: 'Runners go back' },
        ],
        answer: v.passed ? 'live' : 'out',
        explain: v.passed
          ? 'The ball had **already passed the shortstop** — no other infielder had a chance to make a play. When a ground ball goes through an infielder and then hits a runner, it\'s **not interference**. Play on, ball is live.'
          : 'A **fair batted ball hit the runner before it passed an infielder**. That\'s interference — no intent needed. Call **time**, the **runner is out**, the batter gets first, and other runners advance only if forced.',
      }];
    },
  },

  // ===== RUNNER vs FIELDER (interference or obstruction) =====
  {
    id: 'collide', card: 'interference', title: 'Traffic Jam at Short', weight: 2,
    variant() { return { fielding: chance(0.55) }; },
    setup() { return { runners: [2], outs: 0, text: 'runner on 2nd · 0 outs' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      const spot = { x: -15, y: 68 };
      tl.move('SS', tc, tc + 0.55, spot.x, spot.y, v.fielding ? 'tag' : 'ready');
      if (v.fielding) {
        // ground ball right at the shortstop in the runner's path
        tl.ground(tc, tc + 1.0, { x: 0, y: 2 }, { x: spot.x + 1, y: spot.y - 1 });
        tl.move('R2', tc + 0.1, tc + 0.95, spot.x - 0.5, spot.y + 0.6, 'stand');
        tl.at(tc + 0.95, () => { audio.thud(); audio.ouch(); });
        tl.ground(tc + 1.0, tc + 1.7, { x: spot.x + 1, y: spot.y - 1 }, { x: -24, y: 58 });
        batterRuns(tl, tc + 0.3, 16);
        return { pause: tc + 1.15 };
      }
      // ball goes past the shortstop into left field; then the runner bumps into him
      tl.ground(tc, tc + 1.6, { x: 0, y: 2 }, { x: -40, y: 120 });
      tl.move('R2', tc + 0.1, tc + 1.15, spot.x - 0.5, spot.y + 0.6, 'stand');
      tl.at(tc + 1.15, () => { audio.thud(); });
      tl.move('LF', tc + 0.2, tc + 1.6, -40, 118, 'ready');
      batterRuns(tl, tc + 0.3, 16);
      return { pause: tc + 1.3 };
    },
    steps(v) {
      return [{
        q: 'COLLISION! WHAT\'S YOUR RULING?',
        options: [
          { btn: 'A', id: 'int', label: 'INTERFERENCE — RUNNER OUT', sub: 'Dead ball' },
          { btn: 'B', id: 'obs', label: 'OBSTRUCTION', sub: 'Protect the runner' },
          { btn: 'X', id: 'none', label: 'NOTHING — JUST CONTACT', sub: 'Play on' },
        ],
        answer: v.fielding ? 'int' : 'obs',
        explain: v.fielding
          ? 'The shortstop was **fielding a batted ball** — he has the **right of way**. A runner who hinders him commits **interference**, even by accident. Dead ball, runner is out, batter to first.'
          : 'The ball was **already past** the shortstop, so he was **no longer fielding it** — and he didn\'t have the ball. A fielder without the ball who impedes a runner is guilty of **obstruction**. Point at it, call "That\'s obstruction!", and protect the runner.',
      }];
    },
  },

  // ===== OBSTRUCTION: delayed (no play) =====
  {
    id: 'obs-delayed', card: 'obstruction', title: 'Rounding First', weight: 2,
    variant() { return {}; },
    setup() { return { runners: [], outs: 1, text: 'bases empty · 1 out' }; },
    build(tl) {
      const tc = pitchHit(tl);
      tl.fly(tc, tc + 2.0, { x: 0, y: 1.5, z: 3 }, { x: 70, y: 150, z: 0.5 }, 22);
      tl.ground(tc + 2.0, tc + 3.4, { x: 70, y: 150 }, { x: 80, y: 168 });
      tl.move('RF', tc + 0.2, tc + 3.4, 79, 165, 'ready');
      tl.move('1B', tc, tc + 0.9, B1.x + 2.5, B1.y + 5, 'stand');
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x - 0.5, B1.y - 1, 17, 'run');
      const tHit = tl.runTo('BAT', lastKey(tl, 'BAT').t, B1.x + 2.2, B1.y + 4.2, 17, 'stand');
      tl.at(tHit, () => audio.thud());
      tl.pose('BAT', tHit + 0.3, 'stand');
      return { pause: tHit + 0.25, cam: () => ({ x: 40, y: 70, ext: 70 }) };
    },
    steps() {
      return [{
        q: 'THE FIRST BASEMAN WAS IN THE WAY!',
        sub: 'No play is being made on the runner right now',
        options: [
          { btn: 'A', id: 'delayed', label: 'POINT: "THAT\'S OBSTRUCTION!"', sub: 'Let the play finish, then award bases' },
          { btn: 'B', id: 'dead', label: 'TIME! DEAD BALL NOW', sub: 'Award a base immediately' },
          { btn: 'X', id: 'none', label: 'NO CALL', sub: 'Runners can go around' },
        ],
        answer: 'delayed',
        say: "That's obstruction!",
        explain: 'The first baseman **didn\'t have the ball** and wasn\'t fielding it — that\'s **obstruction**. Since **no play was being made on the runner**, point at it and call "That\'s obstruction!" but **let the play continue**. When it\'s over, call time and award whatever bases remove the effect of the obstruction.',
      }];
    },
  },

  // ===== OBSTRUCTION: in a rundown (play being made) =====
  {
    id: 'obs-rundown', card: 'obstruction', title: 'Pickle Trouble', weight: 2,
    variant() { return {}; },
    setup() { return { runners: [3], outs: 1, text: 'runner on 3rd · 1 out' }; },
    build(tl) {
      const tc = pitchHit(tl);
      // ground ball to the pitcher, runner from third gets caught in a rundown
      tl.ground(tc, tc + 0.6, { x: 0, y: 2 }, { x: -3, y: 36 });
      tl.move('P', tc, tc + 0.55, -3, 37, 'ready');
      const tOff = tl.runTo('R3', tc + 0.05, -24, 24, 13.5, 'run');
      tl.hold(tc + 0.6, tc + 1.4, 'P', 3.4);
      tl.move('3B', tc, tc + 1.2, -38, 40, 'ready');
      tl.move('C', tc, tc + 1.0, -5, 5, 'ready');
      // runner retreats toward third
      const tBack = tl.runTo('R3', tOff, -31, 31, 12, 'run');
      const t1 = throwFrom(tl, 'P', tc + 1.4, { x: -36, y: 38, z: 3.5 }, 60);
      tl.hold(t1, t1 + 4, '3B', 3.2);
      // shortstop (no ball) drifts into the base path between the runner and home
      tl.move('SS', tc + 0.4, tc + 1.8, -24.5, 24.5, 'stand');
      // 3B chases, runner reverses toward home — right into the shortstop
      const tTurn = Math.max(tBack, t1 + 0.15);
      tl.runTo('3B', t1 + 0.15, -33, 33, 9, 'tag');
      const tBump = tl.runTo('R3', tTurn, -26.3, 26.3, 11, 'stand');
      tl.at(tBump, () => { audio.thud(); audio.ouch(); });
      return { pause: tBump + 0.3, cam: () => ({ x: -22, y: 28, ext: 46 }) };
    },
    steps() {
      return [{
        q: 'THE SHORTSTOP BLOCKED HIM IN THE RUNDOWN!',
        sub: 'The shortstop does not have the ball',
        options: [
          { btn: 'A', id: 'delayed', label: 'POINT: "THAT\'S OBSTRUCTION!"', sub: 'Let the play finish' },
          { btn: 'B', id: 'dead', label: 'TIME! OBSTRUCTION — DEAD BALL', sub: 'Award the runner home' },
          { btn: 'X', id: 'none', label: 'NO CALL', sub: 'He can tag him out' },
        ],
        answer: 'dead',
        say: "Time! That's obstruction!",
        explain: 'The runner was obstructed **while a play was being made on him** (he was in a rundown). That\'s the immediate kind: call **"Time! That\'s obstruction!"** right away. The ball is dead and the runner gets **at least one base beyond the last base he legally touched** — here, **home**.',
      }];
    },
  },

  // ===== CATCHER BLOCKS THE PLATE WITHOUT THE BALL =====
  {
    id: 'plate-block', card: 'obstruction', title: 'Blocking the Dish', weight: 1,
    variant() { return {}; },
    setup() { return { runners: [3], outs: 1, text: 'runner on 3rd · 1 out' }; },
    build(tl) {
      const tc = pitchHit(tl);
      tl.fly(tc, tc + 1.6, { x: 0, y: 1.5, z: 3 }, { x: -60, y: 120, z: 0.6 }, 18);
      tl.ground(tc + 1.6, tc + 2.6, { x: -60, y: 120 }, { x: -64, y: 128 });
      tl.move('LF', tc + 0.2, tc + 2.6, -63, 126, 'ready');
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x - 0.5, B1.y - 0.5, 16, 'stand');
      // runner from third heads home; catcher sets up in the baseline without the ball
      tl.move('C', tc + 0.4, tc + 1.6, -2.5, 3.5, 'ready');
      const tArrive = tl.runTo('R3', tc + 0.2, -3.2, 4.2, 15, 'stand');
      tl.at(tArrive, () => { audio.thud(); audio.ouch(); });
      const tThrow = tc + 2.95;
      tl.hold(tc + 2.6, tThrow, 'LF', 4);
      throwFrom(tl, 'LF', tThrow, { x: -6, y: 30, z: 3 }, 70);
      return { pause: tArrive + 0.25, cam: () => ({ x: -10, y: 14, ext: 40 }) };
    },
    steps() {
      return [{
        q: 'THE CATCHER BLOCKED THE PLATE!',
        sub: 'The throw hasn\'t gotten there yet',
        options: [
          { btn: 'A', id: 'obs', label: 'OBSTRUCTION — RUNNER SCORES', sub: 'Dead ball' },
          { btn: 'B', id: 'out', label: "RUNNER'S OUT", sub: 'He ran into the catcher' },
          { btn: 'X', id: 'none', label: 'PLAY ON', sub: 'Catchers can block' },
        ],
        answer: 'obs',
        explain: 'A catcher **without the ball** has no right to block the runner\'s path to the plate. This is **obstruction** on a runner who is being played on — call time, and the runner is awarded **home**.',
      }];
    },
  },

  // ===== MYTH: RUNNER MUST SLIDE =====
  {
    id: 'slide-myth', card: 'myth-slide', title: 'Slide or Go Around?', weight: 1,
    variant() { return { around: chance(0.55) }; },
    setup() { return { runners: [2], outs: 2, text: 'runner on 2nd · 2 outs' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      tl.ground(tc, tc + 1.4, { x: 0, y: 2 }, { x: 46, y: 118 });
      tl.move('RF', tc + 0.1, tc + 1.4, 47, 116, 'ready');
      batterRuns(tl, tc + 0.3, 15);
      // runner from 2nd rounds 3rd and heads home
      tl.runPath('R2', tc + 0.05, [{ x: -40, y: 46 }, { x: -12, y: 12 }], 17.5, 'run');
      const tCatch = throwFrom(tl, 'RF', tc + 1.6, { x: 0.8, y: 3.2, z: 3 }, 74);
      tl.move('C', tc + 0.5, tCatch - 0.2, 0.8, 2.5, 'ready');
      tl.hold(tCatch, tCatch + 4, 'C', 2.8);
      tl.pose('C', tCatch + 0.05, 'tag', { facing: -1 });
      const tNear = lastKey(tl, 'R2').t;
      let tEnd;
      if (v.around) {
        tl.runPath('R2', tNear, [{ x: -6.5, y: 4 }, { x: -2.5, y: -1.5 }], 15, 'stand');
        tEnd = lastKey(tl, 'R2').t;
        tl.pose('R2', tEnd, 'dive');
        tl.at(tEnd, () => audio.slide());
      } else {
        tEnd = tl.runTo('R2', tNear, 0, 3, 17, 'stand');
        tl.at(tEnd, () => { audio.thud(); audio.ouch(); });
      }
      return { pause: tEnd + 0.3, cam: () => ({ x: -6, y: 10, ext: 36 }) };
    },
    steps(v) {
      return [{
        q: v.around ? 'HE DIDN\'T SLIDE — HE WENT AROUND!' : 'HE DIDN\'T SLIDE — HE PLOWED INTO THE CATCHER!',
        sub: 'The catcher had the ball, waiting',
        options: [
          { btn: 'A', id: 'safe', label: 'SAFE', sub: 'He touched the plate' },
          { btn: 'B', id: 'out', label: 'OUT', sub: 'He didn\'t slide' },
        ],
        answer: v.around ? 'safe' : 'out',
        explain: v.around
          ? 'Myth busted: **runners don\'t have to slide**. When a fielder has the ball waiting, the runner must **slide or try to get around** him. Going around is legal — he beat the tag, so he\'s **safe**.'
          : 'Runners don\'t have to slide — but they **can\'t crash into a fielder who has the ball waiting**. They must **slide or try to get around**. He ran right through the catcher, so he\'s **out** (and malicious contact can get a player ejected).',
      }];
    },
  },

  // ===== CATCHER'S INTERFERENCE =====
  {
    id: 'ci', card: 'catchers-interference', title: 'Clank!', weight: 1,
    variant() { return {}; },
    setup() { return { runners: [], outs: 0, text: 'bases empty · 0 outs' }; },
    build(tl) {
      const tc = pitchHit(tl);
      tl.at(tc - 0.03, () => { audio.tick(); });
      tl.move('C', 0, tc - 0.1, 0, -1.6, 'catcher');
      tl.ground(tc, tc + 0.9, { x: 0, y: 2 }, { x: -18, y: 66 });
      tl.move('SS', tc, tc + 0.85, -18, 67, 'ready');
      tl.hold(tc + 0.9, tc + 1.4, 'SS', 3.4);
      const tb = throwFrom(tl, 'SS', tc + 1.4, { x: B1.x - 1.2, y: B1.y + 1, z: 3.2 }, 70);
      tl.move('1B', tc, tc + 1.0, B1.x - 0.6, B1.y + 0.9, 'ready');
      tl.pose('1B', tb - 0.3, 'reach', { facing: -1 });
      tl.hold(tb, tb + 3, '1B', 3.2);
      batterRuns(tl, tc + 0.3, 15);
      return { pause: tb + 0.6 };
    },
    steps() {
      return [{
        q: 'THE BAT HIT THE CATCHER\'S MITT ON THE SWING…',
        sub: '…then the batter was thrown out at first',
        options: [
          { btn: 'A', id: 'ci', label: 'CATCHER\'S INTERFERENCE', sub: 'Award the batter first base' },
          { btn: 'B', id: 'out', label: 'BATTER IS OUT', sub: 'The play stands' },
          { btn: 'X', id: 'foul', label: 'FOUL BALL', sub: 'Do it over' },
        ],
        answer: 'ci',
        explain: 'The bat hit the catcher\'s mitt during the swing: **catcher\'s interference**. Signal it, but let the play finish. The batter didn\'t reach first, so the play doesn\'t stand by itself — the penalty is **batter to first** (the offensive manager could choose the play instead, but nobody picks an out!).',
      }];
    },
  },

  // ===== BATTER'S INTERFERENCE =====
  {
    id: 'bi', card: 'batter-interference', title: 'Steal Attempt Chaos', weight: 1,
    variant() { return { moved: chance(0.65) }; },
    setup() { return { runners: [1], outs: 1, text: 'runner on 1st · 1 out' }; },
    build(tl, v) {
      const tc = pitchHit(tl, { swing: false, catcher: true });
      tl.hold(tc, tc + 0.9, 'C', 2.4);
      tl.runTo('R1', tc + 0.02, -0.5, 82, 16.5, 'stand');
      if (v.moved) tl.move('BAT', tc + 0.3, tc + 0.8, -0.6, 1.5, 'stand');
      tl.pose('C', tc + 0.6, 'throw', { dur: 0.4, facing: 1 });
      tl.at(tc + 0.85, () => { if (v.moved) audio.thud(); });
      if (v.moved) {
        tl.ground(tc + 0.9, tc + 1.5, { x: 0, y: 0 }, { x: 6, y: 12 });
      } else {
        tl.throwBall(tc + 0.9, tc + 2.2, { x: 0, y: -2, z: 4.6 }, { x: 1.2, y: 83.5, z: 2.8 });
        tl.move('SS', tc + 0.2, tc + 1.9, 1.5, 83, 'tag');
        tl.hold(tc + 2.2, tc + 5, 'SS', 2.6);
      }
      return { pause: v.moved ? tc + 1.4 : tc + 2.4, cam: () => ({ x: 0, y: v.moved ? 20 : 45, ext: v.moved ? 34 : 60 }) };
    },
    steps(v) {
      return [{
        q: v.moved ? 'THE BATTER STEPPED INTO THE CATCHER\'S THROW!' : 'RUNNER STEALS — WHAT HAPPENED AT THE PLATE?',
        options: [
          { btn: 'A', id: 'bi', label: 'BATTER\'S INTERFERENCE', sub: 'Batter out, runner back to 1st' },
          { btn: 'B', id: 'runner', label: 'RUNNER IS OUT', sub: 'Because of the interference' },
          { btn: 'X', id: 'none', label: 'NOTHING — PLAY ON', sub: '' },
        ],
        answer: v.moved ? 'bi' : 'none',
        explain: v.moved
          ? 'The batter **left the box and got in the way** of the catcher\'s throw. That\'s **batter\'s interference**: the **batter is out** and the **runner goes back** to first. (If the runner had been put out anyway, you\'d ignore the interference.)'
          : 'The batter **stayed in the box** and didn\'t do anything to hinder the catcher. Batters don\'t have to disappear — **no interference**. Play on.',
      }];
    },
  },

  // ===== RUNNING LANE =====
  {
    id: 'lane', card: 'running-lane', title: 'Bunt Down the Line', weight: 1,
    variant() { return { inLane: chance(0.45) }; },
    setup() { return { runners: [], outs: 0, text: 'bases empty · 0 outs' }; },
    build(tl, v) {
      const tc = pitchHit(tl, { bunt: true });
      tl.ground(tc, tc + 0.9, { x: 0, y: 2 }, { x: 4, y: 12 });
      tl.move('C', tc + 0.1, tc + 0.85, 3.5, 11, 'tag');
      tl.hold(tc + 0.9, tc + 1.3, 'C', 2.6);
      tl.move('1B', tc, tc + 1.1, B1.x - 0.6, B1.y + 0.9, 'ready');
      tl.pose('BAT', tc + 0.1, 'stand');
      const off = v.inLane ? 1.8 : -2.2; // + = foul side (in lane), - = inside the line
      const lanePt = { x: 33 + off * 0.7, y: 33 - off * 0.7 };
      const tAt = tl.runTo('BAT', tc + 0.2, lanePt.x, lanePt.y, 15.5, 'run');
      // throw from the catcher hits the runner in the back
      const tThrow = tc + 1.3;
      const hitT = tAt;
      tl.throwBall(tThrow, hitT, { x: 4, y: 12, z: 4 }, { x: lanePt.x, y: lanePt.y, z: 3.5 });
      tl.at(hitT, () => { audio.thud(); audio.ouch(); });
      tl.ground(hitT, hitT + 1, { x: lanePt.x, y: lanePt.y }, { x: lanePt.x + 10, y: lanePt.y - 3 });
      tl.runTo('BAT', hitT, B1.x - 0.3, B1.y - 0.3, 15, 'stand');
      return { pause: hitT + 0.3, cam: () => ({ x: 26, y: 26, ext: 34 }) };
    },
    markers() { return []; },
    steps(v) {
      return [{
        q: 'THE THROW HIT THE BATTER-RUNNER!',
        sub: v.inLane ? 'Look where he was running…' : 'Look where he was running…',
        options: [
          { btn: 'A', id: 'int', label: 'INTERFERENCE — BATTER-RUNNER OUT', sub: 'Dead ball' },
          { btn: 'B', id: 'live', label: 'PLAY ON — BALL IS LIVE', sub: 'No call' },
        ],
        answer: v.inLane ? 'live' : 'int',
        explain: v.inLane
          ? 'He was running **inside the 3-foot running lane** (in foul ground, between the chalk lines). A runner in the lane who gets hit by the throw is doing nothing wrong. **Play on** — the ball is live.'
          : 'In the last half of the way to first, the batter-runner must run **in the 3-foot lane** in foul ground. He was **inside the line on fair ground** and the throw hit him — that interfered with the fielder taking the throw. **Batter-runner is out**, dead ball.',
      }];
    },
  },

  // ===== OUT OF THE BASE PATH =====
  {
    id: 'basepath', card: 'base-path', title: 'Dodgeball', weight: 1,
    variant() { return { dodge: chance(0.55) }; },
    setup(v) { return { runners: v.dodge ? [1] : [], outs: 1, text: v.dodge ? 'runner on 1st · 1 out' : 'bases empty · 1 out' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      if (v.dodge) {
        // grounder to second baseman who tries to tag the runner going by
        tl.ground(tc, tc + 0.7, { x: 0, y: 2 }, { x: 26, y: 62 });
        tl.move('2B', tc, tc + 0.65, 26, 63, 'ready');
        tl.hold(tc + 0.7, tc + 5, '2B', 3);
        tl.runTo('R1', tc + 0.05, 30, 57, 16, 'run');
        tl.move('2B', tc + 0.75, tc + 1.15, 28, 61, 'tag');
        // big swerve out of the base path
        tl.runPath('R1', lastKey(tl, 'R1').t, [{ x: 24, y: 52 }, { x: 14, y: 64 }, { x: 4, y: 80 }], 15, 'stand');
        batterRuns(tl, tc + 0.3, 15);
        return { pause: tc + 1.7, cam: () => ({ x: 22, y: 62, ext: 32 }) };
      }
      // wide turn at first on a clean single, no tag attempt
      tl.ground(tc, tc + 1.4, { x: 0, y: 2 }, { x: 30, y: 120 });
      tl.move('RF', tc, tc + 1.4, 34, 122, 'ready');
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runPath('BAT', tc + 0.15, [{ x: 30, y: 26 }, { x: 46, y: 34 }, { x: B1.x - 0.4, y: B1.y - 0.2 }, { x: 46, y: 54 }], 16.5, 'stand');
      const t = lastKey(tl, 'BAT').t;
      return { pause: t + 0.2, cam: () => ({ x: 34, y: 40, ext: 40 }) };
    },
    steps(v) {
      return [{
        q: v.dodge ? 'HE SWERVED AROUND THE TAG!' : 'HE TOOK A HUGE WIDE TURN!',
        options: [
          { btn: 'A', id: 'out', label: 'OUT — OUT OF THE BASE PATH', sub: 'Fist up' },
          { btn: 'B', id: 'none', label: 'NO CALL — HE\'S FINE', sub: 'Play on' },
        ],
        answer: v.dodge ? 'out' : 'none',
        explain: v.dodge
          ? 'When the fielder **tried to tag him**, his base path became a straight line to the base. He ran **way more than 3 feet** out of it to dodge the tag — **he\'s out**.'
          : 'Myth busted: there\'s no imaginary chalk line between bases. **No tag attempt was being made**, so a wide turn is totally legal. A base path is only set when a fielder tries to tag the runner.',
      }];
    },
  },

  // ===== FAIR OR FOUL =====
  {
    id: 'fairfoul', card: 'fair-foul', title: 'Fair or Foul?', weight: 3,
    variant() { return { k: pick(['rollFoul', 'overBag', 'flyBounce', 'touchedFoul', 'hitsBag']) }; },
    setup() { return { runners: [], outs: pick([0, 1, 2]), text: 'bases empty' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, 16, 15, 15, 'run');
      const L = (d, off) => ({ x: -d * Math.SQRT1_2 - off * Math.SQRT1_2, y: d * Math.SQRT1_2 - off * Math.SQRT1_2 }); // along 3B line; off>0 = foul side
      const R = (d, off) => ({ x: d * Math.SQRT1_2 + off * Math.SQRT1_2, y: d * Math.SQRT1_2 - off * Math.SQRT1_2 }); // along 1B line
      let pause;
      switch (v.k) {
        case 'rollFoul': {
          // lands fair in front of third, spins foul before the bag and stops
          const a = L(40, -2.5), b = L(52, 3), c2 = L(54, 6);
          tl.ground(tc, tc + 1.0, { x: 0, y: 2 }, a);
          tl.ground(tc + 1.0, tc + 1.9, a, b);
          tl.ground(tc + 1.9, tc + 2.5, b, c2);
          tl.move('3B', tc, tc + 2.6, B3.x - 4, B3.y + 4, 'ready');
          pause = tc + 2.6;
          tl.rest(tc + 2.5, tc + 9, { ...c2, z: 0.12 });
          tl.at(pause - 0.1, () => {});
          return { pause, cam: () => ({ x: -36, y: 34, ext: 26 }) };
        }
        case 'overBag': {
          const a = L(48, -1.0), b = L(60.5, -0.2), c2 = L(78, 9);
          tl.ground(tc, tc + 1.0, { x: 0, y: 2 }, a);
          tl.ground(tc + 1.0, tc + 1.3, a, b);
          tl.ground(tc + 1.3, tc + 2.3, b, c2);
          tl.move('3B', tc, tc + 0.6, -44, 50, 'ready');
          tl.move('LF', tc, tc + 2.8, c2.x - 2, c2.y + 2, 'ready');
          return { pause: tc + 1.9, cam: () => ({ x: -44, y: 44, ext: 30 }) };
        }
        case 'flyBounce': {
          const a = R(115, -2), b = R(135, 14);
          tl.fly(tc, tc + 2.0, { x: 0, y: 1.5, z: 3 }, { ...a, z: 0.2 }, 30);
          tl.ground(tc + 2.0, tc + 3.0, a, b);
          tl.move('RF', tc, tc + 3.0, b.x - 3, b.y + 3, 'ready');
          tl.move('1B', tc, tc + 1.2, 54, 60, 'stand');
          return { pause: tc + 2.6, cam: () => ({ x: 74, y: 88, ext: 44 }) };
        }
        case 'touchedFoul': {
          // slow roller up the first-base line, pitcher touches it while the ball is in foul ground
          const a = R(26, 1.6);
          tl.ground(tc, tc + 1.6, { x: 0.6, y: 1.5 }, a);
          tl.move('P', tc, tc + 1.5, a.x - 2.3, a.y + 1.4, 'tag', 'run');
          tl.hold(tc + 1.6, tc + 6, 'P', 0.7);
          tl.at(tc + 1.6, () => audio.pop());
          return { pause: tc + 1.8, cam: () => ({ x: 18, y: 20, ext: 22 }) };
        }
        default: {
          // ball hits the third-base bag and bounds foul
          const a = L(56, -0.3), b = L(60, -0.1), c2 = L(72, 12);
          tl.ground(tc, tc + 0.85, { x: 0, y: 2 }, a);
          tl.ground(tc + 0.85, tc + 0.95, a, b);
          tl.at(tc + 0.95, () => audio.tick());
          tl.ground(tc + 0.95, tc + 1.9, b, c2);
          tl.move('3B', tc, tc + 0.8, -46, 54, 'ready');
          return { pause: tc + 1.6, cam: () => ({ x: -44, y: 44, ext: 28 }) };
        }
      }
    },
    steps(v) {
      const fair = v.k === 'overBag' || v.k === 'flyBounce' || v.k === 'hitsBag';
      const ex = {
        rollFoul: 'It landed fair, but it **rolled foul before reaching third base** and settled there untouched. Before the bag, a grounder is judged where it **stops or is touched** — **foul ball**.',
        overBag: 'It **bounded over third base** while over fair territory. Once a ball passes first or third base fair, it\'s **fair** — even if it rolls foul afterward. Point fair, no voice.',
        flyBounce: 'Past first base, a fly ball is judged by **where it first lands**. It landed **fair** — what happens after (bouncing foul) doesn\'t matter. Point fair.',
        touchedFoul: 'Before the base, it\'s judged where it\'s **first touched** — by the **ball\'s position, not the fielder\'s feet**. The ball was over **foul ground** when the pitcher touched it: **foul ball**.',
        hitsBag: 'The bases are in **fair territory**. A ball that **hits the bag** is a **fair ball**, no matter where it goes next.',
      }[v.k];
      return [{
        q: 'FAIR OR FOUL?',
        sub: 'Plate umpire\'s call — make it!',
        options: [
          { btn: 'A', id: 'fair', label: 'FAIR', sub: 'Point to fair territory' },
          { btn: 'B', id: 'foul', label: 'FOUL BALL!', sub: 'Hands up' },
        ],
        answer: fair ? 'fair' : 'foul',
        say: fair ? null : 'Foul ball!',
        explain: ex,
      }];
    },
  },

  // ===== CATCH / NO CATCH =====
  {
    id: 'catch', card: 'catch', title: 'Diving Grab?', weight: 2,
    variant() { return { k: pick(['trap', 'clean', 'fence', 'carom']) }; },
    setup() { return { runners: [], outs: 1, text: 'bases empty · 1 out' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x - 0.4, B1.y - 0.4, 15, 'stand');
      if (v.k === 'fence') {
        const spot = { x: 10, y: 194 };
        tl.fly(tc, tc + 3.0, { x: 0, y: 1.5, z: 3 }, { ...spot, z: 6 }, 70);
        tl.move('CF', tc, tc + 2.9, spot.x, spot.y - 0.5, 'catchHigh');
        tl.hold(tc + 3.0, tc + 3.35, 'CF', 6);
        tl.at(tc + 3.0, () => audio.pop());
        tl.at(tc + 3.3, () => { audio.thud(); });
        tl.fly(tc + 3.35, tc + 4.0, { ...spot, z: 5 }, { x: spot.x - 4, y: spot.y - 6, z: 0.1 }, 2);
        tl.pose('CF', tc + 3.35, 'dive');
        return { pause: tc + 4.1, cam: () => ({ x: 8, y: 170, ext: 40 }) };
      }
      if (v.k === 'carom') {
        const spot = { x: -40, y: 165 };
        tl.fly(tc, tc + 3.0, { x: 0, y: 1.5, z: 3 }, { ...spot, z: 4 }, 60);
        tl.move('LF', tc, tc + 2.9, spot.x - 1, spot.y, 'catchHigh');
        tl.at(tc + 3.0, () => audio.tick());
        tl.fly(tc + 3.0, tc + 3.7, { ...spot, z: 4 }, { x: spot.x + 7, y: spot.y + 2, z: 2.2 }, 4);
        tl.move('CF', tc, tc + 3.6, spot.x + 7, spot.y + 2.3, 'dive');
        tl.hold(tc + 3.7, tc + 6, 'CF', 1);
        tl.at(tc + 3.7, () => audio.pop());
        return { pause: tc + 4.0, cam: () => ({ x: -30, y: 150, ext: 40 }) };
      }
      const spot = { x: 60, y: 120 };
      tl.fly(tc, tc + 1.8, { x: 0, y: 1.5, z: 3 }, { ...spot, z: v.k === 'trap' ? 0.1 : 0.6 }, 20);
      tl.move('RF', tc, tc + 1.5, spot.x + 3, spot.y + 2, 'run');
      tl.move('RF', tc + 1.5, tc + 1.85, spot.x + 1.5, spot.y + 0.5, 'dive', 'dive');
      if (v.k === 'trap') {
        tl.ground(tc + 1.8, tc + 1.9, spot, { x: spot.x + 0.6, y: spot.y + 0.3 });
        tl.at(tc + 1.82, () => audio.thud());
      }
      tl.hold(tc + 1.9, tc + 6, 'RF', 0.8);
      tl.at(tc + 1.9, () => audio.pop());
      tl.pose('RF', tc + 2.8, 'catchHigh');
      return { pause: tc + 3.0, cam: () => ({ x: 52, y: 104, ext: 34 }) };
    },
    steps(v) {
      const yes = v.k === 'clean' || v.k === 'carom';
      return [{
        q: 'CATCH OR NO CATCH?',
        sub: 'Plate umpire has all catch/no-catch calls',
        options: [
          { btn: 'A', id: 'catch', label: "CATCH — HE'S OUT!", sub: 'Fist up' },
          { btn: 'B', id: 'nocatch', label: 'NO CATCH!', sub: 'Safe sign — ball is live' },
        ],
        answer: yes ? 'catch' : 'nocatch',
        say: yes ? "That's a catch! He's out!" : 'No catch!',
        explain: {
          trap: 'The ball **hit the ground first** — he trapped it against the turf. That\'s **no catch**. Signal safe, say "No catch!" loudly, and the ball is live.',
          clean: 'He caught it **before it touched the ground** and **held on** through the dive. Secure possession = **catch**. Batter\'s out.',
          fence: 'He caught it, but **lost it when he crashed into the fence** — he never showed secure possession. That\'s **no catch**. Ball is live!',
          carom: 'The ball bounced off one fielder, but **another fielder caught it before it hit the ground**. That\'s still a **catch** — batter\'s out.',
        }[v.k],
      }];
    },
  },

  // ===== APPEAL: TAGGING UP =====
  {
    id: 'tagup', card: 'appeal-tagup', title: 'Sac Fly Showdown', weight: 2,
    variant() { return { early: chance(0.6) }; },
    setup() { return { runners: [3], outs: 1, text: 'runner on 3rd · 1 out' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      const spot = { x: 8, y: 160 };
      const tCatch = tc + 3.1;
      tl.fly(tc, tCatch, { x: 0, y: 1.5, z: 3 }, { ...spot, z: 5.5 }, 70);
      tl.move('CF', tc, tCatch - 0.4, spot.x, spot.y + 0.5, 'catchHigh');
      tl.hold(tCatch, tCatch + 0.4, 'CF', 5.5);
      tl.at(tCatch, () => audio.pop());
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, 30, 29, 13, 'stand');
      // runner: tags at third, leaves (early or on time)
      tl.move('R3', tc + 0.1, tc + 0.4, B3.x + 0.2, B3.y - 0.1, 'ready');
      const leave = v.early ? tCatch - 0.75 : tCatch + 0.05;
      const tHome = tl.runTo('R3', leave, 0.6, 1.2, 16.5, 'stand');
      const tThrowIn = tCatch + 0.45;
      throwFrom(tl, 'CF', tThrowIn, { x: -6, y: 46, z: 4 }, 75);
      tl.move('SS', tc, tCatch, -6, 47, 'ready');
      const pause1 = Math.max(tHome, tThrowIn + 1.6) + 0.2;
      if (!v.early) return { pause: pause1 };
      // Step 2: the defense appeals at third
      tl.hold(tThrowIn + 1.6, pause1 + 0.6, 'SS', 3.2);
      const t3 = throwFrom(tl, 'SS', pause1 + 0.6, { x: B3.x + 1, y: B3.y + 1, z: 3 }, 55);
      tl.move('3B', tc, pause1, B3.x + 1.6, B3.y + 1.8, 'ready');
      tl.hold(t3, t3 + 5, '3B', 3);
      tl.move('3B', t3 + 0.1, t3 + 0.5, B3.x + 0.4, B3.y + 0.2, 'ready');
      tl.pose('3B', t3 + 0.55, 'pointL');
      return { pauses: [pause1, t3 + 0.9], cam: (t) => (t < tCatch ? null : { x: -14, y: 40, ext: 56 }) };
    },
    steps(v) {
      const s1 = {
        q: 'THE RUN CROSSES THE PLATE. ANY CALL?',
        sub: 'Watch the runner\'s tag-up',
        options: [
          { btn: 'A', id: 'none', label: 'NO CALL — RUN SCORES', sub: 'For now…' },
          { btn: 'B', id: 'out', label: "RUNNER'S OUT — LEFT EARLY", sub: 'Fist up' },
          { btn: 'X', id: 'back', label: 'SEND HIM BACK TO THIRD', sub: '' },
        ],
        answer: 'none',
        explain: v.early
          ? 'He **did leave early** — before the center fielder touched the ball. But leaving early is an **appeal play**: the umpire **says nothing** unless the defense appeals. Remember what you saw, and wait.'
          : 'He tagged up legally (he left **after** the fielder first touched the ball). There\'s **nothing to call** — the run scores.',
      };
      if (!v.early) return [s1];
      return [s1, {
        q: 'THE DEFENSE APPEALS AT THIRD!',
        sub: 'Third baseman steps on the bag with the ball and points: "He left early!"',
        options: [
          { btn: 'A', id: 'out', label: "OUT ON APPEAL!", sub: 'The run comes off the board' },
          { btn: 'B', id: 'safe', label: 'SAFE — RUN COUNTS', sub: '' },
        ],
        answer: 'out',
        say: "He's out!",
        explain: 'Now it\'s a **legal appeal**: the defense tagged the base the runner left too soon and made the appeal clear. You saw him leave early, so he\'s **out** — and his run doesn\'t count.',
      }];
    },
  },

  // ===== APPEAL: MISSED BASE =====
  {
    id: 'missedbase', card: 'appeal-missed', title: 'Did He Touch It?', weight: 1,
    variant() { return { missed: chance(0.6) }; },
    setup() { return { runners: [1], outs: 0, text: 'runner on 1st · 0 outs' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      tl.fly(tc, tc + 2.0, { x: 0, y: 1.5, z: 3 }, { x: 80, y: 160, z: 0.4 }, 25);
      tl.ground(tc + 2.0, tc + 3.2, { x: 80, y: 160 }, { x: 88, y: 178 });
      tl.move('RF', tc, tc + 3.2, 86, 175, 'ready');
      tl.hold(tc + 3.2, tc + 3.5, 'RF', 4);
      const tIn = throwFrom(tl, 'RF', tc + 3.5, { x: 14, y: 78, z: 4 }, 72);
      tl.move('2B', tc, tc + 2.5, 15, 78, 'ready');
      // runner from first rounds second
      const path = v.missed ? [{ x: 8, y: 78 }, { x: 3.2, y: 82.5 }, { x: -6, y: 79 }, { x: B3.x + 0.4, y: B3.y + 0.2 }] : [{ x: 6, y: 79 }, { x: 0.2, y: 84.4 }, { x: -6, y: 80 }, { x: B3.x + 0.4, y: B3.y + 0.2 }];
      tl.runPath('R1', tc + 0.05, path, 16.5, 'stand');
      const tSafe = lastKey(tl, 'R1').t;
      batterRuns(tl, tc + 0.3, 16);
      const p1 = Math.max(tSafe, tIn) + 0.3;
      tl.hold(tIn, p1 + 0.5, '2B', 3);
      tl.move('2B', p1 + 0.3, p1 + 1.1, B2.x + 0.4, B2.y - 0.3, 'ready');
      tl.pose('2B', p1 + 1.2, 'pointL');
      tl.hold(p1 + 0.5, p1 + 6, '2B', 3);
      return { pauses: [p1, p1 + 1.6], cam: (t) => (t < tc + 1.5 ? null : { x: -10, y: 70, ext: 50 }) };
    },
    steps(v) {
      return [{
        q: 'RUNNER SLIDES INTO THIRD. ANY CALL?',
        sub: 'Did you watch him touch second?',
        options: [
          { btn: 'A', id: 'none', label: 'NO CALL', sub: 'Remember what you saw' },
          { btn: 'B', id: 'out', label: "OUT — HE MISSED SECOND!", sub: '' },
        ],
        answer: 'none',
        explain: v.missed
          ? 'He **missed second base** (he cut inside the bag). But a missed base is an **appeal play** — you **say nothing**, don\'t point, don\'t help. Just remember it.'
          : 'He touched second on his way to third — nothing to call. And even if he hadn\'t, you\'d **say nothing** until the defense appeals.',
      }, {
        q: 'THE SECOND BASEMAN TOUCHES SECOND AND APPEALS!',
        sub: '"He missed the bag, Blue!"',
        options: [
          { btn: 'A', id: 'out', label: 'OUT ON APPEAL', sub: '' },
          { btn: 'B', id: 'safe', label: 'SAFE — HE TOUCHED IT', sub: '' },
        ],
        answer: v.missed ? 'out' : 'safe',
        say: v.missed ? "He's out!" : 'Safe!',
        explain: v.missed
          ? 'A legal appeal (ball + touching the missed base + clearly appealing). He missed it, so he\'s **out on appeal**.'
          : 'They appealed, but he **did touch second**. Signal **safe** — the appeal is denied.',
      }];
    },
  },

  // ===== TIMING PLAY =====
  {
    id: 'timing', card: 'timing-play', title: 'Beat the Clock', weight: 2,
    variant() { return { k: pick(['tagAfter', 'tagAfter', 'tagBefore', 'force', 'batter']) }; },
    setup(v) { return { runners: v.k === 'force' ? [1, 3] : [1, 3], outs: 2, text: 'runners on 1st & 3rd · 2 outs' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      if (v.k === 'force') {
        // slow grounder; runner scores; force at second is the third out
        tl.ground(tc, tc + 1.3, { x: 0, y: 2 }, { x: 22, y: 60 });
        tl.move('2B', tc, tc + 1.25, 22, 61, 'ready');
        tl.hold(tc + 1.3, tc + 1.7, '2B', 3.3);
        const tScore = tl.runTo('R3', tc + 0.02, 0.6, 1.2, 17, 'stand');
        tl.move('SS', tc, tc + 1.4, 1.5, 83.5, 'ready');
        const tb = throwFrom(tl, '2B', tc + 1.7, { x: 1.2, y: 83, z: 3.2 }, 45);
        tl.hold(tb, tb + 5, 'SS', 3.2);
        slideTo(tl, 'R1', tc + 0.05, tb + 0.25, 2, { x: 0.5, y: -0.6 });
        batterRuns(tl, tc + 0.3, 15);
        tl.at(tScore, () => audio.thud());
        return { pause: Math.max(tScore, tb + 0.25) + 0.5 };
      }
      if (v.k === 'batter') {
        tl.ground(tc, tc + 0.9, { x: 0, y: 2 }, { x: -20, y: 64 });
        tl.move('SS', tc, tc + 0.85, -20, 65, 'ready');
        tl.hold(tc + 0.9, tc + 1.4, 'SS', 3.3);
        const tScore = tl.runTo('R3', tc + 0.02, 0.6, 1.2, 17, 'stand');
        tl.runTo('R1', tc + 0.05, 8, 76, 15, 'stand');
        const tb = throwFrom(tl, 'SS', tc + 1.4, { x: B1.x - 1.2, y: B1.y + 1, z: 3.2 }, 70);
        tl.move('1B', tc, tc + 1.0, B1.x - 0.6, B1.y + 0.9, 'ready');
        tl.pose('1B', tb - 0.3, 'reach', { facing: -1 });
        tl.hold(tb, tb + 5, '1B', 3.2);
        batterRuns(tl, tc + 0.3, 14);
        return { pause: Math.max(tScore, tb + 0.3) + 0.4 };
      }
      // single to right, RF bobbles it; runner from first tries for third and is tagged
      const slow = v.k === 'tagBefore';
      const tArr = tl.runPath('R1', tc + 0.05, [{ x: 4, y: 80 }, { x: -30, y: 54 }], 18, 'run');
      const tSafe = tArr + 0.7;
      const tTag = tSafe - 0.22;
      slideTo(tl, 'R1', tArr, tSafe, 3, { x: 0.8, y: 0.6 });
      const tb = tTag - 0.25;
      const rf = { x: 53, y: 116 };
      const flight = Math.hypot(rf.x - (B3.x + 1.2), rf.y - (B3.y + 1)) / 78;
      const tThrow = tb - flight;
      tl.ground(tc, tc + 1.4, { x: 0, y: 2 }, { x: 52, y: 118 });
      tl.move('RF', tc, tc + 1.4, rf.x, rf.y, 'ready');
      tl.hold(tc + 1.4, tc + 1.55, 'RF', 3);
      tl.rest(tc + 1.55, tThrow - 0.6, { x: rf.x + 3, y: rf.y + 4, z: 0.12 });
      tl.move('RF', tc + 1.6, tThrow - 0.65, rf.x + 2.5, rf.y + 3.5, 'tag');
      tl.hold(tThrow - 0.6, tThrow, 'RF', 3.5);
      throwFrom(tl, 'RF', tThrow, { x: B3.x + 1.2, y: B3.y + 1.0, z: 2.8 }, 78);
      tl.move('3B', tc, tc + 1.5, B3.x + 1.5, B3.y + 1.2, 'ready');
      tl.hold(tb, tb + 5, '3B', 2.6);
      tl.pose('3B', tb + 0.05, 'tag', { facing: -1 });
      tl.at(tTag, () => audio.tick());
      const tScore = slow ? tTag + 0.7 : tTag - 0.6;
      tl.move('R3', tc + 0.05, tScore, 0.6, 1.2, 'stand');
      tl.at(tScore, () => audio.thud());
      batterRuns(tl, tc + 0.3, 15);
      return { pause: Math.max(tScore, tTag) + 0.5, cam: (t) => (t < tThrow ? null : { x: -22, y: 26, ext: 44 }) };
    },
    steps(v) {
      const counts = v.k === 'tagAfter';
      return [{
        q: 'THIRD OUT! DOES THE RUN COUNT?',
        options: [
          { btn: 'A', id: 'yes', label: 'RUN COUNTS', sub: 'Point to the plate' },
          { btn: 'B', id: 'no', label: 'NO RUN', sub: 'Wave it off' },
        ],
        answer: counts ? 'yes' : 'no',
        explain: {
          tagAfter: 'The third out was a **tag play** (not a force), and the runner **touched home before** the tag. It\'s a timing play — **the run counts**.',
          tagBefore: 'It was a tag play, but the tag was made **before** the runner touched home. Timing matters — **no run**.',
          force: 'The third out was a **force out** at second. **No run can score** when the third out is a force — no matter when the runner crossed the plate.',
          batter: 'The third out was the **batter-runner retired before reaching first**. **No run can score** on that play.',
        }[v.k],
      }];
    },
  },

  // ===== BALK (50/70) =====
  {
    id: 'balk', card: 'balk', title: 'Big Diamond Balk Check', weight: 1, bigField: true,
    variant() { return { k: pick(['fake1', 'fake2', 'noStop', 'stepOff']) }; },
    setup(v) { return { runners: [1], outs: 1, text: 'runner on 1st (with a lead) · 1 out', divLabel: 'Intermediate 50/70 game' }; },
    build(tl, v) {
      tl.move('R1', 0.2, 1.0, B1.x - 6, B1.y + 6, 'ready');
      tl.pose('P', 0.6, 'stand');
      if (v.k === 'fake1') {
        tl.pose('P', 1.6, 'throw', { dur: 0.3, facing: 1 });
        tl.pose('P', 2.0, 'stand');
        return { pause: 2.2, cam: () => ({ x: 14, y: 44, ext: 34 }) };
      }
      if (v.k === 'fake2') {
        tl.move('P', 1.4, 1.7, -0.2, 47.5, 'throw');
        tl.pose('P', 2.0, 'stand');
        return { pause: 2.2, cam: () => ({ x: 6, y: 50, ext: 34 }) };
      }
      if (v.k === 'stepOff') {
        tl.move('P', 1.2, 1.5, 0, 48.2, 'stand');
        tl.pose('P', 1.8, 'throw', { dur: 0.3, facing: 1 });
        tl.pose('P', 2.2, 'stand');
        return { pause: 2.4, cam: () => ({ x: 14, y: 44, ext: 34 }) };
      }
      // no stop in the set
      tl.pose('P', 1.0, 'pitch', { dur: 1.0 });
      tl.hold(0, 1.8, 'P', 5);
      tl.fly(1.8, 2.4, { x: -1, y: 42, z: 5 }, { x: 0, y: -1.5, z: 2.5 }, 0.3);
      tl.at(2.4, () => audio.pop());
      return { pause: 2.6 };
    },
    steps(v) {
      const balk = v.k === 'fake1' || v.k === 'noStop';
      const desc = {
        fake1: 'From the set position **on the rubber**, the pitcher faked a throw to **first**.',
        fake2: 'On the rubber, the pitcher **stepped toward second** and faked a throw there.',
        stepOff: 'The pitcher **stepped back off the rubber** first, then faked a throw to first.',
        noStop: 'The pitcher came set and delivered **without a discernible pause**.',
      }[v.k];
      return [{
        q: 'BALK OR LEGAL?',
        sub: desc.replace(/\*\*/g, ''),
        options: [
          { btn: 'A', id: 'balk', label: 'BALK!', sub: 'Runners move up one base' },
          { btn: 'B', id: 'legal', label: 'LEGAL — PLAY ON', sub: '' },
        ],
        answer: balk ? 'balk' : 'legal',
        say: balk ? "That's a balk!" : null,
        explain: desc + ' ' + {
          fake1: '**Faking a throw to first from the rubber is a balk.** Runners advance one base.',
          fake2: 'Feinting to **second (or third)** from the rubber is **legal** — as long as he steps toward that base.',
          stepOff: 'Once he **disengages the rubber** with his back foot, he\'s just a fielder. Fielders can fake throws anywhere — **legal**.',
          noStop: 'After coming set, the pitcher must make a **discernible pause**. No stop = **balk**.',
        }[v.k] + ' (Balks apply in divisions where runners can lead off — not in Majors and below.)',
      }];
    },
  },

  // ===== FXLL: OUTFIELDER CAN'T MAKE AN OUT AT A BASE (AA) =====
  {
    id: 'aa-of', card: 'local-aa', title: 'Outfielder to the Rescue?', weight: 2, divs: ['AA', 'AAA', 'MAJ'],
    variant() { return {}; },
    setup() { return { runners: [1], outs: 0, text: 'runner on 1st · 0 outs' }; },
    build(tl) {
      const tc = pitchHit(tl);
      tl.ground(tc, tc + 1.5, { x: 0, y: 2 }, { x: 4, y: 104 });
      tl.move('CF', tc, tc + 1.4, 4, 106, 'ready');
      tl.hold(tc + 1.5, tc + 6, 'CF', 3);
      // CF charges and steps on second ahead of the slow runner
      tl.runTo('CF', tc + 1.6, 0.8, 85.5, 19, 'stand');
      const tStep = lastKey(tl, 'CF').t;
      tl.runTo('R1', tc + 0.05, 9, 76, 12, 'run');
      tl.runTo('R1', lastKey(tl, 'R1').t, 1.5, 83.6, 12, 'stand');
      batterRuns(tl, tc + 0.3, 14);
      return { pause: Math.max(tStep, lastKey(tl, 'R1').t) + 0.3, cam: () => ({ x: 4, y: 88, ext: 30 }) };
    },
    steps(v, div) {
      const aa = div.id === 'AA';
      return [{
        q: 'THE CENTER FIELDER STEPS ON SECOND FIRST!',
        sub: `This is a ${div.full} game`,
        options: [
          { btn: 'A', id: 'out', label: 'OUT — FORCE AT SECOND', sub: 'Fist up' },
          { btn: 'B', id: 'safe', label: 'SAFE', sub: 'Outfielders can\'t do that here' },
        ],
        answer: aa ? 'safe' : 'out',
        card: aa ? 'local-aa' : (div.id === 'AAA' ? 'local-aaa' : 'force-play'),
        explain: aa
          ? 'FXLL **AA local rule**: **an outfielder cannot make an out at a base**. The runner is **safe**.'
          : `That AA rule **does not carry over to ${div.full}** — don\'t import AA rules into other divisions! He beat the runner to the bag: **force out**.`,
      }];
    },
  },

  // ===== FXLL: ONE BASE PER STEAL =====
  {
    id: 'one-base', card: 'local-aa', title: 'Overthrow!', weight: 2, divs: ['AA', 'AAA', 'MAJ'],
    variant() { return {}; },
    setup() { return { runners: [1], outs: 1, text: 'runner on 1st · 1 out · he\'s stealing on the pitch!' }; },
    build(tl) {
      // A pitch the batter takes. The runner goes as the ball reaches the batter (no leads in LL).
      const tc = pitchHit(tl, { swing: false, catcher: true });
      const go = tc - 0.08;
      const tAt2 = tl.runTo('R1', go, ONBAG[2].x + 0.6, ONBAG[2].y - 0.8, 17.5, 'run');
      // the shortstop covers second
      tl.move('SS', tc + 0.05, tc + 1.3, -1.6, 83.8, 'ready');
      tl.at(tc + 1.3, () => { tl.actors.SS.faceAt = { x: 0, y: 0 }; });
      // the catcher's throw to second sails over the shortstop's glove...
      tl.hold(tc, tc + 0.8, 'C', 2.4);
      tl.pose('C', tc + 0.5, 'throw', { dur: 0.4, facing: 1 });
      const over = { x: 0.6, y: 84.5, z: 9.4 };
      const tOver = tl.throwBall(tc + 0.8, tc + 1.95, { x: 0, y: -2, z: 4.6 }, over);
      tl.pose('SS', tOver - 0.25, 'catchHigh');
      tl.pose('SS', tOver + 0.4, 'ready');
      tl.at(tOver, () => audio.ooh());
      // ...and skips into center field
      tl.fly(tOver, tOver + 0.5, over, { x: 2.5, y: 103, z: 0 }, 0.5);
      const tStop = tl.ground(tOver + 0.5, tOver + 1.7, { x: 2.5, y: 103 }, { x: 5, y: 124 });
      tl.move('CF', tOver - 0.3, tStop, 5.5, 125.5, 'ready');
      tl.hold(tStop, tOver + 2.3, 'CF', 3);
      // the runner touches second and keeps going; the throw comes back in to second, too late
      const tAt3 = tl.runTo('R1', tAt2, ONBAG[3].x, ONBAG[3].y, 17, 'stand');
      const tBack = throwFrom(tl, 'CF', tOver + 2.3, { x: -1.2, y: 84.5, z: 3.4 }, 70);
      tl.hold(tBack, tAt3 + 2, 'SS', 3);
      tl.at(tBack, () => { tl.actors.SS.faceAt = { x: B3.x, y: B3.y }; });
      return {
        pause: tAt3 + 0.4,
        cam: (t) => (t < tOver - 0.5 ? { x: 10, y: 40, ext: 56 } : t < tOver + 1.6 ? { x: 0, y: 92, ext: 58 } : { x: -14, y: 76, ext: 62 }),
      };
    },
    steps(v, div) {
      const local = div.id === 'AA' || div.id === 'AAA';
      return [{
        q: 'OVERTHROW ON THE STEAL — HE TOOK THIRD!',
        sub: `No swing: it was a steal · ${div.full} game`,
        options: [
          { btn: 'A', id: 'back', label: 'SEND HIM BACK TO SECOND', sub: 'One base per steal' },
          { btn: 'B', id: 'stay', label: 'HE STAYS AT THIRD', sub: 'Ball was live' },
        ],
        answer: local ? 'back' : 'stay',
        card: local ? (div.id === 'AA' ? 'local-aa' : 'local-aaa') : 'local-aaa',
        explain: local
          ? `FXLL **${div.id} local rule**: on a **steal**, a runner may advance **only one base** — even if the catcher's throw goes into the outfield (or over the fence). Send him back to **second**. (This is only for steals. On a **batted ball**, runners can take as many bases as they can.)`
          : 'In **Majors**, the one-base-per-steal local rule doesn\'t apply. The overthrow was a live ball, so he can advance at his own risk: **he stays at third**.',
      }];
    },
  },

  // ===== FXLL: NO STEALING HOME ON THE THROWBACK (AAA) =====
  {
    id: 'throwback', card: 'local-aaa', title: 'Sneaky Steal of Home', weight: 1, divs: ['AA', 'AAA', 'MAJ'],
    variant() { return { airmail: chance(0.4) }; },
    setup() { return { runners: [3], outs: 1, text: 'runner on 3rd · 1 out' }; },
    build(tl, v) {
      const tc = pitchHit(tl, { swing: false, catcher: true });
      tl.hold(tc, tc + 0.9, 'C', 2.4);
      tl.pose('C', tc + 0.6, 'throw', { dur: 0.4, facing: 1 });
      if (v.airmail) {
        tl.throwBall(tc + 0.9, tc + 1.9, { x: 0, y: -2, z: 4.6 }, { x: 2, y: 66, z: 10 });
        tl.ground(tc + 1.9, tc + 3.0, { x: 2, y: 66 }, { x: 4, y: 96 });
        tl.move('CF', tc, tc + 3.0, 4, 98, 'ready');
      } else {
        tl.throwBall(tc + 0.9, tc + 1.7, { x: 0, y: -2, z: 4.6 }, { x: 0.5, y: 43.5, z: 4.5 });
        tl.hold(tc + 1.7, tc + 6, 'P', 4.5);
        tl.at(tc + 1.7, () => audio.pop());
      }
      tl.pose('P', tc + 1.4, 'catchHigh');
      const tHome = tl.runTo('R3', tc + 1.1, 0.6, 1.2, 17, 'stand');
      tl.at(tHome, () => audio.thud());
      return { pause: tHome + 0.4, cam: () => ({ x: -10, y: 24, ext: 44 }) };
    },
    steps(v, div) {
      let ans, ex;
      if (div.id === 'AA') { ans = 'back'; ex = 'FXLL **AA**: runners **may not steal home** at all. Send him back to third.'; }
      else if (div.id === 'AAA') {
        ans = v.airmail ? 'score' : 'back';
        ex = v.airmail ? 'FXLL **AAA**: no stealing home on the throwback — **unless the catcher\'s throw completely air-mails the pitcher**. It sailed into center, so the run **counts**.' : 'FXLL **AAA**: a runner **may not steal home on the catcher\'s routine throwback** to the pitcher. Send him back to third.';
      } else { ans = 'score'; ex = 'In **Majors** there\'s no throwback local rule — the ball is live and he can steal home. **Run scores.**'; }
      return [{
        q: 'HE BROKE FOR HOME ON THE THROWBACK!',
        sub: `This is a ${div.full} game`,
        options: [
          { btn: 'A', id: 'score', label: 'RUN SCORES', sub: '' },
          { btn: 'B', id: 'back', label: 'SEND HIM BACK TO THIRD', sub: '' },
        ],
        answer: ans,
        card: div.id === 'AA' ? 'local-aa' : 'local-aaa',
        explain: ex,
      }];
    },
  },

  // ===== FXLL: LEAVING EARLY (AA/AAA baseball) =====
  {
    id: 'leave-early', card: 'local-aa', title: 'Jumping the Gun', weight: 1, divs: ['AA', 'AAA'],
    variant() { return { second: chance(0.5) }; },
    setup(v) { return { runners: [1], outs: 0, text: v.second ? 'runner on 1st · already warned this inning' : 'runner on 1st · first time this inning' }; },
    build(tl) {
      tl.pose('P', 0.4, 'pitch', { dur: 1.0 });
      tl.hold(0, 1.2, 'P', 5);
      tl.fly(1.2, 1.8, { x: -1, y: 42, z: 5 }, { x: 0, y: -1.5, z: 2.5 }, 0.3);
      tl.at(1.8, () => audio.pop());
      tl.hold(1.8, 9, 'C', 2.4);
      // runner takes off as the pitcher releases (before the pitch reaches the batter)
      tl.runTo('R1', 1.15, 26, 58, 15, 'stand');
      return { pause: 2.4, cam: () => ({ x: 22, y: 40, ext: 46 }) };
    },
    steps(v, div) {
      return [{
        q: 'HE LEFT FIRST BEFORE THE PITCH REACHED THE BATTER!',
        sub: v.second ? 'He was already warned this inning' : 'First time this inning',
        options: [
          { btn: 'A', id: 'warn', label: 'WARNING — SEND HIM BACK', sub: '' },
          { btn: 'B', id: 'out', label: "RUNNER'S OUT", sub: '' },
          { btn: 'X', id: 'none', label: 'NOTHING — IT\'S A STEAL', sub: '' },
        ],
        answer: v.second ? 'out' : 'warn',
        card: div.id === 'AA' ? 'local-aa' : 'local-aaa',
        explain: `FXLL **${div.id}**: runners can't leave until the pitch reaches the batter. For leaving early, give **one warning**; the **second violation is an out**. ${v.second ? 'He was already warned, so he\'s **out**.' : 'This is the first one — **warn him** and send him back.'}`,
      }];
    },
  },

  // ===== SOFTBALL: LEAVING EARLY =====
  {
    id: 'sb-early', card: 'softball-early', title: 'Softball: Too Soon!', weight: 1, softball: true,
    variant() { return { k: pick(['early', 'onRelease', 'minorsRelease']) }; },
    setup(v) { return { runners: [1], outs: 1, text: 'runner on 1st · 1 out', divLabel: v.k === 'minorsRelease' ? 'Softball Minors game' : 'Softball Majors game' }; },
    build(tl, v) {
      tl.pose('P', 0.4, 'pitch', { dur: 1.0 });
      tl.hold(0, 1.2, 'P', 4);
      tl.fly(1.2, 1.75, { x: 1, y: 39, z: 2.5 }, { x: 0, y: -1.5, z: 2.5 }, 0.6);
      tl.at(1.75, () => audio.pop());
      tl.hold(1.75, 9, 'C', 2.4);
      const leave = v.k === 'early' ? 0.85 : 1.22;
      tl.runTo('R1', leave, 26, 58, 15, 'stand');
      return { pause: 2.3, cam: () => ({ x: 20, y: 40, ext: 46 }) };
    },
    steps(v) {
      const out = v.k === 'early' || v.k === 'minorsRelease';
      return [{
        q: 'DID THE RUNNER LEAVE TOO SOON?',
        sub: v.k === 'minorsRelease' ? 'Softball Minors — he left right at the release' : v.k === 'early' ? 'Softball Majors' : 'Softball Majors — he left right at the release',
        options: [
          { btn: 'A', id: 'out', label: "TIME! RUNNER'S OUT", sub: 'Left early' },
          { btn: 'B', id: 'ok', label: 'LEGAL — PLAY ON', sub: '' },
        ],
        answer: out ? 'out' : 'ok',
        explain: {
          early: 'In softball **Majors and up**, runners may leave when the pitcher **releases** the ball. He left **before the release** — that\'s an **immediate dead-ball out**.',
          onRelease: 'In softball **Majors**, runners may leave **when the ball is released**. He left right at the release — **legal**.',
          minorsRelease: 'In softball **Minors and below**, runners must wait until the pitch **reaches the batter**. Leaving at the release is too soon — **dead ball, runner out**.',
        }[v.k],
      }];
    },
  },

  // ===== SOFTBALL: LOOK-BACK =====
  {
    id: 'sb-lookback', card: 'softball-lookback', title: 'Softball: Look-Back Rule', weight: 1, softball: true,
    variant() { return { dance: chance(0.6) }; },
    setup() { return { runners: [], outs: 1, text: 'batter-runner rounding first', divLabel: 'Softball game' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      tl.ground(tc, tc + 1.3, { x: 0, y: 2 }, { x: 40, y: 110 });
      tl.move('RF', tc, tc + 1.3, 41, 108, 'ready');
      tl.hold(tc + 1.3, tc + 1.6, 'RF', 4);
      const tIn = throwFrom(tl, 'RF', tc + 1.6, { x: 0.5, y: 44, z: 4 }, 70);
      tl.hold(tIn, tIn + 9, 'P', 4);
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x + 2, B1.y + 4, 15, 'run');
      tl.runTo('BAT', lastKey(tl, 'BAT').t, 34, 54, 12, 'stand');
      const t0 = Math.max(tIn, lastKey(tl, 'BAT').t) + 0.3;
      if (v.dance) {
        let t = tl.runTo('BAT', t0, 37, 50, 6, 'stand');
        t = tl.runTo('BAT', t + 0.2, 32, 56, 6, 'stand');
        t = tl.runTo('BAT', t + 0.2, 36, 51, 6, 'stand');
        return { pause: t + 0.6, cam: () => ({ x: 22, y: 46, ext: 40 }) };
      }
      tl.runTo('BAT', t0 + 0.1, B1.x - 0.3, B1.y - 0.2, 12, 'stand');
      return { pause: lastKey(tl, 'BAT').t + 0.5, cam: () => ({ x: 22, y: 46, ext: 40 }) };
    },
    steps(v) {
      return [{
        q: 'PITCHER HAS THE BALL IN THE CIRCLE…',
        sub: 'What about that runner?',
        options: [
          { btn: 'A', id: 'out', label: "TIME! RUNNER'S OUT", sub: 'Look-back violation' },
          { btn: 'B', id: 'ok', label: 'LEGAL — PLAY ON', sub: '' },
        ],
        answer: v.dance ? 'out' : 'ok',
        explain: v.dance
          ? 'Look-back rule: with the pitcher holding the ball in the circle (not making a play), a runner off base must **immediately** go or come back (about 3 seconds). He **stopped and faked back and forth** — **dead ball, runner out**.'
          : 'He went **straight back to first** right away. That\'s exactly what the look-back rule wants — **legal**.',
      }];
    },
  },
];

export function situationsFor(div, { softball = SOFTBALL_ENABLED, bigField = true } = {}) {
  return SITUATIONS.filter((s) => (!s.divs || s.divs.includes(div.id)) && (softball || !s.softball) && (bigField || !s.bigField));
}
