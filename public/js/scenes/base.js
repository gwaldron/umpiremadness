// On the bases: you control the base umpire. Start in the right spot (A/B/C),
// move for an angle while the play develops, stop, then make the call in the UMP CAM.
import { audio } from '../audio.js';
import { voices } from '../voice.js';
import { input } from '../input.js';
import { clamp, lerp, rand, randInt, pick, chance, weighted, dist, norm, sub, add, mul, dot, segDist, mini } from '../util.js';
import { KITS, SKINS } from '../render/figures.js';
import { BASES, UMP_SPOTS, POS } from '../render/field.js';
import { Timeline, setupDefense, setupRunners, setupBatter, BASE_XY, STRIDE } from './timeline.js';
import { UmpCam, UmpCam3D } from './umpcam.js';
import { releasePt, holdZ } from '../sport.js';

const B1 = BASES.first, B2 = BASES.second, B3 = BASES.third, HOME = BASES.home;
const BASE_NAME = { 1: '1ST BASE', 2: '2ND BASE', 3: '3RD BASE', 4: 'HOME PLATE' };
const BAG = { 1: { x: B1.x - 0.9, y: B1.y }, 2: { x: B2.x, y: B2.y }, 3: { x: B3.x + 0.9, y: B3.y }, 4: { x: 0, y: 0.7 } };
const PLATE = BAG[4];
// The plays at the plate (you're the plate umpire)
const PLATE_PLAYS = new Set(['pbHome', 'throwHome']);
const BAG_TOP = 0.3;
// A play decided by less than this (seconds) counts as a "bang-bang" play.
const CLOSE_PLAY = 0.16;
// Diamond interior (inside the baselines) — Little League umpires work from outside it.
function insideDiamond(p) {
  return p.y > Math.abs(p.x) + 2 && p.y < BASES.second.y - Math.abs(p.x) - 2;
}

// The working area: the middle of the infield. On a ball hit to the outfield the base umpire comes in
// here and pivots (Bootcamp "Working area pivot": ball stays in the infield, stay out; ball goes to the
// outfield, come in).
export function inWorkingArea(p) {
  return insideDiamond(p) && p.y > 22;
}
// From A on a ball in the infield (lessons): the spot straight out from first, 45 degrees off the foul line
const A_ANGLE_DIST = 18;
const WORK_POLY = [{ x: 0, y: 26 }, { x: 24, y: 48 }, { x: 10, y: 70 }, { x: -10, y: 70 }, { x: -24, y: 48 }];
// The wedge: the triangle formed by the plate umpire, the catcher and the runner coming in. It changes as
// the play develops, so keep moving to keep it OPEN: stay off the line between the catcher and the runner,
// so you look into the gap between them (where the tag happens) instead of one of them blocking the other.
// How open it is from u: 0 (you're on their line) .. 1 (looking straight across the gap).
export function wedgeOpen(u, cat, run) {
  const Lx = run.x - cat.x, Ly = run.y - cat.y, ll = Math.hypot(Lx, Ly);
  if (ll < 0.5) return 1;
  const Mx = (cat.x + run.x) / 2 - u.x, My = (cat.y + run.y) / 2 - u.y, ml = Math.hypot(Mx, My) || 1;
  return Math.abs(Lx * My - Ly * Mx) / (ll * ml);
}
const WEDGE_OK = 0.6; // about 37 degrees or more off their line

function cross(a, b) { return a.x * b.y - a.y * b.x; }

// How good is the view of the critical moment from point p?
// Generous: a view about 50 degrees or more to the play gives a clear UMP CAM.
export function viewScore(p, crit, moving = false) {
  const d = dist(p, crit.base);
  const sight = norm(sub(crit.base, p));
  const angle = Math.abs(cross(sight, crit.motion));
  const angleS = 0.35 + 0.65 * Math.min(1, angle / 0.78);
  let distS;
  if (d < 5) distS = 0.6;
  else if (d < 8) distS = lerp(0.75, 1, (d - 5) / 3);
  else if (d <= 40) distS = 1;
  else if (d <= 60) distS = lerp(1, 0.82, (d - 40) / 20);
  else if (d <= 100) distS = lerp(0.82, 0.5, (d - 60) / 40);
  else distS = 0.45;
  let occl = false;
  if (crit.fielder) {
    const fv = sub(crit.fielder, p);
    const along = dot(fv, sight);
    if (along > 0 && along < d - 0.2) {
      const perpD = Math.abs(cross(fv, sight));
      if (perpD < 1.3) occl = true;
    }
  }
  const lane = crit.throwSeg ? segDist(p, crit.throwSeg[0], crit.throwSeg[1]).d < 4 : false;
  const runway = crit.runSeg ? segDist(p, crit.runSeg[0], crit.runSeg[1]).d < 3 : false;
  const score = angleS * distS * (occl ? 0.6 : 1) * (lane ? 0.8 : 1) * (runway ? 0.85 : 1) * (moving ? 0.85 : 1);
  return { score, angle, distS, occl, lane, runway, d, moving };
}

// Best reachable spot (searched on rings around the base).
function idealSpot(crit, from, maxTravel = 200) {
  let best = null;
  const home = crit.baseNum === 4;
  for (let r = home ? 8 : 10; r <= (home ? 20 : 34); r += home ? 2 : 4) {
    for (let a = 0; a < 360; a += 8) {
      const ang = (a * Math.PI) / 180;
      const p = { x: crit.base.x + Math.cos(ang) * r, y: crit.base.y + Math.sin(ang) * r };
      if (home ? p.y < -26 || p.y > 10 : p.y < -8 || Math.hypot(p.x, p.y) > 190) continue;
      if (dist(p, from) > maxTravel) continue;
      const v = viewScore(p, crit);
      // prefer spots that don't require a marathon, and fair territory near the infield
      // Foul ground between home and first/third is the runner's lane — never a good spot
      const foul = Math.abs(p.x) > p.y;
      const s = home
        ? v.score - dist(p, from) * 0.002
        : v.score - dist(p, from) * 0.0015 - (foul && p.y < 44 ? 0.3 : foul ? 0.05 : 0) - (insideDiamond(p) ? (crit.working ? -0.1 : 0.15) : 0);
      if (!best || s > best.s) best = { ...p, s, v };
    }
  }
  return best;
}

// Where the base umpire starts. A is a spot in foul ground behind first. On Little League's 60-ft
// diamond, B and C are outside the baselines and BEHIND the infielders (who play about 8 ft back),
// out toward the edge of the outfield grass: B anywhere from halfway between first and second up to
// second base, C anywhere between second and third. d0..d1 = feet behind the baseline that count;
// b0..b1 = the band we highlight while you get set.
const START_ZONES = {
  B: { from: BASES.second, to: BASES.first, s0: -3, s1: 32, d0: 11, d1: 30, b0: 14, b1: 24 },
  C: { from: BASES.second, to: BASES.third, s0: -3, s1: 63, d0: 11, d1: 30, b0: 14, b1: 24 },
};
const ZONE_HELP = {
  A: '**A**: in foul ground behind first base.',
  B: '**B**: behind the infielders, back by the edge of the outfield grass, anywhere from halfway between first and second up to second base.',
  C: '**C**: behind the infielders, back by the edge of the outfield grass, anywhere between second and third.',
};
function zoneAxes(z) {
  const dx = z.to.x - z.from.x, dy = z.to.y - z.from.y;
  const L = Math.hypot(dx, dy);
  const u = { x: dx / L, y: dy / L };
  let n = { x: u.y, y: -u.x };
  if (n.x * z.from.x + n.y * z.from.y < 0) n = { x: -n.x, y: -n.y }; // the side away from home plate
  return { u, n };
}
export function inStartZone(k, p) {
  const z = START_ZONES[k];
  if (!z) return dist(p, UMP_SPOTS[k]) < 10;
  const { u, n } = zoneAxes(z);
  const rx = p.x - z.from.x, ry = p.y - z.from.y;
  const s = rx * u.x + ry * u.y, d = rx * n.x + ry * n.y;
  return s >= z.s0 && s <= z.s1 && d >= z.d0 && d <= z.d1;
}
// the middle of a start zone (where a lesson's demo umpire starts)
function zoneCenter(k) {
  const poly = startZonePoly(k);
  if (!poly) return { x: UMP_SPOTS[k].x, y: UMP_SPOTS[k].y };
  return { x: poly.reduce((v, p) => v + p.x, 0) / poly.length, y: poly.reduce((v, p) => v + p.y, 0) / poly.length };
}
// the band to highlight on the field while you get set
function startZonePoly(k) {
  const z = START_ZONES[k];
  if (!z) return null;
  const { u, n } = zoneAxes(z);
  const P = (s, d) => ({ x: z.from.x + u.x * s + n.x * d, y: z.from.y + u.y * s + n.y * d });
  return [P(z.s0 + 1, z.b0), P(z.s1 - 1, z.b0), P(z.s1 - 1, z.b1), P(z.s0 + 1, z.b1)];
}

export class BasePlayEvent {
  constructor(session, spec = {}) {
    this.s = session;
    this.div = session.div;
    this.spec = spec;
    this.kind = 'base';
    const majors = !['AA', 'AAA'].includes(this.div.id);
    this.play = spec.play || weighted([
      ['force1B', 5], ['steal2B', 3], ['dp', this.div.id === 'AA' ? 1 : 3], ['pickoff1B', 2], ['steal3B', 2],
      ['hit2B', 3], ['hit3B', 2], ['throwHome', 2], ['pbHome', majors ? 1.5 : 0],
    ]);
    // a play at the plate: you're the plate umpire, starting behind the catcher
    this.plate = PLATE_PLAYS.has(this.play);
    this.outs = spec.outs ?? randInt(0, 1);
    this.ump = { x: 0, y: 0, vx: 0, vy: 0, still: 0 };
    const start = this.plate ? { x: UMP_SPOTS.PU.x, y: UMP_SPOTS.PU.y } : session.lastUmpPos || { x: 58, y: 22 };
    this.ump.x = start.x; this.ump.y = start.y;
    this.umpActor = { x: this.ump.x, y: this.ump.y, kit: session.umpKit, skin: session.umpSkin, pose: 'set', ring: true, glove: null, facing: -1, mask: this.plate };
    this.state = 'position';
    this.t = 0;
    this.timeScale = 1;
    this.allowMove = true;
    this.crits = [];
    this.critIdx = 0;
    this.calls = [];
    this.penalties = [];
    this.ouched = false;
    this._build();
  }

  // ---------- play construction ----------
  _bang() {
    const d = this.div.bangBang;
    const mag = chance(0.2) ? rand(0.35, 0.55) : rand(d[0], d[1]);
    return chance(0.5) ? mag : -mag; // + = ball first (out), - = runner first (safe)
  }

  // Keep runners at kid speed: if beating the ball by dt would need a superhuman runner
  // (arriving before minT), make it an out by the same margin instead (or a bigger one).
  _fitDt(dt, tRef, minT) {
    if (tRef + dt < minT) dt = Math.abs(dt);
    if (tRef + dt < minT) dt = minT - tRef;
    return dt;
  }

