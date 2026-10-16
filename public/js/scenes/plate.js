// Behind the dish: the plate umpire's first-person view.
// One AtBatEvent = one batter, pitch after pitch, until the at-bat ends.
import { audio } from '../audio.js';
import { voices, playerName } from '../voice.js';
import { input } from '../input.js';
import { clamp, lerp, rand, randInt, pick, chance, weighted, easeOut, newSeed, seededRng, withRng } from '../util.js';
import { KITS, SKINS } from '../render/figures.js';
import { pitcherJoints, PITCHER_LIMBS } from './pitcher3d.js';
import { solveLimbs, drawHero } from '../render3d/hero.js';
import { Painter2D } from '../render/hero2d.js';
import { POS, UMP_SPOTS, BASES } from '../render/field.js';
import { sport, ballR, ballColor } from '../sport.js';

let BALL_R = 0.121; // feet: a baseball is 2.9 in across; set per game (the softball is bigger)
const HALF = 0.708; // half of 17 in
const GRAV = 32.17;
const GLOVE_Y = -1.25;
const MPH = 1.4667;
const LOOK_Z = -1.2; // camera aims a little below the zone so the plate sits mid-screen

const FUN_FACTS = [
  '🍕 Pizza fanatic', '🐶 Has 3 dogs', '🎮 Gamer', '⚡ Fastest kid on the team', '🌻 Seed-spitting champ',
  '🎸 Air guitar legend', '🧢 Lucky cap (unwashed)', '🍦 Ice cream expert', '🐢 Pet turtle named Speedy',
  '🏀 Also plays hoops', '🥤 Blue slushie only', '🦖 Dino expert', '🎯 Never misses at cornhole',
  '🍬 Bubble gum record holder', '🛹 Skateboards to practice', '🎤 Sings the anthem in the shower',
  '🐟 Caught a 5-lb bass', '📚 Reads the rulebook for fun', '🥞 Pancake eating champ', '🚀 Wants to be an astronaut',
];

export function makeBatter(div, opts = {}) {
  const hand = opts.hand || (chance(0.7) ? 'R' : 'L');
  const H = opts.height || rand(div.heights[0], div.heights[1]);
  const crouch = opts.crouch || rand(0.9, 1.0);
  const side = hand === 'R' ? -1 : 1;
  return {
    hand, H, crouch, side,
    knee: 0.29 * H * (0.94 + 0.06 * crouch),
    armpit: 0.715 * H * crouch,
    bx: side * rand(2.25, 2.6),
    by: rand(0.3, 1.0),
    skin: opts.skin || pick(SKINS),
    num: randInt(1, 42),
    name: playerName(),
    batColor: pick(['#2a3550', '#1b1d22', '#5a1220', '#1d4a3a']),
    batAccent: pick(['#d62839', '#ffd34d', '#35d07f', '#4da3ff']),
    gloveTone: pick(['#f1f1f1', '#1b1d22', '#d62839']),
    line: `BATS ${hand} · AVG .${randInt(180, 455)} · ${pick(FUN_FACTS)}`,
  };
}

function halfW(y) {
  return y >= 0.706 ? HALF : HALF * Math.max(0, y) / 0.706;
}

// Signed distance (ft) of the ball center from the edge of the "any part of the ball touches any part of the zone" region.
function margin(x, z, y, zone) {
  const hw = halfW(y) + BALL_R + (zone.wide || 0);
  const ex = hw - Math.abs(x);
  const et = zone.top + BALL_R - z;
  const eb = z - (zone.bot - BALL_R);
  if (ex >= 0 && et >= 0 && eb >= 0) return Math.min(ex, et, eb);
  const ox = Math.min(0, ex), ot = Math.min(0, et), ob = Math.min(0, eb);
  return -Math.hypot(ox, Math.min(ot, ob));
}

function judge(traj, zone) {
  let best = -Infinity, at = null;
  for (let i = 0; i <= 10; i++) {
    const y = 1.414 * (i / 10);
    const p = traj.atY(y);
    if (!p) continue;
    const m = margin(p.x, p.z, y, zone);
    if (m > best) { best = m; at = p; }
  }
  // Where it crossed the front of the plate (for the K-Zone picture)
  const front = traj.atY(1.0);
  return { strike: best >= 0, margin: best, at: at || front, front };
}

// Pitch trajectory: release → target at y=1.0 (mid-plate), with break and an optional bounce.
function makeTraj(rel, target, mph, brk) {
  const v = mph * MPH;
  const T = (rel.y - 1.0) / v;
  const ax = brk.ax || 0;
  const az = -GRAV + (brk.lift || 0);
  const vx = (target.x - rel.x - 0.5 * ax * T * T) / T;
  const vz = (target.z - rel.z - 0.5 * az * T * T) / T;
  const raw = (t) => ({ x: rel.x + vx * t + 0.5 * ax * t * t, y: rel.y - v * t, z: rel.z + vz * t + 0.5 * az * t * t });
  // bounce time (if the pitch hits the dirt before reaching the glove)
  let tb = null;
  const tGlove = (rel.y - GLOVE_Y) / v;
  for (let t = 0; t < tGlove; t += 0.004) {
    if (raw(t).z <= BALL_R) { tb = t; break; }
  }
  const traj = {
    v, T, tGlove, tb, rel, target, mph,
    pos(t) {
      if (tb === null || t <= tb) return raw(t);
      const p0 = raw(tb);
      const vzb = -(vz + az * tb) * 0.42;
      const dt = t - tb;
      return { x: p0.x + vx * 0.75 * dt, y: p0.y - v * 0.62 * dt, z: Math.max(BALL_R, BALL_R + vzb * dt - 0.5 * GRAV * dt * dt) };
    },
    atY(y) {
      const t = (rel.y - y) / v;
      if (tb !== null && t > tb) return null;
      return raw(t);
    },
    tAtY(y) {
      if (tb === null) return (rel.y - y) / v;
      // after a bounce the ball slows down
      const yb = raw(tb).y;
      if (y >= yb) return (rel.y - y) / v;
      return tb + (yb - y) / (v * 0.62);
    },
  };
  return traj;
}

// Choose a crossing point near the zone edge so the call is a real test.
function chooseLocation(zone, div, wantStrike, edgeIn) {
  const e = edgeIn / 12;
  const cx = HALF + BALL_R + (zone.wide || 0), top = zone.top + BALL_R, bot = zone.bot - BALL_R;
  const sideEdge = weighted([['in', 3], ['out', 3], ['high', 2], ['low', 3], ['corner', 2]]);
  let x, z;
  const midZ = rand(bot + 0.25, top - 0.25);
  const midX = rand(-cx + 0.2, cx - 0.2);
  const s = wantStrike ? -1 : 1;
  switch (sideEdge) {
    case 'in': x = -(cx + s * e); z = midZ; break; // "in" = third-base side; flipped per batter below
    case 'out': x = cx + s * e; z = midZ; break;
    case 'high': x = midX; z = top + s * e; break;
    case 'low': x = midX; z = bot - s * e; break;
    default: {
      const sx = chance(0.5) ? 1 : -1, sz = chance(0.5) ? 1 : -1;
      const ee = wantStrike ? e : e * 0.75;
      x = sx * (cx + s * ee);
      z = sz > 0 ? top + s * ee : bot - s * ee;
    }
  }
  return { x, z, edge: sideEdge };
}

const OPTS = {
  zone: [
    { btn: 'A', id: 'strike', label: 'STRIKE', big: true },
    { btn: 'B', id: 'ball', label: 'BALL', big: true },
  ],
  check: [
    { btn: 'A', id: 'strike', label: 'STRIKE', sub: 'He went — that was a swing' },
    { btn: 'B', id: 'ball', label: 'BALL', sub: 'He held up — no swing' },
  ],
  contact: [
    { btn: 'A', id: 'tip', label: 'FOUL TIP', sub: 'Strike — ball stays live' },
    { btn: 'B', id: 'foul', label: 'FOUL BALL', sub: 'Dead ball — hands up' },
    { btn: 'X', id: 'catch', label: 'CATCH — OUT!', sub: 'Caught fly ball' },
  ],
  bunt2: [
    { btn: 'A', id: 'foul', label: 'FOUL BALL', sub: 'Count stays at two strikes' },
    { btn: 'B', id: 'k', label: 'STRIKE THREE', sub: 'Foul bunt with two strikes — out' },
  ],
  hbp: [
    { btn: 'A', id: 'strike', label: 'STRIKE', sub: 'Dead ball' },
    { btn: 'B', id: 'ball', label: 'BALL', sub: 'Dead ball' },
    { btn: 'X', id: 'hbp', label: 'HIT BY PITCH', sub: 'Take your base' },
  ],
  u3k: [
    { btn: 'A', id: 'out', label: "STRIKE 3 — HE'S OUT", sub: 'Batter is out' },
    { btn: 'B', id: 'run', label: 'STRIKE 3 — HE CAN RUN', sub: 'Uncaught third strike' },
  ],
};

export class AtBatEvent {
  constructor(session, spec = {}) {
    this.s = session;
    this.div = session.div;
    this.spec = spec;
    this.kind = 'atbat';
    this.batter = spec.batter || makeBatter(this.div);
    const gs = session.game;
    this.outs = spec.outs ?? gs.outs;
    this.runners = spec.runners ?? [...gs.runners];
    this.balls = 0;
    this.strikes = spec.strikes ?? 0;
    if (spec.balls !== undefined) this.balls = spec.balls;
    this.pitchNo = 0;
    this.maxPitches = spec.maxPitches || randInt(4, 6);
    this.eye = session.lastSlot ? { ...session.lastSlot } : { x: 0.0, z: 3.5 };
    this.state = 'setup';
    this.t = 0;
    this.allowMove = true;
    BALL_R = ballR(this.div);
    this.pitcherHand = chance(0.8) ? 'R' : 'L';
    this.pitcherSkin = pick(SKINS);
    this.catcherSkin = pick(SKINS);
    this.pitcherNum = randInt(1, 40);
    this.catcherNum = randInt(2, 40);
    this.catcherX = 0;
    this.glove = { x: 0, z: 2.2, y: GLOVE_Y };
    this.armAnim = -1;
    this.trail = [];
    this.divots = []; // where the current pitch dug into the dirt
    this.puffs2d = []; // 2D renderer: dirt puffs to animate
    this.lookZ = LOOK_Z;
    // The zone is the rulebook zone in Majors and up; the younger divisions get a little more room
    // (wider and taller), the way umpires call it for kid-pitch.
    const grow = { AA: { w: 0.17, t: 0.22, b: 0.15 }, AAA: { w: 0.08, t: 0.11, b: 0.08 } }[this.div.id] || { w: 0, t: 0, b: 0 };
    this.zone = { bot: this.batter.knee - grow.b, top: this.batter.armpit + grow.t, wide: grow.w };
    this.fast = !!spec.fast; // blitz mode: snappier pacing
    this.bg = this._bgActors();
    this.setupHinted = false;
  }

