// On the bases: you control the base umpire. Start in the right spot (A/B/C),
// move for an angle while the play develops, stop, then make the call in the UMP CAM.
import { audio } from '../audio.js';
import { voices } from '../voice.js';
import { input } from '../input.js';
import { clamp, lerp, rand, randInt, pick, chance, weighted, dist, norm, sub, add, mul, dot, segDist } from '../util.js';
import { KITS, SKINS } from '../render/figures.js';
import { BASES, UMP_SPOTS, POS } from '../render/field.js';
import { Timeline, setupDefense, setupRunners, setupBatter, BASE_XY } from './timeline.js';
import { UmpCam, UmpCam3D } from './umpcam.js';

const B1 = BASES.first, B2 = BASES.second, B3 = BASES.third, HOME = BASES.home;
const BASE_NAME = { 1: '1ST BASE', 2: '2ND BASE', 3: '3RD BASE' };
const BAG = { 1: { x: B1.x - 0.9, y: B1.y }, 2: { x: B2.x, y: B2.y }, 3: { x: B3.x + 0.9, y: B3.y } };
const BAG_TOP = 0.3;
// A play decided by less than this (seconds) counts as a "bang-bang" play.
const CLOSE_PLAY = 0.16;
// Diamond interior (inside the baselines) — Little League umpires work from outside it.
function insideDiamond(p) {
  return p.y > Math.abs(p.x) + 2 && p.y < BASES.second.y - Math.abs(p.x) - 2;
}

function cross(a, b) { return a.x * b.y - a.y * b.x; }

// How good is the view of the critical moment from point p?
export function viewScore(p, crit, moving = false) {
  const d = dist(p, crit.base);
  const sight = norm(sub(crit.base, p));
  const angle = Math.abs(cross(sight, crit.motion));
  let distS;
  if (d < 6) distS = 0.45;
  else if (d < 11) distS = lerp(0.65, 1, (d - 6) / 5);
  else if (d <= 30) distS = 1;
  else if (d <= 50) distS = lerp(1, 0.7, (d - 30) / 20);
  else if (d <= 90) distS = lerp(0.7, 0.35, (d - 50) / 40);
  else distS = 0.3;
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
  const score = (0.25 + 0.75 * angle) * distS * (occl ? 0.4 : 1) * (lane ? 0.6 : 1) * (runway ? 0.7 : 1) * (moving ? 0.7 : 1);
  return { score, angle, distS, occl, lane, runway, d, moving };
}

// Best reachable spot (searched on rings around the base).
function idealSpot(crit, from, maxTravel = 200) {
  let best = null;
  for (let r = 10; r <= 34; r += 4) {
    for (let a = 0; a < 360; a += 8) {
      const ang = (a * Math.PI) / 180;
      const p = { x: crit.base.x + Math.cos(ang) * r, y: crit.base.y + Math.sin(ang) * r };
      if (p.y < -8 || Math.hypot(p.x, p.y) > 190) continue;
      if (dist(p, from) > maxTravel) continue;
      const v = viewScore(p, crit);
      // prefer spots that don't require a marathon, and fair territory near the infield
      // Foul ground between home and first/third is the runner's lane — never a good spot
      const foul = Math.abs(p.x) > p.y;
      const s = v.score - dist(p, from) * 0.0015 - (foul && p.y < 44 ? 0.3 : foul ? 0.05 : 0) - (insideDiamond(p) ? 0.15 : 0);
      if (!best || s > best.s) best = { ...p, s, v };
    }
  }
  return best;
}

function gradeFor(r) {
  if (r >= 0.85) return 'A';
  if (r >= 0.7) return 'B';
  if (r >= 0.5) return 'C';
  if (r >= 0.35) return 'D';
  return 'F';
}
const GRADE_PTS = { A: 100, B: 70, C: 40, D: 15, F: 0 };
const GRADE_COLOR = { A: '#2fd67b', B: '#b9f36b', C: '#ffd34d', D: '#ff9a3c', F: '#ff4d5a' };

