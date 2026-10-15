// Stick-and-blob ballplayers drawn as billboards in the 3D field.
// Each pose returns joint positions in feet for a 5-ft figure.
//   x = forward (side view) or screen-right (front view), z = up.
import { sport } from '../sport.js';

export const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a86b3c', '#d9a066'];

export const KITS = {
  def: { jersey: '#f4f6fa', trim: '#1f5fe0', pants: '#c3c9d4', cap: '#1f5fe0', shade: '#d5dae3' },
  off: { jersey: '#d62839', trim: '#8c0f1d', pants: '#eef0f3', cap: '#a3121f', helmet: true, shade: '#a81d2c' },
  ump: { jersey: '#1d2b53', trim: '#0d1530', pants: '#7d838f', cap: '#141414', shade: '#141d3a', ump: true },
  coach: { jersey: '#d62839', trim: '#8c0f1d', pants: '#2b2f38', cap: '#a3121f', shade: '#a81d2c', coach: true },
};

export const UMP_SHIRTS = {
  navy: '#1d2b53', powder: '#7fb2e5', black: '#16181d', red: '#b3202e', purple: '#5b2a86',
  green: '#25a244', gold: '#d4a017', pink: '#e0569b', orange: '#ef7d1a',
};
export const UMP_CAPS = { black: '#141414', navy: '#16224a', red: '#9e1b28', gold: '#c8961a', white: '#eef0f3', camo: '#56613f' };

const TAU = Math.PI * 2;

// ---- 3D pose helpers ----
// A joint is [x, z] or [x, z, w]. In side poses x is forward and w is toward the player's left; in front
// poses x is the player's left (screen-right) and w is forward. The flat 2D renderer ignores w; the 3D
// field view uses it, plus J.twist (shoulders turned left of the hips, radians), J.shF / J.shB (shoulders)
// and J.yawF / J.yawB (which way each foot points, radians left of forward).
const UA = 0.78, FA = 0.74, TH = 1.1, SHIN = 1.33; // upper arm, forearm, thigh, shin
const P3 = (p) => [p[0], p[1], p[2] || 0];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);

// Elbow or knee of a two-bone limb from root toward end, bending toward `pole` (a direction). An end
// out of reach is pulled in along the limb. Returns [middle, end].
function bend(root, end, l1, l2, pole) {
  const d0 = vsub(end, root);
  const d1 = vlen(d0) || 1e-6;
  const dir = vmul(d0, 1 / d1);
  const d = Math.min(Math.max(d1, Math.abs(l1 - l2) + 0.02), (l1 + l2) * 0.998);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let q = vsub(pole, vmul(dir, vdot(pole, dir)));
  const ql = vlen(q);
  q = ql > 1e-6 ? vmul(q, 1 / ql) : [0, 0, 0];
  return [vadd(vadd(root, vmul(dir, a)), vmul(q, h)), vadd(root, vmul(dir, d))];
}

// Shoulders of a side pose: the neck, turned by the twist
function shoulders(neck, tw = 0) {
  const n = P3(neck), s = Math.sin(tw), c = Math.cos(tw);
  return [[n[0] - 0.42 * s, n[1] - 0.12, n[2] + 0.42 * c], [n[0] + 0.42 * s, n[1] - 0.12, n[2] - 0.42 * c]];
}

// Finish a side pose: add the shoulders, then re-solve elbows and knees so arms and legs keep their
// length (a keyed elbow or knee only says which way the limb bends).
function limbs(J) {
  [J.shF, J.shB] = shoulders(J.neck, J.twist);
  const h = P3(J.hip);
  for (const s of ['F', 'B']) {
    const side = s === 'F' ? 1 : -1;
    const sh = J['sh' + s], hand = P3(J['hand' + s]);
    const el = J['elbow' + s] ? P3(J['elbow' + s]) : vadd(sh, [-0.3, -1, 0.3 * side]);
    [J['elbow' + s], J['hand' + s]] = bend(sh, hand, UA, FA, vsub(el, vmul(vadd(sh, hand), 0.5)));
    const hs = [h[0], h[1] - 0.05, h[2] + 0.2 * side], foot = P3(J['foot' + s]);
    const kn = J['knee' + s] ? P3(J['knee' + s]) : vadd(hs, [1, -1, 0]);
    [J['knee' + s], J['foot' + s]] = bend(hs, foot, TH, SHIN, vsub(kn, vmul(vadd(hs, foot), 0.5)));
  }
  return J;
}
// Front poses are keyed as [left, z, forward]: swap to side axes to finish them, then back.
const swapW = (J) => {
  const O = {};
  for (const k in J) O[k] = Array.isArray(J[k]) ? [J[k][2] || 0, J[k][1], J[k][0]] : J[k];
  return O;
};
const limbsFront = (J) => swapW(limbs(swapW(J)));

// Smooth path through keyframes [{ p, joint: [..], scalar: n }], easing in and out at the ends.
function keyed(keys, p) {
  const n = keys.length;
  p = Math.max(keys[0].p, Math.min(keys[n - 1].p, p));
  let i = 0;
  while (i < n - 2 && p > keys[i + 1].p) i++;
  const k0 = keys[i], k1 = keys[i + 1], km = keys[i - 1], kp = keys[i + 2];
  const dt = k1.p - k0.p, u = dt > 0 ? (p - k0.p) / dt : 1;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
  const val = (a, b, ta, tb) => (ta === undefined || tb === undefined ? 0 : ((b - a) / (tb - ta)) * dt);
  const f = (v0, v1, vm, vp) => h00 * v0 + h10 * val(vm, v1, km && km.p, k1.p) + h01 * v1 + h11 * val(v0, vp, k0.p, kp && kp.p);
  const J = {};
  for (const j in k1) {
    if (j === 'p') continue;
    const a = k0[j], b = k1[j];
    if (typeof b === 'number') J[j] = f(a, b, km && km[j], kp && kp[j]);
    else J[j] = b.map((_, c) => f(a[c] || 0, b[c] || 0, km && (km[j][c] || 0), kp && (kp[j][c] || 0)));
  }
  return J;
}