  _bgActors() {
    const list = [];
    const fieldSkins = SKINS;
    let i = 0;
    for (const k of ['1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF']) {
      list.push({ ...POS[k], kit: KITS.def, skin: fieldSkins[i++ % fieldSkins.length], pose: 'ready', glove: 'F' });
    }
    const r = this.runners;
    const spot = r.includes(2) || r.includes(3) ? UMP_SPOTS.C : r.includes(1) ? UMP_SPOTS.B : UMP_SPOTS.A;
    list.push({ x: spot.x, y: spot.y, kit: this.s.umpKit, skin: SKINS[1], pose: 'set' });
    const baseXY = { 1: BASES.first, 2: BASES.second, 3: BASES.third };
    for (const b of r) list.push({ x: baseXY[b].x + (b === 1 ? -1 : b === 3 ? 1 : 0), y: baseXY[b].y - 1, kit: KITS.off, skin: pick(SKINS), pose: 'stand' });
    this.pitcher = { x: 0, y: sport.softball ? sport.rubber + 0.35 : 46.6, kit: KITS.def, skin: this.pitcherSkin, pose: 'stand', glove: 'F', mirror: this.pitcherHand === 'L' };
    list.push(this.pitcher);
    return list;
  }

  start() {
    const hud = this.s.hud;
    hud.setBug({ balls: this.balls, strikes: this.strikes, outs: this.outs, runners: this.runners });
    if (this.fast) {
      // Blitz: auto-set in the slot and go
      this.eye = { x: this.batter.side * 0.85, z: 3.95 };
      this.slotOk = true;
      this._newPitch();
      return;
    }
    this._enterSetup();
  }

  // ---------- Slot setup ----------
  slotInfo() {
    const side = this.batter.side;
    const x = this.eye.x, z = this.eye.z;
    const ideal = side * 0.85;
    let msg = 'In the slot. Nice!', short = 'IN THE SLOT', ok = true;
    if (Math.abs(x) < 0.42) { msg = "You're straight behind the catcher — the helmet blocks the plate!"; short = 'BEHIND THE CATCHER'; ok = false; }
    else if (Math.sign(x) !== side) { msg = 'Wrong side! Set up in the slot on the batter\'s side.'; short = 'WRONG SIDE'; ok = false; }
    else if (Math.abs(x) > 1.35) { msg = 'Too close to the batter — slide toward the catcher.'; short = 'TOO CLOSE TO BATTER'; ok = false; }
    else if (z > 4.4) { msg = 'Too high — get your chin just above the catcher\'s helmet.'; short = 'TOO HIGH'; ok = false; }
    else if (z < 3.55) { msg = 'Too low — the catcher is blocking your view.'; short = 'TOO LOW'; ok = false; }
    const score = clamp(1 - Math.abs(x - ideal) / 0.9, 0, 1) * clamp(1 - Math.abs(z - 3.95) / 0.9, 0, 1);
    return { ok, msg, short, score };
  }

  _enterSetup() {
    this.state = 'setup';
    this.allowMove = true;
    const hud = this.s.hud;
    const handTxt = this.batter.hand === 'R' ? 'Right-handed batter' : 'Left-handed batter';
    hud.prompt(this.pitchNo === 0 ? 'GET IN THE SLOT' : 'RESET YOUR STANCE', `${handTxt} · move with ${this.s.moveHint()} · then Play Ball!`);
    hud.setMode('slot');
    hud.options([{ btn: 'A', id: 'ready', label: 'PLAY BALL!', big: true }], () => this._afterSetup());
    if (this.pitchNo === 0 && !this.fast) {
      setTimeout(() => voices.batter(this.batter), 250);
      hud.lowerThird(this.batter);
    }
    if (this.s.hints && !this.spec.exam && !this.setupHinted && (this.s.slotTips = (this.s.slotTips || 0) + 1) <= 2) {
      this.setupHinted = true;
      this.slotTip = 0;
      hud.tip('<b>The slot</b> is the gap between the batter and the catcher. Put your head there with your chin just above the catcher\'s helmet so you can see the whole plate. You can keep adjusting the whole at-bat.');
    }
  }

  _afterSetup() {
    this.s.hud.setMode(null);
    this.slotTip = null;
    const si = this.slotInfo();
    this.s.lastSlot = { ...this.eye };
    this.slotOk = si.ok;
    this.s.hud.tip(null);
    if (!si.ok) this.s.hud.floater('Out of the slot!', true);
    this._newPitch();
  }

  // ---------- Pitch generation ----------
  // Each pitch gets its own seed, so TRY AGAIN can throw the exact same pitch again.
  _newPitch(seed = null) {
    this.pitchSeed = seed ?? newSeed();
    this.pitchBefore = { balls: this.balls, strikes: this.strikes, pitchNo: this.pitchNo };
    withRng(seededRng(this.pitchSeed), () => this._genPitch());
  }

  // TRY AGAIN: rewind the count and throw the same pitch (practice, no points). Afterwards the
  // at-bat picks up from the original call.
  _retryPitch() {
    clearTimeout(this._autoNext);
    const hud = this.s.hud;
    hud.kzone(null);
    hud.options(null);
    hud.prompt('', '');
    if (!this.resume) this.resume = { balls: this.balls, strikes: this.strikes, pitchNo: this.pitchNo, end: this.lastEnd };
    const b = this.pitchBefore;
    this.balls = b.balls; this.strikes = b.strikes; this.pitchNo = b.pitchNo;
    this.practice = true;
    this.s.practice = true;
    this.glove = { x: 0, y: GLOVE_Y, z: 2.2 };
    this.lookZ = LOOK_Z;
    this.catcherStand = 0;
    hud.setBug({ balls: Math.min(this.balls, 3), strikes: Math.min(this.strikes, 2), outs: this.outs, runners: this.runners });
    hud.stamp('TRY AGAIN!', 'gold');
    this._newPitch(this.pitchSeed);
  }

  _genPitch() {
    const d = this.div;
    const st = this.strikes, bl = this.balls;
    const forced = this.spec.forceKinds ? this.spec.forceKinds[this.pitchNo] : null;
    let kind = forced || weighted([
      ['take', 58],
      ['swingMiss', 10],
      ['contact', 11],
      ['check', 7],
      ['hbp', 4],
      ['inPlay', this.pitchNo >= 3 ? 8 : 2],
      ['u3k', st === 2 && d.u3k ? 14 : 0], // dropped third strike: Majors and above only
      ['bunt2', st === 2 ? 4 : 0],
    ]);
    if (this.spec.only) kind = pick(this.spec.only);
    if ((kind === 'u3k' || kind === 'bunt2') && st !== 2) kind = 'take';
    if (kind === 'u3k' && !d.u3k) kind = 'swingMiss';
    this.pk = { kind, t: 0, released: false, called: null, callT: null, decided: false };
    const pk = this.pk;
    const mph = rand(d.mph[0], d.mph[1]) * (this.fast ? 1.05 : 1);
    const big = d.id === 'MAJ' || d.id === 'AS' || d.id === 'WS';
    let pitchType, brk, speed, rel;
    if (sport.softball) {
      // Windmill: released low by the hip, so the ball climbs toward the zone. Drop balls dive,
      // rise balls hop, change-ups float in slow.
      pitchType = d.id === 'AA' ? 'fb' : weighted([['fb', 6], ['ch', 2], ['drop', big ? 2 : 1], ['rise', big ? 2 : 0]]);
      brk = pitchType === 'drop' ? { lift: -9, ax: 0 } : pitchType === 'rise' ? { lift: 16, ax: 0 } : pitchType === 'ch' ? { lift: 3, ax: 0 } : { lift: 6, ax: (this.pitcherHand === 'R' ? -1 : 1) * rand(0, 2) };
      speed = pitchType === 'ch' ? mph * 0.78 : pitchType === 'drop' ? mph * 0.95 : mph;
      rel = { x: (this.pitcherHand === 'R' ? -1 : 1) * rand(0.68, 0.85), y: sport.rubber + 0.35 - rand(2.8, 3.1), z: rand(1.65, 2.0) };
    } else {
      pitchType = d.id === 'AA' ? 'fb' : weighted([['fb', 6], ['ch', 2], ['cb', big ? 2 : 0]]);
      brk = pitchType === 'fb' ? { lift: 12, ax: 0 } : pitchType === 'ch' ? { lift: 7, ax: 0 } : { lift: -7, ax: (this.pitcherHand === 'R' ? 1 : -1) * rand(3, 7) };
      speed = pitchType === 'fb' ? mph : mph * (pitchType === 'ch' ? 0.85 : 0.8);
      rel = { x: (this.pitcherHand === 'R' ? -1 : 1) * rand(0.9, 1.3), y: 42.0, z: rand(4.6, 5.2) };
    }
    pk.rel = rel;
    pk.pitchType = pitchType;
    const b = this.batter;
    const zone = this.zone;
    let target;
    const edgeIn = chance(0.25) ? rand(4, 9) : rand(d.edge[0], d.edge[1]);
    pk.edgeIn = edgeIn;

    switch (kind) {
      case 'take':
      case 'swingMiss': {
        const want = kind === 'swingMiss' ? chance(0.45) : chance(0.5);
        target = chooseLocation(zone, d, want, kind === 'swingMiss' ? rand(1, 8) : edgeIn);
        break;
      }
      case 'check': {
        target = chooseLocation(zone, d, false, rand(2, 7));
        pk.went = chance(0.5);
        break;
      }
      case 'contact': {
        target = { x: rand(-0.4, 0.4), z: rand(zone.bot + 0.3, zone.top - 0.2) };
        pk.sub = weighted([['foulSide', 4], ['foulBack', 2], ['foulTip', 4], ['foulTipDrop', 2], ['popCaught', 2]]);
        // foul balls: which way and how hard (angle measured from straight out; past 45 degrees is foul)
        pk.foulDir = chance(0.5) ? 1 : -1;
        pk.foulAng = rand(0.92, 1.3);
        pk.foulV = rand(55, 80);
        pk.foulVz = rand(5, 15);
        break;
      }
      case 'bunt2': {
        target = { x: rand(-0.4, 0.4), z: rand(zone.bot + 0.4, zone.top - 0.3) };
        pk.bunt = true;
        break;
      }
      case 'u3k': {
        target = { x: rand(-0.6, 0.6), z: rand(-0.6, 0.4) }; // in the dirt
        pk.sub = chance(0.7) ? 'dirt' : 'drop';
        if (pk.sub === 'drop') target = { x: rand(-0.6, 0.6), z: rand(zone.bot, zone.bot + 0.8) };
        break;
      }
      case 'hbp': {
        pk.sub = weighted([['elbow', 3], ['hands', 2], ['swungHit', 2], ['leanIn', 2], ['inZone', 1]]);
        const inside = b.side; // ball toward the batter
        const bodyX = Math.abs(b.bx);
        if (pk.sub === 'inZone') {
          // batter crowds the plate with his elbow over it
          target = { x: inside * 0.5, z: zone.top - 0.2 };
        } else if (pk.sub === 'leanIn') {
          target = { x: inside * (HALF + BALL_R + rand(0.45, 0.6)), z: rand(zone.bot + 0.5, zone.top - 0.2) };
          pk.leanDist = bodyX - 0.3 - Math.abs(target.x);
        } else if (pk.sub === 'hands') {
          target = { x: inside * (bodyX - 0.38), z: zone.top + 0.5 };
        } else if (pk.sub === 'swungHit') {
          target = { x: inside * (bodyX - 1.0), z: zone.top - 0.12 };
        } else {
          target = { x: inside * (bodyX - 0.32), z: rand(zone.bot + 0.7, zone.top + 0.1) };
        }
        break;
      }
      case 'inPlay':
      default:
        target = { x: rand(-0.4, 0.4), z: rand(zone.bot + 0.2, zone.top - 0.2) };
        pk.sub = chance(0.5) ? 'grounder' : 'fly';
    }
    // "in" and "out" are relative to the batter: flip the x of the side edges for left-handed batters
    if (target.edge === 'in' || target.edge === 'out') target.x *= -b.side;
    pk.target = target;
    pk.traj = makeTraj(rel, target, speed, brk);
    pk.judge = judge(pk.traj, zone);
    pk.mph = speed;
    // Timing
    const tr = this.fast ? 0.55 : 0.8; // release time after windup starts
    pk.tRelease = tr;
    pk.tPlate = tr + pk.traj.tAtY(1.0);
    pk.tGlove = tr + pk.traj.tAtY(GLOVE_Y);
    // Swing scheduling
    pk.swing = null;
    if (kind === 'swingMiss' || kind === 'contact' || kind === 'u3k' || kind === 'inPlay' || (kind === 'hbp' && pk.sub === 'swungHit')) {
      pk.swing = { start: pk.tPlate - 0.2, dur: 0.38, max: 1 };
    } else if (kind === 'check') {
      pk.swing = { start: pk.tPlate - 0.17, dur: 0.3, max: pk.went ? 0.78 : 0.34, hold: true };
    } else if (kind === 'bunt2') {
      pk.bunt = { start: pk.tRelease - 0.3 };
    }
    // Batter lean for some HBPs
    pk.lean = kind === 'hbp' && (pk.sub === 'leanIn') ? { start: pk.tPlate - 0.25 } : null;
    pk.crowd = kind === 'hbp' && pk.sub === 'inZone';
    // Catcher set-up spot: near the target, a little noisy
    this.catcherX = clamp(target.x * 0.6 + rand(-0.15, 0.15), -0.7, 0.7);
    this.glove = { x: this.catcherX + rand(-0.2, 0.2), y: GLOVE_Y, z: clamp((zone.bot + zone.top) / 2 + rand(-0.4, 0.2), 1.2, 3.2) };
    this.gloveFrom = { ...this.glove };
    pk.contactT = pk.tPlate - 0.02;
    pk.events = [];
    this.divots = [];
    this._buildBallPath();
    this.state = 'pre';
    this.t = 0;
    this.s.hud.prompt('', '');
    // Smart zone box news: back on after a miss, or earned away with right calls
    this.zoneNews = this.s.zoneNews;
    this.s.zoneNews = null;
    if (this.zoneNews === 'on') this.s.hud.prompt('🎯 ZONE BOX ON', 'You missed one. It goes away when you nail 3 in a row!');
    if (this.zoneNews === 'off') this.s.hud.prompt('🔥 ZONE BOX OFF', "Three right in a row. You don't need it!");
    this.s.hud.options(null);
    this.armAnim = -1;
  }