  _build() {
    const tl = (this.tl = new Timeline());
    const play = this.play;
    let runners = [];
    if (play === 'force1B') runners = this.spec.runners || pick([[], [], [], [], [2], [3], [2, 3]]);
    if (play === 'steal2B' || play === 'pickoff1B' || play === 'dp') runners = [1];
    if (play === 'steal3B') runners = [2];
    if (play === 'hit3B') runners = [1];
    if (play === 'hit2B' && this.spec.runners) runners = this.spec.runners;
    if (play === 'pbHome') runners = [3];
    if (play === 'throwHome') runners = [2];
    this.runners = runners;
    this.expectSpot = runners.includes(2) || runners.includes(3) ? 'C' : runners.includes(1) ? 'B' : 'A';
    setupDefense(tl);
    const hand = chance(0.7) ? 'R' : 'L';
    setupBatter(tl, hand);
    setupRunners(tl, runners);
    if (this.plate) tl.actor('BU', { x: UMP_SPOTS.C.x, y: UMP_SPOTS.C.y, kit: this.s.umpKit, skin: pick(SKINS), pose: 'set', glove: null });
    else tl.actor('PU', { x: 0, y: -6.3, kit: this.s.umpKit, skin: pick(SKINS), pose: 'set', glove: null, mask: true });
    const tP = 0.3;
    // Pitch
    tl.pose('P', tP, 'pitch');
    tl.actors.P.keys[tl.actors.P.keys.length - 1].dur = 1.0;
    tl.hold(0, tP + 0.8, 'P', holdZ());
    const tPlate = tP + 0.8 + rand(0.55, 0.7);
    this.tPlate = tPlate;
    tl.pose('P', tP + 1.1, 'ready');
    const pitchFrom = releasePt();
    const sp = this.div.id === 'AA' ? 0.8 : this.div.id === 'AAA' ? 0.9 : 1;
    const builders = { force1B: this._force1B, steal2B: this._steal, steal3B: this._steal, dp: this._dp, pickoff1B: this._pickoff, hit2B: this._outfieldHit, hit3B: this._outfieldHit, pbHome: this._pbHome, throwHome: this._throwHome };
    builders[play].call(this, tl, tPlate, pitchFrom, sp);
    tl.sample(0);
  }

  _force1B(tl, tPlate, pitchFrom, sp) {
    tl.fly(tPlate - (tPlate - 1.1), tPlate, pitchFrom, { x: 0, y: 1, z: 2.6 }, 0.3);
    tl.actors.BAT.swingAt = tPlate - 0.17;
    tl.at(tPlate, () => audio.crack());
    const fielder = weighted([['SS', 4], ['3B', 2], ['2B', 3], ['P', 1]]);
    const F = tl.actors[fielder];
    const fp = fielder === 'P' ? { x: rand(-4, 6), y: rand(30, 38) } : { x: F.x + rand(-6, 6), y: F.y - rand(2, 8) };
    let vg = rand(45, 65);
    let tg = tPlate + Math.hypot(fp.x, fp.y) / vg;
    const glove = { x: B1.x - 1.4 * (B1.x - fp.x) / dist(B1, fp), y: B1.y - 1.4 * (B1.y - fp.y) / dist(B1, fp), z: 3.3 };
    const vt = rand(58, 78) * sp;
    const ft = dist(fp, glove) / vt;
    const brStart = tPlate + 0.35;
    let vr = rand(13.5, 18) * (this.div.id === 'AA' ? 0.92 : 1);
    let tr = brStart + 59 / vr;
    const dtB = this._bang();
    // variations
    const tw = this.spec.twist; // a drill can ask for one
    const pulled = tw ? tw === 'pulled' : chance(0.12);
    const dropped = tw ? tw === 'dropped' : !pulled && chance(0.1);
    const dt = (pulled || dropped) ? Math.abs(dtB) + 0.05 : dtB;
    let tb = tr - dt;
    let tThrow = tb - ft;
    if (tThrow - tg < 0.35) {
      tr += 0.35 - (tThrow - tg) + rand(0, 0.15);
      tb = tr - dt; tThrow = tb - ft;
      vr = 59 / (tr - brStart);
    } else if (tThrow - tg > 1.3) {
      tg = tThrow - rand(0.5, 0.8);
      vg = Math.hypot(fp.x, fp.y) / (tg - tPlate);
    }
    // Fielder gets down on it a beat early, fields it and throws
    tl.move(fielder, tPlate, Math.max(tPlate + 0.25, tg - 0.3), fp.x, fp.y, 'field');
    tl.last(fielder).dur = 0.6;
    tl.ground(tPlate, tg, { x: 0, y: 2 }, fp);
    tl.hold(tg, tThrow, fielder, 3.4);
    tl.pose(fielder, tThrow - 0.25, 'throw');
    tl.actors[fielder].keys[tl.actors[fielder].keys.length - 1].dur = 0.4;
    tl.actors[fielder].keys[tl.actors[fielder].keys.length - 1].facing = B1.x > fp.x ? 1 : -1;
    tl.pose(fielder, tThrow + 0.4, 'ready');
    tl.throwBall(tThrow, tb, { x: fp.x, y: fp.y, z: 4.5 }, glove);
    // First baseman to the bag
    tl.move('1B', tPlate + 0.1, Math.min(tg, tb - 0.8), B1.x - 0.6, B1.y + 0.9, 'ready');
    tl.pose('1B', tb - 0.35, 'reach', { facing: fp.x < B1.x ? -1 : 1 });
    tl.hold(tb, tb + 3, '1B', 3.2);
    tl.pose('1B', tb + 0.6, 'stand');
    // Batter-runner
    tl.pose('BAT', brStart - 0.05, 'stand');
    const bag = { x: B1.x - 0.3, y: B1.y - 0.3 };
    tl.move('BAT', brStart, tr, bag.x, bag.y, 'run');
    tl.move('BAT', tr, tr + 1.3, B1.x + 14, B1.y + 12, 'stand');
    if (pulled) tl.pose('1B', tb - 0.1, 'reach', { facing: fp.x < B1.x ? -1 : 1 });
    this.crits.push({
      key: 'force1B', type: 'force', baseNum: 1, base: B1, motion: norm(sub(glove, fp)),
      throwSeg: [fp, glove], runSeg: [{ x: 1, y: -1 }, { x: B1.x + 11, y: B1.y + 9 }], fielderId: '1B', runnerId: 'BAT',
      tb, tr, out: !pulled && !dropped && tb < tr, dt: tr - tb,
      pulled: pulled ? tb - 0.07 : null, dropped, dropT: tb + 0.09,
      what: pulled ? 'pulled' : dropped ? 'dropped' : null,
      card: 'force-play',
    });
  }

  _steal(tl, tPlate, pitchFrom, sp) {
    const third = this.play === 'steal3B';
    const from = third ? 2 : 1, to = third ? 3 : 2;
    const target = BASE_XY[to];
    tl.fly(1.1, tPlate, pitchFrom, { x: 0, y: -1.5, z: chance(0.5) ? 0.3 : 2.2 }, 0.3);
    const dirt = this.div.id === 'AA' || this.div.id === 'AAA' || chance(0.4);
    // Runner may go when the pitch reaches the batter (Little League rule)
    const rid = 'R' + from;
    const R = tl.actors[rid];
    const runStart = tPlate + 0.02;
    tl.at(runStart + 0.12, () => voices.going()); // "He's going!"
    let vr = rand(14.5, 18.5) * (this.div.id === 'AA' ? 0.9 : 1);
    const runDist = Math.hypot(target.x - R.x, target.y - R.y);
    let tr = runStart + runDist / vr + 0.12;
    const dt = this._bang();
    const sweep = rand(0.12, 0.22);
    const coverId = third ? '3B' : (chance(0.55) ? 'SS' : '2B');
    const gloveAt = third ? { x: target.x + 1.2, y: target.y + 0.4, z: 2.8 } : { x: target.x + 0.9, y: target.y - 0.7, z: 2.8 };
    const vt = rand(48, 66) * sp * (this.div.id === 'WS' || this.div.id === 'AS' ? 1.15 : 1);
    const cFrom = { x: 0, y: -2.2, z: 4.6 };
    const ft = dist(cFrom, gloveAt) / vt;
    let tt = tr - dt;
    let tb = tt - sweep;
    let tThrow = tb - ft;
    const minTransfer = dirt ? 1.25 : 0.75;
    if (tThrow < tPlate + minTransfer) {
      tThrow = tPlate + minTransfer + rand(0, 0.15);
      tb = tThrow + ft; tt = tb + sweep; tr = tt + dt;
      vr = runDist / (tr - 0.12 - runStart);
    }
    // Catcher: pitch in the dirt sometimes (explains a slow transfer)
    if (dirt) {
      tl.ground(tPlate, tPlate + 0.35, { x: 0, y: -1.5 }, { x: rand(-3, 3), y: -1 });
      tl.hold(tPlate + 0.55, tThrow, 'C', 3.4);
      tl.pose('C', tPlate + 0.2, 'ready');
    } else {
      tl.hold(tPlate, tThrow, 'C', 2.4);
    }
    tl.pose('C', tThrow - 0.3, 'throw', { facing: third ? -1 : 1 });
    tl.actors.C.keys[tl.actors.C.keys.length - 1].dur = 0.4;
    tl.throwBall(tThrow, tb, cFrom, gloveAt);
    // Covering fielder
    const coverSpot = third ? { x: target.x + 1.6, y: target.y + 0.8 } : { x: target.x + 1.4, y: target.y - 0.6 };
    tl.move(coverId, tPlate + 0.2, tb - 0.35, coverSpot.x, coverSpot.y, 'ready');
    tl.pose(coverId, tb + 0.02, 'tag', { facing: third ? 1 : 1 });
    tl.hold(tb, tb + 3, coverId, 2.4);
    tl.pose(coverId, tt + 0.6, 'stand');
    // Runner
    const slideStart = { x: lerp(R.x, target.x, 0.8), y: lerp(R.y, target.y, 0.8) };
    const tSlide = runStart + (runDist * 0.8) / vr;
    tl.move(rid, runStart, tSlide, slideStart.x, slideStart.y, 'run');
    const endBag = { x: target.x + (third ? 0.6 : -0.4), y: target.y + (third ? 0.6 : -0.2) };
    tl.move(rid, tSlide, tr, endBag.x, endBag.y, 'slide', 'slide');
    tl.pose(rid, tr + 0.9, 'stand');
    tl.actors.BAT.keys.push({ t: 0, x: tl.actors.BAT.x, y: tl.actors.BAT.y, pose: 'bat' });
    const missed = chance(0.08);
    const empty = !missed && chance(0.06);
    const dropped = !missed && !empty && chance(0.08);
    this.crits.push({
      key: this.play, type: 'tag', baseNum: to, base: target, motion: norm(sub(target, { x: R.x, y: R.y })),
      throwSeg: [cFrom, gloveAt], runSeg: [{ x: R.x, y: R.y }, target], fielderId: coverId, runnerId: rid,
      tb, tr, tt, out: !missed && !empty && !dropped && tt < tr, dt: tr - tt,
      missed, empty, dropped, dropT: tt + 0.09, slide: 'feet',
      what: missed ? 'missed' : empty ? 'empty' : dropped ? 'dropped' : null,
      card: 'tag-play',
    });
  }