// Catmull-Rom through [u, ...values] points (u ascending), for one value at u
function spline(pts, u) {
  let i = 1;
  while (i < pts.length - 3 && u > pts[i + 1][0]) i++;
  const a = pts[i - 1], b = pts[i], c = pts[i + 1], d = pts[i + 2];
  const dt = c[0] - b[0], t = Math.max(0, Math.min(1, (u - b[0]) / dt));
  const t2 = t * t, t3 = t2 * t;
  return b.slice(1).map((_, k) => {
    const m0 = ((c[k + 1] - a[k + 1]) / (c[0] - a[0])) * dt, m1 = ((d[k + 1] - b[k + 1]) / (d[0] - b[0])) * dt;
    return (2 * t3 - 3 * t2 + 1) * b[k + 1] + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * c[k + 1] + (t3 - t2) * m1;
  });
}

// ---- Run cycle ----
// Each leg's phase q: foot strike at 0, planted (moving back under the body) until RUN_ST, then the swing:
// the heel kicks up, the knee drives through, the leg reaches out and paws back down.
// One cycle covers (RUN_XC - RUN_XO) / RUN_ST = 6.0 ft; timeline STRIDE matches it at the 3D scale.
const RUN_ST = 0.32, RUN_XC = 0.78, RUN_XO = -1.14;
const RUN_SWING = [ // [u, forward, height]
  [-0.15, RUN_XO + 0.6, 0.06], [0, RUN_XO, 0.3], [0.2, -1.22, 0.95], [0.42, -0.66, 1.3], [0.62, 0.42, 0.68],
  [0.8, 1.04, 0.36], [0.93, 0.98, 0.12], [1, RUN_XC, 0], [1.15, RUN_XC - 0.6, 0],
];
function runFoot(q, w) {
  if (q < RUN_ST) {
    const u = q / RUN_ST;
    return [RUN_XC + (RUN_XO - RUN_XC) * u, 0.3 * Math.max(0, (u - 0.72) / 0.28) ** 2, w];
  }
  const [x, z] = spline(RUN_SWING, (q - RUN_ST) / (1 - RUN_ST));
  return [x, Math.max(0, z), w];
}