  // Build a function for the ball's position over pitch time, including what happens after contact.
  _buildBallPath() {
    const pk = this.pk;
    const tr = pk.tRelease;
    const traj = pk.traj;
    const gloveAt = traj.pos(pk.tGlove - tr);
    pk.catchPos = { x: gloveAt.x, y: GLOVE_Y, z: Math.max(0.4, gloveAt.z) };
    const kind = pk.kind;
    const sub = pk.sub;
    pk.state = 'flight';
    const ct = pk.contactT;
    const atContact = traj.pos(ct - tr);
    pk.ballAt = (t) => {
      if (t < tr) return null;
      if (kind === 'contact' || kind === 'bunt2' || kind === 'inPlay' || kind === 'hbp') {
        if (t < ct) return traj.pos(t - tr);
        const dt = t - ct;
        if (kind === 'hbp') {
          // drop from the point of contact
          const p = this.pk.hitPoint || atContact;
          return { x: p.x - this.batter.side * dt * 3, y: p.y - dt * 4, z: Math.max(BALL_R, p.z - 6 * dt - 16 * dt * dt) };
        }
        if (kind === 'bunt2') {
          // a two-strike bunt that trickles into foul ground and stops
          const roll = (1 - Math.exp(-dt * 1.2)) / 1.2;
          return { x: atContact.x + this.batter.side * -roll * 10, y: atContact.y + roll * 6, z: Math.max(BALL_R, atContact.z - dt * 10 - 10 * dt * dt) };
        }
        if (kind === 'inPlay') {
          const vz = sub === 'fly' ? 38 : -6;
          return { x: atContact.x + dt * 12 * this.batter.side, y: atContact.y + dt * 95, z: Math.max(BALL_R, atContact.z + vz * dt - 16 * dt * dt) };
        }
        if (sub === 'foulBack') {
          // popped straight back and up into the backstop and stands
          return { x: atContact.x + dt * 18 * pk.foulDir, y: atContact.y - dt * 58, z: atContact.z + dt * 30 - 16 * dt * dt };
        }
        if (sub === 'foulSide') {
          // pulled or sliced hard into foul ground past the first- or third-base line: one hop, then a roll
          const vx = Math.sin(pk.foulAng) * pk.foulV * pk.foulDir, vy = Math.cos(pk.foulAng) * pk.foulV;
          const z0 = atContact.z, vz0 = pk.foulVz;
          const tLand = (vz0 + Math.sqrt(vz0 * vz0 + 64 * z0)) / 32;
          if (dt < tLand) return { x: atContact.x + vx * dt, y: atContact.y + vy * dt, z: z0 + vz0 * dt - 16 * dt * dt };
          const d2 = dt - tLand;
          const hop = Math.abs(vz0 - 32 * tLand) * 0.35;
          const roll = (0.6 * (1 - Math.exp(-d2 * 1.2))) / 1.2;
          return { x: atContact.x + vx * (tLand + roll), y: atContact.y + vy * (tLand + roll), z: Math.max(BALL_R, hop * d2 - 16 * d2 * d2) };
        }
        if (sub === 'popCaught') {
          const T = 2.4; // time to come down
          const u = Math.min(dt, T);
          const end = { x: this.catcherX - 0.4, y: -3.0, z: 4.6 };
          const k = u / T;
          return { x: lerp(atContact.x, end.x, k), y: lerp(atContact.y, end.y, k), z: atContact.z + (end.z - atContact.z) * k + 4 * 22 * k * (1 - k) };
        }
        // foul tip variants: deflect slightly into the glove
        const tg = 0.06;
        if (dt < tg) {
          const k = dt / tg;
          return { x: lerp(atContact.x, pk.catchPos.x, k), y: lerp(atContact.y, GLOVE_Y, k), z: lerp(atContact.z, pk.catchPos.z + 0.25, k) };
        }
        if (sub === 'foulTipDrop') {
          const d2 = dt - tg;
          return { x: pk.catchPos.x + d2 * 1.5, y: GLOVE_Y - d2 * 1.5, z: Math.max(BALL_R, pk.catchPos.z + 0.25 + 4 * d2 - 16 * d2 * d2) };
        }
        return { ...pk.catchPos, z: pk.catchPos.z + 0.25 };
      }
      // Pitches that reach the catcher
      if (t < pk.tGlove) return traj.pos(t - tr);
      const dt = t - pk.tGlove;
      if (kind === 'u3k') {
        // Not legally caught: blocked in the dirt or popped out of the mitt
        const p0 = pk.catchPos;
        if (sub === 'drop') {
          const roll = (1 - Math.exp(-dt * 1.4)) / 1.4;
          return { x: p0.x + roll * 3, y: GLOVE_Y + roll * 3.5, z: Math.max(BALL_R, p0.z + 5 * dt - 16 * dt * dt) };
        }
        // blocked in the dirt: it kicks off the catcher and rolls to a stop out in front
        const roll = (1 - Math.exp(-dt * 1.4)) / 1.4;
        return { x: p0.x + roll * 3, y: GLOVE_Y + roll * 3.2, z: Math.max(BALL_R, 0.5 + 3 * dt - 16 * dt * dt) };
      }
      return { ...this.glove };
    };
  }

  // ---------- Loop ----------
  // Where the umpire is looking: straight out at the pitcher, or following a foul ball.
  // Is the umpire watching the ball right now? Any time where it goes decides the call: anything
  // hit, a hit-by-pitch, and a third strike from the moment it heads for the dirt.
  _following() {
    const pk = this.pk;
    if (!pk || this.state === 'pre' || this.state === 'setup') return false;
    const k = pk.kind;
    if (k === 'contact' || k === 'bunt2' || k === 'inPlay' || k === 'hbp') return pk.t > pk.contactT;
    if (k === 'u3k') return pk.t > (pk.traj.tb !== null ? pk.tRelease + pk.traj.tb - 0.12 : pk.tGlove - 0.05);
    return false;
  }

  // the umpire's eye, including stepping out of the stance on plays around the plate
  _eyePos() {
    const o = this.eyeOff || { x: 0, y: 0, z: 0 };
    return { x: this.eye.x + o.x, y: -4.3 + o.y, z: this.eye.z + o.z };
  }

