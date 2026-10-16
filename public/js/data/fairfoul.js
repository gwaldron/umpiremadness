// More fair/foul plays: 14 rule families, each with a random line (first or third), distance and fielder,
// so the Fair or Foul drill rarely shows the same play twice. Every one ends on a close, slow-motion look
// straight down the foul line at the moment that decides it: where the ball stopped, where it was touched,
// where it passed the bag, or where it first landed.
import { audio } from '../audio.js';
import { pick, rand, clamp, lerp } from '../util.js';
import { BASES } from '../render/field.js';
import { releasePt, holdZ } from '../sport.js';

const FAMILIES = {
  // before the base: judged where it stops or is first touched
  stopFair: true, stopFoul: false, backFair: true, touchedFair: true, touchedFoul: false,
  popTouchFair: true, popTouchFoul: false, // a pop-up touched in the air before the base
  // at the base: hits the bag, or judged as it passes the bag
  hitsBag: true, overBagFair: true, pastBagFoul: false,
  // past the base in the air: judged where it first lands, or where the ball hits the glove
  flyLine: true, flyFoul: false, flyFairBounceFoul: true, flyOverBag: false, airTouchFoul: false, airTouchFair: true,
};
export const FAIRFOUL_KINDS = Object.keys(FAMILIES);

function lastKey(tl, id) { const k = tl.actors[id].keys; return k[k.length - 1]; }
function pitchHit(tl, t0 = 0.4) {
  tl.pose('P', t0, 'pitch');
  lastKey(tl, 'P').dur = 1.0;
  tl.hold(0, t0 + 0.8, 'P', holdZ());
  const tc = t0 + 1.4;
  tl.fly(t0 + 0.8, tc, releasePt(), { x: 0, y: 1.2, z: 2.6 }, 0.3);
  tl.pose('P', t0 + 1.1, 'ready');
  if (tl.actors.BAT) {
    tl.actors.BAT.swingAt = tc - 0.17;
    tl.at(tc, () => audio.crack());
  }
  return tc;
}

