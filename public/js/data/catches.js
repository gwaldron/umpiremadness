// More catch / no-catch plays: 10 rule families with a random fielder and spot, so the Catch or No Catch
// drill rarely repeats. Each one ends on a close, slow-motion look from the side at the glove, with a
// callout on the moment that matters (never the ruling). Rulings follow Umpire Bootcamp's catch lesson:
// secure possession in hand or glove before the ball touches the ground, and a voluntary release.
import { audio } from '../audio.js';
import { pick, rand } from '../util.js';
import { BASES } from '../render/field.js';
import { releasePt, holdZ } from '../sport.js';

const FAMILIES = {
  transferDrop: true, collisionDrop: false, bobbleCatch: true, bobbleDrop: false, brushGlove: false,
  shoestringCatch: true, shoestringTrap: false, foulPopCatch: true, foulPopDrop: false, deflectGround: false,
};
export const CATCH_KINDS = Object.keys(FAMILIES);

// Where the glove (and the throwing hand) sit in each pose, measured off the 3D rig for a 5-ft player:
// [forward, left, height] from the player's spot, facing the way he's turned
const GLOVE = { catchHigh: [0.45, 0.24, 5.8], field: [1.59, 0.18, 0.5], reachUp: [2.31, 0.33, 5.11] };
const THROW_HAND = [-0.34, -0.18, 4.01]; // early in the throw, ball in the bare hand

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

