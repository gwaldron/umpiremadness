// Keyframed play animation: actors move between keys; the ball follows segments.
import { KITS, SKINS } from '../render/figures.js';
import { POS, BASES, UMP_SPOTS } from '../render/field.js';
import { lerp, clamp, easeOut, pick, dist, shuffle } from '../util.js';

export const BASE_XY = { 0: BASES.home, 1: BASES.first, 2: BASES.second, 3: BASES.third, 4: BASES.home };
export const STRIDE = 5.2; // feet per run cycle

export class Timeline {
  constructor() {
    this.actors = {};
    this.order = [];
    this.segs = [];
    this.events = [];
    this.fired = new Set();
    this.t = 0;
    this.ball = { x: 0, y: 46, z: 4, visible: false, trail: [] };
  }

  actor(id, props) {
    const a = {
      id, x: props.x, y: props.y, kit: props.kit || KITS.def, skin: props.skin || pick(SKINS),
      pose: props.pose || 'ready', phase: 0, facing: props.facing || 1, glove: props.glove ?? (props.kit === KITS.off || props.kit === KITS.ump ? null : 'F'),
      keys: [{ t: 0, x: props.x, y: props.y, pose: props.pose || 'ready' }], dist: 0, ...props,
    };
    a.keys = [{ t: 0, x: props.x, y: props.y, pose: props.pose || 'ready', facing: props.facing }];
    this.actors[id] = a;
    this.order.push(id);
    return a;
  }

  last(id) {
    const k = this.actors[id].keys;
    return k[k.length - 1];
  }

  // Hold a pose at the current spot from time t.
  pose(id, t, pose, extra = {}) {
    const l = this.last(id);
    this.actors[id].keys.push({ t, x: l.x, y: l.y, pose, ...extra });
    return t;
  }

  // Move to (x, y) arriving at t1 (starting at t0 from the last key position). pose = 'run' while moving.
  move(id, t0, t1, x, y, endPose = null, runPose = 'run') {
    const l = this.last(id);
    if (t0 > l.t) this.actors[id].keys.push({ t: t0, x: l.x, y: l.y, pose: l.pose });
    this.actors[id].keys.push({ t: t1, x, y, pose: endPose || l.pose, movePose: runPose });
    return t1;
  }

  // Run at a given speed; returns arrival time.
  runTo(id, t0, x, y, speed, endPose = 'stand') {
    const l = this.last(id);
    const d = Math.hypot(x - l.x, y - l.y);
    return this.move(id, t0, t0 + d / speed, x, y, endPose);
  }

  // Run through a list of points.
  runPath(id, t0, pts, speed, endPose = 'stand') {
    let t = t0;
    for (let i = 0; i < pts.length; i++) {
      t = this.runTo(id, t, pts[i].x, pts[i].y, speed, i === pts.length - 1 ? endPose : 'run');
    }
    return t;
  }

  // Ball segments
  hold(t0, t1, actorId, z = 3.2) { this.segs.push({ k: 'hold', t0, t1, actorId, z }); return t1; }
  rest(t0, t1, p) { this.segs.push({ k: 'rest', t0, t1, p }); return t1; }
  fly(t0, t1, from, to, apex) { this.segs.push({ k: 'fly', t0, t1, from, to, apex }); return t1; }
  ground(t0, t1, from, to) { this.segs.push({ k: 'ground', t0, t1, from, to }); return t1; }
  throwBall(t0, t1, from, to) {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    this.segs.push({ k: 'fly', t0, t1, from, to, apex: Math.min(6, d * 0.035) });
    return t1;
  }
  hide(t0, t1) { this.segs.push({ k: 'hide', t0, t1 }); return t1; }
  at(t, fn) { this.events.push({ t, fn }); }

  get duration() {
    let d = 0;
    for (const a of Object.values(this.actors)) d = Math.max(d, a.keys[a.keys.length - 1].t);
    for (const s of this.segs) d = Math.max(d, s.t1);
    return d;
  }

  sampleActor(a, t) {
    const keys = a.keys;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const k0 = keys[i];
    const k1 = keys[i + 1];
    const px = a.x, py = a.y;
    if (!k1 || k1.t <= k0.t) {
      a.x = k0.x; a.y = k0.y;
      a.pose = k0.pose;
      if (k0.facing) a.facing = k0.facing;
    } else {
      const u = clamp((t - k0.t) / (k1.t - k0.t), 0, 1);
      a.x = lerp(k0.x, k1.x, u);
      a.y = lerp(k0.y, k1.y, u);
      const moving = Math.hypot(k1.x - k0.x, k1.y - k0.y) > 0.2;
      if (moving) {
        a.pose = k1.movePose || 'run';
        if (Math.abs(k1.x - k0.x) > 0.3) a.facing = k1.x > k0.x ? 1 : -1;
        if (k1.facing) a.facing = k1.facing;
      } else {
        a.pose = k0.pose;
      }
    }
    const step = Math.hypot(a.x - px, a.y - py);
    if (step < 20) a.dist += step;
    a.phase = (a.dist / STRIDE) % 1;
    if (a.pose === 'pitch' || a.pose === 'throw' || a.pose === 'out' || a.pose === 'safe') {
      const k = a.keys.filter((kk) => kk.t <= t && kk.pose === a.pose).pop();
      a.phase = k ? clamp((t - k.t) / (k.dur || 0.6), 0, 1) : 1;
    }
    if (a.pose === 'bat') a.phase = a.swingAt !== undefined && t > a.swingAt ? clamp((t - a.swingAt) / 0.35, 0, 1) : 0;
  }