  // A clean hit to the outfield. Bases empty: the batter stretches it into a double and the play is
  // at second. Runner on first: he goes first to third on the single and the play is at third. Either
  // way the base umpire should come into the working area, pivot, and take the play from inside.
  _outfieldHit(tl, tPlate, pitchFrom, sp) {
    const toThird = this.play === 'hit3B';
    tl.fly(1.1, tPlate, pitchFrom, { x: 0, y: 1, z: 2.6 }, 0.3);
    tl.actors.BAT.swingAt = tPlate - 0.17;
    tl.at(tPlate, () => audio.crack());
    // where it goes and who runs it down
    const spots = {
      LF: { of: 'LF', land: { x: -60, y: 116 } }, LC: { of: 'CF', land: { x: -28, y: 138 } },
      RC: { of: 'CF', land: { x: 28, y: 138 } }, RF: { of: 'RF', land: { x: 60, y: 116 } },
    };
    const where = pick(toThird ? ['RF', 'RF', 'RC'] : ['LF', 'LC', 'RC', 'RF']);
    const S = spots[where];
    const land = { x: S.land.x + rand(-6, 6), y: S.land.y + rand(-6, 6) };
    const tLand = tPlate + rand(1.0, 1.35);
    tl.fly(tPlate, tLand, { x: 0, y: 1.5, z: 3 }, land, rand(5, 11));
    // the runner and the base the play is at
    const target = toThird ? B3 : B2;
    const vr = rand(15, 18.5) * (this.div.id === 'AA' ? 0.92 : 1);
    let rid, start, pts;
    if (toThird) {
      rid = 'R1';
      const R = tl.actors.R1;
      start = { x: R.x, y: R.y, t: tPlate + 0.05 };
      pts = [{ x: B2.x + 1.0, y: B2.y + 1.6 }, { x: lerp(B2.x, B3.x, 0.82), y: lerp(B2.y, B3.y, 0.82) }];
      // the batter-runner takes first and rounds the bag
      tl.pose('BAT', tPlate + 0.3, 'stand');
      const tb1 = tl.runTo('BAT', tPlate + 0.35, B1.x + 4, B1.y - 1.5, 16, 'run');
      tl.runTo('BAT', tb1, B1.x + 1.2, B1.y - 0.8, 6, 'stand');
    } else {
      rid = 'BAT';
      start = { x: tl.actors.BAT.x, y: tl.actors.BAT.y, t: tPlate + 0.35 };
      if (tl.actors.R2) tl.runPath('R2', tPlate + 0.05, [{ x: B3.x + 1.2, y: B3.y + 1.6 }, { x: 0.6, y: 1.4 }], 17, 'stand'); // a runner on second scores
      tl.pose('BAT', tPlate + 0.3, 'stand');
      // a wide turn at first, then on to second
      pts = [{ x: B1.x + 2.2, y: B1.y - 1.2 }, { x: lerp(B1.x, B2.x, 0.82), y: lerp(B1.y, B2.y, 0.82) }];
    }
    const bagEnd = toThird ? { x: B3.x + 0.6, y: B3.y + 0.6 } : { x: B2.x + 0.5, y: B2.y - 0.6 };
    let t = start.t, p = start;
    const legs = [];
    for (const q of pts) { const d = dist(p, q); legs.push({ q, t0: t, t1: t + d / vr }); t += d / vr; p = q; }
    let tr = t + dist(p, bagEnd) / (vr * 0.8);
    // the throw is timed off the runner: a bang-bang play at the base
    const dt = this._bang();
    const sweep = rand(0.12, 0.22);
    const cover = toThird ? '3B' : (where === 'LF' || where === 'LC' ? '2B' : 'SS');
    const gloveAt = toThird ? { x: target.x + 1.2, y: target.y + 0.4, z: 2.8 } : { x: target.x + 0.9, y: target.y - 0.7, z: 2.8 };
    const coverSpot = toThird ? { x: target.x + 1.6, y: target.y + 0.8 } : { x: target.x + 1.4, y: target.y - 0.6 };
    const vt = rand(52, 70) * sp;
    // the outfielder runs it down: roll the ball out to where he picks it up
    const dir = norm(sub(land, { x: 0, y: 0 }));
    let field = { x: land.x + dir.x * 14, y: land.y + dir.y * 14 };
    let ft = dist(field, gloveAt) / vt;
    let tt = tr - dt, tb = tt - sweep, tThrow = tb - ft, tField = tThrow - rand(0.35, 0.5);
    if (tField < tLand + 0.7) {
      // runner was too quick for a close play: slow the runner down (kids get tired going two bases)
      const shift = tLand + 0.7 - tField;
      tr += shift; tt += shift; tb += shift; tThrow += shift; tField += shift;
      const k = (tr - start.t) / (tr - shift - start.t);
      t = start.t;
      for (const L of legs) { const d = (L.t1 - L.t0) * k; L.t0 = t; L.t1 = t + d; t += d; }
    } else if ((tField - tLand) * 7 > 14) {
      // a long roll: the ball gets farther out toward the fence before he gets to it
      const far = Math.min((tField - tLand) * 7, 48);
      field = { x: land.x + dir.x * far, y: land.y + dir.y * far };
      if (Math.hypot(field.x, field.y) > 188) { const s2 = 188 / Math.hypot(field.x, field.y); field = { x: field.x * s2, y: field.y * s2 }; }
      ft = dist(field, gloveAt) / vt;
      tThrow = tb - ft; tField = tThrow - rand(0.35, 0.5);
    }
    tl.ground(tLand, tField, land, field);
    tl.move(S.of, tPlate + 0.1, Math.max(tPlate + 0.4, tField - 0.25), field.x, field.y, 'field');
    tl.last(S.of).dur = 0.55;
    tl.hold(tField, tThrow, S.of, 3.4);
    tl.pose(S.of, tThrow - 0.3, 'throw', { facing: gloveAt.x > field.x ? 1 : -1 });
    tl.actors[S.of].keys[tl.actors[S.of].keys.length - 1].dur = 0.4;
    tl.pose(S.of, tThrow + 0.4, 'ready');
    tl.throwBall(tThrow, tb, { x: field.x, y: field.y, z: 5 }, gloveAt);
    // the fielder covering the base
    tl.move(cover, tPlate + 0.2, Math.max(tPlate + 0.8, tb - 0.4), coverSpot.x, coverSpot.y, 'ready');
    tl.pose(cover, tb + 0.02, 'tag', { facing: 1 });
    tl.hold(tb, tb + 3, cover, 2.4);
    tl.pose(cover, tt + 0.6, 'stand');
    // the runner: around the bag, then slide in
    for (let i = 0; i < legs.length; i++) tl.move(rid, legs[i].t0, legs[i].t1, legs[i].q.x, legs[i].q.y, 'run');
    tl.move(rid, legs[legs.length - 1].t1, tr, bagEnd.x, bagEnd.y, 'slide', 'slide');
    tl.pose(rid, tr + 0.9, 'stand');
    const missed = chance(0.08);
    const empty = !missed && chance(0.05);
    const dropped = !missed && !empty && chance(0.08);
    const from = pts[pts.length - 1];
    this.crits.push({
      key: this.play, type: 'tag', baseNum: toThird ? 3 : 2, base: target, motion: norm(sub(target, from)),
      throwSeg: [{ x: field.x, y: field.y, z: 5 }, gloveAt], runSeg: [from, target], fielderId: cover, runnerId: rid,
      tb, tr, tt, out: !missed && !empty && !dropped && tt < tr, dt: tr - tt,
      missed, empty, dropped, dropT: tt + 0.09, slide: 'feet',
      what: missed ? 'missed' : empty ? 'empty' : dropped ? 'dropped' : null,
      card: 'working-area', working: true, tLand,
      // the base touch to watch once you're in the working area: the batter-runner at first, or the runner
      // from first going by second on his way to third
      touch: toThird ? { t: legs[0].t1 - 0.12, base: B2, name: 'second', runnerId: 'R1' } : { t: legs[0].t1 - 0.12, base: B1, name: 'first', runnerId: 'BAT' },
    });
  }

  // A pitch in the dirt gets by the catcher with a runner on third (Majors and up). The catcher spins to
  // chase it to the backstop, so the plate umpire must OPEN THE GATE (step out of his way, away from the
  // ball), then get an angle on the play at the plate: the catcher's throw to the pitcher covering home,
  // and the tag on the runner sliding in.
  _pbHome(tl, tPlate, pitchFrom, sp) {
    const side = pick([-1, 1]); // which way it gets away
    const bounce = { x: side * 0.5, y: 0.6 };
    tl.fly(1.1, tPlate - 0.08, pitchFrom, { ...bounce, z: 0.15 }, 0.25);
    tl.at(tPlate - 0.08, () => audio.thud());
    const rest = { x: side * rand(7, 10), y: -rand(27, 30) };
    const tRest = tPlate + rand(1.1, 1.35);
    tl.ground(tPlate - 0.08, tRest, bounce, rest);
    const pickSpot = { x: rest.x * 0.95, y: rest.y + 1.3 };
    const glove = { x: -0.9, y: 1.7, z: 2.6 }; // the pitcher covering, in front of the plate on the third-base side
    const R = tl.actors.R3;
    const runEnd = { x: -0.5, y: 1.0 };
    const slideStart = { x: lerp(R.x, runEnd.x, 0.84), y: lerp(R.y, runEnd.y, 0.84) };
    const runDist = dist(R, runEnd);
    const vr = rand(15.5, 18.5) * (this.div.id === 'AA' ? 0.92 : 1);
    let tBreak = tPlate + 0.3;
    let tr = tBreak + runDist / vr;
    const dt = this._bang(), sweep = rand(0.12, 0.2);
    const flight = dist(pickSpot, glove) / (rand(40, 52) * sp);
    let tt = tr - dt, tb = tt - sweep, tThrow = tb - flight, tPick = tThrow - 0.4;
    // the catcher needs time to get there: if not, the runner waits a beat before he breaks
    const minPick = Math.max(tRest + 0.1, tPlate + 0.3 + dist(POS.C, pickSpot) / 16);
    if (tPick < minPick) {
      const d = minPick - tPick;
      tBreak += d; tr += d; tt += d; tb += d; tThrow += d; tPick += d;
    }
    tl.move('C', tPlate + 0.22, tPick - 0.1, pickSpot.x, pickSpot.y, 'field');
    tl.last('C').dur = 0.5;
    tl.rest(tRest, tPick, { ...rest, z: 0.12 });
    tl.hold(tPick, tThrow, 'C', 3.3);
    tl.pose('C', tThrow - 0.28, 'throw', { facing: glove.x > pickSpot.x ? 1 : -1 });
    tl.last('C').dur = 0.4;
    tl.pose('C', tThrow + 0.4, 'ready');
    tl.throwBall(tThrow, tb, { x: pickSpot.x, y: pickSpot.y, z: 4.2 }, glove);
    // the pitcher runs in to cover home
    tl.move('P', tPlate + 0.45, tb - 0.45, glove.x - 0.4, glove.y + 1.1, 'ready');
    tl.pose('P', tb + 0.02, 'tag', { facing: -1 });
    tl.hold(tb, tb + 3, 'P', 2.4);
    tl.pose('P', tt + 0.6, 'stand');
    // the runner from third breaks for home and slides in, feet first
    const tSlide = tr - 0.5;
    tl.at(tBreak + 0.1, () => voices.going()); // "He's going!"
    tl.move('R3', tBreak - 0.05, tBreak, R.x, R.y, 'run');
    tl.move('R3', tBreak, tSlide, slideStart.x, slideStart.y, 'run');
    tl.move('R3', tSlide, tr, runEnd.x, runEnd.y, 'slide', 'slide');
    tl.pose('R3', tr + 0.9, 'stand');
    // the batter gets out of the way
    const B = tl.actors.BAT;
    tl.pose('BAT', tPlate + 0.2, 'stand');
    tl.move('BAT', tPlate + 0.35, tPlate + 1.4, B.x < 0 ? -7 : 7, -5, 'stand');
    const missed = chance(0.07);
    const dropped = !missed && chance(0.08);
    this.crits.push({
      key: 'pbHome', type: 'tag', baseNum: 4, base: PLATE, motion: norm(sub(runEnd, slideStart)),
      throwSeg: [{ x: pickSpot.x, y: pickSpot.y, z: 4.2 }, glove], runSeg: [slideStart, PLATE], fielderId: 'P', runnerId: 'R3',
      tb, tr, tt, out: !missed && !dropped && tt < tr, dt: tr - tt, missed, empty: false, dropped, dropT: tt + 0.09, slide: 'feet',
      what: missed ? 'missed' : dropped ? 'dropped' : null,
      card: 'plate-plays', gate: { side, t0: tPlate + 0.22, t1: tPick - 0.1 },
    });
  }

