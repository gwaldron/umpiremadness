// Behind the dish: the plate umpire's first-person view.
// One AtBatEvent = one batter, pitch after pitch, until the at-bat ends.
import { audio } from '../audio.js';
import { voices, playerName } from '../voice.js';
import { input } from '../input.js';
import { clamp, lerp, rand, randInt, pick, chance, weighted, easeOut } from '../util.js';
import { drawFigure, KITS, SKINS } from '../render/figures.js';
import { POS, UMP_SPOTS, BASES } from '../render/field.js';

const BALL_R = 0.121; // feet (2.9 in diameter)
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
  const hand = opts.hand || (Math.random() < 0.7 ? 'R' : 'L');
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
    line: `BATS ${hand} · AVG .${randInt(180, 455)} · ${pick(FUN_FACTS)}`,
  };
}

function halfW(y) {
  return y >= 0.706 ? HALF : HALF * Math.max(0, y) / 0.706;
}

// Signed distance (ft) of the ball center from the edge of the "any part of the ball touches any part of the zone" region.
function margin(x, z, y, zone) {
  const hw = halfW(y) + BALL_R;
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
  const cx = HALF + BALL_R, top = zone.top + BALL_R, bot = zone.bot - BALL_R;
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
    this.pitcherHand = chance(0.8) ? 'R' : 'L';
    this.pitcherSkin = pick(SKINS);
    this.catcherSkin = pick(SKINS);
    this.catcherX = 0;
    this.glove = { x: 0, z: 2.2, y: GLOVE_Y };
    this.armAnim = -1;
    this.lookZ = LOOK_Z;
    this.zone = { bot: this.batter.knee, top: this.batter.armpit };
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
    this.pitcher = { x: 0, y: 46.6, kit: KITS.def, skin: this.pitcherSkin, pose: 'stand', glove: 'F', mirror: this.pitcherHand === 'L' };
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
    let msg = 'In the slot. Nice!', ok = true;
    if (Math.abs(x) < 0.42) { msg = "You're straight behind the catcher — the helmet blocks the plate!"; ok = false; }
    else if (Math.sign(x) !== side) { msg = 'Wrong side! Set up in the slot on the batter\'s side.'; ok = false; }
    else if (Math.abs(x) > 1.35) { msg = 'Too close to the batter — slide toward the catcher.'; ok = false; }
    else if (z > 4.4) { msg = 'Too high — get your chin just above the catcher\'s helmet.'; ok = false; }
    else if (z < 3.55) { msg = 'Too low — the catcher is blocking your view.'; ok = false; }
    const score = clamp(1 - Math.abs(x - ideal) / 0.9, 0, 1) * clamp(1 - Math.abs(z - 3.95) / 0.9, 0, 1);
    return { ok, msg, score };
  }

  _enterSetup() {
    this.state = 'setup';
    this.allowMove = true;
    const hud = this.s.hud;
    const handTxt = this.batter.hand === 'R' ? 'Right-handed batter' : 'Left-handed batter';
    hud.prompt(this.pitchNo === 0 ? 'GET IN THE SLOT' : 'RESET YOUR STANCE', `${handTxt} · move with ${this.s.moveHint()} · then Play Ball!`);
    hud.options([{ btn: 'A', id: 'ready', label: 'PLAY BALL!', big: true }], () => this._afterSetup());
    if (this.pitchNo === 0 && !this.fast) {
      setTimeout(() => voices.batter(this.batter), 250);
      hud.lowerThird(this.batter);
    }
    if (this.s.hints && !this.spec.exam && !this.setupHinted && (this.s.slotTips = (this.s.slotTips || 0) + 1) <= 2) {
      this.setupHinted = true;
      hud.tip('<b>The slot</b> is the gap between the batter and the catcher. Put your head there with your chin just above the catcher\'s helmet so you can see the whole plate.');
    }
  }

  _afterSetup() {
    const si = this.slotInfo();
    this.s.lastSlot = { ...this.eye };
    this.slotOk = si.ok;
    this.s.hud.tip(null);
    if (!si.ok) this.s.hud.floater('Out of the slot!', true);
    this._newPitch();
  }

  // ---------- Pitch generation ----------
  _newPitch() {
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
    const pitchType = d.id === 'AA' ? 'fb' : weighted([['fb', 6], ['ch', 2], ['cb', d.id === 'MAJ' || d.id === 'AS' || d.id === 'WS' ? 2 : 0]]);
    const brk = pitchType === 'fb' ? { lift: 12, ax: 0 } : pitchType === 'ch' ? { lift: 7, ax: 0 } : { lift: -7, ax: (this.pitcherHand === 'R' ? 1 : -1) * rand(3, 7) };
    const speed = pitchType === 'fb' ? mph : mph * (pitchType === 'ch' ? 0.85 : 0.8);
    const rel = { x: (this.pitcherHand === 'R' ? -1 : 1) * rand(0.9, 1.4), y: 41.5, z: rand(4.6, 5.3) };
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
        pk.sub = weighted([['foulBack', 4], ['foulTip', 4], ['foulTipDrop', 2], ['popCaught', 2]]);
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
    this._buildBallPath();
    this.state = 'pre';
    this.t = 0;
    this.allowMove = false;
    this.s.hud.prompt('', '');
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
          return { x: atContact.x + this.batter.side * -dt * 10, y: atContact.y + dt * 6, z: Math.max(BALL_R, atContact.z - dt * 10 - 10 * dt * dt) };
        }
        if (kind === 'inPlay') {
          const vz = sub === 'fly' ? 38 : -6;
          return { x: atContact.x + dt * 12 * this.batter.side, y: atContact.y + dt * 95, z: Math.max(BALL_R, atContact.z + vz * dt - 16 * dt * dt) };
        }
        if (sub === 'foulBack') {
          return { x: atContact.x + dt * 7 * -this.batter.side, y: atContact.y - dt * 70, z: atContact.z + dt * 34 - 16 * dt * dt };
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
        if (sub === 'drop') return { x: p0.x + dt * 2, y: GLOVE_Y + dt * 2.5, z: Math.max(BALL_R, p0.z + 5 * dt - 16 * dt * dt) };
        return { x: p0.x + dt * 3, y: GLOVE_Y + dt * 5.5 * Math.max(0, 1 - dt), z: Math.max(BALL_R, 0.5 + 3 * dt - 16 * dt * dt) };
      }
      return { ...this.glove };
    };
  }

  // ---------- Loop ----------
  update(dt) {
    this.t += dt;
    const hud = this.s.hud;
    if (this.state === 'setup') {
      const m = input.move;
      this.eye.x = clamp(this.eye.x + m.x * dt * 1.6, -1.8, 1.8);
      this.eye.z = clamp(this.eye.z + m.y * dt * 1.3, 2.9, 4.9);
      const si = this.slotInfo();
      hud.promptSub(`${si.ok ? '✅' : '⚠️'} ${si.msg}`);
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
        audio.whoosh(Math.max(0.25, pk.tGlove - pk.tRelease));
        if (live && !pk.called && this._isZoneCall()) {
          hud.options(this._optsFor(), (id) => this._call(id));
        }
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
        if (pk.kind === 'contact') openAt = pk.sub === 'popCaught' ? pk.contactT + 2.5 : pk.sub === 'foulBack' ? pk.contactT + 0.7 : pk.contactT + 0.45;
        if (pk.kind === 'bunt2') openAt = pk.contactT + 0.6;
        if (pk.kind === 'hbp') openAt = pk.contactT + 0.45;
        if (pk.kind === 'u3k') openAt = pk.tGlove + 0.55;
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
      slotOk: this.slotOk,
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

    const delay = this.fast ? 200 : 650;
    setTimeout(() => {
      // Feedback
      if (this._isZoneCall()) {
        if (k === 'take') {
          hud.kzone({ zone: this.zone, at: pk.judge.at, strike: pk.judge.strike, margin: pk.judge.margin, side: this.batter.side, correct, timing });
        } else {
          hud.kzone(null);
        }
        if (k !== 'take') {
          const why = k === 'swingMiss' ? (correct ? 'He swung — strike, no matter where it was.' : 'He SWUNG! A swing and a miss is always a strike.') : pk.went ? 'The bat came all the way around — that\'s an attempt to hit.' : 'He held up — the bat never came around.';
          hud.prompt(correct ? 'GOOD CALL!' : 'MISSED IT!', why);
        } else if (timing === 'early') {
          hud.prompt(correct ? 'RIGHT CALL… TOO SOON!' : 'MISSED IT!', 'Quick trigger! See the ball into the glove, pause, THEN call it.');
        } else if (timing === 'none') {
          hud.prompt('NO CALL!', 'You have to make a call on every pitch.');
        } else {
          hud.prompt(correct ? 'GOOD CALL!' : 'MISSED IT!', '');
        }
        hud.setBug({ balls: Math.min(this.balls, 3), strikes: Math.min(this.strikes, 2), outs: this.outs, runners: this.runners });
        const wait = this.fast ? 300 : 1500;
        this._continueAfter(wait, end);
      } else {
        this.s.showVerdict(this._specialVerdict(correct, truth, id, scored), () => {
          hud.setBug({ balls: Math.min(this.balls, 3), strikes: Math.min(this.strikes, 2), outs: this.outs, runners: this.runners });
          this._afterPitch(end);
        });
      }
    }, delay);
  }

  _continueAfter(ms, end) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      this.s.hud.kzone(null);
      this.s.hud.options(null);
      this._afterPitch(end);
    };
    this.s.hud.options([{ btn: 'A', id: 'next', label: 'NEXT PITCH', small: true }], go);
    this._autoNext = setTimeout(go, ms + (this.fast ? 100 : 600));
  }

  _afterPitch(end) {
    clearTimeout(this._autoNext);
    if (this.s.ended) return;
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
      if (!this.div.u3k) body = `In **${this.div.full}**, the uncaught-third-strike rule **does not apply** (FXLL local rule). The batter is out even though the catcher didn't catch it.`;
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
    const EYE_Y = -4.3;
    cam.lookAt({ x: this.eye.x, y: EYE_Y, z: this.eye.z }, { x: this.eye.x * 0.25, y: 25, z: this.lookZ });
    const pk = this.pk;
    const t = pk ? pk.t : 0;
    const ball = pk && this.state !== 'setup' ? pk.ballAt(t) : null;
    if (s.field.is3d) return this._render3d(g, cam, t, ball);

    s.field.draw(g, cam, { actors: this.bg });
    // Pitcher hides the ball until release
    if (ball && ball.y > 1.6) this._drawBall(g, cam, ball);
    this._drawZoneHelper(g, cam);
    this._drawBatter(g, cam, t);
    if (ball && ball.y <= 1.6 && ball.y > GLOVE_Y + 0.05) this._drawBall(g, cam, ball);
    this._drawGlove(g, cam);
    if (ball && ball.y <= GLOVE_Y + 0.05 && ball.y > -2.0) this._drawBall(g, cam, ball);
    this._drawCatcher(g, cam);
    if (ball && ball.y <= -2.0) this._drawBall(g, cam, ball);
    this._drawMask(g, cam);
    this._drawArm(g, cam);
  }

  _zoneShown() {
    if (this.spec.exam) return false;
    return (this.s.zoneHelper && (this.state === 'setup' || this.state === 'pre' || this.state === 'pitch')) || (this.state === 'setup' && this.s.hints);
  }

  // ---------- 3D rendering ----------
  _render3d(g, cam, t, ball) {
    const s = this.s;
    const b = this.batter;
    const bodies = [this._batterBody(t), this._catcherBody()];
    const showZone = this._zoneShown();
    s.field.draw(g, cam, {
      actors: this.bg,
      bodies,
      ball: ball ? { ...ball, scale: 1.15 } : null,
      zone: showZone ? { bot: this.zone.bot, top: this.zone.top, y: 1.0 } : null,
      extra: (P) => this._arm3d(P, cam),
      overlay: (gg) => {
        if (showZone) this._zoneLabels(gg, cam);
        this._drawMask(gg, cam);
      },
    });
  }

  _batterBody(t) {
    const b = this.batter;
    const J = this._batterPose(t);
    const f = { x: -b.side, y: 0, z: 0 };
    const L = { x: -f.y, y: f.x, z: 0 };
    const S = b.H / 5;
    const handsDir = { x: J.batTip[0] - J.hands[0], y: J.batTip[1] - J.hands[1], z: J.batTip[2] - J.hands[2] };
    const hl = Math.hypot(handsDir.x, handsDir.y, handsDir.z) || 1;
    const P3 = (a) => ({ x: a[0], y: a[1], z: a[2] });
    const hands = P3(J.hands);
    const upperHand = { x: hands.x + (handsDir.x / hl) * 0.28, y: hands.y + (handsDir.y / hl) * 0.28, z: hands.z + (handsDir.z / hl) * 0.28 };
    const W = {
      f, L, S,
      hip: P3(J.hip), neck: P3(J.neck), head: P3(J.head),
      kneeF: P3(J.kneeF), kneeB: P3(J.kneeB), footF: P3(J.footF), footB: P3(J.footB),
      shF: P3(J.shF), shB: P3(J.shB), elF: P3(J.elF), elB: P3(J.elB),
      handF: upperHand, handB: hands, batTip: P3(J.batTip),
    };
    return { W, o: { kit: KITS.off, skin: b.skin, battingGloves: true, lookDir: { x: 0, y: 1, z: 0 }, pose: 'bat' } };
  }

  _catcherBody() {
    const cx = this.catcherX;
    const lift = (this.catcherStand || 0) * 1.4;
    const f = { x: 0, y: 1, z: 0 };
    const L = { x: -1, y: 0, z: 0 };
    const S = 0.92;
    const V = (x, y, z) => ({ x, y, z });
    const glove = V(this.glove.x, this.glove.y, this.glove.z);
    const shF = V(cx - 0.62, -2.25, 1.9 + lift), shB = V(cx + 0.62, -2.25, 1.9 + lift);
    const elF = V((shF.x + glove.x) / 2 - 0.25, (shF.y + glove.y) / 2, Math.min(shF.z, glove.z) - 0.25);
    const W = {
      f, L, S,
      hip: V(cx, -2.45, 1.15 + lift), neck: V(cx, -2.25, 2.12 + lift), head: V(cx, -2.1, 2.42 + lift),
      kneeF: V(cx - 0.85, -1.75, 1.15 + lift * 0.5), kneeB: V(cx + 0.85, -1.75, 1.15 + lift * 0.5),
      footF: V(cx - 0.75, -2.5, 0.05), footB: V(cx + 0.75, -2.5, 0.05),
      shF, shB, elF, handF: glove,
      elB: V(cx + 0.9, -2.15, 1.55 + lift), handB: V(cx + 0.75, -1.9, 1.25 + lift),
    };
    return { W, o: { kit: KITS.def, skin: this.catcherSkin, gear: 'catcher', glove: 'F', pose: 'catcher', gloveColor: '#7a4a22', noFace: true } };
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
    P.ow = 0.012;
    const sleeve = this.s.umpKit.jersey;
    P.limb(sh, el, 0.16, sleeve);
    P.sphere(el, 0.14, sleeve);
    P.limb(el, fist, 0.11, this.s.umpSkin);
    P.sphere(fist, 0.15, this.s.umpSkin);
  }

  _zoneLabels(g, cam) {
    const z = this.zone;
    const b = this.batter;
    const lab = (txt, zz) => {
      const p = cam.project(-b.side * (HALF + 0.12), 1.0, zz);
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
  }

  _drawZoneHelper(g, cam) {
    const show = this._zoneShown();
    if (!show) return;
    const z = this.zone;
    const y = 1.0;
    const pts = [[-HALF, y, z.bot], [HALF, y, z.bot], [HALF, y, z.top], [-HALF, y, z.top]];
    g.save();
    if (cam.polyPath(g, pts)) {
      g.fillStyle = 'rgba(255,211,77,0.10)';
      g.fill();
      g.setLineDash([6, 5]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,211,77,0.85)';
      g.stroke();
      g.setLineDash([]);
    }
    // landmark ticks at knees / armpits
    const b = this.batter;
    const lab = (txt, zz) => {
      const p = cam.project(-b.side * (HALF + 0.12), y, zz);
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

  _drawBall(g, cam, b) {
    const p = cam.project(b.x, b.y, b.z);
    if (!p) return;
    const r = Math.max(1.8, BALL_R * 1.2 * p.s);
    // shadow
    const sh = cam.project(b.x, b.y, 0);
    if (sh) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(sh.x, sh.y, r * 1.1, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
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
      // rotate a (dx toward plate, dy toward pitcher) offset around the body
      const c = Math.cos(rot), sn = Math.sin(rot);
      const rx = dx * c + dy * sn, ry = -dx * sn + dy * c;
      return [bx + f * rx, by + ry];
    };
    const J = {};
    J.footF = [bx, by + 1.05, 0.05];
    J.footB = [bx - f * 0.05, by - 1.05, 0.05];
    J.kneeF = [bx + f * 0.32, by + 0.8, kn - 0.06];
    J.kneeB = [bx + f * 0.3, by - 0.75, kn - 0.08];
    J.hip = [bx - f * 0.05, by, hipZ];
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
        { p: 0, h: [bx + f * 0.35, by - 0.75, ap + 0.55], yaw: -90, el: 62 },
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
      hands = [bx + f * 0.35, by - 0.75, ap + 0.55];
      if (pk && pk.crowd) hands = [bx + f * 0.55, by - 0.5, ap + 0.5];
      batDir = normV3([f * 0.15, -0.5, 0.85]);
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

  _drawBatter(g, cam, t) {
    const b = this.batter;
    const J = this._batterPose(t);
    const kit = KITS.off;
    const OL = 'rgba(10,14,28,0.92)';
    const P = (p) => cam.project(p[0], p[1], p[2]);
    const seg = (a, c, w, color, outline = true) => {
      const pa = P(a), pc = P(c);
      if (!pa || !pc) return;
      const s = (pa.s + pc.s) / 2;
      if (outline) {
        g.strokeStyle = OL;
        g.lineWidth = Math.max(2, (w + 0.09) * s);
        g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pc.x, pc.y); g.stroke();
      }
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, w * s);
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pc.x, pc.y); g.stroke();
    };
    const dot = (p, r, color, outline = true) => {
      const q = P(p);
      if (!q) return;
      if (outline) { g.fillStyle = OL; g.beginPath(); g.arc(q.x, q.y, (r + 0.045) * q.s, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = color;
      g.beginPath(); g.arc(q.x, q.y, r * q.s, 0, Math.PI * 2); g.fill();
    };
    const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // shadow
    const sh = P([J.hip[0], J.hip[1], 0]);
    if (sh) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(sh.x, sh.y, 1.4 * sh.s, 0.4 * sh.s, 0, 0, Math.PI * 2); g.fill(); }
    // cleats
    for (const ft of [J.footB, J.footF]) {
      const p = P(ft);
      if (!p) continue;
      g.fillStyle = OL; g.beginPath(); g.ellipse(p.x, p.y, 0.42 * p.s, 0.2 * p.s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b1b22'; g.beginPath(); g.ellipse(p.x, p.y, 0.37 * p.s, 0.16 * p.s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.fillRect(p.x - 0.2 * p.s, p.y - 0.03 * p.s, 0.4 * p.s, 0.05 * p.s);
    }
    // legs: red socks below the knee, white pants above
    seg(mix(J.kneeB, J.footB, 0.15), J.footB, 0.3, '#b3122a');
    seg(mix(J.kneeF, J.footF, 0.15), J.footF, 0.31, '#c8172f');
    seg(J.hip, mix(J.kneeB, J.footB, 0.2), 0.48, '#d9dce3');
    seg(J.hip, mix(J.kneeF, J.footF, 0.2), 0.5, kit.pants);
    seg(J.hip, mix(J.kneeF, J.footF, 0.2), 0.07, '#c8172f', false); // pant stripe
    // back arm
    seg(J.shB, J.elB, 0.3, '#b51f30');
    seg(J.elB, J.hands, 0.23, shade3(b.skin, 0.85));
    // torso
    seg(J.hip, J.neck, 1.3, kit.jersey);
    seg(J.shB, J.shF, 0.7, kit.jersey, false);
    seg(mix(J.hip, J.neck, 0.15), mix(J.hip, J.neck, 0.85), 0.25, 'rgba(255,255,255,0.12)', false);
    // belt
    const bl = P([J.hip[0], J.hip[1] - 0.38, J.hip[2]]), br = P([J.hip[0], J.hip[1] + 0.38, J.hip[2]]);
    if (bl && br) { g.strokeStyle = '#16161c'; g.lineWidth = Math.max(1, 0.15 * bl.s); g.beginPath(); g.moveTo(bl.x, bl.y); g.lineTo(br.x, br.y); g.stroke(); }
    // number on the back
    const np = P(mix(J.hip, J.neck, 0.55).map((v, i) => (i === 1 ? v - 0.45 : v)));
    if (np && np.s > 16) {
      g.font = `${np.s * 0.5}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(2, np.s * 0.06);
      g.strokeStyle = '#7a0d1a';
      g.strokeText(String(b.num), np.x, np.y);
      g.fillStyle = '#fff';
      g.fillText(String(b.num), np.x, np.y);
    }
    // bat: handle + barrel
    const knob = J.hands, tip = J.batTip;
    const neck = mix(knob, tip, 0.42);
    seg(knob, neck, 0.11, '#c7924f');
    seg(neck, tip, 0.21, '#d9a865');
    dot(tip, 0.115, '#b9864a');
    dot(knob, 0.08, '#2a2a2a', false);
    // front arm + batting gloves
    seg(J.shF, J.elF, 0.31, kit.jersey);
    seg(J.elF, J.hands, 0.24, b.skin);
    dot(J.hands, 0.17, '#f2f2f2');
    // neck + head + helmet
    seg(J.neck, J.head, 0.32, b.skin);
    const hd = P(J.head);
    if (hd) {
      const r = 0.42 * hd.s;
      g.fillStyle = OL;
      g.beginPath(); g.arc(hd.x, hd.y, r * 1.14, 0, Math.PI * 2); g.fill();
      g.fillStyle = b.skin;
      g.beginPath(); g.arc(hd.x, hd.y + r * 0.25, r * 0.85, 0, Math.PI * 2); g.fill();
      const grad = g.createRadialGradient(hd.x - r * 0.4, hd.y - r * 0.5, r * 0.1, hd.x, hd.y, r * 1.2);
      grad.addColorStop(0, '#ff4a5c');
      grad.addColorStop(0.6, kit.cap);
      grad.addColorStop(1, '#5e0712');
      g.fillStyle = grad;
      g.beginPath(); g.arc(hd.x, hd.y - r * 0.05, r * 1.08, Math.PI * 0.88, Math.PI * 2.12); g.closePath(); g.fill();
      // ear flap
      g.beginPath(); g.ellipse(hd.x - this.batter.side * r * 0.55, hd.y + r * 0.35, r * 0.48, r * 0.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.ellipse(hd.x - r * 0.35, hd.y - r * 0.6, r * 0.38, r * 0.15, -0.45, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.font = `${r * 0.6}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('M', hd.x + this.batter.side * r * 0.25, hd.y - r * 0.15);
    }
  }

  _drawGlove(g, cam) {
    const p = cam.project(this.glove.x, this.glove.y, this.glove.z);
    if (!p) return;
    const r = 0.4 * p.s;
    g.fillStyle = 'rgba(10,14,28,0.9)';
    g.beginPath(); g.ellipse(p.x, p.y, r * 1.1, r * 1.18, 0, 0, Math.PI * 2); g.fill();
    const grad = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.4, r * 0.1, p.x, p.y, r * 1.1);
    grad.addColorStop(0, '#a8692f');
    grad.addColorStop(1, '#5e3714');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(p.x, p.y, r, r * 1.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a2a0f';
    g.beginPath(); g.ellipse(p.x, p.y + r * 0.12, r * 0.58, r * 0.66, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d9b27a';
    g.lineWidth = Math.max(1, r * 0.06);
    for (let i = -2; i <= 2; i++) {
      g.beginPath(); g.moveTo(p.x + i * r * 0.28, p.y - r * 1.0); g.lineTo(p.x + i * r * 0.3, p.y - r * 0.6); g.stroke();
    }
  }

  _drawCatcher(g, cam) {
    const cx = this.catcherX;
    const up = this.catcherStand || 0;
    const P = (x, y, z) => cam.project(x, y, z);
    const lift = up * 1.4;
    const OL = 'rgba(10,14,28,0.92)';
    const kit = KITS.def;
    g.lineCap = 'round';
    const seg = (a, c, w, color) => {
      if (!a || !c) return;
      const s = (a.s + c.s) / 2;
      g.strokeStyle = OL; g.lineWidth = (w + 0.08) * s;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke();
      g.strokeStyle = color; g.lineWidth = w * s;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke();
    };
    // legs: pants thighs + shin guards with knee caps
    for (const sx of [-1, 1]) {
      const knee = P(cx + sx * 0.85, -1.85, 1.15 + lift * 0.5);
      const foot = P(cx + sx * 0.75, -2.5, 0.1);
      const hip = P(cx + sx * 0.4, -2.45, 1.2 + lift);
      seg(hip, knee, 0.5, '#d5dae3');
      seg(knee, foot, 0.45, '#1f4fb0');
      if (knee) {
        g.fillStyle = '#2a63d6';
        g.beginPath(); g.arc(knee.x, knee.y, 0.3 * knee.s, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.beginPath(); g.arc(knee.x - 0.08 * knee.s, knee.y - 0.08 * knee.s, 0.1 * knee.s, 0, Math.PI * 2); g.fill();
      }
    }
    // body (we see the catcher's back: jersey + chest-protector straps)
    const sh = P(cx, -2.3, 2.05 + lift);
    const hp = P(cx, -2.5, 1.25 + lift);
    if (sh && hp) {
      const w = 0.85;
      const L = P(cx - w, -2.3, 2.0 + lift), R = P(cx + w, -2.3, 2.0 + lift);
      const HL = P(cx - 0.62, -2.5, 1.15 + lift), HR = P(cx + 0.62, -2.5, 1.15 + lift);
      if (L && R && HL && HR) {
        g.beginPath();
        g.moveTo(L.x, L.y);
        g.quadraticCurveTo(sh.x, sh.y - 0.3 * sh.s, R.x, R.y);
        g.lineTo(HR.x, HR.y);
        g.lineTo(HL.x, HL.y);
        g.closePath();
        g.lineWidth = 0.1 * sh.s;
        g.strokeStyle = OL;
        g.stroke();
        g.fillStyle = kit.jersey;
        g.fill();
        // shading on the right side
        g.fillStyle = 'rgba(30,40,70,0.12)';
        g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(R.x, R.y); g.lineTo(HR.x, HR.y); g.lineTo(hp.x, hp.y); g.closePath(); g.fill();
        // straps
        g.strokeStyle = '#151515';
        g.lineWidth = 0.13 * sh.s;
        g.beginPath(); g.moveTo(L.x + (R.x - L.x) * 0.15, L.y); g.lineTo(HR.x - (HR.x - HL.x) * 0.15, HR.y); g.stroke();
        g.beginPath(); g.moveTo(R.x - (R.x - L.x) * 0.15, R.y); g.lineTo(HL.x + (HR.x - HL.x) * 0.15, HL.y); g.stroke();
        g.fillStyle = '#c0c4cc';
        const mx = (L.x + R.x + HL.x + HR.x) / 4, my = (L.y + R.y + HL.y + HR.y) / 4;
        g.beginPath(); g.arc(mx, my, 0.09 * sh.s, 0, Math.PI * 2); g.fill();
        // number
        g.font = `${0.5 * sh.s}px Bungee, Impact, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#1f5fe0';
        g.fillText('2', (L.x + mx) / 2, my - 0.05 * sh.s);
      }
    }
    // glove arm reaching toward the mitt
    const shL = P(cx - 0.75, -2.3, 2.0 + lift);
    const gl = P(this.glove.x, this.glove.y, this.glove.z);
    seg(shL, gl, 0.3, kit.jersey);
    // helmet (back of a hockey-style catcher's helmet, mask cage peeking out)
    const hd = P(cx, -2.1, 2.45 + lift);
    if (hd) {
      const r = 0.42 * hd.s;
      g.strokeStyle = '#3a3f4a';
      g.lineWidth = Math.max(1, 0.05 * hd.s);
      for (const sx of [-1, 1]) {
        g.beginPath(); g.arc(hd.x + sx * r * 0.85, hd.y + r * 0.3, r * 0.35, -1, 1.2); g.stroke();
      }
      g.fillStyle = OL;
      g.beginPath(); g.arc(hd.x, hd.y, r * 1.1, 0, Math.PI * 2); g.fill();
      const grad = g.createRadialGradient(hd.x - r * 0.35, hd.y - r * 0.45, r * 0.1, hd.x, hd.y, r * 1.1);
      grad.addColorStop(0, '#3f6fe0');
      grad.addColorStop(0.6, '#1d3f9e');
      grad.addColorStop(1, '#0d1f52');
      g.fillStyle = grad;
      g.beginPath(); g.arc(hd.x, hd.y, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.ellipse(hd.x - r * 0.3, hd.y - r * 0.45, r * 0.4, r * 0.18, -0.5, 0, Math.PI * 2); g.fill();
      // strap + dangling throat guard
      g.strokeStyle = '#111';
      g.lineWidth = 0.08 * hd.s;
      g.beginPath(); g.moveTo(hd.x - r * 0.9, hd.y + r * 0.2); g.lineTo(hd.x + r * 0.9, hd.y + r * 0.2); g.stroke();
      g.beginPath(); g.moveTo(hd.x, hd.y + r); g.lineTo(hd.x, hd.y + r * 1.4); g.stroke();
    }
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

function shade3(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
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
  g.fillRect(X(-HALF), Y(zone.top), 2 * HALF * sc, (zone.top - zone.bot) * sc);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.strokeRect(X(-HALF), Y(zone.top), 2 * HALF * sc, (zone.top - zone.bot) * sc);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    g.beginPath(); g.moveTo(X(-HALF + (2 * HALF * i) / 3), Y(zone.top)); g.lineTo(X(-HALF + (2 * HALF * i) / 3), Y(zone.bot)); g.stroke();
    g.beginPath(); g.moveTo(X(-HALF), Y(zone.top - ((zone.top - zone.bot) * i) / 3)); g.lineTo(X(HALF), Y(zone.top - ((zone.top - zone.bot) * i) / 3)); g.stroke();
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