// ---- Keyframed action poses (see keyed) ----
export const THROW_RELEASE = 0.6;
const THROW_KEYS = [
  { p: 0, hip: [0, 2.15, 0], neck: [0.05, 3.62, 0], head: [0.14, 4.1, 0], twist: -1.0, yawF: -0.4, yawB: -1.3, // hands together at the chest
    handF: [0.5, 3.0, 0.05], elbowF: [0.3, 2.75, 0.5], handB: [0.45, 3.05, -0.1], elbowB: [0.15, 2.8, -0.5],
    footF: [0.45, 0, 0.3], kneeF: [0.6, 1.2, 0.4], footB: [-0.45, 0, -0.3], kneeB: [-0.2, 1.2, -0.45] },
  { p: 0.3, hip: [-0.05, 2.05, 0], neck: [-0.22, 3.55, 0], head: [-0.08, 4.03, 0], twist: -1.45, yawF: -0.5, yawB: -1.35, // stride, glove at the target, arm cocked
    handF: [1.55, 3.75, 0.1], elbowF: [0.92, 3.6, 0.2], handB: [-1.15, 4.3, -0.35], elbowB: [-1.2, 3.55, -0.5],
    footF: [1.05, 0.22, 0.12], kneeF: [0.8, 1.3, 0.2], footB: [-0.6, 0, -0.3], kneeB: [-0.2, 1.15, -0.45] },
  { p: 0.48, hip: [0.2, 1.95, 0], neck: [0.38, 3.44, 0], head: [0.55, 3.9, 0], twist: -0.45, yawF: -0.15, yawB: -1.1, // plant, hips open, elbow up
    handF: [0.8, 3.25, 0.25], elbowF: [0.65, 2.95, 0.6], handB: [-0.2, 4.3, -0.95], elbowB: [0.0, 3.6, -1.05],
    footF: [1.35, 0, 0.12], kneeF: [1.15, 1.15, 0.2], footB: [-0.62, 0.06, -0.3], kneeB: [-0.1, 1.0, -0.4] },
  { p: THROW_RELEASE, hip: [0.42, 1.95, 0], neck: [0.78, 3.4, 0], head: [0.98, 3.82, 0], twist: 0.25, yawF: 0, yawB: -0.6, // release out front
    handF: [0.75, 2.75, 0.2], elbowF: [0.25, 2.75, 0.8], handB: [1.85, 4.25, -0.15], elbowB: [1.15, 3.7, -0.5],
    footF: [1.35, 0, 0.12], kneeF: [1.3, 1.15, 0.15], footB: [-0.5, 0.25, -0.25], kneeB: [0.05, 0.95, -0.3] },
  { p: 0.8, hip: [0.55, 1.85, 0], neck: [1.15, 3.07, 0], head: [1.42, 3.42, 0], twist: 0.75, yawF: 0, yawB: -0.2, // follow through across the body
    handF: [0.6, 2.4, 0.55], elbowF: [0.3, 2.65, 0.8], handB: [1.25, 1.75, 0.45], elbowB: [1.4, 2.5, 0.05],
    footF: [1.35, 0, 0.12], kneeF: [1.45, 1.1, 0.15], footB: [-0.1, 0.75, -0.2], kneeB: [0.45, 1.3, -0.25] },
  { p: 1, hip: [0.5, 2.1, 0], neck: [0.9, 3.55, 0], head: [1.05, 4.03, 0], twist: 0.3, yawF: 0, yawB: 0, // back foot comes around
    handF: [0.95, 2.75, 0.45], elbowF: [0.7, 3.0, 0.65], handB: [1.05, 2.55, -0.05], elbowB: [0.85, 3.0, -0.4],
    footF: [1.35, 0, 0.3], kneeF: [1.5, 1.2, 0.3], footB: [0.85, 0, -0.45], kneeB: [1.0, 1.2, -0.45] },
];
const SLIDE_KEYS = [
  { p: 0, hip: [0, 2.1, 0], neck: [-0.12, 3.6, 0], head: [-0.02, 4.08, 0], twist: 0,
    handF: [0.35, 3.15, 0.55], elbowF: [0, 2.95, 0.65], handB: [-0.25, 3.2, -0.55], elbowB: [-0.5, 3.0, -0.65],
    footF: [0.75, 0.35, 0.1], kneeF: [0.7, 1.25, 0.15], footB: [-0.65, 0.12, -0.1], kneeB: [0, 1.05, -0.2] },
  { p: 0.5, hip: [0.15, 1.15, 0], neck: [-0.62, 2.43, 0], head: [-0.5, 2.92, 0], twist: 0,
    handF: [-0.3, 3.05, 0.6], elbowF: [-0.6, 2.45, 0.7], handB: [-0.3, 3.05, -0.6], elbowB: [-0.6, 2.45, -0.7],
    footF: [1.9, 0.45, 0.1], kneeF: [1.1, 1.05, 0.15], footB: [0.35, 0.18, -0.1], kneeB: [0.8, 0.65, -0.45] },
  { p: 1, hip: [0.1, 0.45, 0], neck: [-0.95, 1.52, 0], head: [-0.78, 1.99, 0], twist: 0,
    handF: [-0.5, 2.75, 0.7], elbowF: [-0.95, 2.2, 0.75], handB: [-0.5, 2.75, -0.7], elbowB: [-0.95, 2.2, -0.75],
    footF: [2.3, 0.28, 0.12], kneeF: [1.2, 0.6, 0.15], footB: [1.0, 0.1, 0.05], kneeB: [0.75, 0.55, -0.6] },
];
const DIVE_KEYS = [
  { p: 0, hip: [0, 2.15, 0], neck: [0.48, 3.57, 0], head: [0.68, 4.03, 0], twist: 0,
    handF: [0.55, 2.75, 0.5], elbowF: [0.1, 2.95, 0.6], handB: [0.4, 2.7, -0.5], elbowB: [0, 2.9, -0.6],
    footF: [0.45, 0, 0.12], kneeF: [0.75, 1.15, 0.2], footB: [-0.95, 0.4, -0.12], kneeB: [-0.2, 1.1, -0.2] },
  { p: 0.35, hip: [-0.55, 1.45, 0], neck: [0.88, 1.55, 0], head: [1.3, 1.82, 0], twist: 0,
    handF: [2.1, 1.55, 0.38], elbowF: [1.55, 1.75, 0.5], handB: [2.0, 1.5, -0.38], elbowB: [1.45, 1.7, -0.5],
    footF: [-2.15, 0.85, 0.15], kneeF: [-1.3, 1.0, 0.2], footB: [-2.4, 1.25, -0.15], kneeB: [-1.45, 1.3, -0.2] },
  { p: 1, hip: [-1.3, 0.5, 0], neck: [0.15, 0.62, 0], head: [0.6, 0.86, 0], twist: 0,
    handF: [1.45, 0.38, 0.4], elbowF: [0.88, 0.55, 0.5], handB: [1.35, 0.36, -0.4], elbowB: [0.8, 0.55, -0.5],
    footF: [-3.55, 0.4, 0.25], kneeF: [-2.45, 0.3, 0.25], footB: [-3.45, 0.55, -0.25], kneeB: [-2.4, 0.32, -0.25] },
];
const REACH_KEYS = [
  { p: 0, hip: [0, 2.0, 0], neck: [0.25, 3.48, 0], head: [0.36, 3.97, 0], twist: 0,
    handF: [0.75, 3.0, 0.3], elbowF: [0.35, 2.75, 0.65], handB: [0.6, 2.9, -0.3], elbowB: [0.25, 2.7, -0.65],
    footF: [0.3, 0, 0.45], kneeF: [0.55, 1.05, 0.5], footB: [-0.35, 0, -0.45], kneeB: [0, 1.05, -0.55] },
  // the base plays catch the throw about a foot in front of the fielder, so the stretch is mostly a lunge
  { p: 1, hip: [-0.3, 1.8, 0], neck: [0.25, 3.2, 0], head: [0.42, 3.67, 0], twist: 0.2,
    handF: [1.15, 3.1, 0.15], elbowF: [0.7, 3.0, 0.45], handB: [0.55, 2.75, -0.4], elbowB: [0.2, 2.75, -0.65],
    footF: [1.15, 0, 0.2], kneeF: [1.05, 1.0, 0.25], footB: [-1.0, 0, -0.2], kneeB: [-0.5, 0.95, -0.3] },
];
const TAG_KEYS = [
  { p: 0, hip: [0, 1.95, 0], neck: [0.32, 3.42, 0], head: [0.45, 3.9, 0], twist: 0,
    handF: [0.95, 3.0, 0.15], elbowF: [0.55, 2.75, 0.6], handB: [0.85, 2.85, -0.12], elbowB: [0.45, 2.65, -0.6],
    footF: [0.25, 0, 0.75], kneeF: [0.55, 1.05, 0.8], footB: [-0.25, 0, -0.75], kneeB: [0.1, 1.05, -0.85] },
  { p: 0.4, hip: [-0.15, 1.05, 0], neck: [0.92, 2.1, 0], head: [1.32, 2.36, 0], twist: 0.12,
    handF: [1.45, 0.45, 0.05], elbowF: [1.0, 1.0, 0.45], handB: [1.35, 0.8, -0.12], elbowB: [0.95, 1.35, -0.5],
    footF: [0.25, 0, 0.75], kneeF: [0.75, 0.75, 0.9], footB: [-0.25, 0, -0.75], kneeB: [0.3, 0.7, -0.95] },
  { p: 1, hip: [-0.05, 1.72, 0], neck: [0.3, 3.18, 0], head: [0.42, 3.66, 0], twist: 0.35,
    handF: [0.55, 2.75, 0.8], elbowF: [0.3, 2.35, 0.8], handB: [0.45, 2.5, -0.35], elbowB: [0.15, 2.4, -0.62],
    footF: [0.25, 0, 0.75], kneeF: [0.6, 1.0, 0.8], footB: [-0.25, 0, -0.75], kneeB: [0.15, 1.0, -0.85] },
];
// front poses: [left, z, forward]
const FIELD_KEYS = [
  { p: 0, hip: [0, 1.85, -0.25], neck: [0, 3.18, 0.45], head: [0, 3.66, 0.62],
    handF: [0.35, 1.7, 1.2], elbowF: [0.75, 2.3, 0.75], handB: [-0.35, 1.75, 1.15], elbowB: [-0.75, 2.3, 0.7],
    footF: [0.95, 0, 0.15], kneeF: [0.92, 1.0, 0.55], footB: [-0.95, 0, -0.05], kneeB: [-0.92, 1.0, 0.4] },
  { p: 0.28, hip: [0, 1.25, -0.45], neck: [0, 2.0, 0.85], head: [0, 2.2, 1.32], // butt down, back flat, glove on the dirt
    handF: [0.15, 0.4, 1.45], elbowF: [0.55, 0.95, 1.05], handB: [-0.08, 0.75, 1.4], elbowB: [-0.55, 1.25, 1.0],
    footF: [1.0, 0, 0.3], kneeF: [1.1, 0.8, 0.55], footB: [-1.0, 0, -0.1], kneeB: [-1.1, 0.8, 0.3] },
  { p: 0.5, hip: [0, 1.25, -0.45], neck: [0, 2.0, 0.85], head: [0, 2.2, 1.32], // bare hand covers the ball
    handF: [0.12, 0.45, 1.35], elbowF: [0.55, 0.95, 1.0], handB: [-0.05, 0.6, 1.33], elbowB: [-0.55, 1.2, 0.95],
    footF: [1.0, 0, 0.3], kneeF: [1.1, 0.8, 0.55], footB: [-1.0, 0, -0.1], kneeB: [-1.1, 0.8, 0.3] },
  { p: 0.78, hip: [0, 1.62, -0.3], neck: [0, 2.95, 0.42], head: [0, 3.43, 0.55], // funnel it to the belly
    handF: [0.12, 2.35, 0.75], elbowF: [0.62, 2.3, 0.4], handB: [-0.08, 2.42, 0.7], elbowB: [-0.62, 2.3, 0.35],
    footF: [1.0, 0, 0.3], kneeF: [1.0, 0.95, 0.6], footB: [-1.0, 0, -0.1], kneeB: [-1.0, 0.95, 0.3] },
  { p: 1, hip: [0, 1.95, -0.15], neck: [0, 3.42, 0.15], head: [0, 3.92, 0.22], // coming up to throw
    handF: [0.12, 2.95, 0.6], elbowF: [0.6, 2.7, 0.3], handB: [-0.06, 3.0, 0.55], elbowB: [-0.6, 2.7, 0.25],
    footF: [0.95, 0, 0.3], kneeF: [0.95, 1.1, 0.5], footB: [-0.95, 0, -0.1], kneeB: [-0.95, 1.1, 0.2] },
];
const CATCH_KEYS = [
  { p: 0, hip: [0, 2.3, -0.05], neck: [0, 3.8, 0.12], head: [0, 4.3, 0.18],
    handF: [0.38, 3.25, 0.65], elbowF: [0.72, 3.0, 0.3], handB: [-0.38, 3.25, 0.65], elbowB: [-0.72, 3.0, 0.3],
    footF: [0.5, 0, 0.15], kneeF: [0.52, 1.3, 0.3], footB: [-0.45, 0, -0.15], kneeB: [-0.48, 1.3, 0.1] },
  { p: 1, hip: [0, 2.4, -0.1], neck: [0, 3.9, -0.08], head: [0, 4.38, -0.2], // glove up over the head, eyes up
    handF: [0.28, 5.2, 0.4], elbowF: [0.62, 4.5, 0.3], handB: [-0.12, 5.05, 0.42], elbowB: [-0.55, 4.4, 0.3],
    footF: [0.45, 0, 0.3], kneeF: [0.48, 1.35, 0.35], footB: [-0.45, 0, -0.25], kneeB: [-0.45, 1.33, -0.1] },
];
const READY = limbsFront({ // athletic crouch: feet wide, knees bent, chest over the knees, glove out front
  hip: [0, 1.9, -0.25], neck: [0, 3.25, 0.42], head: [0, 3.75, 0.6],
  handF: [0.35, 1.95, 1.2], elbowF: [0.75, 2.45, 0.75], handB: [-0.35, 1.95, 1.15], elbowB: [-0.75, 2.45, 0.7],
  footF: [0.95, 0, 0.05], kneeF: [0.9, 1.05, 0.45], footB: [-0.95, 0, 0], kneeB: [-0.9, 1.05, 0.4],
});