export class BasePlayEvent {
  constructor(session, spec = {}) {
    this.s = session;
    this.div = session.div;
    this.spec = spec;
    this.kind = 'base';
    this.play = spec.play || weighted([
      ['force1B', 5], ['steal2B', 3], ['dp', this.div.id === 'AA' ? 1 : 3], ['pickoff1B', 2], ['steal3B', 2],
    ]);
    this.outs = spec.outs ?? randInt(0, 1);
    this.ump = { x: 0, y: 0, vx: 0, vy: 0, still: 0 };
    const start = session.lastUmpPos || { x: 58, y: 22 };
    this.ump.x = start.x; this.ump.y = start.y;
    this.umpActor = { x: this.ump.x, y: this.ump.y, kit: session.umpKit, skin: session.umpSkin, pose: 'set', ring: true, glove: null, facing: -1 };
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
    this.runners = runners;
    this.expectSpot = runners.includes(2) || runners.includes(3) ? 'C' : runners.includes(1) ? 'B' : 'A';
    setupDefense(tl);
    const hand = chance(0.7) ? 'R' : 'L';
    setupBatter(tl, hand);
    setupRunners(tl, runners);
    tl.actor('PU', { x: 0, y: -6.3, kit: this.s.umpKit, skin: pick(SKINS), pose: 'set', glove: null, mask: true });
    const tP = 0.3;
    // Pitch
    tl.pose('P', tP, 'pitch');
    tl.actors.P.keys[tl.actors.P.keys.length - 1].dur = 1.0;
    tl.hold(0, tP + 0.8, 'P', 5.0);
    const tPlate = tP + 0.8 + rand(0.55, 0.7);
    this.tPlate = tPlate;
    tl.pose('P', tP + 1.1, 'ready');
    const pitchFrom = { x: -1, y: 42, z: 5 };
    const sp = this.div.id === 'AA' ? 0.8 : this.div.id === 'AAA' ? 0.9 : 1;
    const builders = { force1B: this._force1B, steal2B: this._steal, steal3B: this._steal, dp: this._dp, pickoff1B: this._pickoff };
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
    const pulled = chance(0.12);
    const dropped = !pulled && chance(0.1);
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
    // Fielder fields it and throws
    tl.move(fielder, tPlate, tg - 0.05, fp.x, fp.y, 'ready');
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
    tl.move('R1', tReact, tr, back.x, back.y, 'dive', 'run');
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
    tl.move(fielder, tPlate, tg - 0.05, fp.x, fp.y, 'ready');
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
    hud.prompt('TAKE YOUR POSITION', `${rtxt} · ${this.outs} out${this.outs === 1 ? '' : 's'} · You're the base umpire`);
    hud.options([{ btn: 'A', id: 'set', label: "I'M SET — PITCH!", big: true }], () => this._go());
    if (this.s.hints && !this.spec.exam) {
      const spot = this.expectSpot;
      const why = { A: 'Bases empty → start in <b>A</b>: foul ground behind first base.', B: 'Runner on 1st only → start in <b>B</b>: outside the baseline between first and second, near second base.', C: 'Runner on 2nd or 3rd → start in <b>C</b>: outside the baseline between second and third, near second base.' }[spot];
      hud.tip(`${why} Move with ${this.s.moveHint()}.`);
    }
    this.s.rig.set({ x: 8, y: 52 }, 62, 0.72);
    this.posTimer = 0;
  }