  _updateLook(dt) {
    const pk = this.pk;
    const follow = this._following();
    // on plays right around the plate (dropped third strike, HBP, tips, bunts), come up out of the
    // stance and step out so the catcher doesn't block the ball
    const close = follow && (pk.kind === 'u3k' || pk.kind === 'hbp' || pk.kind === 'bunt2' || (pk.kind === 'contact' && (pk.sub === 'foulTip' || pk.sub === 'foulTipDrop')));
    const side = this.eye.x >= 0 ? 1 : -1;
    const wantOff = close ? { x: side * 1.7, y: 0.25, z: 1.0 } : { x: 0, y: 0, z: 0 };
    const off = this.eyeOff || { x: 0, y: 0, z: 0 };
    const ko = 1 - Math.exp(-dt * 4);
    this.eyeOff = { x: off.x + (wantOff.x - off.x) * ko, y: off.y + (wantOff.y - off.y) * ko, z: off.z + (wantOff.z - off.z) * ko };
    const eye = this._eyePos();
    let want = { x: this.eye.x * 0.25 - eye.x, y: 25 - eye.y, z: this.lookZ - eye.z };
    if (follow) {
      const b = pk.ballAt(pk.t);
      if (b) want = { x: b.x - eye.x, y: b.y - eye.y, z: b.z - eye.z };
      this.trail.push(b ? { x: b.x, y: b.y, z: b.z } : null);
      if (this.trail.length > 8) this.trail.shift();
    } else if (this.trail.length) this.trail.length = 0;
    const wl = Math.hypot(want.x, want.y, want.z) || 1;
    want = { x: want.x / wl, y: want.y / wl, z: want.z / wl };
    const cur = this.lookDir || want;
    const k = 1 - Math.exp(-dt * (follow ? 7 : 5));
    const nx = cur.x + (want.x - cur.x) * k, ny = cur.y + (want.y - cur.y) * k, nz = cur.z + (want.z - cur.z) * k;
    const nl = Math.hypot(nx, ny, nz) || 1;
    this.lookDir = { x: nx / nl, y: ny / nl, z: nz / nl };
  }

  update(dt) {
    this.t += dt;
    this._updateLook(dt);
    const hud = this.s.hud;
    // you can shift around in the slot the whole at-bat, not just while setting up
    const m = this.finished ? { x: 0, y: 0 } : input.move;
    this.eye.x = clamp(this.eye.x + m.x * dt * 1.6, -1.8, 1.8);
    this.eye.z = clamp(this.eye.z + m.y * dt * 1.3, 2.9, 4.9);
    const si = this.slotInfo();
    // between pitches a small badge shows where you stand; it goes away once the ball is hit or called
    hud.slotChip(this.state === 'setup' || this.zoneNews || this.finished || !this.pk || this.pk.called || this._following() ? null : si);
    if (this.state === 'setup') {
      hud.promptSub(`${si.ok ? '✅' : '⚠️'} ${si.msg}`);
      // the slot tip gets out of the way once you start moving (or after a few seconds)
      if (this.slotTip !== null && this.slotTip !== undefined) {
        this.slotTip += dt * (Math.abs(m.x) + Math.abs(m.y) > 0.15 ? 6 : 1);
        if (this.slotTip > 8) { hud.tip(null); this.slotTip = null; }
      }
      return;
    }
    if (this.state === 'pre') {
      this.pitcher.pose = 'stand';
      if (this.t > (this.fast ? 0.25 : 0.55)) { this.state = 'pitch'; this.t = 0; }
      return;
    }
    if (this.state === 'signal') this.armAnim += dt;
    if (this.pk && (this.state === 'pitch' || this.state === 'signal' || this.state === 'wait')) {
      const pk = this.pk;
      pk.t += dt;
      const t = pk.t;
      const live = this.state === 'pitch';
      this.pitcher.pose = 'pitch';
      this.pitcher.phase = clamp((t * 0.8) / pk.tRelease, 0, 1);
      if (!pk.released && t >= pk.tRelease) {
        pk.released = true;
        if (this.zoneNews) { this.zoneNews = null; hud.prompt('', ''); }
        audio.whoosh(Math.max(0.25, pk.tGlove - pk.tRelease));
        if (live && !pk.called && this._isZoneCall()) {
          hud.options(this._optsFor(), (id) => this._call(id));
        }
      }
      // the slot counts where you are as the pitch reaches the plate
      if (pk.slotOk === undefined && t >= pk.tPlate) {
        pk.slotOk = this.slotInfo().ok;
        this.s.lastSlot = { ...this.eye };
      }
      // a pitch in the dirt: a big puff and a divot where it hit, so it's obvious
      if (!pk.bounceDone && pk.traj.tb !== null && t >= pk.tRelease + pk.traj.tb && (!pk.contactT || pk.kind === 'u3k' || t < pk.contactT)) {
        pk.bounceDone = true;
        const p = pk.traj.pos(pk.traj.tb);
        this.divots.push({ x: p.x, y: p.y });
        this._dirtPuff(p.x, p.y, 1);
        audio.thud();
      }
      if (pk.swing && !pk.swingSnd && t >= pk.swing.start) { pk.swingSnd = true; audio.swing(); }
      // Catcher reaches for the ball late in its flight
      if (pk.kind !== 'contact' || pk.sub !== 'popCaught') {
        const reachStart = pk.tGlove - 0.16;
        if (t > reachStart && t <= pk.tGlove) {
          const k = easeOut((t - reachStart) / 0.16);
          this.glove.x = lerp(this.gloveFrom.x, pk.catchPos.x, k);
          this.glove.z = lerp(this.gloveFrom.z, pk.catchPos.z, k);
        }
      }
      // Contact moments
      if (!pk.contactDone && ['contact', 'bunt2', 'inPlay', 'hbp'].includes(pk.kind) && t >= pk.contactT) {
        pk.contactDone = true;
        if (pk.kind === 'hbp') {
          pk.hitPoint = pk.traj.pos(pk.contactT - pk.tRelease);
          audio.thud();
          audio.ouch();
          this.s.shake(6);
          pk.flinch = t;
        } else if (pk.kind === 'contact' && (pk.sub === 'foulTip' || pk.sub === 'foulTipDrop')) {
          audio.tick();
          setTimeout(() => audio.pop(), 60);
        } else {
          audio.crack();
        }
      }
      // Pop into the glove
      if (!pk.popped && t >= pk.tGlove && ['take', 'swingMiss', 'check', 'u3k'].includes(pk.kind)) {
        pk.popped = true;
        audio.pop();
        this.glove = { ...pk.catchPos };
        this.gloveFrom = { ...this.glove };
        // Framing: sneak the glove toward the middle of the zone
        const zMid = (this.zone.bot + this.zone.top) / 2;
        pk.frame = { x: clamp(-this.glove.x * 0.0 + (0 - this.glove.x) * 0.35, -0.3, 0.3), z: clamp((zMid - this.glove.z) * 0.3, -0.3, 0.3) };
        pk.framed = !pk.judge.strike && pk.kind === 'take' && Math.abs(pk.judge.margin) < 0.25 && (Math.abs(pk.frame.x) > 0.08 || Math.abs(pk.frame.z) > 0.08);
        if (pk.kind === 'u3k') audio.thud();
        // a very low pitch: the catcher scoops it right off the dirt
        if (!pk.bounceDone && pk.catchPos.z < 0.8) this._dirtPuff(pk.catchPos.x, GLOVE_Y + 0.2, 0.55);
      }
      if (pk.popped && pk.frame && pk.kind === 'take') {
        const k = clamp((t - pk.tGlove) / 0.25, 0, 1);
        this.glove.x = this.gloveFrom.x + pk.frame.x * easeOut(k);
        this.glove.z = this.gloveFrom.z + pk.frame.z * easeOut(k);
      }
      if (pk.kind === 'contact' && pk.sub === 'popCaught' && t > pk.contactT) {
        const k = clamp((t - pk.contactT) / 2.4, 0, 1);
        this.lookZ = LOOK_Z + Math.sin(k * Math.PI) * 14;
        this.catcherStand = Math.min(1, (t - pk.contactT) / 0.6);
        this.glove = { x: lerp(this.glove.x, this.catcherX - 0.4, 0.1), y: -3.0, z: lerp(this.glove.z, 4.6, 0.1) };
        if (k >= 1 && !pk.caughtPop) { pk.caughtPop = true; audio.pop(); }
      }
      // When does the special decision open?
      if (live && !pk.decisionOpen && !this._isZoneCall()) {
        let openAt = Infinity;
        // fouls wait until you've watched the ball go foul
        if (pk.kind === 'contact') openAt = pk.sub === 'popCaught' ? pk.contactT + 2.5 : pk.sub === 'foulBack' ? pk.contactT + 1.1 : pk.sub === 'foulSide' ? pk.contactT + 1.3 : pk.contactT + 0.8;
        if (pk.kind === 'bunt2') openAt = pk.contactT + 1.5;
        if (pk.kind === 'hbp') openAt = pk.contactT + 0.8;
        if (pk.kind === 'u3k') openAt = pk.tGlove + 1.0;
        if (pk.kind === 'inPlay') openAt = pk.contactT + 0.9;
        if (t >= openAt) {
          pk.decisionOpen = true;
          if (pk.kind === 'inPlay') {
            hud.prompt('IN PLAY!', 'No call needed — the batter put it in play.');
            setTimeout(() => this._endAtBat('inplay'), this.fast ? 400 : 1300);
            this.state = 'wait';
          } else {
            const q = { contact: 'WHAT WAS THAT?', bunt2: 'TWO-STRIKE BUNT…', hbp: 'HIT BY PITCH?', u3k: 'STRIKE THREE… NOW WHAT?' }[pk.kind];
            const sub = pk.kind === 'u3k' ? this._u3kContext() : '';
            hud.prompt(q, sub);
            hud.options(this._optsFor(), (id) => this._call(id));
            pk.openT = t;
          }
        }
      }
      // No call at all
      if (live && pk.released && !pk.called && this._isZoneCall() && t > pk.tGlove + 4.5) this._call(null);
    }
  }

  _u3kContext() {
    const first = this.runners.includes(1) ? 'Runner on 1st' : '1st base open';
    return `${first} · ${this.outs} out${this.outs === 1 ? '' : 's'} · ${this.div.name}`;
  }

  _isZoneCall() {
    const k = this.pk.kind;
    return k === 'take' || k === 'swingMiss' || k === 'check';
  }

  _optsFor() {
    const k = this.pk.kind;
    if (k === 'take' || k === 'swingMiss') return OPTS.zone;
    if (k === 'check') return OPTS.check;
    return OPTS[k] || OPTS.zone;
  }

  onAction(act) {
    // options are routed through the HUD; nothing else to do here
    return false;
  }