// ---- Side-view poses (x is "forward") ----
const SIDE = {
  stand() {
    const hip = [0, 2.45], neck = [0.05, 3.95];
    return { hip, neck, head: [0.1, 4.45], kneeF: [0.12, 1.35], footF: [0.25, 0], kneeB: [-0.1, 1.35], footB: [-0.2, 0], elbowF: [0.2, 3.2], handF: [0.3, 2.5], elbowB: [-0.15, 3.2], handB: [-0.1, 2.5] };
  },
  // p: 0..1 through one stride (left foot strikes at 0, right at 0.5). Leaning in, knees driving, heels
  // kicking up, arms pumping opposite the legs with the elbows bent; the shoulders counter-turn a little.
  run(p) {
    p = ((p % 1) + 1) % 1;
    const half = (p * 2) % 1, st = RUN_ST * 2;
    // the body sinks onto the planted leg and floats up between steps
    const hz = half < st ? 2.24 - 0.12 * Math.sin((Math.PI * half) / st) : 2.24 + 0.09 * Math.sin((Math.PI * (half - st)) / (1 - st));
    const hip = [0, hz, 0];
    const neck = [0.36, hz + 1.455, 0];
    // the arm on the right side swings forward as the left knee drives (left knee is highest near p = 0.8)
    const sw = Math.cos(TAU * (p - 0.84));
    const twist = 0.2 * sw;
    const [shF, shB] = shoulders(neck, twist);
    const arm = (sh, s, side) => {
      const fwd = Math.max(0, s);
      const a = 0.14 + 0.78 * s, fl = 1.45 + 0.28 * s; // upper arm angle off vertical, elbow bend
      const el = vadd(sh, vmul([Math.sin(a), -Math.cos(a), 0.12 * side], UA));
      const hd = vadd(el, vmul([Math.sin(a + fl), -Math.cos(a + fl), -side * (0.2 + 0.25 * fwd)], FA));
      return [el, hd];
    };
    const [elbowF, handF] = arm(shF, -sw, 1);
    const [elbowB, handB] = arm(shB, sw, -1);
    return limbs({
      hip, neck, head: [0.5, hz + 1.94, 0], twist, elbowF, handF, elbowB, handB,
      footF: runFoot(p, 0.1), footB: runFoot((p + 0.5) % 1, -0.1), kneeF: [1.4, hz - 0.3, 0.2], kneeB: [1.4, hz - 0.3, -0.2],
    });
  },
  // Feet-first bent-leg slide (p: 0..1 drops from the run onto the seat): lead leg straight at the bag,
  // the other folded under it, leaning back with the hands up
  slide(p = 1) {
    return limbs(keyed(SLIDE_KEYS, p));
  },
  // Knocked down in a collision: stumble back with the arms flung up, then land on the seat of the
  // pants, legs out and hands behind (p: 0..1 through the fall)
  fall(p = 1) {
    const stumble = { hip: [-0.4, 2.1], neck: [-0.95, 3.4], head: [-1.15, 3.85], kneeF: [0.35, 1.45], footF: [0.6, 0.35], kneeB: [-0.3, 1.2], footB: [-0.35, 0],
      elbowF: [0.25, 3.5], handF: [0.6, 4.05], elbowB: [-0.25, 3.55], handB: [0.15, 4.1] };
    const down = { hip: [-0.6, 0.55], neck: [-1.3, 1.85], head: [-1.6, 2.3], kneeF: [0.4, 1.0], footF: [1.3, 0.15], kneeB: [0.3, 0.7], footB: [1.2, 0.1],
      elbowF: [-1.0, 1.1], handF: [-1.3, 0.2], elbowB: [-1.1, 1.0], handB: [-1.4, 0.15] };
    const st = SIDE.stand();
    const a = p < 0.35 ? st : stumble, b = p < 0.35 ? stumble : down;
    let k = p < 0.35 ? p / 0.35 : (p - 0.35) / 0.65;
    k = k * k * (3 - 2 * k);
    const J = {};
    for (const j in b) J[j] = [a[j][0] + (b[j][0] - a[j][0]) * k, a[j][1] + (b[j][1] - a[j][1]) * k];
    return J;
  },
  // Head-first: launch out of the run, arms reaching, and land flat on the chest (p: 0..1). The hands end
  // up just ahead of the player's spot (where the bag or the ball is) with the body stretched out behind.
  dive(p = 1) {
    return limbs(keyed(DIVE_KEYS, p));
  },
  // First baseman's stretch (p: 0..1): back foot on the bag, front leg lunging at the throw, glove out
  reach(p = 1) {
    return limbs(keyed(REACH_KEYS, p));
  },
  // Sweep tag (p: 0..1): take the throw straddling the bag, drop the glove to the ground in front of it,
  // then sweep it up and away
  tag(p = 1) {
    return limbs(keyed(TAG_KEYS, p));
  },
  // Overhand throw toward +x by a righty (p: 0..1, the ball leaves the hand at THROW_RELEASE): break the
  // hands, stride at the target with the shoulders closed and the arm cocked high, plant, turn the hips and
  // chest through, release out front, then follow through across the body as the back leg comes around.
  throw(p) {
    return limbs(keyed(THROW_KEYS, p));
  },
  bat(p = 0) {
    // p: 0 stance, 0..1 swing
    const hip = [0, 2.2], neck = [-0.05 + 0.25 * p, 3.75];
    const hands = p <= 0 ? [-0.5, 3.55] : [-0.5 + p * 1.4, 3.55 - p * 0.8];
    return { hip, neck, head: [0.05 + 0.2 * p, 4.25], kneeF: [0.7, 1.2], footF: [0.95, 0], kneeB: [-0.7, 1.2], footB: [-0.95, 0], elbowF: [0.0, 3.0], handF: hands, elbowB: [-0.7, 3.2], handB: hands, bat: true, batP: Math.max(0, p), batAngle: p <= 0 ? 0.78 : 0.78 - p * 4.0 };
  },
};