  // A single to the outfield with a runner on second: he rounds third and tries to score, and the throw
  // comes home. The plate umpire works THE WEDGE: the triangle of himself, the catcher and the runner,
  // kept open as they close in, so he sees into the gap where the tag happens.
  _throwHome(tl, tPlate, pitchFrom, sp) {
    tl.fly(1.1, tPlate, pitchFrom, { x: 0, y: 1, z: 2.6 }, 0.3);
    tl.actors.BAT.swingAt = tPlate - 0.17;
    tl.at(tPlate, () => audio.crack());
    const of = pick(['LF', 'CF', 'RF']);
    const land0 = { LF: { x: -46, y: 108 }, CF: { x: 0, y: 128 }, RF: { x: 46, y: 108 } }[of];
    const land = { x: land0.x + rand(-6, 6), y: land0.y + rand(-6, 6) };
    const tLand = tPlate + rand(1.0, 1.3);
    tl.fly(tPlate, tLand, { x: 0, y: 1.5, z: 3 }, land, rand(5, 10));
    const dir = norm(land);
    const glove = { x: -1.3, y: 2.1, z: 2.6 }; // the catcher, up the third-base side of the plate
    const R = tl.actors.R2;
    const pts = [{ x: B3.x + 1.2, y: B3.y + 1.8 }, { x: B3.x + 3.0, y: B3.y - 1.6 }];
    const runEnd = { x: -0.5, y: 1.0 };
    const slideStart = { x: lerp(B3.x, runEnd.x, 0.86), y: lerp(B3.y, runEnd.y, 0.86) };
    const vr = rand(15.5, 18.5) * (this.div.id === 'AA' ? 0.92 : 1);
    const legs = [];
    let t = tPlate + 0.05, p = { x: R.x, y: R.y };
    for (const q of [...pts, slideStart]) { const d = dist(p, q); legs.push({ q, t0: t, t1: t + d / vr }); t += d / vr; p = q; }
    let tr = t + dist(slideStart, runEnd) / (vr * 0.8);
    const dt = this._bang(), sweep = rand(0.12, 0.2);
    const vt = rand(55, 70) * sp;
    let field = { x: land.x + dir.x * 8, y: land.y + dir.y * 8 };
    let ft = dist(field, glove) / vt;
    let tt = tr - dt, tb = tt - sweep, tThrow = tb - ft, tField = tThrow - rand(0.35, 0.5);
    if (tField < tLand + 0.5) {
      // too quick for a close play: the runner was slower getting around third
      const shift = tLand + 0.5 - tField;
      const k = (tr + shift - legs[0].t0) / (tr - legs[0].t0);
      let t2 = legs[0].t0;
      for (const L of legs) { const d = (L.t1 - L.t0) * k; L.t0 = t2; L.t1 = t2 + d; t2 += d; }
      tr += shift; tt += shift; tb += shift; tThrow += shift; tField += shift;
    } else if (tField - tLand > 1.2) {
      // a slower roll: it gets farther out before he gets to it
      field = { x: land.x + dir.x * 18, y: land.y + dir.y * 18 };
      ft = dist(field, glove) / vt;
      tThrow = tb - ft;
      tField = Math.min(tField, tThrow - 0.35);
    }
    tl.ground(tLand, tField, land, field);
    tl.move(of, tPlate + 0.1, Math.max(tPlate + 0.4, tField - 0.25), field.x, field.y, 'field');
    tl.last(of).dur = 0.55;
    tl.hold(tField, tThrow, of, 3.4);
    tl.pose(of, tThrow - 0.3, 'throw', { facing: glove.x > field.x ? 1 : -1 });
    tl.last(of).dur = 0.4;
    tl.pose(of, tThrow + 0.4, 'ready');
    tl.throwBall(tThrow, tb, { x: field.x, y: field.y, z: 5 }, glove);
    // the catcher comes out in front of the plate for the throw
    tl.move('C', tPlate + 0.3, Math.max(tPlate + 1.2, tb - 0.5), glove.x + 0.5, glove.y + 0.6, 'ready');
    tl.pose('C', tb + 0.02, 'tag', { facing: -1 });
    tl.hold(tb, tb + 3, 'C', 2.4);
    tl.pose('C', tt + 0.6, 'stand');
    // the runner from second: around third and home, sliding in feet first
    for (const L of legs) tl.move('R2', L.t0, L.t1, L.q.x, L.q.y, 'run');
    tl.move('R2', legs[legs.length - 1].t1, tr, runEnd.x, runEnd.y, 'slide', 'slide');
    tl.pose('R2', tr + 0.9, 'stand');
    // the batter-runner takes first
    tl.pose('BAT', tPlate + 0.3, 'stand');
    const tb1 = tl.runTo('BAT', tPlate + 0.35, B1.x + 4, B1.y - 1.5, 16, 'run');
    tl.runTo('BAT', tb1, B1.x + 1.2, B1.y - 0.8, 6, 'stand');
    const missed = chance(0.07);
    const dropped = !missed && chance(0.08);
    this.crits.push({
      key: 'throwHome', type: 'tag', baseNum: 4, base: PLATE, motion: norm(sub(runEnd, slideStart)),
      throwSeg: [{ x: field.x, y: field.y, z: 5 }, glove], runSeg: [slideStart, PLATE], fielderId: 'C', runnerId: 'R2',
      tb, tr, tt, out: !missed && !dropped && tt < tr, dt: tr - tt, missed, empty: false, dropped, dropT: tt + 0.09, slide: 'feet',
      what: missed ? 'missed' : dropped ? 'dropped' : null,
      card: 'plate-plays', wedge: true, tLand,
    });
  }

  _pickoff(tl, tPlate, pitchFrom, sp) {
    tl.fly(1.1, tPlate, pitchFrom, { x: 0, y: -1.5, z: 2.2 }, 0.3);
    tl.hold(tPlate, 99, 'C', 2.4);
    const R = tl.actors.R1;
    const off = { x: B1.x - 6.2, y: B1.y + 6.2 };
    tl.move('R1', tPlate + 0.05, tPlate + 0.9, off.x, off.y, 'ready');
    const tThrow = tPlate + rand(0.55, 0.85);
    tl.segs = tl.segs.filter((s) => !(s.k === 'hold' && s.actorId === 'C'));
    tl.hold(tPlate, tThrow, 'C', 2.4);
    tl.pose('C', tThrow - 0.3, 'throw', { facing: 1 });
    tl.actors.C.keys[tl.actors.C.keys.length - 1].dur = 0.4;
    const gloveAt = { x: B1.x - 1.0, y: B1.y + 1.2, z: 2.4 };
    const cFrom = { x: 0, y: -2.2, z: 4.6 };
    const vt = rand(55, 72) * sp;
    const tb = tThrow + dist(cFrom, gloveAt) / vt;
    tl.throwBall(tThrow, tb, cFrom, gloveAt);
    tl.move('1B', tPlate + 0.05, tb - 0.3, B1.x - 0.6, B1.y + 1.6, 'ready');
    tl.pose('1B', tb + 0.02, 'tag', { facing: -1 });
    tl.hold(tb, tb + 3, '1B', 2.2);
    const sweep = rand(0.1, 0.2);
    const tt = tb + sweep;
    const back = { x: B1.x - 0.9, y: B1.y + 0.4 };
    const dd = dist(off, back);
    const tFree = Math.max(tThrow + 0.05, tPlate + 0.95); // reacts after finishing his lead-off steps
    const dt = this._fitDt(this._bang(), tt, tFree + dd / 16);
    const tr = tt + dt;
    const tReact = Math.max(tFree, tr - dd / 10);
    const tDive = lerp(tReact, tr, 0.55);
    tl.move('R1', tReact, tDive, lerp(off.x, back.x, 0.55), lerp(off.y, back.y, 0.55), 'run');
    tl.move('R1', tDive, tr, back.x, back.y, 'dive', 'dive');
    tl.pose('R1', tr + 1, 'stand');
    tl.pose('1B', tt + 0.7, 'stand');
    const missed = chance(0.08);
    const dropped = !missed && chance(0.08);
    this.crits.push({
      key: 'pickoff1B', type: 'tag', baseNum: 1, base: B1, motion: norm(sub(back, off)),
      throwSeg: [cFrom, gloveAt], runSeg: [off, back], fielderId: '1B', runnerId: 'R1',
      tb, tr, tt, out: !missed && !dropped && tt < tr, dt: tr - tt, missed, empty: false, dropped, dropT: tt + 0.09, slide: 'head',
      what: missed ? 'missed' : dropped ? 'dropped' : null,
      card: 'tag-play',
    });
  }

  _dp(tl, tPlate, pitchFrom, sp) {
    tl.fly(1.1, tPlate, pitchFrom, { x: 0, y: 1, z: 2.6 }, 0.3);
    tl.actors.BAT.swingAt = tPlate - 0.17;
    tl.at(tPlate, () => audio.crack());
    const six = chance(0.55); // 6-4-3 vs 4-6-3
    const fielder = six ? 'SS' : '2B';
    const pivot = six ? '2B' : 'SS';
    const F = tl.actors[fielder];
    const fp = { x: F.x + rand(-4, 4), y: F.y - rand(3, 7) };
    const vg = rand(55, 70);
    const tg = tPlate + Math.hypot(fp.x, fp.y) / vg;
    tl.move(fielder, tPlate, Math.max(tPlate + 0.25, tg - 0.3), fp.x, fp.y, 'field');
    tl.last(fielder).dur = 0.6;
    tl.ground(tPlate, tg, { x: 0, y: 2 }, fp);
    const pivotSpot = six ? { x: B2.x + 1.3, y: B2.y - 0.8 } : { x: B2.x - 1.3, y: B2.y - 0.8 };
    const glove1 = { x: pivotSpot.x + (fp.x - pivotSpot.x) * 0.05, y: pivotSpot.y - 0.4, z: 3.3 };
    const tThrow1 = tg + rand(0.35, 0.55);
    const vt1 = rand(40, 55);
    const tb1 = tThrow1 + dist(fp, glove1) / vt1;
    tl.hold(tg, tThrow1, fielder, 3.3);
    tl.pose(fielder, tThrow1 - 0.2, 'throw', { facing: pivotSpot.x > fp.x ? 1 : -1 });
    tl.actors[fielder].keys[tl.actors[fielder].keys.length - 1].dur = 0.35;
    tl.pose(fielder, tThrow1 + 0.4, 'ready');
    tl.throwBall(tThrow1, tb1, { x: fp.x, y: fp.y, z: 3.6 }, glove1);
    tl.move(pivot, tPlate + 0.1, tb1 - 0.3, pivotSpot.x, pivotSpot.y, 'ready');
    tl.pose(pivot, tb1 - 0.15, 'reach', { facing: fp.x < pivotSpot.x ? -1 : 1 });
    // Relay to first
    const tThrow2 = tb1 + rand(0.4, 0.6);
    const glove2 = { x: B1.x - 1.1, y: B1.y + 1.0, z: 3.3 };
    const vt2 = rand(55, 72) * sp;
    const tb2 = tThrow2 + dist(pivotSpot, glove2) / vt2;
    tl.hold(tb1, tThrow2, pivot, 3.3);
    tl.pose(pivot, tThrow2 - 0.25, 'throw', { facing: 1 });
    tl.actors[pivot].keys[tl.actors[pivot].keys.length - 1].dur = 0.4;
    tl.pose(pivot, tThrow2 + 0.5, 'ready');
    tl.throwBall(tThrow2, tb2, { x: pivotSpot.x, y: pivotSpot.y, z: 4.4 }, glove2);
    tl.move('1B', tPlate + 0.1, tb2 - 0.6, B1.x - 0.6, B1.y + 0.9, 'ready');
    tl.pose('1B', tb2 - 0.35, 'reach', { facing: -1 });
    tl.hold(tb2, tb2 + 3, '1B', 3.2);
    // Runner from first → second
    const R = tl.actors.R1;
    const slideAt = { x: lerp(R.x, B2.x, 0.82), y: lerp(R.y, B2.y, 0.82) };
    const runD = dist(R, B2);
    const r1Start = tPlate + 0.05;
    const dt1 = this._fitDt(this._bang(), tb1, r1Start + runD / 19);
    const pulled1 = chance(0.12);
    const tr1 = tb1 + (pulled1 ? Math.abs(dt1) + 0.05 : dt1);
    const v1 = runD / (tr1 - r1Start);
    tl.move('R1', r1Start, r1Start + (runD * 0.82) / v1, slideAt.x, slideAt.y, 'run');
    tl.move('R1', r1Start + (runD * 0.82) / v1, tr1, B2.x + 0.5, B2.y - 0.6, 'slide', 'slide');
    tl.pose('R1', tr1 + 1, 'stand');
    // Batter-runner to first
    const brStart = tPlate + 0.35;
    const dt2 = this._fitDt(this._bang(), tb2, brStart + 59 / 19.5);
    const tr2 = tb2 + dt2;
    tl.pose('BAT', brStart - 0.05, 'stand');
    tl.move('BAT', brStart, tr2, B1.x - 0.3, B1.y - 0.3, 'run');
    tl.move('BAT', tr2, tr2 + 1.3, B1.x + 14, B1.y + 12, 'stand');
    if (pulled1) tl.pose(pivot, tb1 - 0.1, 'reach', { facing: fp.x < pivotSpot.x ? -1 : 1 });
    this.crits.push({
      key: 'dp1', type: 'force', baseNum: 2, base: B2, motion: norm(sub(glove1, fp)),
      throwSeg: [fp, glove1], runSeg: [B1, B2], fielderId: pivot, runnerId: 'R1',
      tb: tb1, tr: tr1, out: !pulled1 && tb1 < tr1, dt: tr1 - tb1, pulled: pulled1 ? tb1 - 0.07 : null, dropped: false,
      what: pulled1 ? 'pulled' : null, card: 'double-play',
    });
    this.crits.push({
      key: 'dp2', type: 'force', baseNum: 1, base: B1, motion: norm(sub(glove2, pivotSpot)),
      throwSeg: [pivotSpot, glove2], runSeg: [HOME, { x: B1.x + 10, y: B1.y + 10 }], fielderId: '1B', runnerId: 'BAT',
      tb: tb2, tr: tr2, out: tb2 < tr2, dt: tr2 - tb2, pulled: null, dropped: false, card: 'double-play',
    });
  }