  // ---------- The call ----------
  _call(id) {
    const pk = this.pk;
    if (pk.called) return;
    const t = pk.t;
    pk.called = id || 'none';
    pk.callT = t;
    const hud = this.s.hud;
    hud.options(null);
    let truth, correct, timing = null;
    const k = pk.kind;
    if (k === 'take') truth = pk.judge.strike ? 'strike' : 'ball';
    else if (k === 'swingMiss') truth = 'strike';
    else if (k === 'check') truth = pk.went ? 'strike' : 'ball';
    else if (k === 'contact') truth = pk.sub === 'foulTip' ? 'tip' : pk.sub === 'popCaught' ? 'catch' : 'foul';
    else if (k === 'bunt2') truth = 'k';
    else if (k === 'hbp') truth = pk.sub === 'swungHit' || pk.sub === 'inZone' ? 'strike' : pk.sub === 'leanIn' ? 'ball' : 'hbp';
    else if (k === 'u3k') truth = (this.div.u3k && (!this.runners.includes(1) || this.outs === 2)) ? 'run' : 'out';
    correct = id === truth;
    if (k === 'take' && !this.spec.exam) this.s.zoneCall(correct);

    if (this._isZoneCall()) {
      const since = pk.called === 'none' ? 99 : t - pk.tGlove;
      if (pk.called === 'none') timing = 'none';
      else if (since < -0.02) timing = 'early';
      else if (since < 0.22) timing = 'rushed';
      else if (since <= 1.7) timing = 'perfect';
      else timing = 'late';
    }

    // Signal + voice
    const strikeCall = id === 'strike' || id === 'k' || id === 'out' || id === 'run' || id === 'tip';
    this.state = 'signal';
    this.armAnim = strikeCall ? 0 : -1;
    {
      // what the count will be after this call (judgment calls stand)
      let b = this.balls, st = this.strikes;
      if (id === 'strike' || id === 'tip') st++;
      if (id === 'ball') b++;
      const kind = id === 'strike' ? (st >= 3 ? 'k' : 'strike') : id === 'ball' ? (b >= 4 ? 'bb' : 'ball') : id === 'catch' ? 'out' : id === 'out' || id === 'run' ? 'k' : id;
      if (id && id !== 'none') voices.call(kind, { balls: Math.min(b, 3), strikes: Math.min(st, 2), fast: this.fast });
    }
    const stampTxt = { strike: 'STRIKE!', ball: 'BALL', tip: 'FOUL TIP!', foul: 'FOUL!', catch: 'OUT!', k: 'STRIKE 3!', hbp: 'TAKE YOUR BASE', out: 'STRIKE 3!', run: 'STRIKE 3!', none: 'NO CALL?!' }[pk.called];
    hud.stamp(stampTxt, pk.called === 'ball' ? '' : 'gold');

    // Build result
    const res = {
      kind: 'pitch', sub: k, correct, timing, card: this._card(),
      painted: k === 'take' && correct && Math.abs(pk.judge.margin) * 12 < 1,
      framedFoiled: k === 'take' && correct && pk.framed,
      slotOk: pk.slotOk ?? this.slotInfo().ok,
      edgeIn: pk.judge.margin * 12,
      call: id, truth,
      strikeThree: (truth === 'strike' && this.strikes === 2) || truth === 'k',
      hands: k === 'hbp' && pk.sub === 'hands',
      division: this.div.id,
    };
    const scored = this.s.record(res);

    // Count update: judgment calls stand; rule decisions get the correct ruling.
    let end = null;
    const callForCount = (k === 'take' || k === 'check') ? (id === 'strike' ? 'strike' : id === 'ball' ? 'ball' : truth) : truth;
    if (k === 'take' || k === 'check' || k === 'swingMiss') {
      if (callForCount === 'strike') { this.strikes++; if (this.strikes >= 3) end = 'k'; }
      else { this.balls++; if (this.balls >= 4) end = 'bb'; }
    } else if (k === 'contact') {
      if (truth === 'catch') end = 'out';
      else if (truth === 'tip') { this.strikes++; if (this.strikes >= 3) end = 'k'; }
      else if (this.strikes < 2) this.strikes++;
    } else if (k === 'bunt2') end = 'k';
    else if (k === 'hbp') {
      if (truth === 'hbp') end = 'hbp';
      else if (truth === 'strike') { this.strikes++; if (this.strikes >= 3) end = 'k'; }
      else { this.balls++; if (this.balls >= 4) end = 'bb'; }
    } else if (k === 'u3k') end = truth === 'run' ? 'u3k-run' : 'k';
    this.pitchNo++;
    this.lastEnd = end;

    const delay = this.fast ? 200 : 650;
    setTimeout(() => {
      // Feedback
      if (this._isZoneCall()) {
        if (k === 'take') {
          hud.kzone({ zone: this.zone, at: pk.judge.at, strike: pk.judge.strike, margin: pk.judge.margin, side: this.batter.side, correct, timing });
        } else {
          hud.kzone(null);
        }
        const pre = this.practice ? 'PRACTICE: ' : '';
        if (k !== 'take') {
          const why = k === 'swingMiss' ? (correct ? 'He swung — strike, no matter where it was.' : 'He SWUNG! A swing and a miss is always a strike.') : pk.went ? 'The bat came all the way around — that\'s an attempt to hit.' : 'He held up — the bat never came around.';
          hud.prompt(pre + (correct ? 'GOOD CALL!' : 'MISSED IT!'), why);
        } else if (timing === 'early') {
          hud.prompt(pre + (correct ? 'RIGHT CALL… TOO SOON!' : 'MISSED IT!'), 'Quick trigger! See the ball into the glove, pause, THEN call it.');
        } else if (timing === 'none') {
          hud.prompt(pre + 'NO CALL!', 'You have to make a call on every pitch.');
        } else {
          hud.prompt(pre + (correct ? 'GOOD CALL!' : 'MISSED IT!'), '');
        }
        hud.setBug({ balls: Math.min(this.balls, 3), strikes: Math.min(this.strikes, 2), outs: this.outs, runners: this.runners });
        const wait = this.fast ? 300 : 1500;
        this._continueAfter(wait, end, correct && timing !== 'early' && timing !== 'none');
      } else {
        this.s.showVerdict({ ...this._specialVerdict(correct, truth, id, scored), retry: this.fast ? null : () => this._retryPitch() }, () => {
          hud.setBug({ balls: Math.min(this.balls, 3), strikes: Math.min(this.strikes, 2), outs: this.outs, runners: this.runners });
          this._afterPitch(end);
        });
      }
    }, delay);
  }

  // After a ball/strike call: NEXT PITCH (auto after a beat when you got it right) or TRY AGAIN.
  _continueAfter(ms, end, good = true) {
    let done = false;
    const go = (id) => {
      if (done) return;
      done = true;
      clearTimeout(this._autoNext);
      if (id === 'retry') return this._retryPitch();
      this.s.hud.kzone(null);
      this.s.hud.options(null);
      this._afterPitch(end);
    };
    const opts = [{ btn: 'A', id: 'next', label: 'NEXT PITCH', small: true }];
    if (!this.fast) opts.push({ btn: 'X', id: 'retry', label: good ? 'TRY AGAIN' : '↻ TRY AGAIN', small: !!good, big: !good, hot: !good });
    this.s.hud.options(opts, go);
    // a miss waits for you, so there's time to try it again
    if (good || this.fast) this._autoNext = setTimeout(() => go('next'), ms + (this.fast ? 100 : 600));
  }

  _afterPitch(end) {
    clearTimeout(this._autoNext);
    if (this.s.ended) return;
    if (this.resume) {
      // back from a practice pitch: pick up where the real call left the at-bat
      const r = this.resume;
      this.resume = null;
      this.balls = r.balls; this.strikes = r.strikes; this.pitchNo = r.pitchNo;
      end = r.end;
      this.practice = false;
      this.s.practice = false;
      this.s.hud.setBug({ balls: Math.min(this.balls, 3), strikes: Math.min(this.strikes, 2), outs: this.outs, runners: this.runners });
    }
    this.s.hud.prompt('', '');
    if (this.s.gameOver && !end) return this.s.eventDone();
    if (end) return this._endAtBat(end);
    if (this.pitchNo >= this.maxPitches && !this.spec.forceKinds) return this._endAtBat('inplay');
    if (this.spec.forceKinds && this.pitchNo >= this.spec.forceKinds.length) return this._endAtBat('inplay');
    if (this.s.mode === 'blitz' && this.s.timeLeft <= 0) return;
    this.glove = { x: 0, y: GLOVE_Y, z: 2.2 };
    this.lookZ = LOOK_Z;
    this.catcherStand = 0;
    this._newPitch();
  }

  _endAtBat(how) {
    if (this.finished) return;
    this.finished = true;
    this.allowMove = false;
    const gs = this.s.game;
    const hud = this.s.hud;
    const msg = { k: 'STRIKEOUT', bb: 'BALL FOUR — WALK', hbp: 'BATTER TO FIRST', 'u3k-run': 'BATTER RUNS!', out: 'BATTER IS OUT', inplay: 'BALL IN PLAY' }[how] || '';
    if (how === 'k' || how === 'out') gs.outs++;
    if (how === 'bb' || how === 'hbp' || how === 'u3k-run') gs.forceAdvance();
    if (how === 'inplay') gs.randomizeAfterPlay();
    if (gs.outs >= 3) gs.nextHalf();
    hud.prompt(msg, '');
    setTimeout(() => this.s.eventDone(), this.fast ? 300 : 900);
  }

  _card() {
    const k = this.pk.kind;
    if (k === 'take') return 'strike-zone';
    if (k === 'swingMiss') return 'strike-zone';
    if (k === 'check') return 'checked-swings';
    if (k === 'contact') return 'foul-tip';
    if (k === 'bunt2') return 'foul-bunt';
    if (k === 'hbp') return this.pk.sub === 'hands' ? 'myth-hands' : 'hit-by-pitch';
    if (k === 'u3k') return 'uncaught-third-strike';
    return 'strike-zone';
  }