// ---- Front-view poses (x is screen-right) ----
const FRONT = {
  stand() {
    return { hip: [0, 2.45], neck: [0, 3.95], head: [0, 4.45], kneeF: [0.3, 1.35], footF: [0.38, 0], kneeB: [-0.3, 1.35], footB: [-0.38, 0], elbowF: [0.62, 3.2], handF: [0.7, 2.5], elbowB: [-0.62, 3.2], handB: [-0.7, 2.5] };
  },
  ready() {
    return { ...READY };
  },
  // Fielding a grounder (p: 0..1): get down with the glove on the dirt out front and the bare hand above
  // it, then funnel the ball up to the belly and come up ready to throw
  field(p = 1) {
    return limbsFront(keyed(FIELD_KEYS, p));
  },
  set() {
    // Umpire set: hands on thighs
    return { hip: [0, 2.0], neck: [0, 3.4], head: [0, 3.9], kneeF: [0.7, 1.15], footF: [0.75, 0], kneeB: [-0.7, 1.15], footB: [-0.75, 0], elbowF: [0.85, 2.55], handF: [0.65, 1.55], elbowB: [-0.85, 2.55], handB: [-0.65, 1.55] };
  },
  out(p = 1) {
    // Right fist hammer (umpire faces camera, so right arm is screen-left)
    const up = Math.min(1, p * 2);
    return { ...FRONT.stand(), elbowB: [-1.0, 3.95 + 0.1 * up], handB: [-1.0 + 0.1 * up, 3.95 + 0.85 * up] };
  },
  safe(p = 1) {
    const w = Math.min(1, p * 2);
    return { ...FRONT.stand(), elbowF: [0.62 + 0.65 * w, 3.5 + 0.35 * w], handF: [0.7 + 1.3 * w, 2.9 + 1.0 * w], elbowB: [-0.62 - 0.65 * w, 3.5 + 0.35 * w], handB: [-0.7 - 1.3 * w, 2.9 + 1.0 * w] };
  },
  time() {
    return { ...FRONT.stand(), elbowF: [0.75, 4.55], handF: [0.75, 5.3], elbowB: [-0.75, 4.55], handB: [-0.75, 5.3] };
  },
  pointR() {
    return { ...FRONT.stand(), elbowF: [1.1, 3.95], handF: [1.85, 4.0] };
  },
  pointL() {
    return { ...FRONT.stand(), elbowB: [-1.1, 3.95], handB: [-1.85, 4.0] };
  },
  // Catch over the head (p: 0..1 raises the glove), bare hand beside it, looking up
  catchHigh(p = 1) {
    return limbsFront(keyed(CATCH_KEYS, p));
  },
  catcher() {
    return { hip: [0, 1.2], neck: [0, 2.6], head: [0, 3.05], kneeF: [0.85, 1.15], footF: [0.75, 0], kneeB: [-0.85, 1.15], footB: [-0.75, 0], elbowF: [0.55, 2.0], handF: [0.3, 2.1], elbowB: [-0.75, 1.9], handB: [-0.7, 1.4] };
  },
  pitch(p) {
    // Wind-up seen from the plate: knee lift, stride, release, follow-through.
    const S = FRONT.stand();
    if (sport.softball) return windmill(S, p);
    if (p < 0.4) {
      const k = p / 0.4;
      return { ...S, kneeF: [0.25, 1.35 + 1.0 * k], footF: [0.3, 0.5 * k + 0.0], handF: [0.15, 3.1], handB: [-0.15, 3.1], elbowF: [0.5, 3.2], elbowB: [-0.5, 3.2] };
    }
    if (p < 0.75) {
      const k = (p - 0.4) / 0.35;
      return { ...S, hip: [0, 2.3 - 0.3 * k], neck: [0, 3.85 - 0.25 * k], head: [0, 4.35 - 0.25 * k], kneeF: [0.4, 1.3], footF: [0.55, 0], elbowF: [0.8, 3.4], handF: [1.0, 3.0], elbowB: [-0.8, 4.0 + 0.3 * k], handB: [-0.6 - 0.4 * k, 4.6 + 0.5 * k] };
    }
    const k = Math.min(1, (p - 0.75) / 0.25);
    return { ...S, hip: [0, 2.0], neck: [0.1, 3.4 - 0.3 * k], head: [0.1, 3.9 - 0.3 * k], kneeF: [0.4, 1.1], footF: [0.5, 0], kneeB: [-0.3, 1.0 + 0.4 * k], footB: [-0.4, 0.2 + 0.6 * k], elbowB: [-0.3 + 0.6 * k, 3.9 - 0.8 * k], handB: [0.0 + 0.8 * k, 4.4 - 2.2 * k] };
  },
};

