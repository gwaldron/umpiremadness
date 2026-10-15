// "Hero" bodies: the realistic, close-up players in the plate umpire's view (batter, catcher, pitcher).
// Softer shading, tapered limbs, real gear (two-flap batting helmet, aluminum bat, catcher's gear),
// knicker pants with team socks, and jersey numbers/lettering.
import { vec3, solveIK } from './people.js';

const { V, add, sub, mul, dot, cross, len, norm, lerp3 } = vec3;
const UP = V(0, 0, 1);
const HAIRS = ['#2b1d14', '#4a2f1b', '#1a1a1a', '#7a4b23', '#c9a25c', '#5a3a22', '#8b3a1a'];
const GEAR = '#1f3f9e';

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

// ---------- jersey art ----------
function numberCanvas(num, fill, stroke) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.font = '900 200px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 22;
  g.strokeStyle = stroke;
  g.strokeText(String(num), 128, 140);
  g.fillStyle = fill;
  g.fillText(String(num), 128, 140);
  return c;
}
function teamCanvas(name, fill, stroke) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.font = 'italic 900 118px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = stroke;
  g.strokeText(name, 256, 84);
  g.fillStyle = fill;
  g.fillText(name, 256, 84);
  // the classic swoosh tail under the script
  g.beginPath();
  g.moveTo(70, 150);
  g.quadraticCurveTo(256, 128, 470, 140);
  g.quadraticCurveTo(256, 150, 70, 162);
  g.closePath();
  g.lineWidth = 8;
  g.stroke();
  g.fill();
  return c;
}