  // ---------- flow ----------
  start() {
    const hud = this.s.hud;
    hud.setBug({ balls: 0, strikes: 0, outs: this.outs, runners: this.runners });
    const rtxt = this.runners.length === 0 ? 'Bases empty' : 'Runner' + (this.runners.length > 1 ? 's' : '') + ' on ' + this.runners.map((b) => ['', '1st', '2nd', '3rd'][b]).join(' & ');
    if (this.plate) {
      hud.prompt("YOU'RE THE PLATE UMPIRE", `${rtxt} · ${this.outs} out${this.outs === 1 ? '' : 's'} · Be ready for a play at the plate`);
      hud.options([{ btn: 'A', id: 'set', label: 'PLAY BALL!', big: true }], () => this._go());
      if ((this.s.hints || this.spec.tutorial) && !this.spec.exam) {
        hud.tip(this.play === 'pbHome'
          ? `Runner on third. If a pitch gets by, <b>open the gate</b>: step out of the catcher's way (away from the ball) so he can chase it, then get an angle on the play at the plate. Move with ${this.s.moveHint()}.`
          : `Runner on second. On a throw home, <b>work the wedge</b>: the triangle formed by you, the catcher and the runner coming in. Keep moving so it stays <b>open</b> and you can see between them, right where the tag will happen. Move with ${this.s.moveHint()}.`);
      }
      this._frame([{ x: this.ump.x, y: this.ump.y }, PLATE, { x: 0, y: 14 }], 20);
      this.posTimer = 0;
      return;
    }
    hud.prompt('TAKE YOUR POSITION', `${rtxt} · ${this.outs} out${this.outs === 1 ? '' : 's'} · You're the base umpire`);
    hud.options([{ btn: 'A', id: 'set', label: "I'M SET — PITCH!", big: true }], () => this._go());
    if (this.s.hints && !this.spec.exam) {
      const spot = this.expectSpot;
      const why = { A: 'Bases empty → start in <b>A</b>: foul ground behind first base.', B: 'Runner on 1st only → start in <b>B</b>: behind the infielders, back by the outfield grass, anywhere from halfway between first and second up to second base.', C: 'Runner on 2nd or 3rd → start in <b>C</b>: behind the infielders, back by the outfield grass, anywhere between second and third.' }[spot];
      hud.tip(`${why} Move with ${this.s.moveHint()}.`);
    }
    this.s.rig.set({ x: 8, y: 52 }, 62, 0.72);
    this.posTimer = 0;
    // not in the right start spot? blink so you see it's you and you need to move
    this.flashT = inStartZone(this.expectSpot, this.ump) ? null : 0;
    if (this.spec.demo) {
      // a lesson's demo: the umpire starts in the right spot and moves by himself along the gold track
      const z = zoneCenter(this.expectSpot);
      this.ump.x = z.x; this.ump.y = z.y;
      this.flashT = null;
      hud.options(null);
      hud.tip(null);
      hud.prompt(this.spec.caption.title, this.spec.caption.pre);
      this.demoT = 0;
    }
  }

  _go() {
    if (this.state !== 'position') return;
    const hud = this.s.hud;
    hud.tip(null);
    hud.options(null);
    if (this.plate) {
      // no start spot to grade: you start behind the catcher
      this.startOk = true;
      this.startPos = { x: this.ump.x, y: this.ump.y };
      this.track = [{ ...this.startPos }];
      this.bumped = false;
      this.gateOk = undefined;
      this.state = 'live';
      this.t = 0;
      hud.prompt('', '');
      for (const c of this.crits) c.ideal = null;
      this._prepCrit();
      return;
    }
    // Check the starting spot
    let nearest = null, nd = Infinity;
    for (const k of ['A', 'B', 'C']) {
      const d = dist(this.ump, UMP_SPOTS[k]);
      if (d < nd) { nd = d; nearest = k; }
    }
    this.startOk = inStartZone(this.expectSpot, this.ump);
    this.startPos = { x: this.ump.x, y: this.ump.y };
    this.track = [{ ...this.startPos }];
    if (!this.startOk) this.flashT = 0.55; // one more blink: you started in the wrong spot
    this.wentIn = false;
    this.inCalled = false;
    this.startNearest = nd < 14 ? nearest : null;
    hud.floater(this.startOk ? `✓ ${this.expectSpot} POSITION` : `✗ SHOULD BE IN ${this.expectSpot}`, !this.startOk);
    if (this.startOk) audio.correct(); else audio.wrong();
    this.state = 'live';
    this.t = 0;
    hud.prompt('', '');
    // Ideal spots
    for (const c of this.crits) c.ideal = null;
    this._prepCrit();
  }

  _prepCrit() {
    const c = this.crits[this.critIdx];
    if (!c) return;
    const from = this.critIdx === 0 ? { x: this.ump.x, y: this.ump.y } : { x: this.ump.x, y: this.ump.y };
    const travel = c.tb - this.t;
    c.ideal = idealSpot({ ...c, fielder: this._fielderAt(c) }, from, Math.max(18, travel * 16 + 10));
    // the A lesson (demo and reps): from A on a ball in the infield, come well into fair territory, about
    // 45 degrees off the foul line, halfway between the foul line and the baseline to second
    if ((this.spec.demo || this.spec.coach) && this.expectSpot === 'A' && c.type === 'force' && c.baseNum === 1 && !this.spec.hold) {
      c.ideal = { x: BASES.first.x, y: BASES.first.y + A_ANGLE_DIST };
    }
    c.tFirst = Math.min(c.tb, c.tr, c.tt ?? Infinity);
    c.route = this._route(c, from);
    if (this.critIdx > 0) c.go = this.t + 0.1;
  }

  // The track a lesson teaches (Bootcamp A/B/C): from B or C on a ball in the infield, hold your spot and
  // adjust a step or two; on a ball to the outfield, come into the working area first; otherwise go
  // straight for the angle.
  _route(c, from) {
    if (!c.ideal) return null;
    if (this.spec.hold) {
      const d = dist(from, c.ideal), k = Math.min(1, 4 / Math.max(d, 0.01));
      return [from, { x: from.x + (c.ideal.x - from.x) * k, y: from.y + (c.ideal.y - from.y) * k }];
    }
    if (c.working) {
      const mid = { x: from.x * 0.35, y: clamp(from.y * 0.8 + 8, 32, 56) };
      return [from, mid, { x: c.ideal.x, y: c.ideal.y }];
    }
    return [from, { x: c.ideal.x, y: c.ideal.y }];
  }

  // The demo umpire's stick: along the route, timed to get there and stop before the play
  _autopilot() {
    const c = this.crits[this.critIdx];
    if (!c || !c.route || this.t < (c.go ?? this.tPlate + 0.12)) return { x: 0, y: 0 };
    if (c.wp === undefined) {
      c.wp = 1;
      let L = 0;
      for (let i = 1; i < c.route.length; i++) L += dist(c.route[i - 1], c.route[i]);
      c.apSpeed = clamp(L / Math.max(0.6, c.tFirst - 0.75 - this.t), 6, 17);
    }
    while (c.wp < c.route.length && dist(this.ump, c.route[c.wp]) < 0.7) c.wp++;
    if (c.wp >= c.route.length) return { x: 0, y: 0 };
    const q = c.route[c.wp], d = dist(this.ump, q) || 1;
    const k = (c.apSpeed / 17) * Math.min(1, d / 2.5 + (c.wp < c.route.length - 1 ? 1 : 0));
    return { x: ((q.x - this.ump.x) / d) * k, y: ((q.y - this.ump.y) / d) * k };
  }

  _fielderAt(c) {
    // On a force play the fielder stretches from the bag toward the throw
    if (c.type === 'force') return { x: c.base.x - c.motion.x * 2.2, y: c.base.y - c.motion.y * 2.2 };
    const a = this.tl.actors[c.fielderId];
    if (!a) return null;
    // approximate: where the fielder will be at the moment of the play
    const keys = a.keys.filter((k) => k.t <= c.tb + 0.05);
    const k = keys[keys.length - 1] || a.keys[0];
    return { x: k.x, y: k.y };
  }

  onAction() { return false; }

  // Where the tag lands: on the sliding runner's leg (or hand on a dive back).
  _tagPoint(c) {
    if (c.type !== 'tag') return null;
    const bag = BAG[c.baseNum];
    const dir = norm(sub(c.runSeg[1], c.runSeg[0]));
    const reach = c.slide === 'head' ? 0.9 : 1.3;
    return { x: bag.x - dir.x * reach, y: bag.y - dir.y * reach, z: c.missed ? 1.4 : 0.45 };
  }