  _specialVerdict(correct, truth, id, scored) {
    const pk = this.pk;
    const k = pk.kind;
    const label = (opts, v) => (opts.find((o) => o.id === v) || {}).label || v;
    const opts = this._optsFor();
    let body = '';
    if (k === 'contact') {
      if (pk.sub === 'foulTip') body = 'The ball went **sharp and direct** from the bat into the catcher\'s mitt and was held. That\'s a **foul tip**: it counts as a strike and the ball stays live. Don\'t yell "foul"!';
      else if (pk.sub === 'foulTipDrop') body = 'It went straight back into the mitt — but the catcher **didn\'t hold it**. A foul tip has to be legally caught. If it isn\'t, it\'s just a **foul ball**: dead ball.';
      else if (pk.sub === 'popCaught') body = 'That ball went **up**, higher than the batter\'s head — that\'s not a foul tip. When the catcher catches a foul fly ball, the **batter is out**.';
      else body = 'The ball flew back into the screen. That\'s a **foul ball**: hands up, call "Foul!", ball is dead. It\'s a strike only with fewer than two strikes.';
    } else if (k === 'bunt2') {
      body = 'A **foul bunt with two strikes is strike three** — the batter is out. That\'s different from a regular swing, where a two-strike foul doesn\'t change the count.';
    } else if (k === 'hbp') {
      const s = pk.sub;
      if (s === 'swungHit') body = 'The batter **swung** at the pitch. When a batter swings and the pitch hits them, it\'s a **strike** and the ball is dead — no free base.';
      else if (s === 'inZone') body = 'The pitch hit the batter while it was **in the strike zone** (his elbow was hanging over the plate). That\'s a **strike**, dead ball — no base award.';
      else if (s === 'leanIn') body = 'The batter **moved into the pitch** on purpose. That pitch was outside the zone, so it\'s a **ball** — but the batter does not get first base.';
      else if (s === 'hands') body = '**The hands are part of the batter, not the bat!** The batter didn\'t swing, so getting hit on the hands is a hit-by-pitch: dead ball, take your base.';
      else body = 'The pitch hit the batter, who didn\'t swing and tried to get out of the way, and it wasn\'t in the strike zone. **Time! Take your base.** Runners move up only if forced.';
    } else if (k === 'u3k') {
      if (!this.div.u3k) body = `In **${this.div.full}**, the uncaught-third-strike rule **does not apply**: Little League only uses it in **Majors and up**. The batter is out even though the catcher didn't catch it.`;
      else if (truth === 'run') body = `The pitch was **not legally caught** and ${this.runners.includes(1) ? '**there are two outs**' : '**first base is open**'} — the batter may run! Signal strike three **without an out call** and watch the play.`;
      else body = 'First base is **occupied with fewer than two outs**, so the batter is **out** even though the catcher didn\'t catch it. The ball stays live, so keep watching the runners!';
    }
    return {
      correct,
      title: correct ? pick(['GREAT CALL!', 'NAILED IT!', 'THAT\'S THE CALL!', 'BY THE BOOK!']) : 'MISSED CALL',
      sub: `You: ${label(opts, id)} · Correct: ${label(opts, truth)}`,
      body,
      card: this._card(),
      scored,
    };
  }

  // ---------- Rendering ----------
  render(g) {
    const s = this.s;
    const cam = s.cam;
    const aspect = cam.w / cam.h;
    // Keep roughly the same horizontal coverage on any screen shape
    cam.fovY = clamp(2 * Math.atan(Math.tan(0.5) * 1.6 / Math.min(aspect, 1.6)), 0.9, 1.5);
    const d = this.lookDir;
    const ep = this._eyePos();
    cam.lookAt(ep, d ? { x: ep.x + d.x * 25, y: ep.y + d.y * 25, z: ep.z + d.z * 25 } : { x: this.eye.x * 0.25, y: 25, z: this.lookZ });
    const pk = this.pk;
    const t = pk ? pk.t : 0;
    const ball = pk && this.state !== 'setup' ? pk.ballAt(t) : null;
    if (s.field.is3d) return this._render3d(g, cam, t, ball);

    // 2D (no WebGL): the same realistic pitcher, batter and catcher as 3D, painted onto the canvas
    s.field.draw(g, cam, { actors: this.bg.filter((a) => a !== this.pitcher) });
    this._drawDirt2d(g, cam);
    const P2 = this._p2 || (this._p2 = new Painter2D());
    const paint = (body) => { P2.begin(g, cam); drawHero(P2, body.W, body.o); P2.end(); };
    paint(this._pitcherBody());
    // Pitcher hides the ball until release
    if (ball && ball.y > 1.6) this._drawBall(g, cam, ball);
    this._drawZoneHelper(g, cam);
    this._drawImprint(g, cam);
    paint(this._batterBody(t));
    if (ball && ball.y <= 1.6 && ball.y > GLOVE_Y + 0.05) this._drawBall(g, cam, ball);
    paint(this._catcherBody());
    if (ball && ball.y <= GLOVE_Y + 0.05) this._drawBall(g, cam, ball);
    this._drawMask(g, cam);
    this._drawArm(g, cam);
  }

  // Where the pitch crossed the plate, shown once the ball gets there: the exact point the K-Zone
  // uses, so the field and the K-Zone always agree. (Exams show it only after you call it.)
  _imprint() {
    const pk = this.pk;
    if (!pk || !pk.judge || pk.kind !== 'take' || this.state === 'setup') return null;
    const at = pk.judge.at;
    const ay = at.y ?? 1.0;
    if (pk.t < pk.tRelease + pk.traj.tAtY(ay)) return null;
    if (this.spec.exam && !pk.called) return null;
    const color = pk.called ? (pk.judge.strike ? '#ff5a5a' : '#3fa2ff') : '#ffffff';
    return { x: at.x, y: ay, z: at.z, color };
  }

  // How strongly to draw the strike zone box right now: 0 hidden, 1 full
  _zoneShown() {
    // after a called pitch, the zone stays up with the imprint so the field matches the K-Zone
    const review = !!(this.pk && this.pk.called && this.pk.kind === 'take' && (this.state === 'signal' || this.state === 'wait'));
    if (this.spec.exam || review) return review ? 1 : 0;
    // once the ball is hit, the zone is no longer the point (and the view may turn to follow it)
    if (this.pk && this.pk.contactT && this.pk.kind !== 'take' && this.pk.t > this.pk.contactT && this.state !== 'setup') return 0;
    const lvl = this.state === 'setup' || this.state === 'pre' || this.state === 'pitch' ? this.s.zoneBoxLevel() : 0;
    // setting up in the slot with hints on, the box shows what you need to see
    if (this.state === 'setup' && this.s.hints && this.s.profile.settings.zoneBox !== 'off') return Math.max(lvl, 0.7);
    return lvl;
  }

  // ---------- 3D rendering ----------
  _render3d(g, cam, t, ball) {
    const s = this.s;
    const b = this.batter;
    const bodies = [this._batterBody(t), this._catcherBody(), this._pitcherBody()];
    const showZone = this._zoneShown();
    s.field.draw(g, cam, {
      actors: this.bg.filter((a) => a !== this.pitcher),
      bodies,
      ball: ball ? { ...ball, scale: 1.15, halo: 0.45, trail: this.trail.filter(Boolean), dim: showZone && this._inZone(ball) ? 0.3 : 0, shadow: !this._following() } : null,
      scuffs: this.divots.map((d) => ({ x: d.x, y: d.y, r: 0.7, sx: 0.9, sy: 1.7, a: 0.95 })),
      // the 3D box over the whole plate, or (Settings) a flat TV-style box at the front of the plate
      zone: showZone ? { bot: this.zone.bot, top: this.zone.top, w: 2 * (HALF + this.zone.wide), alpha: showZone, ...(this._tvZone() ? { y: 1.4, depth: 0.03 } : { y: 0.708, depth: 1.416 }) } : null,
      imprint: this._imprint(),
      extra: (P) => this._arm3d(P, cam),
      overlay: (gg) => {
        if (showZone) this._zoneLabels(gg, cam, showZone);
        this._drawMask(gg, cam);
      },
    });
  }

  // The batter as a realistic "hero" body. The pose's F joints are the lead side (toward the pitcher):
  // the batter's left for a righty, right for a lefty. The lead arm holds the bottom hand.
  _batterBody(t) {
    const b = this.batter;
    const J = this._batterPose(t);
    const f = { x: -b.side, y: 0, z: 0 };
    const L = { x: -f.y, y: f.x, z: 0 };
    const S = b.H / 5;
    const P3 = (a) => ({ x: a[0], y: a[1], z: a[2] });
    const hands = P3(J.hands);
    const tip = P3(J.batTip);
    const dl = Math.hypot(tip.x - hands.x, tip.y - hands.y, tip.z - hands.z) || 1;
    const dir = { x: (tip.x - hands.x) / dl, y: (tip.y - hands.y) / dl, z: (tip.z - hands.z) / dl };
    const along = (k) => ({ x: hands.x + dir.x * k, y: hands.y + dir.y * k, z: hands.z + dir.z * k });
    const lead = b.side < 0 ? 'F' : 'B', rear = lead === 'F' ? 'B' : 'F';
    const W = { f, L, S, hip: P3(J.hip), neck: P3(J.neck), head: P3(J.head), knob: along(-0.17), batTip: tip };
    W['knee' + lead] = P3(J.kneeF); W['foot' + lead] = P3(J.footF);
    W['knee' + rear] = P3(J.kneeB); W['foot' + rear] = P3(J.footB);
    W['sh' + lead] = P3(J.shF); W['sh' + rear] = P3(J.shB);
    W['el' + lead] = P3(J.elF); W['el' + rear] = P3(J.elB);
    W['hand' + lead] = hands; W['hand' + rear] = along(0.27);
    solveLimbs(W);
    return {
      hero: true, W,
      o: {
        kit: KITS.off, skin: b.skin, battingGloves: true, gloveTone: b.gloveTone, helmet: true, ponytail: sport.softball && 'bubble', faceguard: sport.softball, lookDir: { x: 0, y: 1, z: 0 },
        num: b.num, team: 'Titans', teamColors: ['#ffffff', '#6d0d18'], numColors: ['#ffffff', '#6d0d18'],
        batColor: b.batColor, batAccent: b.batAccent, footDir: { x: f.x * 0.25, y: 1 },
      },
    };
  }

  // The pitcher's 3D delivery. It starts during the short "pre" beat, so the ball leaves the hand at release.
  _pitcherBody() {
    const pk = this.pk;
    const pre = this.fast ? 0.25 : 0.55;
    const tr = pre + (pk ? pk.tRelease : 0.8);
    let tau = 0;
    if (this.state === 'pre') tau = this.t;
    else if (pk && this.state !== 'setup') tau = pre + pk.t;
    const lefty = this.pitcherHand === 'L';
    const W = solveLimbs(pitcherJoints((0.8 * tau) / tr, { hand: this.pitcherHand, rel: pk && pk.rel }), PITCHER_LIMBS);
    return {
      hero: true, W,
      o: {
        kit: KITS.def, skin: this.pitcherSkin, glove: lefty ? 'B' : 'F', gloveColor: '#5b3a1e',
        ballInHand: tau < tr ? (lefty ? 'F' : 'B') : null, lookDir: { x: -W.head.x * 0.05, y: -1 },
        team: 'Hawks', teamColors: ['#1f5fe0', '#0d2a6b'], num: this.pitcherNum, numColors: ['#1f5fe0', '#0d2a6b'],
        feetAlong: false, ponytail: sport.softball,
      },
    };
  }