  sampleBall(t) {
    const b = this.ball;
    let seg = null;
    for (const s of this.segs) if (t >= s.t0 && t <= s.t1) seg = s;
    if (!seg) {
      // after the last segment that started before t
      let last = null;
      for (const s of this.segs) if (s.t0 <= t && (!last || s.t1 >= last.t1)) last = s;
      if (!last) { b.visible = false; return; }
      seg = last;
      t = Math.min(t, last.t1);
    }
    const u = seg.t1 > seg.t0 ? clamp((t - seg.t0) / (seg.t1 - seg.t0), 0, 1) : 1;
    b.visible = seg.k !== 'hide';
    let p;
    switch (seg.k) {
      case 'hold': {
        const a = this.actors[seg.actorId];
        p = { x: a.x + 0.6, y: a.y - 0.4, z: seg.z };
        break;
      }
      case 'rest': p = { ...seg.p, z: seg.p.z ?? 0.12 }; break;
      case 'fly': {
        const f = seg.from, to = seg.to;
        p = { x: lerp(f.x, to.x, u), y: lerp(f.y, to.y, u), z: lerp(f.z ?? 3, to.z ?? 3, u) + 4 * (seg.apex || 0) * u * (1 - u) };
        break;
      }
      case 'ground': {
        const f = seg.from, to = seg.to;
        const e = easeOut(u);
        const bounce = Math.abs(Math.sin(u * Math.PI * 4)) * 1.6 * (1 - u) * (1 - u);
        p = { x: lerp(f.x, to.x, e), y: lerp(f.y, to.y, e), z: 0.15 + bounce };
        break;
      }
      default: p = { x: b.x, y: b.y, z: b.z };
    }
    const moved = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
    b.x = p.x; b.y = p.y; b.z = p.z;
    if (b.visible && moved > 0.05 && moved < 30 && seg.k !== 'hold') {
      b.trail.push({ x: p.x, y: p.y, z: p.z });
      if (b.trail.length > 7) b.trail.shift();
    } else if (b.trail.length) b.trail.shift();
  }

  sample(t) {
    const prev = this.t;
    this.t = t;
    for (const id of this.order) this.sampleActor(this.actors[id], t);
    this.sampleBall(t);
    for (const e of this.events) {
      if (!this.fired.has(e) && t >= e.t && prev <= e.t + 5) {
        this.fired.add(e);
        try { e.fn(); } catch (err) { console.error(err); }
      }
    }
  }

  list() {
    return this.order.map((id) => this.actors[id]);
  }
}

// ---- Helpers to set up a standard field ----
export function setupDefense(tl, opts = {}) {
  const skins = shuffle(SKINS);
  let i = 0;
  for (const k of ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF']) {
    const p = opts[k] || POS[k];
    tl.actor(k, { x: p.x, y: p.y, kit: KITS.def, skin: skins[i++ % skins.length], pose: k === 'C' ? 'catcher' : k === 'P' ? 'stand' : 'ready', glove: 'F', num: 1 + ((i * 7) % 39), backView: k === 'C' });
  }
}

export function setupRunners(tl, runners) {
  for (const b of runners) {
    const p = BASE_XY[b];
    const off = b === 1 ? { x: -0.6, y: 0.9 } : b === 2 ? { x: -1.2, y: -0.6 } : { x: 0.9, y: -0.6 };
    tl.actor('R' + b, { x: p.x + off.x, y: p.y + off.y, kit: KITS.off, pose: 'stand', glove: null, facing: b === 3 ? 1 : -1 });
  }
}

export function setupBatter(tl, hand = 'R') {
  const x = hand === 'R' ? -2.4 : 2.4;
  tl.actor('BAT', { x, y: 0.7, kit: KITS.off, pose: 'bat', facing: hand === 'R' ? 1 : -1, glove: null });
}

export function umpSpotFor(runners) {
  return runners.includes(2) || runners.includes(3) ? UMP_SPOTS.C : runners.includes(1) ? UMP_SPOTS.B : UMP_SPOTS.A;
}

export function setupUmps(tl, runners, umpKit, includeBU = true) {
  tl.actor('PU', { x: 0, y: -6.3, kit: umpKit, pose: 'set', glove: null, mask: true });
  if (includeBU) {
    const s = umpSpotFor(runners);
    tl.actor('BU', { x: s.x, y: s.y, kit: umpKit, pose: 'set', glove: null });
  }
}

// Standard pitch: pitcher winds, ball to the plate. Returns time the ball reaches the plate.
export function pitchTo(tl, t0, opts = {}) {
  tl.pose('P', t0, 'pitch');
  tl.actors.P.keys[tl.actors.P.keys.length - 1].dur = 1.0;
  tl.hold(0, t0 + 0.8, 'P', 5.2);
  const tPlate = t0 + 0.8 + (opts.flight || 0.6);
  tl.fly(t0 + 0.8, tPlate, { x: -1, y: 42, z: 5 }, { x: 0, y: 0.5, z: opts.z || 2.5 }, 0.3);
  tl.pose('P', t0 + 1.05, 'ready');
  return tPlate;
}

export function swing(tl, t) {
  if (!tl.actors.BAT) return;
  tl.actors.BAT.swingAt = t - 0.17;
}

export function distXY(a, b) {
  return dist(a, b);
}