  // Pose fixes so the close-up shows exactly what happened: foot on the bag at tr,
  // ball in the glove at tb, glove on the runner at tt.
  _overrides(t) {
    const tl = this.tl;
    for (const a of tl.list()) { a.ik = null; a.faceAt = null; }
    const c = this.crits[this.critIdx];
    if (!c) return;
    const tLast = Math.max(c.tb, c.tr, c.tt ?? 0);
    const tFirst = Math.min(c.tb, c.tr, c.tt ?? Infinity);
    if (t < tFirst - 1.2 || t > tLast + 1.5) return;
    const F = tl.actors[c.fielderId];
    const R = tl.actors[c.runnerId];
    const bag = BAG[c.baseNum];
    const dir = norm(sub(c.runSeg[1], c.runSeg[0]));
    const ramp = (t0, t1) => clamp((t - t0) / (t1 - t0), 0, 1);
    const glovePt = { x: c.throwSeg[1].x, y: c.throwSeg[1].y, z: c.throwSeg[1].z ?? 3 };
    const ball = tl.ball;
    if (F) {
      F.ik = [];
      if (c.type === 'force') {
        F.faceAt = c.throwSeg[0];
        const w = ramp(c.tb - 0.7, c.tb - 0.3) * (1 - ramp(c.tb + 0.8, c.tb + 1.1));
        F.ik.push({ joint: 'handF', target: glovePt, w });
        // pivot foot on the bag (or pulled off it)
        const toF = norm(sub(F, bag));
        let foot = { x: bag.x + toF.x * 0.3, y: bag.y + toF.y * 0.3, z: BAG_TOP };
        if (c.pulled !== null && c.pulled !== undefined && t > c.pulled) {
          const k = clamp((t - c.pulled) / 0.18, 0, 1);
          const away = norm(sub(c.throwSeg[0], bag));
          foot = { x: foot.x + away.x * 1.8 * k, y: foot.y + away.y * 1.8 * k, z: BAG_TOP * (1 - k) + Math.sin(k * Math.PI) * 0.5 };
        }
        F.ik.push({ joint: 'footB', target: foot, w: ramp(c.tb - 1.0, c.tb - 0.6) * (1 - ramp(c.tb + 1.0, c.tb + 1.3)) });
        if (t >= c.tb && t < c.tb + 1.0) {
          if (c.dropped && t > c.dropT) {
            const d = t - c.dropT;
            ball.x = glovePt.x + d * 1.2; ball.y = glovePt.y + d * 0.6; ball.z = Math.max(0.15, glovePt.z - 9 * d * d - 1.2 * d);
          } else { ball.x = glovePt.x; ball.y = glovePt.y; ball.z = glovePt.z; }
        }
      } else {
        F.faceAt = c.runSeg[0];
        const tagPt = this._tagPoint(c);
        let gl;
        if (t <= c.tb) gl = glovePt;
        else if (t <= c.tt) { const k = clamp((t - c.tb) / Math.max(0.05, c.tt - c.tb), 0, 1); const e = k * k; gl = { x: lerp(glovePt.x, tagPt.x, e), y: lerp(glovePt.y, tagPt.y, e), z: lerp(glovePt.z, tagPt.z, e) }; }
        else { const k = clamp((t - c.tt) / 0.35, 0, 1); gl = { x: tagPt.x, y: tagPt.y, z: tagPt.z + k * 0.9 }; }
        const w = ramp(c.tb - 0.7, c.tb - 0.3) * (1 - ramp(c.tt + 0.9, c.tt + 1.2));
        F.ik.push({ joint: 'handF', target: gl, w });
        const fw = norm(sub(c.runSeg[0], bag));
        const bare = { x: F.x + fw.x * 0.5 - fw.y * 0.6, y: F.y + fw.y * 0.5 + fw.x * 0.6, z: 3.3 };
        if (c.empty) F.ik.push({ joint: 'handB', target: bare, w });
        if (t >= c.tb && t < c.tt + 1.0) {
          if (c.empty) { ball.x = bare.x; ball.y = bare.y; ball.z = bare.z + 0.1; }
          else if (c.dropped && t > c.dropT) {
            const d = t - c.dropT;
            ball.x = gl.x + d * 2; ball.y = gl.y + d; ball.z = Math.max(0.15, gl.z + 2.5 * d - 12 * d * d);
          } else { ball.x = gl.x; ball.y = gl.y; ball.z = gl.z; }
        }
      }
    }
    if (R) {
      R.ik = [];
      const edge = { x: bag.x - dir.x * 0.35, y: bag.y - dir.y * 0.35, z: BAG_TOP };
      const w = ramp(c.tr - 0.28, c.tr) * (1 - ramp(c.tr + 0.25, c.tr + 0.5));
      if (c.type === 'tag' && c.slide === 'head') R.ik.push({ joint: 'handF', target: edge, w });
      else R.ik.push({ joint: 'footF', target: c.type === 'tag' ? { ...edge, z: 0.2 } : edge, w });
    }
  }