// Softball windmill seen from the plate: hands together, the throwing arm (screen-left for a righty)
// circles up over the top and down past the hip to release at p = 0.75, then follows through.
function windmill(S, p) {
  const sh = [-0.62, 3.8], L = 1.45;
  if (p < 0.25) {
    return { ...S, elbowF: [0.5, 3.1], handF: [0.12, 2.95], elbowB: [-0.5, 3.1], handB: [-0.1, 2.95] };
  }
  if (p < 0.75) {
    const k = (p - 0.25) / 0.5;
    const a = k * Math.PI * 2;
    const hz = sh[1] - L * Math.cos(a) * (a < 0.3 ? 0.55 : 1);
    const hx = sh[0] - 0.12 * Math.sin(a);
    const lift = Math.sin(Math.min(1, k * 1.6) * Math.PI);
    return { ...S, hip: [0, 2.45 - 0.2 * k], kneeF: [0.35, 1.35 + 0.7 * lift], footF: [0.4, 0.45 * lift], elbowF: [0.75, 3.55], handF: [0.6, 3.9 - 0.8 * k], elbowB: [(sh[0] + hx) / 2 - 0.08, (sh[1] + hz) / 2], handB: [hx, hz] };
  }
  const k = Math.min(1, (p - 0.75) / 0.25);
  return { ...S, hip: [0, 2.15], neck: [0, 3.75], head: [0, 4.25], kneeF: [0.4, 1.1], footF: [0.5, 0], kneeB: [-0.3, 1.1 + 0.3 * k], footB: [-0.35, 0.3 * k], elbowF: [0.75, 3.0], handF: [0.65, 2.4], elbowB: [-0.55 + 0.25 * k, 2.8 + 0.4 * k], handB: [-0.45 + 0.3 * k, 2.4 + 1.2 * k] };
}

export function poseJoints(pose, phase = 0) {
  if (FRONT[pose]) return { J: FRONT[pose](phase), front: true };
  if (SIDE[pose]) return { J: SIDE[pose](phase), front: false };
  return { J: FRONT.stand(), front: true };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * amt)));
  g = Math.max(0, Math.min(255, Math.round(g * amt)));
  b = Math.max(0, Math.min(255, Math.round(b * amt)));
  return `rgb(${r},${g},${b})`;
}