  _catcherBody() {
    const cx = this.catcherX;
    const lift = (this.catcherStand || 0) * 1.4;
    const f = { x: 0, y: 1, z: 0 };
    const L = { x: -1, y: 0, z: 0 };
    const S = 0.92;
    const V = (x, y, z) => ({ x, y, z });
    const glove = V(this.glove.x, this.glove.y, this.glove.z);
    const shF = V(cx - 0.5, -2.25, 1.92 + lift), shB = V(cx + 0.5, -2.25, 1.92 + lift);
    const elF = V((shF.x + glove.x) / 2 - 0.25, (shF.y + glove.y) / 2, Math.min(shF.z, glove.z) - 0.25);
    const W = {
      f, L, S,
      hip: V(cx, -2.45, 1.15 + lift), neck: V(cx, -2.25, 2.12 + lift), head: V(cx, -2.1, 2.42 + lift),
      kneeF: V(cx - 0.85, -1.75, 1.15 + lift * 0.5), kneeB: V(cx + 0.85, -1.75, 1.15 + lift * 0.5),
      footF: V(cx - 0.75, -2.5, 0.05), footB: V(cx + 0.75, -2.5, 0.05),
      shF, shB, elF, handF: glove,
      elB: V(cx + 0.9, -2.15, 1.55 + lift), handB: V(cx + 0.75, -1.9, 1.25 + lift),
    };
    return {
      hero: true, W,
      o: { kit: KITS.def, skin: this.catcherSkin, gear: 'catcher', glove: 'F', gloveColor: '#6b3f1d', noFace: true, ponytail: sport.softball, num: this.catcherNum, numColors: ['#1f5fe0', '#0d2a6b'], footDir: { x: 0, y: 1 } },
    };
  }

  // First-person strike mechanic: your right arm hammers up into view.
  _arm3d(P, cam) {
    if (this.armAnim < 0) return;
    const t = this.armAnim;
    const k = clamp(t / 0.2, 0, 1);
    const out = clamp((t - 0.9) / 0.3, 0, 1);
    const punch = Math.sin(clamp((t - 0.15) / 0.25, 0, 1) * Math.PI) * 0.12;
    const e = cam.eye, r = cam.r, u = cam.u, f = cam.f;
    const at = (a, b, c) => ({ x: e.x + r.x * a + u.x * b + f.x * c, y: e.y + r.y * a + u.y * b + f.y * c, z: e.z + r.z * a + u.z * b + f.z * c });
    const drop = out * 1.4;
    const sh = at(0.75, -1.1 - drop, 0.15);
    const el = at(0.62 - 0.08 * k, -0.85 + 0.45 * k - drop, 0.75);
    const fist = at(0.5 - 0.05 * k, -0.6 + 0.85 * k + punch - drop, 0.95);
    P.ow = 0.008;
    P.useFamily('hero');
    const sleeve = this.s.umpKit.jersey;
    P.taper(sh, el, 0.17, sleeve);
    P.sphere(el, 0.125, sleeve, false);
    P.taper(el, fist, 0.12, this.s.umpSkin);
    P.ellipsoid(fist, cam.r, cam.u, cam.f, 0.13, 0.16, 0.12, this.s.umpSkin);
    P.useFamily('toon');
  }

  _zoneLabels(g, cam, alpha = 1) {
    const z = this.zone;
    g.save();
    g.globalAlpha = alpha;
    const b = this.batter;
    const lab = (txt, zz) => {
      const p = cam.project(-b.side * (HALF + this.zone.wide + 0.12), this._tvZone() ? 1.416 : 1.0, zz);
      if (!p) return;
      g.font = `700 ${Math.round(12 * this.s.app.dpr)}px Rubik, sans-serif`;
      g.fillStyle = 'rgba(255,240,190,0.95)';
      g.strokeStyle = 'rgba(11,21,48,0.8)';
      g.lineWidth = 3 * this.s.app.dpr;
      g.textAlign = b.side < 0 ? 'left' : 'right';
      g.textBaseline = 'middle';
      g.strokeText(txt, p.x, p.y);
      g.fillText(txt, p.x, p.y);
    };
    lab('ARMPITS', z.top);
    lab('TOP OF KNEES', z.bot);
    g.restore();
  }

  _drawZoneHelper(g, cam) {
    const show = this._zoneShown();
    if (!show) return;
    const z = this.zone;
    const y = 1.416;
    g.save();
    g.globalAlpha = show;
    // the zone is a box over the whole plate: back face, then front face
    const zw = HALF + (z.wide || 0);
    for (const [yy, fill] of this._tvZone() ? [[y, 0.1]] : [[0, 0.05], [y, 0.08]]) {
      const pts = [[-zw, yy, z.bot], [zw, yy, z.bot], [zw, yy, z.top], [-zw, yy, z.top]];
      if (cam.polyPath(g, pts)) {
        g.fillStyle = `rgba(255,211,77,${fill})`;
        g.fill();
        g.setLineDash([6, 5]);
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(255,211,77,0.75)';
        g.stroke();
        g.setLineDash([]);
      }
    }
    // landmark ticks at knees / armpits
    const b = this.batter;
    const lab = (txt, zz) => {
      const p = cam.project(-b.side * (HALF + (z.wide || 0) + 0.12), y, zz);
      if (!p) return;
      g.font = `700 ${Math.round(12 * this.s.app.dpr)}px Rubik, sans-serif`;
      g.fillStyle = 'rgba(255,240,190,0.95)';
      g.textAlign = b.side < 0 ? 'left' : 'right';
      g.textBaseline = 'middle';
      g.fillText(txt, p.x, p.y);
    };
    lab('ARMPITS', z.top);
    lab('TOP OF KNEES', z.bot);
    g.restore();
  }