// ---------- the body ----------
// W: world joints { hip, neck, head, shF, shB, elF, elB, handF, handB, kneeF, kneeB, footF, footB, f, L, S, knob?, batTip? }
// F = the character's left side, B = right side.
// o: { kit, skin, hair, gear: 'catcher', glove: 'F'|'B', gloveColor, battingGloves, num, team, teamColors, ballInHand, lookDir, noFace }
export function drawHero(P, W, o) {
  const kit = o.kit;
  const S = W.S || 1;
  const skin = o.skin || '#e0ac69';
  const jersey = kit.jersey, trim = kit.trim || '#333', pants = kit.pants;
  const catcher = o.gear === 'catcher';
  P.useFamily('hero');
  P.ow = P._outlineFor(W.hip) * 0.35;
  P.blob((W.footF.x + W.footB.x) / 2, (W.footF.y + W.footB.y) / 2, 1.25 * S);

  // torso frame: the chest follows the shoulder line, the hips turn about halfway with it
  const upT = norm(sub(W.neck, W.hip));
  const flat = (v) => norm(sub(v, mul(upT, dot(v, upT))));
  const Lbody = flat(W.L);
  const sl = sub(W.shF, W.shB);
  const Lt = len(sl) > 0.2 * S && dot(flat(sl), Lbody) > -0.2 ? flat(sl) : Lbody;
  const Ft = cross(Lt, upT);
  const Lh = flat(add(Lbody, Lt));
  const Fh = cross(Lh, upT);
  const Lw = flat(add(Lh, Lt));
  const Fw = cross(Lw, upT);
  const tl = len(sub(W.neck, W.hip));

  // ----- legs -----
  for (const side of [1, -1]) {
    const knee = side > 0 ? W.kneeF : W.kneeB, foot = side > 0 ? W.footF : W.footB;
    const hipSide = add(add(W.hip, mul(Lh, 0.2 * S * side)), mul(upT, -0.04 * S));
    const ankle = add(foot, mul(UP, 0.2 * S));
    P.taper(hipSide, knee, 0.27 * S, pants);
    P.sphere(knee, 0.165 * S, pants);
    // piping down the outside of the leg
    if (!o.slacks) P.limb(add(hipSide, mul(Lh, 0.22 * S * side)), add(knee, mul(Lh, 0.15 * S * side)), 0.022 * S, trim, false);
    if (catcher) {
      // shin guard with a knee cap and a plate over the laces
      const sd = norm(sub(ankle, knee));
      P.taper(add(knee, mul(sd, 0.05 * S)), add(ankle, mul(sd, 0.05 * S)), 0.21 * S, GEAR);
      P.ellipsoid(add(knee, mul(sd, -0.02 * S)), Lt, Ft, sd, 0.21 * S, 0.22 * S, 0.24 * S, GEAR);
      for (const k of [0.3, 0.62]) P.limb(lerp3(knee, ankle, k - 0.03), lerp3(knee, ankle, k + 0.03), 0.2 * S, '#14161c', false);
    } else if (o.slacks) {
      P.taper(knee, ankle, 0.175 * S, pants); // umpire slacks
    } else {
      const mid = lerp3(knee, ankle, 0.36);
      P.taper(knee, mid, 0.165 * S, pants);
      P.taper(lerp3(knee, ankle, 0.3), ankle, 0.125 * S, trim); // team socks
      P.sphere(ankle, 0.088 * S, trim, false);
    }
    // cleat: upper + white sole
    let fwd = V(W.f.x, W.f.y, 0);
    const fx = sub(foot, knee);
    if (o.feetAlong !== false && Math.hypot(fx.x, fx.y) > 0.45 * S) fwd = norm(V(fx.x, fx.y, 0));
    if (o.footDir) fwd = norm(V(o.footDir.x, o.footDir.y, 0));
    const lat = cross(UP, fwd);
    P.ellipsoid(add(add(foot, mul(UP, 0.12 * S)), mul(fwd, 0.1 * S)), lat, fwd, UP, 0.15 * S, 0.34 * S, 0.12 * S, '#16181f');
    P.ellipsoid(add(add(foot, mul(UP, 0.035 * S)), mul(fwd, 0.1 * S)), lat, fwd, UP, 0.155 * S, 0.36 * S, 0.04 * S, '#e9e9ea', false);
    if (catcher) P.ellipsoid(add(add(foot, mul(UP, 0.2 * S)), mul(fwd, 0.18 * S)), lat, fwd, UP, 0.14 * S, 0.2 * S, 0.09 * S, GEAR, false);
  }

  // ----- pelvis, belt, torso -----
  P.ellipsoid(add(W.hip, mul(upT, 0.06 * S)), Lh, Fh, upT, 0.46 * S, 0.32 * S, 0.3 * S, pants);
  const beltC = add(W.hip, mul(upT, 0.27 * S));
  P.ellipsoid(beltC, Lh, Fh, upT, 0.455 * S, 0.315 * S, 0.055 * S, '#15161b', false);
  P.useFamily('gloss');
  P.ellipsoid(add(beltC, mul(Fh, 0.3 * S)), Lh, Fh, upT, 0.05 * S, 0.02 * S, 0.04 * S, '#c9ccd2', false);
  P.useFamily('hero');
  const waistC = lerp3(W.hip, W.neck, 0.4);
  const chestC = lerp3(W.hip, W.neck, 0.7);
  P.ellipsoid(waistC, Lw, Fw, upT, 0.46 * S, 0.3 * S, tl * 0.34, jersey);
  P.ellipsoid(chestC, Lt, Ft, upT, 0.6 * S, 0.34 * S, tl * 0.38, jersey);
  if (o.protector) P.ellipsoid(add(lerp3(W.hip, W.neck, 0.62), mul(Ft, 0.17 * S)), Lt, Ft, upT, 0.44 * S, 0.24 * S, tl * 0.5, '#1d2233');
  // collar
  P.ellipsoid(add(W.neck, mul(upT, -0.06 * S)), Lt, Ft, upT, 0.2 * S, 0.17 * S, 0.05 * S, trim, false);
  if (catcher) {
    // chest protector in front, harness straps across the back
    P.ellipsoid(add(lerp3(W.hip, W.neck, 0.6), mul(Ft, 0.16 * S)), Lt, Ft, upT, 0.46 * S, 0.26 * S, tl * 0.5, GEAR);
    const back = (p) => add(p, mul(Ft, -0.36 * S));
    for (const s of [1, -1]) {
      P.limb(back(add(lerp3(W.hip, W.neck, 0.95), mul(Lt, 0.3 * S * s))), back(add(lerp3(W.hip, W.neck, 0.35), mul(Lt, -0.32 * S * s))), 0.035 * S, '#121318', false);
    }
    P.limb(back(add(lerp3(W.hip, W.neck, 0.5), mul(Lt, 0.4 * S))), back(add(lerp3(W.hip, W.neck, 0.5), mul(Lt, -0.4 * S))), 0.03 * S, '#121318', false);
  }
  // jersey numbers and lettering
  if (o.num !== undefined && o.num !== null) {
    const [fillC, strokeC] = o.numColors || [trim, '#ffffff'];
    const backC = add(lerp3(W.hip, W.neck, 0.74), mul(Ft, -0.335 * S));
    P.decal(backC, mul(Ft, -1), upT, 0.44 * S, 0.44 * S, `n${o.num}${fillC}${strokeC}`, () => numberCanvas(o.num, fillC, strokeC));
  }
  if (o.team) {
    const [fillC, strokeC] = o.teamColors || [trim, '#ffffff'];
    const frontC = add(lerp3(W.hip, W.neck, 0.74), mul(Ft, 0.33 * S));
    P.decal(frontC, Ft, upT, 0.74 * S, 0.28 * S, `t${o.team}${fillC}${strokeC}`, () => teamCanvas(o.team, fillC, strokeC));
  }

  // ----- arms -----
  for (const side of [1, -1]) {
    const sh = side > 0 ? W.shF : W.shB, el = side > 0 ? W.elF : W.elB, hand = side > 0 ? W.handF : W.handB;
    P.sphere(sh, 0.15 * S, jersey, false);
    const cuff = lerp3(sh, el, 0.55);
    P.taper(sh, cuff, 0.17 * S, jersey);
    P.limb(lerp3(sh, el, 0.5), lerp3(sh, el, 0.57), 0.128 * S, trim, false); // sleeve trim
    P.taper(lerp3(sh, el, 0.45), el, 0.135 * S, skin);
    P.sphere(el, 0.092 * S, skin, false);
    const wrist = lerp3(el, hand, 0.8);
    P.taper(el, wrist, 0.115 * S, skin);
    const gl = (o.glove === 'F' && side > 0) || (o.glove === 'B' && side < 0);
    const hd = norm(sub(hand, el));
    let hx = cross(hd, UP);
    hx = len(hx) < 0.1 ? Lt : norm(hx);
    const hz = cross(hx, hd);
    if (gl) {
      const mitt = catcher;
      const gc = add(hand, mul(hd, 0.1 * S));
      P.ellipsoid(gc, hx, hd, hz, (mitt ? 0.4 : 0.32) * S, (mitt ? 0.4 : 0.42) * S, (mitt ? 0.22 : 0.15) * S, o.gloveColor || '#7a4a22');
      P.ellipsoid(add(gc, mul(hz, (mitt ? 0.12 : 0.09) * S)), hx, hd, hz, (mitt ? 0.27 : 0.2) * S, (mitt ? 0.28 : 0.28) * S, 0.07 * S, '#4a2a14', false);
    } else {
      const tone = o.battingGloves ? (o.gloveTone || '#f1f1f1') : skin;
      P.ellipsoid(add(hand, mul(hd, 0.02 * S)), hx, hd, hz, 0.085 * S, 0.12 * S, 0.065 * S, tone);
      if (o.battingGloves) P.limb(lerp3(el, hand, 0.84), lerp3(el, hand, 0.9), 0.08 * S, '#1a1b20', false);
    }
    if (o.ballInHand && ((o.ballInHand === 'F' && side > 0) || (o.ballInHand === 'B' && side < 0))) P.sphere(add(hand, mul(hd, 0.1 * S)), 0.12, '#fbfbf6');
  }

  // ----- neck + head -----
  const headC = W.head;
  P.taper(W.neck, lerp3(W.neck, headC, 0.6), 0.13 * S, skin, false);
  const hr = 0.36 * S;
  let hf = V(Ft.x + W.f.x, Ft.y + W.f.y, 0);
  hf = o.lookDir ? norm(V(o.lookDir.x, o.lookDir.y, 0)) : len(hf) > 0.2 ? norm(hf) : W.f;
  const hl = cross(UP, hf);
  P.ellipsoid(headC, hl, hf, UP, hr * 0.9, hr * 0.98, hr * 1.06, skin);
  P.ellipsoid(add(add(headC, mul(hf, hr * 0.28)), mul(UP, -hr * 0.52)), hl, hf, UP, hr * 0.6, hr * 0.62, hr * 0.44, skin, false); // jaw
  const hair = o.hair || HAIRS[hashStr(String(o.skin) + (o.num ?? '') + (jersey || '')) % HAIRS.length];
  if (!catcher) P.ellipsoid(add(add(headC, mul(hf, -hr * 0.2)), mul(UP, -hr * 0.06)), hl, hf, UP, hr * 0.96, hr * 0.9, hr * 0.9, hair, false);
  for (const s of [1, -1]) P.ellipsoid(add(add(headC, mul(hl, s * hr * 0.88)), mul(hf, -hr * 0.05)), hl, hf, UP, hr * 0.12, hr * 0.18, hr * 0.26, skin, false);
  if (!o.noFace) {
    for (const s of [1, -1]) {
      const eye = add(add(add(headC, mul(hf, hr * 0.8)), mul(hl, s * hr * 0.3)), mul(UP, hr * 0.04));
      P.ellipsoid(eye, hl, hf, UP, hr * 0.13, hr * 0.08, hr * 0.085, '#f2efe8', false);
      P.sphere(add(eye, mul(hf, hr * 0.06)), hr * 0.065, '#3b2616', false);
      P.ellipsoid(add(add(eye, mul(UP, hr * 0.19)), mul(hf, hr * 0.06)), hl, hf, UP, hr * 0.16, hr * 0.05, hr * 0.035, hair, false);
    }
    P.ellipsoid(add(add(headC, mul(hf, hr * 0.96)), mul(UP, -hr * 0.16)), hl, hf, UP, hr * 0.09, hr * 0.1, hr * 0.16, skin, false); // nose
    P.ellipsoid(add(add(headC, mul(hf, hr * 0.84)), mul(UP, -hr * 0.48)), hl, hf, UP, hr * 0.17, hr * 0.05, hr * 0.03, '#7d3b35', false); // mouth
  }
  // ----- headgear -----
  P.useFamily('gloss');
  if (catcher) {
    P.ellipsoid(add(headC, mul(UP, hr * 0.06)), hl, hf, UP, hr * 1.08, hr * 1.14, hr * 1.1, GEAR);
    P.ellipsoid(add(add(headC, mul(hf, -hr * 0.3)), mul(UP, -hr * 0.3)), hl, hf, UP, hr * 0.95, hr * 0.85, hr * 0.7, GEAR);
    // back plate seam, vents and the mask's back strap
    P.ellipsoid(add(add(headC, mul(hf, -hr * 0.62)), mul(UP, -hr * 0.42)), hl, hf, UP, hr * 0.78, hr * 0.5, hr * 0.42, '#183478');
    for (const s of [1, -1]) P.ellipsoid(add(add(add(headC, mul(hf, -hr * 0.55)), mul(UP, hr * 0.78)), mul(hl, s * hr * 0.28)), hl, hf, UP, hr * 0.09, hr * 0.15, hr * 0.06, '#0d1424', false);
    P.useFamily('hero');
    P.limb(add(add(headC, mul(hl, hr * 1.02)), mul(UP, -hr * 0.2)), add(add(headC, mul(hl, -hr * 1.02)), mul(UP, -hr * 0.2)), hr * 0.07, '#121318', false);
    P.ellipsoid(add(add(headC, mul(hf, hr * 0.92)), mul(UP, -hr * 0.12)), hl, hf, UP, hr * 0.98, hr * 0.36, hr * 1.02, '#20232b'); // cage
    P.ellipsoid(add(add(headC, mul(hf, hr * 0.8)), mul(UP, -hr * 1.05)), hl, hf, UP, hr * 0.42, hr * 0.2, hr * 0.32, '#20232b', false); // throat guard
  } else if (o.helmet || kit.helmet) {
    // Little League batting helmet: ear flaps on BOTH sides
    P.dome(add(headC, mul(UP, hr * 0.02)), hl, hf, UP, hr * 1.13, hr * 1.18, hr * 1.12, kit.cap);
    P.ellipsoid(add(add(headC, mul(hf, -hr * 0.32)), mul(UP, -hr * 0.18)), hl, hf, UP, hr * 1.02, hr * 0.82, hr * 0.74, kit.cap);
    for (const s of [1, -1]) {
      const flap = add(add(add(headC, mul(hl, s * hr * 0.92)), mul(UP, -hr * 0.34)), mul(hf, hr * 0.02));
      P.ellipsoid(flap, hl, hf, UP, hr * 0.2, hr * 0.56, hr * 0.56, kit.cap);
      P.ellipsoid(add(flap, mul(hl, s * hr * 0.16)), hl, hf, UP, hr * 0.06, hr * 0.12, hr * 0.12, '#101114', false);
    }
    P.ellipsoid(add(add(headC, mul(hf, hr * 1.06)), mul(UP, hr * 0.3)), hl, norm(sub(hf, mul(UP, 0.15))), norm(add(UP, mul(hf, 0.15))), hr * 0.74, hr * 0.36, hr * 0.05, kit.cap, false);
    for (const s of [1, -1]) P.ellipsoid(add(add(add(headC, mul(UP, hr * 1.02)), mul(hf, hr * 0.25)), mul(hl, s * hr * 0.3)), hl, hf, UP, hr * 0.08, hr * 0.16, hr * 0.05, '#101114', false);
  } else {
    P.useFamily('hero');
    P.dome(add(headC, mul(UP, hr * 0.14)), hl, hf, UP, hr * 1.0, hr * 1.04, hr * 0.92, kit.cap);
    P.sphere(add(headC, mul(UP, hr * 1.04)), hr * 0.08, kit.cap, false);
    const bf = norm(sub(hf, mul(UP, 0.2))), bu = norm(add(UP, mul(hf, 0.2)));
    P.ellipsoid(add(add(headC, mul(hf, hr * 1.02)), mul(UP, hr * 0.14)), hl, bf, bu, hr * 0.66, hr * 0.56, hr * 0.045, kit.cap);
  }
  P.useFamily('hero');

  // ----- aluminum bat -----
  if (W.batTip && W.knob) {
    const d = sub(W.batTip, W.knob);
    const Lb = len(d);
    const dir = mul(d, 1 / Lb);
    let bx = cross(dir, UP);
    bx = len(bx) < 0.1 ? V(1, 0, 0) : norm(bx);
    const bz = cross(bx, dir);
    const at = (k) => add(W.knob, mul(dir, k));
    P.ellipsoid(W.knob, bx, dir, bz, 0.075, 0.03, 0.075, '#121316', false); // knob
    P.limb(at(0.02), at(0.72), 0.042, '#1a1b20'); // grip tape
    P.useFamily('gloss');
    const alloy = o.batColor || '#2a3550';
    P.limb(at(0.72), at(1.02), 0.039, alloy);
    P.taper(at(1.42), at(1.18), 0.11, alloy);
    P.taper(at(1.18), at(1.0), 0.064, alloy);
    P.limb(at(1.42), at(Lb - 0.02), 0.11, '#b9bfc9');
    P.limb(at(1.72), at(1.9), 0.112, o.batAccent || '#d62839', false);
    P.ellipsoid(at(Lb - 0.01), bx, dir, bz, 0.105, 0.022, 0.105, '#121316', false); // end cap
    P.useFamily('hero');
  }
  P.useFamily('toon');
}