// a: { x, y, z, kit, skin, pose, phase, facing, height, glove ('F'|'B'|null), ballInHand, alpha, mask, mirror }
const OUTLINE = 'rgba(10,14,28,0.92)';
export function drawFigure(g, cam, a) {
  const P = cam.project(a.x, a.y, a.z || 0);
  if (!P) return;
  // Players are drawn ~30% larger than life so they read well on small screens
  const scale = (P.s * (a.height || 5) * (a.vis ?? 1.3)) / 5;
  const kit = a.kit || KITS.def;
  const prevAlpha = g.globalAlpha;
  if (a.alpha !== undefined) g.globalAlpha = a.alpha;
  if (scale < 1.4) {
    // Far away: a tiny readable blip
    g.fillStyle = OUTLINE;
    g.fillRect(P.x - 1.5, P.y - 6, 3, 6);
    g.fillStyle = kit.jersey;
    g.fillRect(P.x - 0.75, P.y - 5.25, 1.5, 3);
    g.globalAlpha = prevAlpha;
    return;
  }
  const { J, front } = poseJoints(a.pose || 'stand', a.phase || 0);
  const fx = front ? (a.mirror ? -1 : 1) : (a.facing || 1);
  const X = (p) => P.x + p[0] * scale * fx;
  const Y = (p) => P.y - p[1] * scale;
  const detail = scale > 6;
  const skin = a.skin || SKINS[0];
  const skinDark = shade(skin, 0.85);
  const pantsDark = shade(kit.pants, 0.84);
  const jerseyDark = kit.shade || shade(kit.jersey, 0.85);
  const sock = kit.trim || '#333';
  const ow = 0.16; // outline thickness (feet)

  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Ground shadow
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(P.x, P.y, scale * 1.0, scale * 0.3, 0, 0, Math.PI * 2);
  g.fill();

  const line = (pts, w, color) => {
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, w * scale);
    g.beginPath();
    g.moveTo(X(pts[0]), Y(pts[0]));
    for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i]), Y(pts[i]));
    g.stroke();
  };
  const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  // head sits a touch higher and bigger for a friendly cartoon look
  const head = [J.head[0], J.head[1] + 0.12];
  const HR = 0.52;

  const torsoPoly = () => {
    if (front) {
      const sw = 0.62, hw = 0.46;
      return [[J.neck[0] - sw, J.neck[1] - 0.12], [J.neck[0] + sw, J.neck[1] - 0.12], [J.hip[0] + hw, J.hip[1] - 0.12], [J.hip[0] - hw, J.hip[1] - 0.12]];
    }
    return null;
  };

  const pass = (outline) => {
    const C = (c) => (outline ? OUTLINE : c);
    const Wd = (w) => (outline ? w + ow : w);
    // back leg: thigh (pants) + shin (sock)
    const kneeB = J.kneeB, footB = J.footB;
    line([J.hip, kneeB, mid(kneeB, footB, 0.45)], Wd(0.44), C(pantsDark));
    line([mid(kneeB, footB, 0.4), footB], Wd(0.32), C(shade(sock, 0.8)));
    // back arm
    line([J.neck, J.elbowB], Wd(0.32), C(jerseyDark));
    line([J.elbowB, J.handB], Wd(0.24), C(skinDark));
    // torso
    const tp = torsoPoly();
    if (tp) {
      g.beginPath();
      tp.forEach((p, i) => (i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))));
      g.closePath();
      if (outline) { g.strokeStyle = OUTLINE; g.lineWidth = ow * scale * 2; g.stroke(); }
      g.fillStyle = C(kit.jersey);
      g.fill();
      line([J.hip, J.neck], Wd(0.7), C(kit.jersey));
    } else {
      line([J.hip, J.neck], Wd(0.86), C(kit.jersey));
    }
    // front leg
    const kneeF = J.kneeF, footF = J.footF;
    line([J.hip, kneeF, mid(kneeF, footF, 0.45)], Wd(0.46), C(kit.pants));
    line([mid(kneeF, footF, 0.4), footF], Wd(0.33), C(sock));
    // front arm
    line([J.neck, J.elbowF], Wd(0.33), C(kit.jersey));
    line([J.elbowF, J.handF], Wd(0.25), C(skin));
    // head
    g.fillStyle = C(skin);
    g.beginPath();
    g.arc(X(head), Y(head), (HR + (outline ? ow / 2 : 0)) * scale, 0, Math.PI * 2);
    g.fill();
  };
  pass(true);
  pass(false);

  // Shoes
  for (const f of [J.footB, J.footF]) {
    const sx = X(f) + (front ? 0 : 0.14 * scale * fx), sy = Y(f) - 0.09 * scale;
    g.fillStyle = '#16161c';
    g.beginPath(); g.ellipse(sx, sy, (front ? 0.24 : 0.32) * scale, 0.15 * scale, 0, 0, Math.PI * 2); g.fill();
    if (detail) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(sx - 0.14 * scale, sy - 0.02 * scale, 0.28 * scale, 0.05 * scale); }
  }
  // Pants stripe + belt
  if (detail) {
    g.strokeStyle = shade(kit.trim || '#333', 1.0);
    g.lineWidth = Math.max(1, 0.06 * scale);
    g.beginPath(); g.moveTo(X(J.hip), Y(J.hip)); g.lineTo(X(mid(J.kneeF, J.footF, 0.3)), Y(mid(J.kneeF, J.footF, 0.3))); g.stroke();
  }
  g.fillStyle = '#16161c';
  const bw = (front ? 0.48 : 0.42) * scale;
  g.fillRect(X(J.hip) - bw, Y(J.hip) - 0.09 * scale, bw * 2, 0.18 * scale);
  // Jersey trim: collar + number on the chest/back
  if (detail) {
    g.fillStyle = kit.trim || '#333';
    g.beginPath(); g.arc(X(J.neck), Y(J.neck) + 0.02 * scale, 0.2 * scale, 0, Math.PI); g.fill();
    if (front && kit !== KITS.ump && a.num !== undefined) {
      g.fillStyle = kit.trim;
      g.font = `${0.62 * scale}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(a.num), X(mid(J.neck, J.hip, 0.45)), Y(mid(J.neck, J.hip, 0.45)));
    }
    if (a.mask && front) {
      // plate umpire chest protector
      g.fillStyle = 'rgba(20,24,40,0.85)';
      const c = mid(J.neck, J.hip, 0.4);
      g.beginPath(); g.ellipse(X(c), Y(c), 0.48 * scale, 0.6 * scale, 0, 0, Math.PI * 2); g.fill();
    }
  }

  // Head gear + face
  const hx = X(head), hy = Y(head), hr = HR * scale;
  if (kit.helmet) {
    g.fillStyle = kit.cap;
    g.beginPath(); g.arc(hx, hy - hr * 0.08, hr * 1.12, Math.PI * 0.92, Math.PI * 2.08); g.fill();
    g.fillRect(hx - hr * 1.12, hy - hr * 0.12, hr * 2.24, hr * 0.32);
    // ear flap
    g.beginPath(); g.ellipse(hx - fx * hr * (front ? 0.85 : 0.2), hy + hr * 0.25, hr * 0.38, hr * 0.42, 0, 0, Math.PI * 2); g.fill();
    if (detail) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(hx - hr * 0.35, hy - hr * 0.6, hr * 0.32, hr * 0.14, -0.4, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = kit.cap;
    g.beginPath(); g.arc(hx, hy - hr * 0.12, hr * 1.04, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    g.beginPath();
    if (front) g.ellipse(hx, hy - hr * 0.1, hr * 0.95, hr * 0.24, 0, 0, Math.PI * 2);
    else g.ellipse(hx + hr * 0.8 * fx, hy - hr * 0.14, hr * 0.62, hr * 0.17, 0, 0, Math.PI * 2);
    g.fill();
    if (detail) { g.fillStyle = kit.trim || '#fff'; g.beginPath(); g.arc(hx, hy - hr * 1.12, hr * 0.12, 0, Math.PI * 2); g.fill(); }
  }
  if (detail) {
    g.fillStyle = '#1a1a1a';
    if (front && !a.backView) {
      g.beginPath(); g.arc(hx - hr * 0.32, hy + hr * 0.18, hr * 0.1, 0, Math.PI * 2); g.arc(hx + hr * 0.32, hy + hr * 0.18, hr * 0.1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(60,20,20,0.8)';
      g.lineWidth = Math.max(1, hr * 0.08);
      g.beginPath(); g.arc(hx, hy + hr * 0.42, hr * 0.2, 0.2, Math.PI - 0.2); g.stroke();
    } else if (!front) {
      g.beginPath(); g.arc(hx + hr * 0.45 * fx, hy + hr * 0.15, hr * 0.1, 0, Math.PI * 2); g.fill();
    }
  }
  if (a.mask) {
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = Math.max(1, 0.09 * scale);
    for (let i = -1; i <= 1; i++) {
      g.beginPath(); g.moveTo(hx - hr * 0.75, hy + i * hr * 0.32 + hr * 0.2); g.lineTo(hx + hr * 0.75, hy + i * hr * 0.32 + hr * 0.2); g.stroke();
    }
  }

  // Bat
  if (J.bat) {
    const ang = J.batAngle;
    const L = 2.6;
    const h = J.handB;
    const tip = [h[0] + Math.sin(ang) * L * -1, h[1] + Math.cos(ang) * L];
    g.strokeStyle = OUTLINE;
    g.lineWidth = Math.max(2, 0.3 * scale);
    g.beginPath(); g.moveTo(X(h), Y(h)); g.lineTo(X(tip), Y(tip)); g.stroke();
    g.strokeStyle = '#d6a25e';
    g.lineWidth = Math.max(1.5, 0.19 * scale);
    g.beginPath(); g.moveTo(X(h), Y(h)); g.lineTo(X(tip), Y(tip)); g.stroke();
  }
  // Hands (batting gloves / fists)
  for (const hnd of [J.handB, J.handF]) {
    g.fillStyle = skin;
    g.beginPath(); g.arc(X(hnd), Y(hnd), 0.15 * scale, 0, Math.PI * 2); g.fill();
  }
  // Glove
  if (a.glove) {
    const gh = a.glove === 'B' ? J.handB : J.handF;
    const gx = X(gh), gy = Y(gh), r = 0.38 * scale;
    g.fillStyle = OUTLINE;
    g.beginPath(); g.arc(gx, gy, r + ow * scale * 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = a.gloveColor || '#8a5524';
    g.beginPath(); g.arc(gx, gy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5e3714';
    g.beginPath(); g.arc(gx, gy + r * 0.1, r * 0.5, 0, Math.PI * 2); g.fill();
  }
  if (a.ballInHand) {
    const bh = a.ballInHand === 'F' ? J.handF : J.handB;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(X(bh), Y(bh), Math.max(1.5, 0.16 * scale), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = prevAlpha;
}


// Screen-space position of a figure's hand (used to attach the ball to a glove).
export function handWorld(a, which = 'F') {
  const { J, front } = poseJoints(a.pose || 'stand', a.phase || 0);
  const h = which === 'B' ? J.handB : J.handF;
  const H = (a.height || 5) / 5;
  if (front) {
    // front view: x offset is screen-right ≈ world +x when the camera looks up the field
    return { x: a.x + h[0] * H, y: a.y, z: (a.z || 0) + h[1] * H };
  }
  const fx = a.facing || 1;
  return { x: a.x + h[0] * H * fx * (a.dirX ?? 1), y: a.y + h[0] * H * (a.dirY ?? 0), z: (a.z || 0) + h[1] * H };
}