  _drawImprint(g, cam) {
    const im = this._imprint();
    if (!im) return;
    const p = cam.project(im.x, im.y, im.z);
    if (!p) return;
    const r = Math.max(2, BALL_R * p.s);
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = im.color;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = im.color;
    g.lineWidth = Math.max(2, r * 0.25);
    g.beginPath(); g.arc(p.x, p.y, r * 1.7, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // Is any part of the ball inside the strike zone box right now?
  _tvZone() { return this.s.profile.settings.zoneStyle === 'tv'; }

  _inZone(b) {
    return !!b && b.y >= 0 && b.y <= 1.414 && margin(b.x, b.z, b.y, this.zone) >= 0;
  }

  // Kick up dirt: the 3D dust system, or a quick animated puff in 2D
  _dirtPuff(x, y, k) {
    const f = this.s.field;
    if (f.puff) f.puff(x, y, k);
    else this.puffs2d.push({ x, y, k, t0: performance.now() });
  }

  // 2D renderer: divots and dirt puffs on the ground
  _drawDirt2d(g, cam) {
    for (const d of this.divots) {
      const p = cam.project(d.x, d.y, 0);
      if (!p) continue;
      g.fillStyle = 'rgba(92,58,26,0.6)';
      g.beginPath(); g.ellipse(p.x, p.y, Math.max(3, 0.5 * p.s), Math.max(1.5, 0.22 * p.s), 0, 0, Math.PI * 2); g.fill();
    }
    const now = performance.now();
    this.puffs2d = this.puffs2d.filter((q) => now - q.t0 < 900);
    for (const q of this.puffs2d) {
      const u = (now - q.t0) / 900;
      const p = cam.project(q.x, q.y, 0.6 * u * q.k);
      if (!p) continue;
      g.fillStyle = `rgba(196,150,100,${0.55 * (1 - u)})`;
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3;
        g.beginPath(); g.arc(p.x + Math.cos(a) * p.s * 0.5 * u * q.k, p.y - Math.abs(Math.sin(a)) * p.s * 0.3 * u, Math.max(2, p.s * (0.25 + 0.4 * u) * q.k), 0, Math.PI * 2); g.fill();
      }
    }
  }

  _drawBall(g, cam, b) {
    const p = cam.project(b.x, b.y, b.z);
    if (!p) return;
    // never smaller than a few screen pixels (more on phones), like the 3D ball
    const dpr = this.s.app.dpr;
    const minR = (Math.min(cam.w, cam.h) / dpr < 500 ? 6.2 : 4.6) * dpr;
    const r = Math.max(minR, BALL_R * 1.2 * p.s);
    const far = BALL_R * 1.2 * p.s < minR;
    // trail while following a hit ball
    const tr = this.trail.filter(Boolean);
    tr.forEach((q, i) => {
      const pq = cam.project(q.x, q.y, q.z);
      if (!pq) return;
      g.fillStyle = `rgba(255,255,255,${0.12 + (0.3 * i) / tr.length})`;
      g.beginPath(); g.arc(pq.x, pq.y, r * (0.4 + (0.5 * i) / tr.length), 0, Math.PI * 2); g.fill();
    });
    if (far) {
      // halo + dark ring so a far-away ball pops against grass, dirt and chalk
      const gl = g.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3);
      gl.addColorStop(0, 'rgba(255,224,102,0.55)');
      gl.addColorStop(1, 'rgba(255,224,102,0)');
      g.fillStyle = gl;
      g.beginPath(); g.arc(p.x, p.y, r * 3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(10,14,28,0.9)';
      g.lineWidth = Math.max(1.5, r * 0.28);
      g.beginPath(); g.arc(p.x, p.y, r * 1.12, 0, Math.PI * 2); g.stroke();
    }
    // shadow
    const sh = cam.project(b.x, b.y, 0);
    if (sh) {
      g.fillStyle = this._following() ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.6)';
      g.beginPath(); g.ellipse(sh.x, sh.y, r * 1.1, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = ballColor();
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    if (this._zoneShown() && this._inZone(b)) {
      // a touch darker while it's inside the strike zone box
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    }
    if (r > 6) {
      g.strokeStyle = '#d0302f';
      g.lineWidth = r * 0.12;
      g.beginPath(); g.arc(p.x - r * 0.95, p.y, r * 0.75, -0.9, 0.9); g.stroke();
      g.beginPath(); g.arc(p.x + r * 0.95, p.y, r * 0.75, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
    }
  }

  _batterPose(t) {
    const b = this.batter;
    const pk = this.pk;
    const s = b.side; // -1 for righty (stands on 3B side)
    const f = -s; // toward the plate
    let bx = b.bx, by = b.by;
    if (pk && pk.crowd) bx = s * 1.75;
    let lean = 0, flinch = 0, swing = 0, bunt = 0;
    if (pk && this.state !== 'setup') {
      if (pk.swing) {
        const sw = pk.swing;
        const u = (t - sw.start) / sw.dur;
        if (u > 0) {
          if (sw.hold) swing = u < 1 ? sw.max * easeOut(clamp(u, 0, 1)) : sw.max - (sw.max < 0.5 ? 0.12 : 0);
          else swing = clamp(u, 0, 1);
        }
      }
      if (pk.bunt && t > pk.bunt.start) bunt = clamp((t - pk.bunt.start) / 0.3, 0, 1);
      if (pk.lean && t > pk.lean.start) lean = clamp((t - pk.lean.start) / 0.2, 0, 1);
      if (pk.flinch) flinch = clamp((t - pk.flinch) / 0.25, 0, 1);
      if (pk.kind === 'u3k' && pk.decisionOpen) {
        // batter thinking about running
      }
    }
    const H = b.H, ap = b.armpit, kn = b.knee;
    bx += f * lean * (pk && pk.leanDist ? pk.leanDist : 0.55) - f * flinch * 0.6;
    const hipZ = H * 0.5 * b.crouch;
    const rot = swing * 1.2 + bunt * 1.1; // shoulders open toward the pitcher
    const shoulderZ = ap + 0.3;
    const rotP = (dx, dy) => {
      // rotate a (dx toward plate, dy toward pitcher) offset around the body: the lead shoulder
      // pulls away from the plate and the chest turns to face the pitcher
      const c = Math.cos(rot), sn = Math.sin(rot);
      const rx = dx * c - dy * sn, ry = dx * sn + dy * c;
      return [bx + f * rx, by + ry];
    };
    const J = {};
    // weight shifts forward and the back foot pivots ("squish the bug") as the swing turns
    const turn = Math.max(swing, bunt * 0.3);
    J.footF = [bx, by + 1.05, 0.05];
    J.footB = [bx - f * 0.05, by - 1.05 + 0.1 * turn, 0.05 + 0.13 * turn];
    J.kneeF = [bx + f * 0.32, by + 0.8, kn - 0.06];
    J.kneeB = [bx + f * (0.3 + 0.38 * turn), by - 0.75 + 0.4 * turn, kn - 0.08 - 0.12 * turn];
    J.hip = [bx - f * 0.05 + f * 0.06 * turn, by + 0.18 * turn, hipZ - 0.05 * turn];
    const sF = rotP(0.1, 0.62), sB = rotP(0.05, -0.62);
    J.shF = [sF[0], sF[1], shoulderZ];
    J.shB = [sB[0], sB[1], shoulderZ];
    const nk = rotP(0.12, 0);
    J.neck = [nk[0], nk[1], ap + 0.45];
    J.head = [bx + f * (0.15 + lean * 0.2), by + 0.12, H - 0.4];
    // Hands + bat
    let hands, batDir;
    if (bunt > 0) {
      hands = lerpV3([bx + f * 0.35, by - 0.7, ap + 0.55], [bx + f * 1.05, by + 0.55, ap - 0.15], bunt);
      batDir = normV3(lerpV3([f * 0.15, -0.5, 0.85], [f * 1, 0.05, 0.12], bunt));
    } else if (swing > 0) {
      const keys = [
        { p: 0, h: [bx + f * 0.75, by - 0.55, ap + 0.35], yaw: -100, el: 52 },
        { p: 0.5, h: [bx + f * 1.05, by + 0.15, ap - 0.15], yaw: 0, el: -6 },
        { p: 1, h: [bx + f * 0.55, by + 0.85, ap + 0.35], yaw: 125, el: 38 },
      ];
      const k0 = swing < 0.5 ? keys[0] : keys[1];
      const k1 = swing < 0.5 ? keys[1] : keys[2];
      const u = (swing - k0.p) / (k1.p - k0.p);
      hands = lerpV3(k0.h, k1.h, u);
      const yaw = (lerp(k0.yaw, k1.yaw, u) * Math.PI) / 180;
      const el = (lerp(k0.el, k1.el, u) * Math.PI) / 180;
      batDir = [Math.cos(el) * Math.cos(yaw) * f, Math.cos(el) * Math.sin(yaw), Math.sin(el)];
    } else {
      hands = [bx + f * 0.75, by - 0.55, ap + 0.35];
      if (pk && pk.crowd) hands = [bx + f * 0.55, by - 0.5, ap + 0.5];
      // stance: hands out in front at shoulder height (on the plate side of the head), the bat about 50
      // degrees up and tilted back over the helmet toward the catcher (where the swing starts from)
      const yaw = (-100 * Math.PI) / 180, el = (52 * Math.PI) / 180;
      batDir = [Math.cos(el) * Math.cos(yaw) * f, Math.cos(el) * Math.sin(yaw), Math.sin(el)];
    }
    if (flinch > 0) hands = [hands[0] - f * 0.4 * flinch, hands[1], hands[2] + 0.3 * flinch];
    J.hands = hands;
    J.batTip = [hands[0] + batDir[0] * 2.55, hands[1] + batDir[1] * 2.55, hands[2] + batDir[2] * 2.55];
    // Elbows
    J.elF = [lerp(J.shF[0], hands[0], 0.5) + f * 0.1, lerp(J.shF[1], hands[1], 0.5), Math.min(J.shF[2], hands[2]) - 0.35];
    J.elB = [lerp(J.shB[0], hands[0], 0.5) - f * 0.05, lerp(J.shB[1], hands[1], 0.5) - 0.15, Math.min(J.shB[2], hands[2]) - 0.3];
    if (pk && pk.crowd) J.elF = [s * 0.45, by + 0.3, ap - 0.15];
    return J;
  }




  // Looking through your own umpire mask: soft bars + vignette at the edges.
  _drawMask(g, cam) {
    const W = cam.w, H = cam.h;
    const vg = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    const bar = (y, th, a) => {
      const gr = g.createLinearGradient(0, y - th, 0, y + th);
      gr.addColorStop(0, 'rgba(10,10,14,0)');
      gr.addColorStop(0.5, `rgba(10,10,14,${a})`);
      gr.addColorStop(1, 'rgba(10,10,14,0)');
      g.fillStyle = gr;
      g.fillRect(0, y - th, W, th * 2);
    };
    bar(H * 0.05, H * 0.035, 0.55);
    bar(H * 0.97, H * 0.05, 0.6);
    const post = (x, th) => {
      const gr = g.createLinearGradient(x - th, 0, x + th, 0);
      gr.addColorStop(0, 'rgba(10,10,14,0)');
      gr.addColorStop(0.5, 'rgba(10,10,14,0.5)');
      gr.addColorStop(1, 'rgba(10,10,14,0)');
      g.fillStyle = gr;
      g.fillRect(x - th, 0, th * 2, H);
    };
    post(W * 0.015, W * 0.03);
    post(W * 0.985, W * 0.03);
  }

  _drawArm(g, cam) {
    if (this.armAnim < 0) return;
    const t = this.armAnim;
    const W = cam.w, H = cam.h;
    const k = clamp(t / 0.2, 0, 1);
    const punch = Math.sin(clamp((t - 0.15) / 0.25, 0, 1) * Math.PI) * 0.25;
    const out = clamp((t - 0.9) / 0.3, 0, 1);
    const sc = H / 600;
    const sx = W * 0.88, sy = H + 50 * sc;
    const ex = W * 0.81 - 30 * sc * k, ey = H - (110 + 150 * k) * sc + out * 320 * sc;
    const fx = W * 0.79 - 10 * sc * k - punch * 40 * sc, fy = ey - (60 + 95 * k) * sc;
    const OL = 'rgba(10,14,28,0.92)';
    g.lineCap = 'round';
    const line = (x0, y0, x1, y1, w, c) => {
      g.strokeStyle = OL; g.lineWidth = w + 8 * sc;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = c; g.lineWidth = w;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    };
    line(sx, sy, ex, ey, 82 * sc, this.s.umpKit.jersey);
    line(ex, ey, fx, fy, 50 * sc, this.s.umpSkin);
    // shirt cuff
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 6 * sc;
    g.beginPath(); g.moveTo(ex - 30 * sc, ey + 8 * sc); g.lineTo(ex + 30 * sc, ey - 2 * sc); g.stroke();
    // fist
    g.fillStyle = OL;
    g.beginPath(); g.ellipse(fx, fy - 12 * sc, 46 * sc, 42 * sc, -0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = this.s.umpSkin;
    g.beginPath(); g.ellipse(fx, fy - 12 * sc, 41 * sc, 37 * sc, -0.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 4 * sc;
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.moveTo(fx - 24 * sc, fy - 34 * sc + i * 15 * sc); g.quadraticCurveTo(fx, fy - 40 * sc + i * 15 * sc, fx + 22 * sc, fy - 34 * sc + i * 15 * sc); g.stroke();
    }
  }
}

function lerpV3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function normV3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function drawKZone(canvas, info) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const { zone, at, strike, side } = info;
  // map world x (-1.6..1.6) and z (0..4.6) into the canvas
  const zMid = (zone.bot + zone.top) / 2;
  const span = Math.max(3.2, zone.top - zone.bot + 1.6);
  const sc = Math.min(W / 3.2, H / span);
  const X = (x) => W / 2 + x * sc;
  const Y = (z) => H / 2 - (z - zMid) * sc;
  // batter's side shading
  g.fillStyle = 'rgba(214,40,57,0.18)';
  if (side < 0) g.fillRect(0, 0, X(-HALF - 0.35), H);
  else g.fillRect(X(HALF + 0.35), 0, W, H);
  // zone
  g.fillStyle = 'rgba(255,255,255,0.06)';
  const ZW = HALF + (zone.wide || 0);
  g.fillRect(X(-ZW), Y(zone.top), 2 * ZW * sc, (zone.top - zone.bot) * sc);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.strokeRect(X(-ZW), Y(zone.top), 2 * ZW * sc, (zone.top - zone.bot) * sc);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    g.beginPath(); g.moveTo(X(-ZW + (2 * ZW * i) / 3), Y(zone.top)); g.lineTo(X(-ZW + (2 * ZW * i) / 3), Y(zone.bot)); g.stroke();
    g.beginPath(); g.moveTo(X(-ZW), Y(zone.top - ((zone.top - zone.bot) * i) / 3)); g.lineTo(X(ZW), Y(zone.top - ((zone.top - zone.bot) * i) / 3)); g.stroke();
  }
  // plate
  g.fillStyle = '#fff';
  const py = H - 10;
  g.beginPath();
  g.moveTo(X(-HALF), py - 6); g.lineTo(X(HALF), py - 6); g.lineTo(X(HALF), py); g.lineTo(X(0), py + 6); g.lineTo(X(-HALF), py); g.closePath();
  g.fill();
  // ball
  const r = BALL_R * sc;
  g.fillStyle = strike ? '#ff5a5a' : '#3fa2ff';
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath(); g.arc(X(at.x), Y(at.z), r, 0, Math.PI * 2); g.fill(); g.stroke();
}