// Keep limb lengths honest: re-solve elbows/knees with IK, using the authored joints as pole hints.
export function solveLimbs(W, { upper = 0.92, lower = 0.9, thigh = 1.12, shin = 1.12 } = {}) {
  const S = W.S || 1;
  for (const side of ['F', 'B']) {
    const sh = W['sh' + side], hand = W['hand' + side], el = W['el' + side];
    const reach = (upper + lower) * S * 0.999;
    const dv = sub(hand, sh);
    if (len(dv) > reach) W['hand' + side] = add(sh, mul(norm(dv), reach));
    const mid = lerp3(sh, W['hand' + side], 0.5);
    W['el' + side] = solveIK(sh, W['hand' + side], upper * S, lower * S, sub(el, mid));
    const hipSide = add(W.hip, mul(W.L, 0.2 * S * (side === 'F' ? 1 : -1)));
    const foot = W['foot' + side], knee = W['knee' + side];
    const ankle = add(foot, mul(UP, 0.2 * S));
    // an over-reaching leg pulls its foot in rather than stretching
    const lr = (thigh + shin) * S * 0.995;
    const dl = sub(ankle, hipSide);
    let ank = ankle;
    if (len(dl) > lr) {
      ank = add(hipSide, mul(norm(dl), lr));
      W['foot' + side] = add(ank, mul(UP, -0.2 * S));
    }
    const km = lerp3(hipSide, ank, 0.5);
    W['knee' + side] = solveIK(hipSide, ank, thigh * S, shin * S, sub(knee, km));
  }
  return W;
}