  _go() {
    if (this.state !== 'position') return;
    const hud = this.s.hud;
    hud.tip(null);
    hud.options(null);
    // Grade the starting spot
    let nearest = null, nd = Infinity;
    for (const k of ['A', 'B', 'C']) {
      const d = dist(this.ump, UMP_SPOTS[k]);
      if (d < nd) { nd = d; nearest = k; }
    }
    this.startOk = nearest === this.expectSpot && nd < 10;
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
    c.tFirst = Math.min(c.tb, c.tr, c.tt ?? Infinity);
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
  _frame(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ext = clamp(Math.max((x1 - x0) / 2, ((y1 - y0) / 2) * 0.85) + 16, 42, 105);
    this.s.rig.set({ x: cx, y: cy + 4 }, ext, 0.78);
  }

  update(dt) {
    const hud = this.s.hud;
    const m = input.move;
    const canMove = this.state === 'position' || this.state === 'live' || this.state === 'after';
    // Umpire movement (feet per second)
    const maxV = 17, acc = 70;
    const tvx = canMove ? m.x * maxV : 0, tvy = canMove ? m.y * maxV : 0;
    const k = Math.min(1, (acc * dt) / Math.max(1, Math.hypot(tvx - this.ump.vx, tvy - this.ump.vy)));
    this.ump.vx += (tvx - this.ump.vx) * k;
    this.ump.vy += (tvy - this.ump.vy) * k;
    if (this.state === 'cam') { this.ump.vx = 0; this.ump.vy = 0; }
    const step = (this.state === 'live' ? this.timeScale : 1) * dt;
    this.ump.x = clamp(this.ump.x + this.ump.vx * step, -75, 75);
    this.ump.y = clamp(this.ump.y + this.ump.vy * step, -15, 140);
    const speed = Math.hypot(this.ump.vx, this.ump.vy);
    this.ump.still = speed < 1.5 ? this.ump.still + dt : 0;
    const ua = this.umpActor;
    ua.x = this.ump.x; ua.y = this.ump.y;
    if (!this.signalPose) {
      if (speed > 2) { ua.pose = 'run'; ua.dist = (ua.dist || 0) + speed * step; ua.phase = (ua.dist / 5.2) % 1; if (Math.abs(this.ump.vx) > 1) ua.facing = this.ump.vx > 0 ? 1 : -1; }
      else ua.pose = this.ump.still > 0.25 ? 'set' : 'stand';
    }

    if (this.state === 'position') {
      this.posTimer += dt;
      this._frame([{ x: this.ump.x, y: this.ump.y }, UMP_SPOTS[this.expectSpot], { x: 0, y: 0 }, BASES.second, BASES.first, BASES.third]);
      return;
    }
    if (this.state === 'live' || this.state === 'after') {
      const c = this.crits[this.critIdx];
      // Slow-mo approach to the critical moment
      if (this.state === 'live' && c) {
        const until = c.tFirst - this.t;
        this.timeScale = until < 0.6 ? lerp(this.timeScale, 0.35, 0.15) : 1;
        if (until <= 0.32) return this._openCam(c);
      } else this.timeScale = 1;
      this.t += dt * this.timeScale;
      this.tl.sample(this.t);
      this._overrides(this.t);
      this._checkLane();
      // camera: keep the umpire, the ball, the base in play and the runners in frame
      const b = this.tl.ball;
      const pts = [{ x: this.ump.x, y: this.ump.y }, { x: b.x, y: b.y }];
      if (c) pts.push(c.base);
      for (const id of ['BAT', 'R1', 'R2', 'R3']) { const a = this.tl.actors[id]; if (a) pts.push(a); }
      this._frame(pts);
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
      if (!c.called && this.cam.seenAt !== null && this.cam.real - this.cam.seenAt > 6) this._call(null);
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
    const ideal = c.ideal || idealSpot({ ...c, fielder: fpos }, this.ump);
    const ratio = clamp(v.score / Math.max(0.2, ideal.v.score), 0, 1);
    c.view = v;
    c.grade = gradeFor(ratio);
    c.ratio = ratio;
    c.moving = moving;
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
      gradeLabel: `ANGLE ${c.grade}`, gradeColor: GRADE_COLOR[c.grade],
      skin: pick(SKINS),
    });
    this.cam.three = !!this.s.field.is3d;
    audio.whoosh(0.35);
    if (Math.abs(c.dt) < 0.22 || c.what) setTimeout(() => audio.ooh(), 250);
    // short (phone landscape) screens: the inset fills the top, so let the OUT/SAFE buttons speak
    if (innerHeight < 480) this.s.hud.prompt('', '');
    else this.s.hud.prompt('MAKE THE CALL!', 'Watch the bag — then call it');
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
    if (id) voices.call(id, { close: Math.abs(c.dt) < 0.22 });
    hud.stamp(id === 'out' ? 'OUT!' : id === 'safe' ? 'SAFE!' : 'NO CALL?!', `${id === 'out' ? 'gold' : 'good'}${this.callCam ? ' low' : ''}`);
    // Score
    const bonus = [];
    if (this.critIdx === 0) {
      if (this.startOk) bonus.push({ label: `Started in ${this.expectSpot}`, pts: 50 });
      else bonus.push({ label: `Wrong start spot`, pts: -25 });
    }
    bonus.push({ label: `Angle grade ${c.grade}`, pts: GRADE_PTS[c.grade] });
    if (c.view.lane) bonus.push({ label: 'In the throwing lane', pts: -25 });
    if (c.moving) bonus.push({ label: 'Called it on the move', pts: -25 });
    for (const p of this.penalties) bonus.push(p);
    this.penalties = [];
    const bang = Math.abs(c.dt) < CLOSE_PLAY && !c.what;
    const res = {
      kind: 'base', sub: c.key, correct, timing, card: c.card,
      extraCards: [
        { id: 'abc', correct: !!this.startOk },
        { id: 'angles', correct: c.grade === 'A' || c.grade === 'B' },
        ...(bang ? [{ id: 'bang-bang', correct }] : []),
      ],
      bonus, grade: c.grade, startOk: this.critIdx === 0 ? this.startOk : undefined, bangBang: bang && correct,
      call: id, truth, division: this.div.id,
    };
    const scored = this.s.record(res);
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

  _verdict(c, correct, truth, id, timing, scored) {
    const hud = this.s.hud;
    const v = c.view;
    const lines = [];
    const by = Math.abs(c.dt).toFixed(2);
    if (c.what === 'pulled') lines.push(`The fielder's **foot came off the bag** before the ball got there — no force. **Safe.**`);
    else if (c.what === 'dropped') lines.push(`The ball **came out of the glove** — no secure possession. **Safe.**`);
    else if (c.what === 'missed') lines.push(`The tag **missed** — there was daylight between the glove and the runner. **Safe.**`);
    else if (c.what === 'empty') lines.push(`He tagged with an **empty glove** — the ball was in his other hand! A tag needs the ball. **Safe.**`);
    else if (c.type === 'force') lines.push(c.out ? `The ball beat the runner by **${by} s**. **Out.**` : `The runner beat the ball by **${by} s**. **Safe.**`);
    else lines.push(c.out ? `The tag beat the runner to the bag by **${by} s**. **Out.**` : `The runner reached the bag **${by} s** before the tag. **Safe.**`);
    if (Math.abs(c.dt) < CLOSE_PLAY && !c.what) lines.push('That was a true **bang-bang** play — and there\'s no such thing as a tie.');
    // Position coaching
    const tips = [];
    if (v.occl) tips.push('A fielder\'s body **blocked your view**. Step so you can see daylight between glove and runner.');
    if (v.lane) tips.push('You were **in the throwing lane**. Stay out of the ball\'s path.');
    if (c.moving) tips.push('You were **still moving** at the moment of the play. Get set — stop — then watch.');
    if (v.angle < 0.55 && !v.occl) tips.push(`Poor angle: you were looking **along** the ${c.type === 'force' ? 'throw' : 'runner\'s path'}. Aim for about **90°** to it.`);
    if (v.d > 50) tips.push('You were **too far away**. Close the distance while the ball is in the air.');
    if (v.d < 7) tips.push('You were **too close** — back off so you can see the whole play.');
    if (!tips.length) tips.push('Great positioning: good angle, good distance, and you were set.');
    let extra = `<div class="vcall">📐 Angle grade: <b style="color:${GRADE_COLOR[c.grade]}">${c.grade}</b> · ${Math.round(c.ratio * 100)}% of the best view${this.critIdx === 0 ? ` · Start: ${this.startOk ? `<b>✓ ${this.expectSpot}</b>` : `✗ should be <b>${this.expectSpot}</b>`}` : ''}<br>${tips.join(' ')}</div>`;
    if (timing === 'early') extra += '<div class="vcall">⏱️ <b>Quick trigger!</b> You called it before the play was over. Let it finish, pause, then sell it.</div>';
    // Show the best spot on the field
    this.showIdeal = c.ideal;
    this.s.showVerdict({
      correct,
      title: correct ? pick(['GREAT CALL!', 'RIGHT ON!', 'SOLD IT!', 'MONEY!']) : 'MISSED CALL',
      sub: `You: ${id ? id.toUpperCase() : 'NO CALL'} · Correct: ${truth.toUpperCase()}`,
      body: lines.join(' '),
      extraHtml: extra,
      card: c.card,
      scored,
      note: 'The gold ring on the field shows a great spot for that play.',
    }, () => {
      this.showIdeal = null;
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
      this.s.lastUmpPos = { x: this.ump.x, y: this.ump.y };
      this.s.eventDone();
    });
  }

  render(g) {
    const s = this.s;
    const actors = [...this.tl.list(), this.umpActor];
    const markers = [];
    if (this.state === 'position' && (s.hints || this.spec.tutorial) && !this.spec.exam) {
      const sp = UMP_SPOTS[this.expectSpot];
      markers.push({ x: sp.x, y: sp.y, r: 4, color: 'rgba(255,211,77,0.95)', dash: [6, 5], label: this.expectSpot });
    }
    if (this.state === 'live' && (s.hints || this.spec.tutorial) && !this.spec.exam) {
      const c = this.crits[this.critIdx];
      if (c && c.ideal && this.t > this.tPlate - 0.2) markers.push({ x: c.ideal.x, y: c.ideal.y, r: 3.5, color: 'rgba(255,211,77,0.9)', dash: [5, 4] });
    }
    if (this.showIdeal) markers.push({ x: this.showIdeal.x, y: this.showIdeal.y, r: 3.5, color: '#ffd34d', width: 4, label: '★' });
    s.field.draw(g, s.cam, { actors, ball: this.tl.ball, markers });
    if (this.state === 'cam' && this.cam) {
      const W = s.cam.w, H = s.cam.h;
      const portrait = H > W;
      const w = portrait ? W * 0.94 : Math.min(W * 0.62, H * 1.25);
      const h = portrait ? w * 0.68 : w * 0.56;
      const rect = { x: (W - w) / 2, y: portrait ? H * 0.2 : Math.max(H * 0.17, (H - h) / 2 - H * 0.06), w, h };
      if (!this.cam.three) { this.cam.render(g, rect, s.app.dpr); return; }
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