export const CATCH_PLUS = {
  id: 'catch-plus', card: 'catch', title: 'Catch or No Catch?', weight: 1,
  variant() { return { k: pick(CATCH_KINDS) }; },
  setup() { return { runners: [], outs: pick([0, 1]), text: 'bases empty' }; },
  build(tl, v) {
    const tc = pitchHit(tl);
    const k = v.k;
    tl.pose('BAT', tc + 0.05, 'stand');
    tl.runTo('BAT', tc + 0.2, BASES.first.x - 0.3, BASES.first.y - 0.2, 15, 'stand');
    let field = {};
    const puff = (p, s = 0.45) => { if (field.puff) field.puff(p.x, p.y, s); };
    const bat = { x: 0, y: 1.5, z: 3 };

    // who, where, and which way he faces (toward home, a little turned)
    const foul = k === 'foulPopCatch' || k === 'foulPopDrop';
    const shoe = k === 'shoestringCatch' || k === 'shoestringTrap';
    let who, spot;
    if (foul) {
      who = pick(['C', '1B', '3B']);
      spot = who === 'C' ? { x: pick([-1, 1]) * rand(8, 14), y: rand(-9, -6) } : who === '1B' ? { x: rand(52, 60), y: rand(30, 38) } : { x: -rand(52, 60), y: rand(30, 38) };
    } else {
      who = pick(['LF', 'CF', 'RF']);
      const base = { LF: { x: -62, y: 138 }, CF: { x: 0, y: 165 }, RF: { x: 62, y: 138 } }[who];
      spot = { x: base.x + rand(-10, 10), y: base.y + (shoe ? -rand(14, 22) : rand(-8, 8)) };
    }
    const a = tl.actors[who];
    const S = (a.height || 5) / 5;
    const hd = Math.atan2(-spot.y, -spot.x) + rand(-0.25, 0.25);
    const fx = Math.cos(hd), fy = Math.sin(hd), lx = -fy, ly = fx;
    const at = (o, p = spot) => ({ x: p.x + (fx * o[0] + lx * o[1]) * S, y: p.y + (fy * o[0] + ly * o[1]) * S, z: o[2] * S });
    const pose = k === 'brushGlove' ? 'reachUp' : shoe ? 'field' : 'catchHigh';
    const G = at(GLOVE[pose]); // the glove at the moment of truth
    const tB = tc + (foul ? rand(2.6, 3.0) : shoe ? rand(1.6, 1.9) : rand(2.8, 3.3)); // ball reaches the glove
    const apex = foul ? rand(30, 38) : shoe ? rand(9, 14) : rand(28, 40);
    // run in under it, turn to face home, glove up
    tl.move(who, tc + 0.1, tB - (shoe ? 0.3 : 0.6), spot.x, spot.y, 'ready');
    tl.at(tB - 0.65, () => { a.heading = hd; });
    tl.pose(who, tB - (pose === 'field' ? 0.22 : 0.33), pose, pose === 'field' ? { dur: 0.75 } : {});
    let words = [], moment = tB, mark = null, markT = 0, extra = null; // mark: where it hit the ground, at markT
    const ground = (o) => { const p = at([o[0], o[1], 0]); return { x: p.x, y: p.y, z: 0.12 }; };

    if (k === 'transferDrop') {
      // a clean catch... then it slips out as he reaches in to throw
      tl.fly(tc, tB, bat, G, apex);
      tl.at(tB, () => audio.pop());
      const tT = tB + 0.85;
      tl.hold(tB, tT + 0.12, who, G.z);
      tl.pose(who, tT, 'throw', { dur: 0.7 });
      const H = at(THROW_HAND), D = ground([0.6, -0.4]);
      tl.fly(tT + 0.12, tT + 0.55, H, D, 0.2);
      tl.at(tT + 0.55, () => { audio.thud(); puff(D, 0.35); });
      tl.pose(who, tT + 0.6, 'field', { dur: 0.75 });
      words = [{ t: tB, text: 'CAUGHT!' }, { t: tT + 0.15, text: 'DROPPED!' }];
      moment = tT;
    } else if (k === 'collisionDrop') {
      // two outfielders call for it; he gloves it as the other one runs into him, and it pops loose
      tl.fly(tc, tB, bat, G, apex);
      tl.at(tB, () => audio.pop());
      const mate = who === 'CF' ? pick(['LF', 'RF']) : 'CF';
      // he comes in from the deep side, so the camera (looking across) sees them side by side
      const crash = { x: spot.x - fx * 1.25 * S, y: spot.y - fy * 1.25 * S };
      tl.move(mate, tc + 0.1, tB + 0.12, crash.x, crash.y, 'run');
      tl.at(tB + 0.12, () => { audio.thud(); audio.ouch(); });
      tl.hold(tB, tB + 0.14, who, G.z);
      const D = ground([2.8, 0.5]); // knocked loose, out in front of him
      tl.fly(tB + 0.14, tB + 0.75, { ...G, z: G.z - 0.4 }, D, 2.2);
      tl.at(tB + 0.75, () => { audio.thud(); puff(D, 0.4); });
      tl.pose(who, tB + 0.13, 'fall', { dur: 0.32 });
      tl.pose(mate, tB + 0.14, 'fall', { dur: 0.32 });
      words = [{ t: tB + 0.12, text: 'CRASH!' }];
      extra = mate;
    } else if (k === 'bobbleCatch' || k === 'bobbleDrop' || k === 'foulPopCatch' || k === 'foulPopDrop') {
      tl.fly(tc, tB, bat, G, apex);
      tl.at(tB, () => audio.pop());
      const bobble = k !== 'foulPopCatch';
      if (!bobble) {
        tl.hold(tB, tB + 6, who, G.z);
        tl.pose(who, tB + 1.4, 'ready');
      } else if (k === 'bobbleCatch') {
        // it pops up out of the glove... and he grabs it again on the way down
        const up = { ...G, z: G.z - 1.1 };
        tl.fly(tB, tB + 0.62, G, up, 1.6);
        tl.pose(who, tB + 0.2, 'catchHigh');
        lastKey(tl, who).dur = 0.4;
        tl.at(tB + 0.62, () => audio.pop());
        tl.hold(tB + 0.62, tB + 6, who, up.z);
        words = [{ t: tB, text: 'BOBBLE!' }];
        moment = tB + 0.62;
      } else {
        // it pops up out of the glove and he can't find it again: it hits the ground
        const D = ground([1.2, 0.5]);
        tl.fly(tB, tB + 0.95, G, D, 1.6);
        tl.pose(who, tB + 0.45, 'field', { dur: 0.75 });
        tl.at(tB + 0.95, () => { audio.thud(); puff(D, 0.4); });
        mark = D; markT = tB + 0.95;
        words = [{ t: tB, text: 'BOBBLE!' }];
        moment = tB + 0.95;
      }
    } else if (k === 'brushGlove') {
      // a full stretch: the ball ticks off the tip of the glove and keeps going
      tl.fly(tc, tB, bat, G, apex);
      tl.at(tB, () => audio.tick());
      const D = ground([4.2, 0.9]);
      tl.fly(tB, tB + 0.55, G, D, 0.5);
      tl.at(tB + 0.55, () => { audio.thud(); puff(D, 0.4); });
      mark = D; markT = tB + 0.55;
      words = [{ t: tB, text: 'TOUCHED!' }];
    } else if (k === 'deflectGround') {
      // it glances off his glove and hits the grass before his teammate can get there
      tl.fly(tc, tB, bat, G, apex);
      tl.at(tB, () => audio.tick());
      const D = ground([2.6, 1.6]);
      tl.fly(tB, tB + 0.6, G, D, 1.4);
      tl.at(tB + 0.6, () => { audio.thud(); puff(D, 0.45); });
      tl.pose(who, tB + 0.25, 'ready');
      const mate = who === 'CF' ? pick(['LF', 'RF']) : 'CF';
      const pick2 = ground([3.4, 1.9]);
      tl.move(mate, tc + 0.1, tB + 1.0, pick2.x, pick2.y, 'field');
      lastKey(tl, mate).dur = 0.6;
      tl.rest(tB + 0.6, tB + 1.15, D);
      tl.hold(tB + 1.15, tB + 6, mate, 0.5);
      mark = D; markT = tB + 0.6;
      words = [{ t: tB, text: 'OFF HIS GLOVE!' }];
      moment = tB + 0.6;
    } else {
      // running in for a sinking liner, glove down at his shoe tops
      if (k === 'shoestringCatch') {
        tl.fly(tc, tB, bat, G, apex);
        tl.at(tB, () => audio.pop());
        tl.hold(tB, tB + 6, who, G.z);
      } else {
        const B = ground([2.5, 0.2]); // a step short of the glove (out in front of it, toward home)
        tl.fly(tc, tB - 0.08, bat, B, apex);
        tl.at(tB - 0.08, () => { audio.thud(); puff(B, 0.5); });
        tl.fly(tB - 0.08, tB + 0.05, B, { ...G, z: G.z - 0.15 }, 0.25);
        tl.at(tB + 0.05, () => audio.pop());
        tl.hold(tB + 0.05, tB + 6, who, G.z);
        mark = B; markT = tB - 0.08;
      }
      tl.pose(who, tB + 1.3, 'catchHigh'); // up, showing the ball
    }

    // close and slow from the side, looking across the way he faces, at the height of the glove
    const yaw = Math.atan2(lx, ly);
    const z = Math.max(0.5, G.z * 0.7);
    return {
      pause: moment + 1.0,
      slow: [[moment - 0.5, moment + 0.35]],
      replay: Math.max(tc - 0.2, tB - 2.2),
      words,
      init: (s) => { field = s.field; },
      scuffs: (t) => (mark && t >= markT ? [{ x: mark.x, y: mark.y, r: 0.4, sx: 0.8, sy: 1.3, a: 0.85 }] : []),
      cam: (t) => (t < Math.max(tc + 0.4, tB - 1.4) ? null
        : { x: G.x, y: G.y, z: extra ? z * 0.8 : z, ext: extra ? 6 : shoe ? 4 : 4.6, pitch: shoe ? 0.22 : 0.3, yaw }),
    };
  },
  steps(v) {
    const yes = FAMILIES[v.k];
    const ex = {
      transferDrop: 'He **caught it cleanly** and had **secure possession**, then dropped it reaching in to throw. Dropping it on the **transfer** is a **voluntary release**, so it\'s still a **catch**. Batter\'s out.',
      collisionDrop: 'The ball got in his glove, but he **lost it in the collision** before he ever had **secure possession**. Losing it while still completing the act is **no catch**. Ball is live!',
      bobbleCatch: 'He bobbled it, but he **grabbed it again before it touched the ground**. It never hit the grass and he ended up **securing it**: **catch**. Batter\'s out.',
      bobbleDrop: 'It **popped out of his glove** and **hit the ground**. He never had **secure possession**: **no catch**. Ball is live!',
      brushGlove: 'It **ticked off the end of his glove**. Brief contact isn\'t possession, and it hit the ground: **no catch**.',
      shoestringCatch: 'A great shoestring grab: the ball went **into the glove before it touched the grass**, and he held on. **Catch**, batter\'s out.',
      shoestringTrap: 'Look at the turf: the ball **hit the ground a step in front of him** and short-hopped into the glove. That\'s a **trap**, **no catch**. Ball is live!',
      foulPopCatch: 'A **caught foul fly** counts the same as a fair one: he **secured it** before it hit the ground, so it\'s a **catch** and the batter\'s out.',
      foulPopDrop: 'It **popped out of his glove** and **hit the ground**. No secure possession on a foul pop is **no catch**: it\'s just a **foul ball**, and the batter stays up.',
      deflectGround: 'It glanced off one fielder and **hit the ground before anyone caught it**. Once it touches the grass it can\'t be caught: **no catch**.',
    }[v.k];
    return [{
      q: 'CATCH OR NO CATCH?',
      sub: 'Plate umpire has all catch/no-catch calls',
      options: [
        { btn: 'A', id: 'catch', label: "CATCH — HE'S OUT!", sub: 'Fist up' },
        { btn: 'B', id: 'nocatch', label: 'NO CATCH!', sub: 'Safe sign — ball is live' },
      ],
      answer: yes ? 'catch' : 'nocatch',
      say: yes ? "That's a catch! He's out!" : 'No catch!',
      explain: ex,
    }];
  },
};