export const FAIRFOUL_PLUS = {
  id: 'fairfoul-plus', card: 'fair-foul', title: 'Fair or Foul?', weight: 3,
  variant() { return { k: pick(FAIRFOUL_KINDS), side: pick(['1B', '3B']) }; },
  // no base umpire: fair/foul is the plate umpire's call, and at A he'd stand right in the down-the-line shot
  setup() { return { runners: [], outs: pick([0, 1, 2]), text: 'bases empty', bu: false }; },
  build(tl, v) {
    const tc = pitchHit(tl);
    const s = v.side === '3B' ? -1 : 1;
    // a spot d feet out along the line, off feet to the side of it (off > 0 = foul side)
    const P = (d, off) => ({ x: s * (d + off) * Math.SQRT1_2, y: (d - off) * Math.SQRT1_2 });
    const IF = s > 0 ? '1B' : '3B', OF = s > 0 ? 'RF' : 'LF';
    const bag = s > 0 ? BASES.first : BASES.third;
    tl.pose('BAT', tc + 0.05, 'stand');
    tl.runTo('BAT', tc + 0.2, BASES.first.x - 0.3, BASES.first.y - 0.2, 15, 'stand');
    let field = {};
    const puff = (p, k = 0.5) => { if (field.puff) field.puff(p.x, p.y, k); };
    let t = tc;
    // a grounder rolling through points, slowing down each leg
    const roll = (pts, v0, slow = 0.7) => {
      let prev = pts[0], speed = v0;
      for (const q of pts.slice(1)) {
        const t1 = t + Math.hypot(q.x - prev.x, q.y - prev.y) / speed;
        tl.ground(t, t1, prev, q);
        t = t1; prev = q; speed *= slow;
      }
      return prev;
    };
    const fly = (from, to, apex, speed = 72) => {
      const t1 = t + Math.max(0.35, Math.hypot(to.x - from.x, to.y - from.y) / speed);
      tl.fly(t, t1, from, to, apex);
      t = t1;
      return t1;
    };
    const home = { x: 0.3 * s, y: 2.2 };
    const bat = { x: 0, y: 1.5, z: 3 };
    const fielder = (id, x, y, tArrive, pose = 'ready') => tl.move(id, tc + 0.1, Math.max(tc + 0.5, tArrive), x, y, pose);
    let dec, air = false, mark = null, touched = false; // the deciding moment { t, p }, a ball mark where a fly first landed
    const k = v.k;

    if (k === 'stopFair' || k === 'stopFoul' || k === 'backFair') {
      const d = rand(26, 46);
      const off = k === 'stopFair' ? rand(-0.45, 0.08) : k === 'stopFoul' ? rand(0.7, 2.1) : rand(-0.95, -0.45);
      const path = k === 'backFair'
        ? [home, P(d * 0.45, -2.2), P(d - 7, 1.7), P(d - 2.5, 0.8), P(d, off)]
        : k === 'stopFoul'
          ? [home, P(d * 0.5, -2.6), P(d - 5, -0.7), P(d, off)]
          : [home, P(d * 0.5, -3), P(d - 4, -1.3), P(d, off)];
      const end = roll(path, 46, k === 'backFair' ? 0.62 : 0.55);
      tl.rest(t, t + 9, { ...end, z: 0.12 });
      dec = { t, p: end };
      // the fielder comes in and lets it roll, hoping it goes foul
      const who = d < 32 ? pick(['C', 'P', IF]) : pick(['P', IF]);
      const w = P(d + 2.5, -3.2);
      fielder(who, w.x, w.y, t + 0.5);
    } else if (k === 'touchedFair' || k === 'touchedFoul') {
      const d = rand(22, 44);
      const off = k === 'touchedFair' ? rand(-0.9, -0.4) : rand(0.7, 1.6);
      const tp = P(d, off);
      roll([home, P(d * 0.5, off * 0.3 - 0.6), tp], 40, 0.7);
      tl.rest(t, t + 9, { ...tp, z: 0.12 });
      dec = { t, p: tp };
      // fielding it from the other side of the line: feet one way, ball the other
      const feet = P(d, k === 'touchedFair' ? off + 1.45 : off - 1.6);
      const who = d < 30 ? pick(['C', 'P']) : pick(['P', IF]);
      tl.at(tc + 0.05, () => { tl.actors[who].faceAt = tp; });
      tl.move(who, tc + 0.1, t - 0.1, feet.x, feet.y, 'field', 'run');
      tl.at(t, () => audio.pop());
      touched = true;
    } else if (k === 'hitsBag' || k === 'overBagFair' || k === 'pastBagFoul') {
      if (k === 'hitsBag') {
        roll([home, P(32, -1.6), P(52, -0.9), bag], 70, 0.85);
        dec = { t, p: bag };
        tl.at(t, () => { audio.tick(); puff(bag, 0.45); });
        roll([bag, P(70, 7), P(78, 12)], 40, 0.6);
      } else if (k === 'overBagFair') {
        roll([home, P(30, -2), P(50, -1.4)], 72, 0.85);
        const a = P(50, -1.4), b = P(66, 0.4);
        dec = { t: t + ((60 - 50) / 16) * Math.max(0.35, 16 / 60), p: P(60, -0.3) };
        fly({ ...a, z: 0.12 }, { ...b, z: 0.12 }, 2.4, 60);
        roll([b, P(76, 5), P(82, 9)], 40, 0.6);
      } else {
        roll([home, P(26, -2.2), P(40, -1.0), P(52, 0.25)], 72, 0.9);
        const a = P(52, 0.25), b = P(68, 1.8);
        const t0 = t;
        roll([a, b], 52, 1);
        dec = { t: lerp(t0, t, 0.5), p: P(60, 1.0) };
        roll([b, P(80, 5)], 40, 0.6);
      }
      const w = P(78, -5);
      fielder(OF, w.x, w.y, dec.t + 1.2);
      const g = P(54, -6);
      tl.move(IF, tc + 0.1, tc + 0.9, g.x, g.y, 'ready');
    } else if (k === 'flyLine' || k === 'flyFoul' || k === 'flyFairBounceFoul') {
      const d = rand(95, 150);
      const off = k === 'flyLine' ? rand(-0.12, 0.12) : k === 'flyFoul' ? rand(0.45, 1.8) : rand(-2.6, -0.6);
      const L = P(d, off);
      fly(bat, { ...L, z: 0.12 }, clamp(d * 0.25, 18, 40), 78);
      dec = { t, p: L };
      mark = L;
      tl.at(t, () => { audio.thud(); puff(L, 0.55); });
      const bounce = k === 'flyFoul' ? P(d + 12, -5) : P(d + 14, off > 0.2 ? 6 : 7);
      fly({ ...L, z: 0.12 }, { ...bounce, z: 0.12 }, 3.5, 45);
      roll([bounce, P(d + 22, k === 'flyFoul' ? -8 : 11)], 25, 0.6);
      const w = P(d - 6, -6);
      fielder(OF, w.x, w.y, dec.t + 0.5);
    } else if (k === 'flyOverBag') {
      // a slicing fly: over the bag in the air, then it curls foul and lands beyond it
      const over = { ...P(60, -0.5), z: 15 };
      fly(bat, over, 9, 64);
      const L = P(rand(76, 88), rand(2.4, 4.2));
      fly(over, { ...L, z: 0.12 }, 1.5, 34);
      dec = { t, p: L };
      mark = L;
      tl.at(t, () => { audio.thud(); puff(L, 0.55); });
      roll([L, P(98, 8)], 30, 0.6);
      const w = P(92, -4);
      fielder(OF, w.x, w.y, dec.t + 0.7);
    } else {
      // a fielder reaches across the line and gets a glove on it in the air, but can't hold it: the GLOVE
      // is on one side of the line and both feet are on the other. Infield pop-ups (before the bag) and
      // outfield flies (past it) are both judged where the ball is when it's first touched.
      air = true;
      const pop = k === 'popTouchFair' || k === 'popTouchFoul';
      const gloveFoul = k === 'airTouchFoul' || k === 'popTouchFoul';
      const d = pop ? rand(18, 46) : rand(100, 140);
      const off = gloveFoul ? rand(0.8, 1.0) : -rand(0.8, 1.0); // glove well over the line, feet still across it
      const who = pop ? (d < 28 ? pick(['C', IF]) : pick(['P', IF])) : OF;
      const a = tl.actors[who];
      // the reach pose puts the glove 2.31 ft out the way he's turned (and 0.33 ft to his left) at 5.11 ft
      const S = (a.height || 5) / 5;
      const nx = s * Math.SQRT1_2, ny = -Math.SQRT1_2; // toward foul ground
      const fx = gloveFoul ? nx : -nx, fy = gloveFoul ? ny : -ny; // he reaches over the line
      const lx = -fy, ly = fx;
      const A = { ...P(d, off), z: 5.11 * S };
      const pos = { x: A.x - fx * 2.31 * S - lx * 0.33 * S, y: A.y - fy * 2.31 * S - ly * 0.33 * S };
      fly(bat, A, pop ? rand(26, 36) : clamp(d * 0.24, 18, 36), pop ? d / rand(2.4, 2.9) : 78);
      dec = { t, p: A };
      tl.move(who, tc + 0.1, t - 0.45, pos.x, pos.y, 'ready');
      tl.at(t - 0.42, () => { a.heading = Math.atan2(fy, fx); });
      tl.pose(who, t - 0.36, 'reachUp');
      tl.at(t, () => audio.tick());
      touched = true;
      const G = P(d + (pop ? 1.5 : 3), gloveFoul ? -3.2 : 3.6); // it pops off the glove and drops across the line
      fly(A, { ...G, z: 0.12 }, 1.2, 13);
      tl.at(t, () => { audio.thud(); puff(G, 0.4); });
      roll([G, P(d + (pop ? 3 : 6), gloveFoul ? -4.6 : 5.2)], 9, 0.6);
    }

    const tDec = dec.t;
    const line = s > 0 ? Math.PI / 4 : -Math.PI / 4; // look straight down the foul line, like the umpire does
    return {
      pause: tDec + 1.0,
      slow: [[tDec - 0.55, tDec + 0.3]],
      words: touched ? [{ t: tDec, text: 'TOUCHED!' }] : [],
      replay: Math.max(tc - 0.2, tDec - 2.4),
      init: (sess) => { field = sess.field; },
      scuffs: (tt) => (mark && tt >= tDec ? [{ x: mark.x, y: mark.y, r: 0.4, sx: 0.8, sy: 1.3, a: 0.85 }] : []),
      cam: (tt) => (tt < Math.max(tc + 0.3, tDec - 1.4) ? null
        : { x: dec.p.x, y: dec.p.y, z: air ? dec.p.z * 0.75 : 0, ext: air ? 5.2 : Math.hypot(dec.p.x, dec.p.y) > 75 ? 7 : 4.6, pitch: air ? 0.32 : 0.5, yaw: line }),
    };
  },
  steps(v) {
    const fair = FAMILIES[v.k];
    const base = v.side === '3B' ? 'third base' : 'first base';
    const ex = {
      stopFair: `It never reached ${base}, and it **stopped on or inside the line**. Before the base, a grounder is judged where it **stops** (or is first touched), and the line is **fair**. **Fair ball!**`,
      stopFoul: `It rolled across the line and **stopped in foul territory** before reaching ${base}, and nobody touched it. Judged where it stops: **foul ball**.`,
      backFair: `It went foul, then **spun back and stopped fair** before ${base}. Only where it **stops** (or is first touched) counts: **fair ball**.`,
      touchedFair: `Before the base, it's judged where it's **first touched**, by the **ball's** position, not the fielder's feet. The fielder stood in foul ground, but the ball was **over fair territory**: **fair ball**.`,
      touchedFoul: `Before the base, it's judged where it's **first touched**, by the **ball's** position, not the fielder's feet. The fielder stood in fair territory, but the ball was **over foul ground**: **foul ball**.`,
      hitsBag: `It **hit the bag**. The bases are in **fair territory**, so it's a **fair ball**, no matter where it went next.`,
      overBagFair: `It bounded **over the bag**, over fair territory, then rolled foul. A ball that passes ${base} **on or over fair territory** is **fair**. What it does after that doesn't matter.`,
      pastBagFoul: `It came down fair in front of the bag, but it went **past ${base} over foul ground**. A grounder is judged as it **passes the base**: **foul ball**.`,
      flyLine: `Past the base, a fly ball is judged where it **first lands**. It landed **on the line**, and the line is **fair**. Bouncing foul after that doesn't matter: **fair ball**.`,
      flyFoul: `It **first landed foul** past ${base}, then bounced into fair territory. Past the base, it's judged where it **first lands**: **foul ball**.`,
      flyFairBounceFoul: `Past the base, a fly ball is judged where it **first lands**. It landed **fair**, so bouncing foul afterward doesn't matter: **fair ball**.`,
      flyOverBag: `It was over the bag **in the air**, but it **first landed in foul territory** past ${base}. A fly ball isn't judged as it passes the base, it's judged where it **first lands**: **foul ball**.`,
      airTouchFoul: `It's judged where the ball **hits the glove**, not where the fielder is standing. He stood in fair territory, but his glove was **over foul ground** when it touched the ball. It dropping fair doesn't matter: **foul ball**.`,
      airTouchFair: `It's judged where the ball **hits the glove**, not where the fielder is standing. Both his feet were in foul ground, but his glove was **over fair territory** when it touched the ball. It dropping foul doesn't matter: **fair ball**.`,
      popTouchFoul: `A pop-up before ${base} is judged where it's **first touched**: where the ball **hits the glove**, not where the fielder stands. His feet were fair, but the glove was **over foul ground**: **foul ball**.`,
      popTouchFair: `A pop-up before ${base} is judged where it's **first touched**: where the ball **hits the glove**, not where the fielder stands. His feet were foul, but the glove was **over fair territory**: **fair ball**.`,
    }[v.k];
    return [{
      q: 'FAIR OR FOUL?',
      sub: "Plate umpire's call: make it!",
      options: [
        { btn: 'A', id: 'fair', label: 'FAIR', sub: 'Point to fair territory' },
        { btn: 'B', id: 'foul', label: 'FOUL BALL!', sub: 'Hands up' },
      ],
      answer: fair ? 'fair' : 'foul',
      say: fair ? null : 'Foul ball!',
      explain: ex,
    }];
  },
};