  // Fit a set of ground points on screen (with some padding).
  _frame(pts, minExt = 42) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ext = clamp(Math.max((x1 - x0) / 2, ((y1 - y0) / 2) * 0.85) + 16, minExt, 105);
    // plays at the plate: look back at home from center field, so the backstop and the room behind the
    // plate are in view (3D only: the flat 2D figures are drawn for the view from behind home)
    // (the throw-home play keeps the view from behind home, a little higher, so you see the hit go out)
    if (this.plate && this.play === 'pbHome' && this.s.field.is3d) this.s.rig.set({ x: cx, y: cy - 3 }, ext, 0.95, Math.PI);
    else if (this.plate) this.s.rig.set({ x: cx, y: cy - 3 }, Math.min(105, ext * 1.15), 1.05);
    // (aimed a little toward home and a touch wider: the near edge of this tilted view is where you
    // usually are, and it used to get cut off)
    else this.s.rig.set({ x: cx, y: cy - 2 }, Math.min(105, ext * 1.08), 0.8);
  }

  update(dt) {
    const hud = this.s.hud;
    // the stick moves you the way it points on screen (plays at the plate look back from center field)
    const m = this.spec.demo ? (this.state === 'live' && !this.touchHold ? this._autopilot() : { x: 0, y: 0 })
      : this.plate && this.play === 'pbHome' && this.s.field.is3d ? { x: -input.move.x, y: -input.move.y } : input.move;
    const canMove = this.state === 'position' || this.state === 'live' || this.state === 'after';
    // Umpire movement (feet per second)
    const maxV = 17, acc = 70;
    const tvx = canMove ? m.x * maxV : 0, tvy = canMove ? m.y * maxV : 0;
    const k = Math.min(1, (acc * dt) / Math.max(1, Math.hypot(tvx - this.ump.vx, tvy - this.ump.vy)));
    this.ump.vx += (tvx - this.ump.vx) * k;
    this.ump.vy += (tvy - this.ump.vy) * k;
    if (this.state === 'cam' || this.touchHold) { this.ump.vx = 0; this.ump.vy = 0; }
    const step = (this.state === 'live' ? this.timeScale : 1) * dt;
    this.ump.x = clamp(this.ump.x + this.ump.vx * step, -75, 75);
    this.ump.y = clamp(this.ump.y + this.ump.vy * step, this.plate ? -32 : -15, 140);
    const speed = Math.hypot(this.ump.vx, this.ump.vy);
    this.ump.still = speed < 1.5 ? this.ump.still + dt : 0;
    const ua = this.umpActor;
    ua.x = this.ump.x; ua.y = this.ump.y;
    ua.vis = Math.min(innerWidth, innerHeight) < 600 ? 1.6 : 1.2; // a bigger you on phones
    ua.you = true;
    // the blink: off and on a few times
    if (this.flashT !== null && this.flashT !== undefined) {
      this.flashT += dt;
      ua.hidden = this.flashT < 1.15 && Math.floor(this.flashT / 0.19) % 2 === 1;
      if (this.flashT >= 1.15) { this.flashT = null; ua.hidden = false; }
    }
    // your track during the play: a dot every half foot or so
    if (this.track && (this.state === 'live')) {
      const last = this.track[this.track.length - 1];
      if (Math.hypot(this.ump.x - last.x, this.ump.y - last.y) > 0.5 && this.track.length < 600) this.track.push({ x: this.ump.x, y: this.ump.y });
    }
    if (!this.signalPose) {
      if (speed > 2) { ua.pose = 'run'; ua.dist = (ua.dist || 0) + speed * step; ua.phase = (ua.dist / STRIDE) % 1; if (Math.abs(this.ump.vx) > 1) ua.facing = this.ump.vx > 0 ? 1 : -1; }
      else ua.pose = this.ump.still > 0.25 ? 'set' : 'stand';
    }

    if (this.state === 'position' && this.plate) {
      this._frame([{ x: this.ump.x, y: this.ump.y }, PLATE, { x: 0, y: 14 }], 20);
      return;
    }
    if (this.state === 'position' && this.spec.demo) {
      this.demoT += dt;
      this._frame([{ x: this.ump.x, y: this.ump.y }, UMP_SPOTS[this.expectSpot], { x: 0, y: 0 }, BASES.second, BASES.first, BASES.third]);
      if (this.demoT > 2.6) this._go();
      return;
    }
    if (this.state === 'position') {
      this.posTimer += dt;
      // phones: frame just you, your spot and its base so you're big enough to steer; bigger screens show the infield
      const you = { x: this.ump.x, y: this.ump.y };
      if (Math.min(innerWidth, innerHeight) < 600) {
        const base = { A: BASES.first, B: BASES.second, C: BASES.second }[this.expectSpot];
        const zone = startZonePoly(this.expectSpot) || [UMP_SPOTS[this.expectSpot]];
        this._frame([you, base, ...zone], 22);
      } else this._frame([you, UMP_SPOTS[this.expectSpot], { x: 0, y: 0 }, BASES.second, BASES.first, BASES.third]);
      return;
    }
    if (this.state === 'live' || this.state === 'after') {
      const c = this.crits[this.critIdx];
      // a lesson demo stops on the runner's touch: in the working area, watch him touch the bag
      if (this.state === 'live' && c && c.touch && this.spec.demo && !c.touchShown && this.t >= c.touch.t) {
        c.touchShown = true;
        this._touchPause(c);
      }
      if (this.touchHold) {
        this.tl.sample(this.t);
        this._overrides(this.t);
        this._frame([{ x: this.ump.x, y: this.ump.y }, c.touch.base, this.tl.actors[c.touch.runnerId]], 26);
        return;
      }
      // Slow-mo approach to the critical moment
      if (this.state === 'live' && c) {
        const until = c.tFirst - this.t;
        this.timeScale = until < 0.6 ? lerp(this.timeScale, 0.35, 0.15) : 1;
        if (until <= 0.32) return this._openCam(c);
      } else this.timeScale = 1;
      this.t += dt * this.timeScale;
      // a ball to the outfield: did the umpire come into the working area?
      if (c && c.working && this.state === 'live') {
        if (this.t > this.tPlate && inWorkingArea(this.ump)) this.wentIn = true;
        if (!this.inCalled && this.t >= c.tLand) {
          this.inCalled = true;
          if ((this.s.hints || this.spec.tutorial) && !this.spec.exam && !this.wentIn) hud.floater('OUTFIELD! COME IN!', false, 50, 30);
        }
      }
      this.tl.sample(this.t);
      this._overrides(this.t);
      this._checkLane();
      if (c && c.gate && this.state === 'live') this._checkGate(c);
      // camera: keep the umpire, the ball, the base in play and the runners in frame
      const b = this.tl.ball;
      const pts = [{ x: this.ump.x, y: this.ump.y }, { x: b.x, y: b.y }];
      if (c) pts.push(c.base);
      if (this.plate && c) {
        // plays at the plate: stay close on you, the plate and the ball; bring the runner in once he's
        // on his way home (and the catcher while he chases a passed ball)
        const near = [{ x: this.ump.x, y: this.ump.y }, PLATE];
        if (Math.hypot(b.x, b.y) < 70) near.push({ x: b.x, y: b.y });
        if (c.gate && this.t < c.gate.t1 + 0.3) near.push(this.tl.actors.C);
        const R = this.tl.actors[c.runnerId];
        if (R && Math.hypot(R.x, R.y) < 48) near.push(R);
        this._frame(near, 18);
      } else {
        for (const id of ['BAT', 'R1', 'R2', 'R3']) { const a = this.tl.actors[id]; if (a) pts.push(a); }
        this._frame(pts);
      }
      if (this.state === 'after') {
        this.afterT += dt;
        if (this.afterT > 1.4 && this.afterDone) {
          const cb = this.afterDone;
          this.afterDone = null;
          cb();
        }
      }
      return;
    }
    if (this.callCam) {
      this.callCam.t += dt;
      ua.phase = Math.min(1, this.callCam.t / 0.4);
    }
    if (this.state === 'cam') {
      this.cam.update(dt);
      if (this.cam.three) {
        this.tl.sample(this.cam.ct);
        this._overrides(this.cam.ct);
        const cc = this.crits[this.critIdx];
        if (!cc.dusted && this.cam.ct >= cc.tr && this.s.field.dust) {
          cc.dusted = true;
          const bag = BAG[cc.baseNum];
          this.s.field.dust.emit(bag.x, bag.y, 0.25, cc.type === 'tag' ? 22 : 12, { size: cc.type === 'tag' ? 1.1 : 0.8, spread: 0.6, speed: 2.6, up: 2.2, life: 1.3 });
        }
      }
      const c = this.crits[this.critIdx];
      if (this.spec.demo && !c.called && this.cam.seenAt !== null && this.cam.real - this.cam.seenAt > 0.9) this._call(c.out ? 'out' : 'safe');
      if (!c.called && this.cam.seenAt !== null && this.cam.real - this.cam.seenAt > 6) this._call(null);
    }
  }

  // Passed ball: the catcher spins and runs back for it. Stay out of his way (open the gate), stepping to
  // the side away from the ball.
  _checkGate(c) {
    const g = c.gate, C = this.tl.actors.C;
    if (!this.bumped && this.t > g.t0 && this.t < g.t1 + 0.2 && Math.hypot(C.x - this.ump.x, C.y - this.ump.y) < 1.9) {
      this.bumped = true;
      audio.thud();
      this.s.shake(10);
      input.rumble(0.8, 0.8, 250);
      this.s.hud.floater('BUMP! Open the gate!', true);
    }
    if (this.gateOk === undefined && this.t >= g.t0 + 0.45) {
      // stepped at least a couple of feet to the side away from the ball, and nobody ran into anybody
      this.gateOk = !this.bumped && (this.ump.x - this.startPos.x) * -g.side >= 1.8;
      if (this.gateOk && (this.s.hints || this.spec.tutorial) && !this.spec.exam) this.s.hud.floater('✓ GATE OPEN', false, 50, 30);
    }
  }

  _checkLane() {
    if (this.ouched) return;
    const b = this.tl.ball;
    if (!b.visible || b.z > 6.5) return;
    // only thrown balls (fly segments) count
    const seg = this.tl.segs.find((s) => s.k === 'fly' && this.t >= s.t0 && this.t <= s.t1 && s.t0 > this.tPlate - 0.05);
    if (!seg) return;
    if (Math.hypot(b.x - this.ump.x, b.y - this.ump.y) < 1.5) {
      this.ouched = true;
      audio.ouch();
      audio.thud();
      this.s.shake(14);
      input.rumble(1, 1, 300);
      this.s.hud.floater('OUCH! Throwing lane!', true);
      this.s.profile.stats.ouch = (this.s.profile.stats.ouch || 0) + 1;
      this.penalties.push({ label: 'Hit by the throw', pts: -75 });
    }
  }

  _openCam(c) {
    this.state = 'cam';
    const moving = Math.hypot(this.ump.vx, this.ump.vy) > 1.5 || this.ump.still < 0.12;
    const fpos = this._fielderAt(c);
    const v = viewScore(this.ump, { ...c, fielder: fpos }, moving);
    c.view = v;
    c.moving = moving;
    if (c.route) c.holdDist = dist(c.route[0], this.ump);
    if (c.ideal) c.spotOff = dist(c.ideal, this.ump);
    // the wedge at the tag: you, the catcher and the runner. Open = you see into the gap between them.
    if (c.wedge) {
      const C = this.tl.actors[c.fielderId], R = this.tl.actors[c.runnerId];
      c.wedgeOpen = wedgeOpen(this.ump, C, R);
      const dTag = dist(this.ump, PLATE);
      c.inWedge = c.wedgeOpen >= WEDGE_OK && dTag >= 4 && dTag <= 24;
    }
    // Didn't move to the play? (the farther you should have gone and the less you went, the more it
    // counts; not coming in on a ball to the outfield counts too) It costs a few points and gets a tip.
    const sp0 = this.startPos || this.ump;
    const need = dist(sp0, c.ideal || c.base);
    const went = dist(sp0, this.ump);
    let lazy = need > 12 ? clamp(1 - went / need, 0, 1) : 0;
    if (c.working && !this.wentIn) lazy = Math.max(lazy, 0.65);
    c.lazy = lazy;
    // which way is the runner going in the umpire's view? (mirror the close-up if needed)
    const sight = norm(sub(c.base, this.ump));
    const runDir = norm(sub(c.runSeg[1], c.runSeg[0]));
    const mirror = cross(sight, runDir) < 0;
    const Cam = this.s.field.is3d ? UmpCam3D : UmpCam;
    const bag = BAG[c.baseNum];
    const glovePt = { ...c.throwSeg[1], z: c.throwSeg[1].z ?? 3 };
    // aim between the bag and the glove so both the foot and the catch are in the shot
    const aim = { x: (bag.x * 2 + glovePt.x) / 3, y: (bag.y * 2 + glovePt.y) / 3, z: (BAG_TOP + glovePt.z) / 2 };
    const half = Math.max(2.8, Math.hypot(glovePt.x - bag.x, glovePt.y - bag.y, glovePt.z - BAG_TOP) * 0.62 + 1.3);
    c.camView = { eye: { x: this.ump.x, y: this.ump.y, z: 4.7 }, target: aim, half, moving };
    this.cam = new Cam({
      points: { bag: { x: bag.x, y: bag.y, z: BAG_TOP + 0.2 }, glove: glovePt, tag: this._tagPoint(c) },
      type: c.type, tb: c.tb, tr: c.tr, tt: c.tt, pulled: c.pulled, dropped: c.dropped, dropT: c.dropT,
      missed: c.missed, empty: c.empty, slide: c.slide, mirror,
      quality: { angle: v.angle, distS: v.distS, occl: v.occl, moving },
      baseName: BASE_NAME[c.baseNum], speed: 0.4,
      skin: pick(SKINS),
    });
    this.cam.three = !!this.s.field.is3d;
    audio.whoosh(0.35);
    if (Math.abs(c.dt) < 0.22 || c.what) setTimeout(() => audio.ooh(), 250);
    // short (phone landscape) screens: the inset fills the top, so let the OUT/SAFE buttons speak
    if (innerHeight < 480) this.s.hud.prompt('', '');
    else this.s.hud.prompt('MAKE THE CALL!', c.baseNum === 4 ? 'Watch the plate — then call it' : 'Watch the bag — then call it');
    this.s.hud.options([
      { btn: 'A', id: 'out', label: 'OUT', big: true },
      { btn: 'B', id: 'safe', label: 'SAFE', big: true },
    ], (id) => this._call(id));
  }

  _call(id) {
    const c = this.crits[this.critIdx];
    if (c.called) return;
    c.called = id || 'none';
    const hud = this.s.hud;
    hud.options(null);
    const cam = this.cam;
    let timing;
    if (!id) timing = 'none';
    else if (cam.seenAt === null) timing = 'early';
    else {
      const since = cam.real - cam.seenAt;
      timing = since < 0.12 ? 'rushed' : since <= 2.6 ? 'perfect' : 'late';
    }
    const truth = c.out ? 'out' : 'safe';
    const correct = id === truth;
    // Signal
    this.signalPose = id === 'out' ? 'out' : id === 'safe' ? 'safe' : 'stand';
    this.umpActor.pose = this.signalPose;
    this.umpActor.phase = 1;
    if (id && cam && cam.three) {
      // broadcast "CALL CAM": cut to the umpire selling the call toward the bag
      this.callCam = { t: 0, id, base: { x: c.base.x, y: c.base.y } };
      this.umpActor.faceAt = this.callCam.base;
      this.umpActor.phase = 0;
      cam.callLabel = id === 'out' ? 'CALL CAM · OUT!' : 'CALL CAM · SAFE!';
      cam.flash = 0.6;
      hud.prompt('', '');
      audio.whoosh(0.25);
    }
    // a safe call on a pulled foot or a dropped ball says why: "Safe! He's off the bag!"
    const why = id === 'safe' && c.what === 'pulled' ? 'offBag' : id === 'safe' && c.what === 'dropped' ? 'ballDown' : null;
    if (id) voices.call(why || id, { close: Math.abs(c.dt) < 0.22 });
    hud.stamp(why === 'offBag' ? 'SAFE! OFF THE BAG!' : why === 'ballDown' ? "SAFE! BALL'S ON THE GROUND!" : id === 'out' ? 'OUT!' : id === 'safe' ? 'SAFE!' : 'NO CALL?!', `${id === 'out' ? 'gold' : 'good'}${this.callCam ? ' low' : ''}`);
    // Score
    const bonus = [];
    if (this.critIdx === 0 && !this.plate) {
      if (this.startOk) bonus.push({ label: `Started in ${this.expectSpot}`, pts: 50 });
      else bonus.push({ label: `Wrong start spot`, pts: -25 });
    }
    if (c.gate) bonus.push(this.bumped ? { label: 'Ran into the catcher', pts: -50 } : this.gateOk ? { label: 'Opened the gate', pts: 50 } : { label: 'Slow to open the gate', pts: -15 });
    if (c.wedge) bonus.push(c.inWedge ? { label: 'Kept the wedge open', pts: 50 } : { label: 'The wedge closed on you', pts: -25 });
    if (c.working) bonus.push(this.wentIn ? { label: 'Into the working area', pts: 50 } : { label: 'Stayed out on a ball to the outfield', pts: -25 });
    else if (c.lazy > 0.6 && !this.plate) bonus.push({ label: "Didn't move to the play", pts: -25 });
    if (this.spec.coach && this.spec.hold) bonus.push(c.holdDist <= 12 ? { label: 'Held your spot', pts: 25 } : { label: 'Wandered off on an infield ball', pts: -25 });
    else if (this.spec.coach && c.spotOff !== undefined && c.spotOff < 9) bonus.push({ label: 'Got to a good spot', pts: 25 });
    if (c.view.lane) bonus.push({ label: 'In the throwing lane', pts: -25 });
    if (c.moving) bonus.push({ label: 'Called it on the move', pts: -25 });
    for (const p of this.penalties) bonus.push(p);
    this.penalties = [];
    const bang = Math.abs(c.dt) < CLOSE_PLAY && !c.what;
    const res = {
      kind: 'base', sub: c.key, correct, timing, card: c.card,
      extraCards: [
        this.plate ? { id: 'plate-plays', correct: c.gate ? !!this.gateOk : !!c.inWedge } : { id: 'abc', correct: !!this.startOk },
        ...(c.working ? [{ id: 'tag-play', correct }] : []),
        // good positioning: set, a clear view, and out of the throwing lane
        { id: 'angles', correct: !c.moving && !c.view.occl && !c.view.lane },
        ...(bang ? [{ id: 'bang-bang', correct }] : []),
      ],
      bonus, startOk: this.critIdx === 0 && !this.plate ? this.startOk : undefined, bangBang: bang && correct,
      call: id, truth, division: this.div.id,
    };
    const scored = this.spec.demo ? null : this.s.record(res);
    this.calls.push({ correct, crit: c });
    // Let the play finish in the background, then show the verdict.
    setTimeout(() => {
      this.state = 'after';
      this.afterT = 0;
      this.afterDone = () => this._verdict(c, correct, truth, id, timing, scored);
      if (this.cam && this.cam.three) this.t = Math.max(this.t, Math.min(this.cam.ct, c.tFirst + 0.6));
      this.cam = null;
      this.callCam = null;
      hud.prompt('', '');
    }, this.callCam ? 1450 : 700);
  }

  // A lesson demo pauses as the runner reaches the bag: from the working area, watch the touch.
  _touchPause(c) {
    const hud = this.s.hud;
    this.touchHold = true;
    this.umpActor.faceAt = c.touch.base;
    hud.prompt('WATCH THE TOUCH!', `He's in the working area. Now pivot and watch the runner touch ${c.touch.name}. Glance at the touch, then pick the ball back up for the next play.`);
    hud.options([{ btn: 'A', id: 'go', label: 'CONTINUE', hot: true }], () => {
      this.touchHold = false;
      this.umpActor.faceAt = null;
      hud.options(null);
      hud.prompt('', '');
    });
  }

  // A lesson demo's wrap-up: what the umpire just did, and why
  _demoVerdict(c) {
    const hud = this.s.hud;
    const cap = this.spec.caption;
    this.s.showVerdict({ correct: true, info: true, title: "THAT'S THE MOVE!", sub: cap.title, body: cap.summary, card: c.card, scored: null }, () => {
      this.signalPose = null;
      this.umpActor.faceAt = null;
      if (this.critIdx === 0 && this.crits.length > 1) {
        this.critIdx++;
        this.state = 'live';
        this._prepCrit();
        hud.prompt('TURN TO FIRST!', 'Double play: a step or two for the angle on the relay');
        return;
      }
      this.s.eventDone();
    });
  }

  _verdict(c, correct, truth, id, timing, scored) {
    if (this.spec.demo) return this._demoVerdict(c);
    const hud = this.s.hud;
    const v = c.view;
    const lines = [];
    const by = Math.abs(c.dt).toFixed(2);
    if (c.what === 'pulled') lines.push(`The fielder's **foot came off the bag** before the ball got there — no force. **Safe.**`);
    else if (c.what === 'dropped') lines.push(`The ball **came out of the glove** — no secure possession. **Safe.**`);
    else if (c.what === 'missed') lines.push(`The tag **missed** — there was daylight between the glove and the runner. **Safe.**`);
    else if (c.what === 'empty') lines.push(`He tagged with an **empty glove** — the ball was in his other hand! A tag needs the ball. **Safe.**`);
    else if (c.type === 'force') lines.push(c.out ? `The ball beat the runner by **${by} s**. **Out.**` : `The runner beat the ball by **${by} s**. **Safe.**`);
    else { const spot = c.baseNum === 4 ? 'the plate' : 'the bag'; lines.push(c.out ? `The tag beat the runner to ${spot} by **${by} s**. **Out.**` : `The runner reached ${spot} **${by} s** before the tag. **Safe.**`); }
    if (Math.abs(c.dt) < CLOSE_PLAY && !c.what) lines.push('That was a true **bang-bang** play — and there\'s no such thing as a tie.');
    // Position coaching
    const tips = [];
    if (v.occl) tips.push('A fielder\'s body **blocked your view**. Step so you can see daylight between glove and runner.');
    if (v.lane) tips.push('You were **in the throwing lane**. Stay out of the ball\'s path.');
    if (c.moving) tips.push('You were **still moving** at the moment of the play. Get set — stop — then watch.');
    if (c.gate) tips.unshift(this.bumped ? 'You **ran into the catcher**. When a pitch gets by, **open the gate**: step out to the side **away from the ball** so he can get to it, then get an angle on the play at the plate.'
      : this.gateOk ? 'You **opened the gate** for the catcher. That\'s the move!' : 'Open the gate **right away**: the moment the ball gets by, step out to the side away from the ball.');
    if (c.wedge) tips.unshift(c.inWedge ? 'You **kept the wedge open**: the triangle of you, the catcher and the runner. You could see right into the gap where the tag happened. Nice!'
      : 'Work **the wedge**: the triangle formed by you, the catcher and the runner coming in. It changes as the play develops, so keep moving to keep it **open**. When the catcher and runner line up in front of you, the wedge is closed and one of them hides the tag.');
    if (c.working && !this.wentIn) tips.unshift('Ball to the outfield → **come in!** Move into the infield (the **working area**), pivot to watch the runner touch the bag, and be ready for the play at second or third.');
    else if (c.working) tips.unshift('You came into the **working area** on the hit to the outfield. That\'s the move!');
    else if (c.lazy > 0.6 && !this.plate) tips.unshift('You **barely moved**. Go get an angle while the play develops, then stop and watch.');
    if (this.critIdx === 0 && !this.startOk) tips.unshift(`Start in ${ZONE_HELP[this.expectSpot]}`);
    if (this.spec.coach) {
      if (this.spec.hold) tips.unshift(c.holdDist <= 12 ? 'Ball in the infield: you **held your spot** and adjusted. That\'s the move from B and C.' : 'Ball in the infield: from B or C, **hold your spot** and adjust a step or two. Don\'t chase the play.');
      else if (c.spotOff !== undefined) tips.push(c.spotOff < 9 ? 'You ended up right where the **gold dots** end. Nice!' : 'Compare your **white trail** with the **gold dots**: that\'s the track to a better angle.');
    }
    if (!tips.length) tips.push('Nice — you were set and could see the play.');
    const start = this.critIdx === 0 && !this.plate ? `Start: ${this.startOk ? `<b>✓ ${this.expectSpot}</b>` : `✗ should be in <b>${this.expectSpot}</b>`}` : '';
    let extra = `<div class="vcall">${start ? `📍 ${start}<br>` : ''}${mini(tips.join(' '))}</div>`;
    if (timing === 'early') extra += '<div class="vcall">⏱️ <b>Quick trigger!</b> You called it before the play was over. Let it finish, pause, then sell it.</div>';
    this.s.showVerdict({
      correct,
      title: correct ? pick(['GREAT CALL!', 'RIGHT ON!', 'SOLD IT!', 'MONEY!']) : 'MISSED CALL',
      sub: `You: ${id ? id.toUpperCase() : 'NO CALL'} · Correct: ${truth.toUpperCase()}`,
      body: lines.join(' '),
      extraHtml: extra,
      card: c.card,
      scored,
    }, () => {
      this.signalPose = null;
      this.umpActor.faceAt = null;
      if (this.critIdx === 0 && this.crits.length > 1) {
        this.critIdx++;
        this.state = 'live';
        this._prepCrit();
        hud.prompt('TURN TO FIRST!', 'Double play — get your angle on the relay');
        setTimeout(() => hud.prompt('', ''), 1500);
        return;
      }
      if (this.crits.length > 1 && this.calls.every((x) => x.correct)) this.s.profile.stats.dpBoth++;
      if (!this.plate) this.s.lastUmpPos = { x: this.ump.x, y: this.ump.y };
      this.s.eventDone();
    });
  }

  render(g) {
    const s = this.s;
    const actors = [...this.tl.list(), this.umpActor];
    const markers = [];
    if (this.state === 'position' && (s.hints || this.spec.tutorial) && !this.spec.exam) {
      const poly = startZonePoly(this.expectSpot);
      if (poly) markers.push({ poly, color: '#ffd34d', dash: [6, 5], label: this.expectSpot });
      else {
        const sp = UMP_SPOTS[this.expectSpot];
        markers.push({ x: sp.x, y: sp.y, r: 4, color: 'rgba(255,211,77,0.95)', dash: [6, 5], label: this.expectSpot });
      }
    }
    if (this.state === 'live' && (s.hints || this.spec.tutorial) && !this.spec.exam) {
      const c = this.crits[this.critIdx];
      if (c && c.working && this.t >= c.tLand - 0.4) markers.push({ poly: WORK_POLY, color: '#ffd34d', dash: [6, 5], label: 'WORKING AREA' });
      if (c && c.wedge && this.t >= c.tLand - 0.4) {
        // the wedge, live: you, the catcher and the runner coming in (green open, red closed)
        const C = this.tl.actors[c.fielderId], R = this.tl.actors[c.runnerId];
        if (C && R && Math.hypot(R.x, R.y) < 55) {
          const open = wedgeOpen(this.ump, C, R) >= WEDGE_OK;
          markers.push({ poly: [{ x: this.ump.x, y: this.ump.y }, { x: C.x, y: C.y }, { x: R.x, y: R.y }], color: open ? '#2fd67b' : '#ff5a5a', label: open ? 'WEDGE OPEN' : 'WEDGE CLOSED', labelS: 6 });
        }
      }
      if (c && c.gate && this.t > this.tPlate - 0.1 && this.gateOk === undefined) markers.push({ x: this.startPos.x - c.gate.side * 3, y: this.startPos.y, r: 1.4, color: '#ffd34d', pulse: true, label: 'STEP OUT' });
      if (c && c.ideal && this.t > this.tPlate - 0.2 && !c.wedge && (!c.gate || this.gateOk !== undefined)) markers.push({ x: c.ideal.x, y: c.ideal.y, r: 3.5, color: 'rgba(255,211,77,0.9)', dash: [5, 4] });
    }
    // the blink also gets a white ring so your eye finds you
    if (this.flashT !== null && this.flashT !== undefined) markers.push({ x: this.ump.x, y: this.ump.y, r: 3.4, color: '#ffffff', pulse: true });
    // where you went: a soft dotted trail from the pitch on (stays up through the call)
    const paths = this.track && this.track.length > 1 && this.state !== 'position' ? [{ pts: [...this.track, { x: this.ump.x, y: this.ump.y }], color: '#ffffff', r: 0.2, gap: 0.75 }] : [];
    const cr = this.crits[this.critIdx];
    if (cr && cr.route && ((this.spec.demo && this.state !== 'position') || (this.spec.coach && cr.called))) paths.push({ pts: cr.route, color: '#ffd34d', r: 0.32, gap: 1.3 });
    s.field.draw(g, s.cam, { actors, ball: this.tl.ball, markers, paths });
    if (this.state === 'cam' && this.cam) {
      const W = s.cam.w, H = s.cam.h;
      const portrait = H > W;
      const w = portrait ? W * 0.94 : Math.min(W * 0.62, H * 1.25);
      const h = portrait ? w * 0.68 : w * 0.56;
      const rect = { x: (W - w) / 2, y: portrait ? H * 0.2 : Math.max(H * 0.17, (H - h) / 2 - H * 0.06), w, h };
      if (!this.cam.three || !s.field.is3d) { this.cam.render(g, rect, s.app.dpr); return; }
      const dpr = s.app.dpr;
      const css = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };
      const c = this.crits[this.critIdx];
      if (this.callCam) {
        const cc = this.callCam;
        const u = this.ump;
        let dx = cc.base.x - u.x, dy = cc.base.y - u.y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        const push = 1.18 - 0.18 * Math.min(1, cc.t / 1.2);
        const back = Math.min(10, Math.max(5, dl * 0.6)) * push;
        const kick = cc.id === 'out' ? Math.max(0, 1 - Math.abs(cc.t - 0.32) / 0.12) * 0.12 : 0;
        const eye = { x: u.x + dx * back - dy * back * 0.38, y: u.y + dy * back + dx * back * 0.38, z: 4.3 + kick };
        const fov = 2 * Math.atan(3.4 / back);
        s.field.drawInset({ eye, target: { x: u.x, y: u.y, z: 3.5 }, fov }, css, { actors: [...this.tl.list(), this.umpActor], ball: this.tl.ball }, 1);
        this.cam.renderOverlay(g, rect, dpr, () => null);
        return;
      }
      const v = c.camView;
      const d = Math.max(4, Math.hypot(v.target.x - v.eye.x, v.target.y - v.eye.y, v.target.z - v.eye.z));
      const fov = 2 * Math.atan((v.half || 3.1) / d);
      const jit = v.moving ? 0.12 : 0;
      const tt = performance.now() / 1000;
      const eye = { x: v.eye.x + Math.sin(tt * 31) * jit, y: v.eye.y + Math.cos(tt * 27) * jit, z: v.eye.z + Math.sin(tt * 23) * jit };
      const q = this.cam.q;
      const block = q.distS >= 0.85 ? 1 : Math.round(lerp(7, 2, clamp((q.distS - 0.3) / 0.55, 0, 1)));
      s.field.drawInset({ eye, target: v.target, fov }, css, { actors: this.tl.list(), ball: this.tl.ball }, block);
      this.cam.renderOverlay(g, rect, dpr, (pt) => {
        const pp = s.field.projectInset(pt, css);
        return pp.behind ? null : { x: pp.x * dpr, y: pp.y * dpr };
      });
    }
  }
}
