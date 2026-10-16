// Rule situations. Each one scripts a short play, then asks for the ruling.
// Rulings follow Little League rules as taught in Umpire Bootcamp.
import { audio } from '../audio.js';
import { pick, chance, rand, clamp, lerp } from '../util.js';
import { BASES, POS } from '../render/field.js';
import { sport, forSport, releasePt, holdZ, CIRCLE_R } from '../sport.js';

const B1 = BASES.first, B2 = BASES.second, B3 = BASES.third, H = BASES.home;
const ONBAG = { 1: { x: B1.x - 0.3, y: B1.y - 0.2 }, 2: { x: B2.x, y: B2.y - 0.5 }, 3: { x: B3.x + 0.3, y: B3.y - 0.2 }, 4: { x: 0.4, y: 0.6 } };


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
  tl.hold(0, t0 + 0.8, 'P', holdZ());
  const tc = t0 + 1.4;
  tl.fly(t0 + 0.8, tc, releasePt(), catcher ? { x: 0, y: -1.5, z } : { x: 0, y: 1.2, z }, 0.3);
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
// Run to a ground ball and get down on it a beat before it gets there at tBall (the 'field' pose)
function fieldAt(tl, id, t0, tBall, x, y) {
  tl.move(id, t0, Math.max(t0 + 0.2, tBall - 0.3), x, y, 'field');
  lastKey(tl, id).dur = 0.6;
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

// Cleat marks a runner leaves from t0 to t1, one per footfall, each showing once he's made it,
// so you can see exactly where he ran. Returns a scuffs(t) function.
function footprints(tl, id, t0, t1, every = 0.15) {
  const marks = [];
  for (let ts = t0; ts <= t1; ts += every) {
    const p = posAt(tl, id, ts), q = posAt(tl, id, ts + 0.05);
    if (Math.hypot(q.x - p.x, q.y - p.y) < 0.1) continue; // standing still: no new mark
    const rot = Math.atan2(q.y - p.y, q.x - p.x) - Math.PI / 2;
    const side = marks.length % 2 ? 0.36 : -0.36;
    marks.push({ t: ts, x: p.x + Math.cos(rot) * side, y: p.y + Math.sin(rot) * side, r: 0.46, sx: 0.7, sy: 1.35, a: 1, rot });
  }
  return (t) => marks.filter((m) => m.t <= t);
}
// A BALL CAM picture-in-picture that keeps the ball in the middle, seen from the home-plate side of it
function ballCam(tl, back = 20, up = 7, fov = 0.6) {
  const b = tl.ball, d = Math.hypot(b.x, b.y) || 1;
  return {
    eye: { x: b.x - (b.x / d) * back, y: b.y - (b.y / d) * back, z: (b.z || 0) + up },
    target: { x: b.x, y: b.y, z: b.z || 0 }, fov, label: 'BALL CAM',
  };
}
// A white ring around the ball on the ground, so a tiny ball is easy to find on a phone
const ballRing = (tl) => ({ x: tl.ball.x, y: tl.ball.y, r: 1.1, color: '#ffffff' });
// The tag-or-contact moment: a callout plus a short slow-motion window around it
const moment = (t, text, before = 0.5, after = 0.3, y) => ({ words: [{ t, text, y }], slow: [[t - before, t + after]] });
// A close camera on a spot, aimed a little past it so the players there stand below the callout
const closeOn = (x, y, ext, pitch = 0.6) => ({ x, y: y + ext * 0.45, ext, pitch });

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
      // every version: slow motion off the bat and a callout naming what kind of ball it is (one of the
      // four boxes), so a pop-up, a liner and a bunt can't be mixed up
      const look = {
        words: [{ t: tc + 0.05, text: { popup: 'POP-UP!', liner: 'LINE DRIVE!', bunt: 'BUNT!' }[v.ball] }],
        slow: [[tc - 0.15, tc + 0.4]],
        replay: tc - 1.0,
      };
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
        return { pause: tc + 0.3, ...look, cam: (t) => (t < tc - 0.3 ? null : { x: -8, y: 34, ext: 30, pitch: 0.55 }) };
      }
      if (v.ball === 'bunt') {
        const land = { x: 4, y: 20 };
        tl.fly(tc, tc + 1.7, { x: 0, y: 1.5, z: 2.3 }, { x: land.x, y: land.y, z: 3 }, 13);
        tl.move('P', tc + 0.2, tc + 1.5, land.x, land.y + 1, 'catchHigh');
        tl.hold(tc + 1.7, tc + 5, 'P', 3.4);
        tl.at(tc + 1.7, () => audio.pop());
        tl.pose('BAT', tc + 0.2, 'stand');
        tl.runTo('BAT', tc + 0.3, 20, 19, 14, 'run');
        return { pause: tc + 0.9, ...look, cam: (t) => (t < tc - 0.3 ? null : { x: 3, y: 12, ext: 20, pitch: 0.55 }) };
      }
      const hang = 3.4;
      const f = v.to.f;
      tl.fly(tc, tc + hang, { x: 0, y: 1.5, z: 3 }, { x: v.to.x, y: v.to.y, z: 5.5 }, 62);
      tl.move(f, tc + 0.3, tc + hang - 0.7, v.to.x - 0.4, v.to.y + 0.3, 'catchHigh');
      tl.hold(tc + hang, tc + 7, f, 5.4);
      tl.at(tc + hang, () => audio.pop());
      tl.pose('BAT', tc + 0.2, 'stand');
      tl.runTo('BAT', tc + 0.3, 30, 29, 15, 'stand');
      return { pause: tc + 1.15, ...look, cam: (t) => (t < tc - 0.3 ? null : { x: v.to.x * 0.5, y: v.to.y * 0.6 + 4, ext: 42, pitch: 0.55 }) };
    },
    steps(v, div) {
      const yes = v.outs < 2 && v.runners.includes(1) && v.runners.includes(2) && v.ball === 'popup';
      let explain;
      if (yes) explain = 'All four boxes are checked: **fewer than two outs**, runners on **1st & 2nd** (or loaded), a **fair fly ball**, and an infielder can catch it with **ordinary effort**. Call it loud: "Infield fly, batter\'s out!" The ball stays **live** — runners may advance at their own risk.';
      else if (v.ball === 'liner') explain = 'A **line drive** is never an infield fly. The rule only covers fly balls — not liners and not bunts.';
      else if (v.ball === 'bunt') explain = 'A popped-up **bunt** is never an infield fly. No call — just watch for the catch.';
      else if (v.outs === 2) explain = 'With **two outs** there\'s no infield fly — the defense just needs one out, so there\'s no cheap double play to protect against.';
      else explain = 'The rule needs runners on **1st & 2nd** or the **bases loaded** — where the defense could let the ball drop for an easy double play. Not here, so no infield fly.';
      return [{
        q: 'BALL IN THE AIR! WHAT\'S YOUR CALL?',
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
        return { pause: th + 0.25, slow: [[th - 0.3, th + 0.2]], cam: (t) => (t > tc + 0.3 ? { x: hit.x + 3, y: hit.y - 6, ext: 22 } : null) };
      }
      // grounder gets past the shortstop, then hits the runner behind him
      tl.move('SS', tc, tc + 0.7, -14, 63, 'field');
      lastKey(tl, 'SS').dur = 1.0;
      const through = { x: -18, y: 74 };
      const th = tc + 1.25;
      tl.ground(tc, th, { x: 0, y: 2 }, through);
      tl.at(th, () => audio.thud());
      tl.ground(th, th + 0.9, through, { x: -26, y: 86 });
      tl.move('R2', tc + 0.1, th, through.x, through.y, 'stand');
      batterRuns(tl, tc + 0.3, 16);
      return { pause: th + 0.25, slow: [[th - 0.3, th + 0.2]], cam: (t) => (t > tc + 0.3 ? { x: through.x + 2, y: through.y - 8, ext: 24 } : null) };
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
      // both versions: tight and slow on the bump, with a BALL CAM box showing where the ball is right then
      let is3d = true;
      const look = (tHit) => ({
        ...moment(tHit, 'CONTACT!', 0.55, 0.3),
        replay: tc - 0.5,
        init: (s) => { is3d = s.field.is3d; },
        // (the flat 2D view has no picture-in-picture, so it stays wide enough to show the ball too)
        cam: (t) => (t < tc + 0.25 ? null : is3d ? closeOn(spot.x - 1, spot.y + 0.5, 13) : { x: spot.x - 5, y: spot.y + 6, ext: 24 }),
        inset: (t) => (t > tc + 0.2 && t < tHit + 0.9 ? ballCam(tl, 18, 8) : null),
      });
      tl.move('SS', tc, tc + 0.55, spot.x, spot.y, v.fielding ? 'field' : 'ready');
      if (v.fielding) lastKey(tl, 'SS').dur = 0.6;
      if (v.fielding) {
        // ground ball right at the shortstop in the runner's path
        tl.ground(tc, tc + 1.0, { x: 0, y: 2 }, { x: spot.x + 1, y: spot.y - 1 });
        tl.move('R2', tc + 0.1, tc + 0.95, spot.x - 0.5, spot.y + 0.6, 'stand');
        tl.at(tc + 0.95, () => { audio.thud(); audio.ouch(); });
        tl.pose('SS', tc + 0.95, 'fall', { dur: 0.32 }); // knocked down by the runner
        tl.move('R2', tc + 0.97, tc + 1.15, spot.x - 3.2, spot.y - 2.6, 'stand'); // the runner stumbles on past him
        tl.ground(tc + 1.0, tc + 1.7, { x: spot.x + 1, y: spot.y - 1 }, { x: -24, y: 58 });
        batterRuns(tl, tc + 0.3, 16);
        return { pause: tc + 1.35, ...look(tc + 0.95) };
      }
      // ball goes past the shortstop into left field; then the runner bumps into him
      tl.ground(tc, tc + 1.6, { x: 0, y: 2 }, { x: -40, y: 120 });
      tl.move('R2', tc + 0.1, tc + 1.15, spot.x - 0.5, spot.y + 0.6, 'stand');
      tl.at(tc + 1.15, () => { audio.thud(); });
      tl.pose('R2', tc + 1.15, 'fall', { dur: 0.32 }); // the runner bounces off him and goes down
      fieldAt(tl, 'LF', tc + 0.2, tc + 1.6, -40, 118);
      batterRuns(tl, tc + 0.3, 16);
      return { pause: tc + 1.5, ...look(tc + 1.15) };
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
      fieldAt(tl, 'RF', tc + 0.2, tc + 3.4, 79, 165);
      tl.move('1B', tc, tc + 0.9, B1.x + 2.5, B1.y + 5, 'stand');
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x - 0.5, B1.y - 1, 17, 'run');
      const tHit = tl.runTo('BAT', lastKey(tl, 'BAT').t, B1.x + 2.2, B1.y + 4.2, 17, 'stand');
      tl.at(tHit, () => audio.thud());
      tl.pose('BAT', tHit + 0.3, 'stand');
      // tight and slow on the bump at first, with a BALL CAM box showing the ball is way out in right
      return {
        pause: tHit + 0.25,
        ...moment(tHit, 'CONTACT!', 0.55, 0.2),
        replay: tHit - 2.2,
        cam: (t) => (t < tHit - 1.8 ? null : closeOn(B1.x + 2, B1.y + 4, 12)),
        inset: (t) => (t > tHit - 1.6 ? ballCam(tl, 22, 9) : null),
      };
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
      fieldAt(tl, 'P', tc, tc + 0.6, -3, 37);
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
      tl.pose('R3', tBump, 'fall', { dur: 0.32 });
      // the rundown framed close, then slow on the bump (the third baseman with the ball is right behind)
      return {
        pause: tBump + 0.4,
        ...moment(tBump, 'CONTACT!', 0.6, 0.3),
        replay: t1 - 0.8,
        cam: (t) => (t < tc + 0.4 ? { x: -14, y: 30, ext: 30 } : t < tBump - 0.9 ? closeOn(-27, 29, 18, 0.65) : closeOn(-27.5, 27, 11)),
      };
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
      fieldAt(tl, 'LF', tc + 0.2, tc + 2.6, -63, 126);
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x - 0.5, B1.y - 0.5, 16, 'stand');
      // runner from third heads home; catcher sets up in the baseline without the ball
      tl.move('C', tc + 0.4, tc + 1.6, -2.5, 3.5, 'ready');
      const tArrive = tl.runTo('R3', tc + 0.2, -3.2, 4.2, 15, 'stand');
      tl.at(tArrive, () => { audio.thud(); audio.ouch(); });
      tl.pose('R3', tArrive, 'fall', { dur: 0.32 });
      const tThrow = tc + 2.95;
      tl.hold(tc + 2.6, tThrow, 'LF', 4);
      throwFrom(tl, 'LF', tThrow, { x: -6, y: 30, z: 3 }, 70);
      // tight and slow at the plate, with a BALL CAM box on the throw (still on its way in)
      return {
        pause: tArrive + 0.4,
        ...moment(tArrive, 'CONTACT!', 0.55, 0.3),
        replay: tArrive - 2.2,
        cam: (t) => (t < tArrive - 2 ? null : closeOn(-3.2, 3, 10, 0.9)), // (high, so the plate umpire isn't in the way on a phone)
        inset: (t) => (t > tArrive - 1.8 ? ballCam(tl, 24, 8) : null),
      };
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
      fieldAt(tl, 'RF', tc + 0.1, tc + 1.4, 47, 116);
      batterRuns(tl, tc + 0.3, 15);
      // runner from 2nd rounds 3rd and heads home
      tl.runPath('R2', tc + 0.05, [{ x: -40, y: 46 }, { x: -12, y: 12 }], 17.5, 'run');
      const tCatch = throwFrom(tl, 'RF', tc + 1.6, { x: 0.8, y: 3.2, z: 3 }, 74);
      tl.move('C', tc + 0.5, tCatch - 0.2, 0.8, 2.5, 'ready');
      tl.hold(tCatch, tCatch + 4, 'C', 2.8);
      tl.pose('C', tCatch + 0.05, 'tag', { facing: -1 });
      const tNear = lastKey(tl, 'R2').t;
      let tEnd;
      let field = {};
      if (v.around) {
        // swings wide of the catcher, then dives in from the back side with his hand on the plate
        tl.runPath('R2', tNear, [{ x: -6.5, y: 3 }, { x: -5.4, y: -0.5 }], 15, 'stand');
        const tDive = lastKey(tl, 'R2').t;
        tEnd = tDive + 0.35;
        tl.move('R2', tDive, tEnd, -1.9, -0.2, 'dive', 'dive');
        tl.at(tEnd, () => { audio.slide(); if (field.puff) field.puff(-0.4, 0, 0.5); }); // his hand slaps the plate
      } else {
        tEnd = tl.runTo('R2', tNear, 0, 3, 17, 'stand');
        tl.at(tEnd, () => { audio.thud(); audio.ouch(); });
        tl.pose('C', tEnd, 'fall', { dur: 0.32 });
        tl.hold(tEnd + 0.3, tEnd + 4, 'C', 1.1);
      }
      // both versions: close and slow at the plate as he gets there, so you see him go around or crash
      return {
        pause: tEnd + 0.5,
        ...moment(tEnd, v.around ? 'AROUND HIM!' : 'CRASH!', 0.7, 0.4),
        replay: tEnd - 2.4,
        init: (s) => { field = s.field; },
        cam: (t) => (t < tEnd - 2.2 ? { x: -6, y: 10, ext: 30 } : closeOn(-1.5, 0.5, 9.5, 0.9)),
      };
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
      tl.move('C', 0, tc - 0.1, 0, -1.2, 'catcher'); // creeping up, mitt too close to the bat
      tl.ground(tc, tc + 0.9, { x: 0, y: 2 }, { x: -18, y: 66 });
      fieldAt(tl, 'SS', tc, tc + 0.9, -18, 67);
      tl.hold(tc + 0.9, tc + 1.4, 'SS', 3.4);
      const tb = throwFrom(tl, 'SS', tc + 1.4, { x: B1.x - 1.2, y: B1.y + 1, z: 3.2 }, 70);
      tl.move('1B', tc, tc + 1.0, B1.x - 0.6, B1.y + 0.9, 'ready');
      tl.pose('1B', tb - 0.3, 'reach', { facing: -1 });
      tl.hold(tb, tb + 3, '1B', 3.2);
      batterRuns(tl, tc + 0.3, 15);
      // close up on the plate in slow motion for the swing (the bat clips the mitt), then follow the play
      return { pause: tb + 0.6, slow: [[tc - 0.35, tc + 0.25]], cam: (t) => (t < tc + 0.45 ? { x: 0, y: 1, ext: 13, pitch: 1.0 } : null) };
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
      // the batter steps out of the box, right across the plate into the catcher's throwing lane
      if (v.moved) tl.move('BAT', tc + 0.25, tc + 0.75, 0.3, 0.6, 'stand', 'run');
      tl.pose('C', tc + 0.6, 'throw', { dur: 0.4, facing: 1 });
      if (v.moved) {
        // the throw smacks into him and drops
        tl.throwBall(tc + 0.88, tc + 0.98, { x: 0, y: -2, z: 4.6 }, { x: 0.3, y: 0.4, z: 3.6 });
        tl.at(tc + 0.98, () => { audio.thud(); audio.ouch(); });
        tl.ground(tc + 0.98, tc + 1.6, { x: 0.3, y: 0.4 }, { x: 2.5, y: 4 });
      } else {
        tl.throwBall(tc + 0.9, tc + 2.2, { x: 0, y: -2, z: 4.6 }, { x: 1.2, y: 83.5, z: 2.8 });
        tl.move('SS', tc + 0.2, tc + 1.9, 1.5, 83, 'tag');
        tl.hold(tc + 2.2, tc + 5, 'SS', 2.6);
      }
      // close on the plate so you see what the batter does, then (no interference) follow the throw
      return { pause: v.moved ? tc + 1.5 : tc + 2.4, slow: [[tc + 0.2, tc + 1.1]], cam: (t) => (v.moved || t < tc + 1.0 ? { x: 0, y: 1, ext: 13, pitch: 1.0 } : { x: 0, y: 45, ext: 60 }) };
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
      fieldAt(tl, 'C', tc + 0.1, tc + 0.9, 3.5, 11);
      tl.hold(tc + 0.9, tc + 1.3, 'C', 2.6);
      tl.move('1B', tc, tc + 1.1, B1.x - 0.6, B1.y + 0.9, 'ready');
      tl.pose('BAT', tc + 0.1, 'stand');
      const off = v.inLane ? 1.8 : -2.2; // + = foul side (in lane), - = inside the line
      const lanePt = { x: 33 + off * 0.7, y: 33 - off * 0.7 };
      const tAt = tl.runTo('BAT', tc + 0.2, lanePt.x, lanePt.y, 15.5, 'run');
      // throw from the catcher hits the runner in the back
      const tThrow = tc + 1.3;
      const hitT = tAt;
      tl.pose('C', tThrow - 0.25, 'throw', { dur: 0.4 });
      tl.pose('C', tThrow + 0.4, 'ready');
      tl.throwBall(tThrow, hitT, { x: 4, y: 12, z: 4 }, { x: lanePt.x, y: lanePt.y, z: 3.5 });
      tl.at(hitT, () => { audio.thud(); audio.ouch(); });
      tl.ground(hitT, hitT + 1, { x: lanePt.x, y: lanePt.y }, { x: lanePt.x + 10, y: lanePt.y - 3 });
      tl.runTo('BAT', hitT, B1.x - 0.3, B1.y - 0.3, 15, 'stand');
      // both versions: the running lane lit up, his cleat marks, and a slow look straight up the line
      // (from behind home) as the throw hits him, so you can see which side of the chalk he's on
      const R2 = Math.SQRT1_2, o = 3 * R2;
      const lane = [{ x: 30 * R2, y: 30 * R2 }, { x: B1.x, y: B1.y }, { x: B1.x + o, y: B1.y - o }, { x: 30 * R2 + o, y: 30 * R2 - o }];
      return {
        pause: hitT + 0.35,
        ...moment(hitT, 'HIT!', 0.55, 0.3),
        replay: tc - 0.3,
        scuffs: footprints(tl, 'BAT', tc + 0.6, hitT + 0.3, 0.13),
        markers: (t) => (t > tc + 0.3 ? [{ poly: lane, color: '#ffd34d', label: 'RUNNING LANE' }] : []),
        cam: (t) => (t < tc + 0.3 ? null : { x: lanePt.x + 2.5, y: lanePt.y + 2.5, ext: 10, pitch: 1.0, yaw: Math.PI / 4 }),
      };
    },
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
        fieldAt(tl, '2B', tc, tc + 0.7, 26, 63);
        tl.hold(tc + 0.7, tc + 5, '2B', 3);
        tl.runTo('R1', tc + 0.05, 30, 57, 16, 'run');
        tl.move('2B', tc + 0.75, tc + 1.15, 28, 61, 'tag');
        // big swerve out of the base path
        const tTry = lastKey(tl, 'R1').t; // the tag try: his base path is now a straight line from here to 2nd
        tl.runPath('R1', tTry, [{ x: 24, y: 52 }, { x: 14, y: 64 }, { x: 4, y: 80 }], 15, 'stand');
        batterRuns(tl, tc + 0.3, 15);
        // the 3-foot base path lights up the moment the fielder goes to tag him; his cleat marks show his route
        const at = { x: 30, y: 57 }, d = Math.hypot(B2.x - at.x, B2.y - at.y), n = { x: -(B2.y - at.y) / d * 3, y: (B2.x - at.x) / d * 3 };
        const path = [{ x: at.x + n.x, y: at.y + n.y }, { x: B2.x + n.x, y: B2.y + n.y }, { x: B2.x - n.x, y: B2.y - n.y }, { x: at.x - n.x, y: at.y - n.y }];
        return {
          pause: tc + 1.9,
          ...moment(tTry, 'TAG TRY!', 0.4, 0.7),
          replay: tc - 0.3,
          scuffs: footprints(tl, 'R1', tc + 0.3, tc + 1.9, 0.13),
          markers: (t) => (t >= tTry ? [{ poly: path, color: '#ffd34d', label: '3 FT BASE PATH' }] : []),
          cam: (t) => (t < tc + 0.3 ? null : { x: 20, y: 62, ext: 17, pitch: 0.95 }),
        };
      }
      // wide turn at first on a clean single, no tag attempt
      tl.ground(tc, tc + 1.4, { x: 0, y: 2 }, { x: 30, y: 120 });
      fieldAt(tl, 'RF', tc, tc + 1.4, 34, 122);
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runPath('BAT', tc + 0.15, [{ x: 30, y: 26 }, { x: 46, y: 34 }, { x: B1.x - 0.4, y: B1.y - 0.2 }, { x: 46, y: 54 }], 16.5, 'stand');
      const t = lastKey(tl, 'BAT').t;
      // the same high, close look and cleat marks: you can see just how wide he went (and nobody tried a tag)
      return {
        pause: t + 0.2,
        replay: tc - 0.3,
        scuffs: footprints(tl, 'BAT', tc + 0.3, t, 0.13),
        cam: (tt) => (tt < tc + 0.3 ? null : { x: 40, y: 40, ext: 17, pitch: 0.95 }),
      };
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
      // batted-ball time runs a little slow so the ball is easy to follow, even on a phone
      const T = (x) => tc + x * 1.5;
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, 16, 15, 15, 'run');
      const L = (d, off) => ({ x: -d * Math.SQRT1_2 - off * Math.SQRT1_2, y: d * Math.SQRT1_2 - off * Math.SQRT1_2 }); // along 3B line; off>0 = foul side
      const R = (d, off) => ({ x: d * Math.SQRT1_2 + off * Math.SQRT1_2, y: d * Math.SQRT1_2 - off * Math.SQRT1_2 }); // along 1B line
      let field = {};
      const lineLook = (tKey, text) => ({
        ...moment(tKey, text, 0.55, 0.35),
        replay: tc - 0.2,
        init: (s) => { field = s.field; },
        markers: (t) => [
          ...(t > tc + 0.2 && t < tKey + 0.6 ? [{ x: B3.x, y: B3.y, r: 2.4, color: '#ffd34d', pulse: true, label: 'WATCH THE BAG', labelZ: 4.2, labelS: 4.2 }] : []),
          ...(t > tKey - 1 ? [ballRing(tl)] : []),
        ],
        cam: (t) => (t < tc + 0.3 ? null : { ...L(60, 1.5), ext: 9.5, pitch: 0.75, yaw: -Math.PI / 4 }),
      });
      switch (v.k) {
        // The three grounders down the third-base line share one look: slow motion, a ring on the bag,
        // and a view straight down the line like the plate umpire's, so you have to watch where the ball is
        // when it reaches the bag (or where it stops before it)
        case 'rollFoul': {
          // lands fair in front of third, spins foul before the bag and stops
          const a = L(40, -2.5), b = L(52, 3), c2 = L(54, 6);
          tl.ground(tc, T(1.0), { x: 0, y: 2 }, a);
          tl.ground(T(1.0), T(1.9), a, b);
          tl.ground(T(1.9), T(2.5), b, c2);
          tl.move('3B', tc, T(2.6), B3.x - 4, B3.y + 4, 'ready');
          tl.rest(T(2.5), T(9), { ...c2, z: 0.12 });
          return { pause: T(2.7), ...lineLook(T(2.5), 'STOPPED!') };
        }
        case 'overBag': {
          const a = L(48, -1.0), b = L(60.5, -0.2), c2 = L(78, 9);
          tl.ground(tc, T(1.0), { x: 0, y: 2 }, a);
          tl.ground(T(1.0), T(1.3), a, b);
          tl.ground(T(1.3), T(2.3), b, c2);
          tl.move('3B', tc, T(0.6), -44, 50, 'ready');
          tl.move('LF', tc, T(2.8), c2.x - 2, c2.y + 2, 'ready');
          return { pause: T(1.9), ...lineLook(T(1.3), 'AT THE BAG!') };
        }
        case 'flyBounce': {
          // the same kind of look down the first-base line, and a mark in the grass where it first lands
          const a = R(115, -2), b = R(135, 14);
          tl.fly(tc, T(2.0), { x: 0, y: 1.5, z: 3 }, { ...a, z: 0.2 }, 30);
          tl.ground(T(2.0), T(3.0), a, b);
          tl.at(T(2.0), () => { audio.thud(); if (field.puff) field.puff(a.x, a.y, 0.5); });
          tl.move('RF', tc, T(3.0), b.x - 3, b.y + 3, 'ready');
          tl.move('1B', tc, T(1.2), 54, 60, 'stand');
          return {
            pause: T(2.6),
            ...moment(T(2.0), 'LANDS!', 0.5, 0.35),
            replay: tc - 0.2,
            init: (s) => { field = s.field; },
            scuffs: (t) => (t >= T(2.0) ? [{ x: a.x, y: a.y, r: 0.55, sx: 0.8, sy: 1.6, a: 0.9, rot: -Math.PI / 4 }] : []),
            markers: (t) => (t > T(1.4) ? [ballRing(tl)] : []),
            cam: (t) => (t < T(0.8) ? null : { ...R(116, 3), ext: 11, pitch: 0.7, yaw: Math.PI / 4 }),
          };
        }
        case 'touchedFoul': {
          // slow roller up the first-base line, pitcher touches it while the ball is in foul ground
          // (well over the chalk, and the glove covers it right where it lies, so it's plainly foul)
          const a = R(26, 2.6);
          const feet = { x: a.x - 1.4 * Math.SQRT1_2, y: a.y + 1.4 * Math.SQRT1_2 }; // fielding it from the fair side
          tl.ground(tc, T(1.6), { x: 0.6, y: 1.2 }, a);
          tl.at(tc + 0.05, () => { tl.actors.P.faceAt = a; });
          tl.move('P', tc, T(1.5), feet.x, feet.y, 'field', 'run');
          tl.rest(T(1.6), T(6), { ...a, z: 0.12 });
          tl.at(T(1.6), () => audio.pop());
          return {
            pause: T(1.8),
            replay: tc + 0.1,
            slow: [[T(1.3), T(1.75)]],
            cam: (t) => (t < T(0.5) ? { x: 18, y: 20, ext: 22 } : { x: a.x - 1.2, y: a.y + 1.2, ext: 7.5, pitch: 1.0 }),
          };
        }
        default: {
          // ball hits the third-base bag (a puff of chalk) and bounds foul
          const a = L(56, -0.3), b = L(60, -0.1), c2 = L(72, 12);
          tl.ground(tc, T(0.85), { x: 0, y: 2 }, a);
          tl.ground(T(0.85), T(0.95), a, b);
          tl.at(T(0.95), () => { audio.tick(); if (field.puff) field.puff(b.x, b.y, 0.4); });
          tl.ground(T(0.95), T(1.9), b, c2);
          tl.move('3B', tc, T(0.8), -46, 54, 'ready');
          return { pause: T(1.6), ...lineLook(T(0.95), 'AT THE BAG!') };
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
      let field = {};
      if (v.k === 'fence') {
        // catches it on the warning track, crashes into the wall, and it pops out onto the dirt
        const spot = { x: 10, y: 194 }, wall = { x: 10.5, y: 198.4 }, drop = { x: 7, y: 190.5 };
        tl.fly(tc, tc + 3.0, { x: 0, y: 1.5, z: 3 }, { ...spot, z: 6 }, 70);
        tl.move('CF', tc, tc + 2.9, spot.x, spot.y - 0.5, 'catchHigh');
        tl.move('CF', tc + 3.0, tc + 3.3, wall.x, wall.y - 1.2, 'catchHigh');
        tl.hold(tc + 3.0, tc + 3.35, 'CF', 6);
        tl.at(tc + 3.0, () => audio.pop());
        tl.at(tc + 3.3, () => { audio.thud(); });
        tl.fly(tc + 3.35, tc + 3.95, { x: wall.x - 0.3, y: wall.y - 1.6, z: 5 }, { ...drop, z: 0.1 }, 2.5);
        tl.at(tc + 3.95, () => { audio.thud(); if (field.puff) field.puff(drop.x, drop.y, 0.5); });
        tl.ground(tc + 3.95, tc + 4.5, drop, { x: drop.x - 1.5, y: drop.y - 2.5 });
        tl.pose('CF', tc + 3.3, 'fall', { dur: 0.32 });
        // close, low and slow from the side: the catch, the crash, and the ball dropping out onto the track
        return {
          pause: tc + 4.5,
          ...moment(tc + 3.3, 'WALL!', 0.6, 0.75, 0.8), // (low: a side-on view has the players right where the callout usually goes)
          replay: tc + 1.4,
          init: (s) => { field = s.field; },
          scuffs: (t) => (t >= tc + 3.95 ? [{ x: drop.x, y: drop.y, r: 0.5, sx: 0.8, sy: 1.5, a: 0.9 }] : []),
          markers: (t) => (t >= tc + 3.35 ? [ballRing(tl)] : []),
          cam: (t) => (t < tc + 1.6 ? null : { x: 8.5, y: 194.5, ext: 10, pitch: 0.35, yaw: Math.PI / 2 }),
        };
      }
      if (v.k === 'carom') {
        // it glances off the left fielder's glove and the diving center fielder grabs it before it lands
        const spot = { x: -40, y: 165 };
        tl.fly(tc, tc + 3.0, { x: 0, y: 1.5, z: 3 }, { ...spot, z: 4 }, 60);
        tl.move('LF', tc, tc + 2.9, spot.x - 1, spot.y, 'catchHigh');
        tl.at(tc + 3.0, () => audio.tick());
        tl.pose('LF', tc + 3.15, 'ready'); // empty-handed: it got away from him
        tl.fly(tc + 3.0, tc + 3.7, { ...spot, z: 4 }, { x: spot.x + 7, y: spot.y + 2, z: 2.2 }, 4);
        tl.move('CF', tc, tc + 3.6, spot.x + 7, spot.y + 2.3, 'dive');
        tl.hold(tc + 3.7, tc + 6, 'CF', 1);
        tl.at(tc + 3.7, () => audio.pop());
        // close, low and slow from behind: off one glove, into the other, with daylight under the ball
        return {
          pause: tc + 4.2,
          ...moment(tc + 3.0, 'OFF HIS GLOVE!', 0.5, 0.95, 0.8),
          replay: tc + 1.4,
          cam: (t) => (t < tc + 1.6 ? null : { x: spot.x + 3, y: spot.y + 1, ext: 9, pitch: 0.3, yaw: 0 }),
        };
      }
      const spot = { x: 60, y: 120 };
      // trap: the ball lands a step short of the glove, kicks up turf, and short-hops in
      const bounce = { x: spot.x - 0.65, y: spot.y - 1.3 };
      if (v.k === 'trap') {
        tl.fly(tc, tc + 1.72, { x: 0, y: 1.5, z: 3 }, { ...bounce, z: 0.1 }, 20);
        tl.fly(tc + 1.72, tc + 1.9, { ...bounce, z: 0.1 }, { ...spot, z: 0.35 }, 0.6);
        tl.at(tc + 1.72, () => { audio.thud(); if (field.puff) field.puff(bounce.x, bounce.y, 0.55); });
      } else tl.fly(tc, tc + 1.8, { x: 0, y: 1.5, z: 3 }, { ...spot, z: 0.6 }, 20);
      tl.move('RF', tc, tc + 1.5, spot.x + 3, spot.y + 2, 'run');
      tl.move('RF', tc + 1.5, tc + 1.85, spot.x + 1.5, spot.y + 0.5, 'dive', 'dive');
      tl.hold(tc + 1.9, tc + 6, 'RF', 0.8);
      tl.at(tc + 1.9, () => audio.pop());
      tl.pose('RF', tc + 3.4, 'catchHigh'); // stays down through the freeze, then pops up showing it
      // the same close, low, side-on slow-motion look for the trap and the clean catch, so the camera
      // doesn't give it away: you have to watch whether the ball hits the turf
      return {
        pause: tc + 3.0,
        slow: [[tc + 1.45, tc + 2.05]],
        init: (s) => { field = s.field; },
        scuffs: (t) => (v.k === 'trap' && t >= tc + 1.72 ? [{ x: bounce.x, y: bounce.y, r: 0.55, sx: 0.8, sy: 1.6, a: 0.9 }] : []),
        cam: (t) => (t < tc + 0.6 ? null : { x: spot.x - 0.3, y: spot.y - 0.65, ext: 5.5, pitch: 0.3, yaw: 2.03 }),
      };
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
      // At the catch: the camera sits tight on the runner's foot at third (in slow motion) while a CATCH CAM
      // box shows the ball hitting the glove, so you see both at the same instant
      const watch = (t) => t > tCatch - 1.7 && t < tCatch + 0.75;
      const look = {
        slow: [[tCatch - 0.9, tCatch + 0.35]],
        replay: tCatch - 2.2,
        cam: (t) => (t < tCatch - 1.7 ? null : watch(t) ? { x: B3.x + 4.5, y: B3.y - 3.5, ext: 13, pitch: 0.5, yaw: 0.9 } : { x: -14, y: 40, ext: 56 }),
        inset: (t) => (watch(t) ? {
          eye: { x: spot.x - 9, y: spot.y - 15, z: 6.5 }, target: { x: spot.x, y: spot.y, z: 4.6 }, fov: 0.55,
          label: 'CATCH CAM', flash: t >= tCatch ? 'CAUGHT!' : null, corner: 'bl', // he runs off to the right
        } : null),
      };
      if (!v.early) return { pause: pause1, ...look };
      // Step 2: the defense appeals at third
      tl.hold(tThrowIn + 1.6, pause1 + 0.6, 'SS', 3.2);
      const t3 = throwFrom(tl, 'SS', pause1 + 0.6, { x: B3.x + 1, y: B3.y + 1, z: 3 }, 55);
      tl.move('3B', tc, pause1, B3.x + 1.6, B3.y + 1.8, 'ready');
      tl.hold(t3, t3 + 5, '3B', 3);
      tl.move('3B', t3 + 0.1, t3 + 0.5, B3.x + 0.4, B3.y + 0.2, 'ready');
      tl.pose('3B', t3 + 0.55, 'pointL');
      return { pauses: [pause1, t3 + 0.9], ...look };
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
      fieldAt(tl, 'RF', tc, tc + 3.2, 86, 175);
      tl.hold(tc + 3.2, tc + 3.5, 'RF', 4);
      const tIn = throwFrom(tl, 'RF', tc + 3.5, { x: 14, y: 78, z: 4 }, 72);
      tl.move('2B', tc, tc + 2.5, 15, 78, 'ready');
      // runner from first rounds second: a miss cuts WAY inside (5 ft short of the bag), a touch steps right on it
      const path = v.missed
        ? [{ x: 9, y: 76.5 }, { x: 3.4, y: 81.1 }, { x: -5, y: 78.5 }, { x: B3.x + 0.4, y: B3.y + 0.2 }]
        : [{ x: 6, y: 79 }, { x: 0.15, y: 84.6 }, { x: -6, y: 80 }, { x: B3.x + 0.4, y: B3.y + 0.2 }];
      tl.runPath('R1', tc + 0.05, path, 16.5, 'stand');
      const tSafe = lastKey(tl, 'R1').t;
      const tBag = tl.actors.R1.keys.find((k) => k.x === path[1].x && k.y === path[1].y).t; // passing second
      batterRuns(tl, tc + 0.3, 16);
      const p1 = Math.max(tSafe, tIn) + 0.3;
      tl.hold(tIn, p1 + 0.5, '2B', 3);
      tl.move('2B', p1 + 0.3, p1 + 1.1, B2.x + 0.4, B2.y - 0.3, 'ready');
      tl.pose('2B', p1 + 1.2, 'pointL');
      tl.hold(p1 + 0.5, p1 + 6, '2B', 3);
      let field = {};
      if (!v.missed) tl.at(tBag, () => { audio.tick(); if (field.puff) field.puff(B2.x, B2.y, 0.5); });
      // cleat marks in the dirt around second, one per footfall, left there for the rest of the play so you
      // can see exactly where he went
      const steps = [];
      for (let ts = tBag - 0.9; ts <= tBag + 0.95; ts += 0.15) {
        const p = posAt(tl, 'R1', ts), q = posAt(tl, 'R1', ts + 0.05);
        const rot = Math.atan2(q.y - p.y, q.x - p.x) - Math.PI / 2;
        const side = steps.length % 2 ? 0.36 : -0.36;
        const onBag = Math.abs(p.x - B2.x) < 0.75 && Math.abs(p.y - B2.y) < 0.75;
        if (!onBag) steps.push({ t: ts, x: p.x + Math.cos(rot) * side, y: p.y + Math.sin(rot) * side, r: 0.46, sx: 0.7, sy: 1.35, a: 1, rot });
        else steps.push({ t: ts, skip: true });
      }
      const near = (t) => t > tBag - 1.3 && t < tBag + 0.8;
      return {
        pauses: [p1, p1 + 1.6],
        replay: tBag - 2.2, // both replays go back to him rounding second
        slow: [[tBag - 0.5, tBag + 0.45]],
        init: (s) => { field = s.field; },
        scuffs: (t) => steps.filter((m) => !m.skip && m.t <= t),
        markers: (t) => (t > tBag - 1.6 && t < tBag + 0.6 ? [{ x: B2.x, y: B2.y, r: 2.2, color: '#ffd34d', pulse: true, label: 'WATCH THE BAG', labelZ: 4.2, labelS: 4.2 }] : []),
        // a close, high look down at second as he rounds it, then back out for the throw and the slide
        cam: (t) => (t < tc + 1.2 ? null : near(t) ? { x: B2.x - 0.5, y: B2.y - 1.5, ext: 10, pitch: 1.05 } : { x: -10, y: 70, ext: 50 }),
      };
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
        fieldAt(tl, '2B', tc, tc + 1.3, 22, 61);
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
        fieldAt(tl, 'SS', tc, tc + 0.9, -20, 65);
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
      fieldAt(tl, 'RF', tc, tc + 1.4, rf.x, rf.y);
      tl.hold(tc + 1.4, tc + 1.55, 'RF', 3);
      tl.rest(tc + 1.55, tThrow - 0.6, { x: rf.x + 3, y: rf.y + 4, z: 0.12 });
      tl.move('RF', tc + 1.6, tThrow - 0.65, rf.x + 2.5, rf.y + 3.5, 'field');
      lastKey(tl, 'RF').dur = 0.4;
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
      // tight on the tag at third, with a HOME CAM box on the runner crossing the plate: which came first?
      const t0 = Math.min(tScore, tTag), t1 = Math.max(tScore, tTag);
      return {
        pause: t1 + 0.5,
        slow: [[t0 - 0.4, t1 + 0.25]],
        replay: tThrow - 0.8,
        words: [{ t: tTag, text: 'TAG!' }],
        cam: (t) => (t < tThrow ? null : { x: B3.x + 3, y: B3.y, ext: 12, pitch: 0.55, yaw: 0.9 }),
        inset: (t) => (t > t0 - 1.4 && t < t1 + 0.8 ? {
          eye: { x: 12, y: -11, z: 6 }, target: { x: -1, y: 2, z: 2.4 }, fov: 0.62,
          label: 'HOME CAM', flash: t >= tScore ? 'RUN SCORES!' : null,
        } : null),
      };
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

  // ===== SOFTBALL: LEAVING EARLY (Bootcamp: softball-vs-baseball) =====
  // Majors and up may leave on the release; Minors and below only when the pitch reaches the batter.
  // Leaving too soon is an immediate dead-ball out (not baseball's delayed enforcement).
  {
    id: 'sb-early', card: 'softball-early', title: 'Leaving Too Soon?', weight: 2, sport: 'softball',
    variant(div) {
      const minors = div.id === 'AA' || div.id === 'AAA';
      return { minors, k: pick(minors ? ['early', 'atRelease', 'atBatter'] : ['early', 'atRelease', 'atRelease']) };
    },
    setup() { return { runners: [1], outs: 1, text: 'runner on 1st · 1 out' }; },
    build(tl, v) {
      tl.pose('P', 0.4, 'pitch', { dur: 1.0 });
      tl.hold(0, 1.2, 'P', holdZ());
      tl.fly(1.2, 1.75, releasePt(), { x: 0, y: -1.5, z: 2.5 }, 0.6);
      tl.at(1.75, () => audio.pop());
      tl.hold(1.75, 9, 'C', 2.4);
      const leave = { early: 0.85, atRelease: 1.22, atBatter: 1.72 }[v.k];
      tl.runTo('R1', leave, 26, 58, 15, 'stand');
      // tight on the runner's foot at first, with a PITCH CAM box on the pitcher: when did the foot come off?
      const ry = sport.rubber;
      return {
        pause: 2.3,
        slow: [[0.7, 1.85]],
        replay: 0.2,
        cam: () => ({ x: B1.x - 1.5, y: B1.y + 2.5, ext: 11, pitch: 0.6 }),
        inset: (t) => (t > 0.3 && t < 2.2 ? {
          eye: { x: 15, y: ry - 15, z: 5 }, target: { x: 0, y: ry - 2.5, z: 2.8 }, fov: 0.5,
          label: 'PITCH CAM', flash: t >= 1.75 ? 'AT THE BATTER!' : t >= 1.2 ? 'RELEASE!' : null,
        } : null),
      };
    },
    steps(v, div) {
      const out = v.k === 'early' || (v.minors && v.k === 'atRelease');
      const when = { early: 'He left before the pitcher let go of the ball', atRelease: 'He left right as the ball was released', atBatter: 'He left as the pitch reached the batter' }[v.k];
      const rule = v.minors
        ? 'In softball **Minors**, runners may leave only when the pitch **reaches the batter**.'
        : 'In softball **Majors and up**, runners may leave when the pitcher **releases** the ball.';
      return [{
        q: 'DID THE RUNNER LEAVE TOO SOON?',
        sub: when,
        options: [
          { btn: 'A', id: 'out', label: "TIME! RUNNER'S OUT", sub: 'Left early' },
          { btn: 'B', id: 'ok', label: 'LEGAL — PLAY ON', sub: '' },
        ],
        answer: out ? 'out' : 'ok',
        explain: `${rule} ${out
          ? 'He went too soon. In softball that\'s an **immediate dead-ball out**: call time, he\'s out, and the pitch is a no-pitch.'
          : 'He waited long enough, so it\'s **legal**. Play on.'}`,
      }];
    },
  },

  // ===== SOFTBALL: LOOK-BACK =====
  {
    id: 'sb-lookback', card: 'softball-lookback', title: 'The Circle Rule', weight: 2, sport: 'softball',
    variant() { return { dance: chance(0.6) }; },
    setup() { return { runners: [], outs: 1, text: 'batter-runner rounding first' }; },
    build(tl, v) {
      const tc = pitchHit(tl);
      tl.ground(tc, tc + 1.3, { x: 0, y: 2 }, { x: 40, y: 110 });
      fieldAt(tl, 'RF', tc, tc + 1.3, 41, 108);
      tl.hold(tc + 1.3, tc + 1.6, 'RF', 4);
      const tIn = throwFrom(tl, 'RF', tc + 1.6, { x: 0.5, y: POS.P.y, z: 4 }, 70);
      tl.hold(tIn, tIn + 9, 'P', 4);
      tl.pose('BAT', tc + 0.05, 'stand');
      tl.runTo('BAT', tc + 0.15, B1.x + 2, B1.y + 4, 15, 'run');
      tl.runTo('BAT', lastKey(tl, 'BAT').t, 34, 54, 12, 'stand');
      const t0 = Math.max(tIn, lastKey(tl, 'BAT').t) + 0.3;
      // both versions: a callout and a lit-up circle the moment the pitcher has the ball in it, the camera
      // close on the runner (cleat marks show every change of direction), and a CIRCLE CAM box on the pitcher
      const look = (end) => ({
        pause: end,
        words: [{ t: tIn, text: 'BALL IN THE CIRCLE!' }],
        replay: tIn - 1.2,
        scuffs: footprints(tl, 'BAT', tIn - 0.6, end, 0.15),
        markers: (t) => (t >= tIn ? [{ x: 0, y: sport.rubber, r: CIRCLE_R, color: '#ffd34d', pulse: true }] : []),
        cam: (t) => (t < tIn - 1 ? null : { x: 37, y: 50, ext: 14, pitch: 0.8 }),
        inset: (t) => (t > tIn - 0.8 ? {
          eye: { x: 12, y: sport.rubber - 16, z: 7 }, target: { x: 0, y: sport.rubber + 1, z: 2.5 }, fov: 0.55,
          label: 'CIRCLE CAM', flash: t >= tIn ? 'BALL IN!' : null, corner: 'tl',
        } : null),
      });
      if (v.dance) {
        let t = tl.runTo('BAT', t0, 37, 50, 6, 'stand');
        t = tl.runTo('BAT', t + 0.2, 32, 56, 6, 'stand');
        t = tl.runTo('BAT', t + 0.2, 36, 51, 6, 'stand');
        return look(t + 0.6);
      }
      tl.runTo('BAT', t0 + 0.1, B1.x - 0.3, B1.y - 0.2, 12, 'stand');
      return look(lastKey(tl, 'BAT').t + 0.5);
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
          ? 'The **circle rule** (look-back): with the pitcher holding the ball in the circle and not making a play, a runner off base must **immediately** go or come back (about 3 seconds). He **stopped and faked back and forth** — **dead ball, runner out**.'
          : 'He went **straight back to first** right away. That\'s exactly what the look-back rule wants — **legal**.',
      }];
    },
  },
];

export function situationsFor(div) {
  return SITUATIONS.filter((s) => (!s.divs || s.divs.includes(div.id)) && forSport(s));
}
