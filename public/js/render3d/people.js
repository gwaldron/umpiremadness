// Cel-shaded 3D people built from instanced spheres, cylinders and domes.
// Every body part of every person is one instance, so the whole cast costs a handful of draw calls.
import * as THREE from 'three';
import { TOON_STEPS } from './engine.js';
import { poseJoints } from '../render/figures.js';

const CAP = 3000;
const OUTLINE = '#0b0f1c';

// --- tiny vector helpers on {x,y,z} ---
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => { const l = len(a) || 1; return V(a.x / l, a.y / l, a.z / l); };
const lerp3 = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const UP = V(0, 0, 1);
export const vec3 = { V, add, sub, mul, dot, cross, len, norm, lerp3 };

// Two-bone IK: root → joint → end, reaching for target. Returns the middle joint.
export function solveIK(root, target, l1, l2, pole) {
  const d0 = sub(target, root);
  let d = len(d0);
  const dir = mul(d0, 1 / (d || 1));
  d = Math.min(d, (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let q = sub(pole, mul(dir, dot(pole, dir)));
  q = norm(q);
  return add(add(root, mul(dir, a)), mul(q, h));
}

// Height of the ground (the pitcher's mound is raised 6 inches).
export function groundZ(x, y) {
  const d = Math.hypot(x, y - 46);
  if (d >= 5.6) return 0;
  return 0.5 * Math.min(1, (5.6 - d) / 4.0);
}

const FRONT_POSES = new Set(['stand', 'ready', 'set', 'out', 'safe', 'time', 'pointR', 'pointL', 'catchHigh', 'catcher', 'pitch']);

export class People {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;
    const mk = (geo, mat, cast) => {
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = cast;
      m.receiveShadow = cast;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (cast) m.setColorAt(0, new THREE.Color('#fff'));
      scene.add(m);
      return m;
    };
    const fill = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: TOON_STEPS });
    const ol = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
    this.geo = {
      sphere: new THREE.SphereGeometry(1, 16, 11),
      sphereLo: new THREE.SphereGeometry(1, 12, 8),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1, false),
      cylOpen: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
      dome: new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    };
    this.fills = {
      sphere: mk(this.geo.sphere, fill, true),
      cyl: mk(this.geo.cyl, fill, true),
      dome: mk(this.geo.dome, fill, true),
    };
    this.outlines = {
      sphere: mk(this.geo.sphereLo, ol, false),
      cyl: mk(this.geo.cylOpen, ol, false),
      dome: mk(this.geo.dome, ol, false),
    };
    this.n = { sphere: 0, cyl: 0, dome: 0 };
    this.on = { sphere: 0, cyl: 0, dome: 0 };
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this.state = new WeakMap(); // per-actor heading smoothing
    this.ow = 0.05;
  }

  begin(camera, focalPx) {
    this.n.sphere = this.n.cyl = this.n.dome = 0;
    this.on.sphere = this.on.cyl = this.on.dome = 0;
    this.camPos = camera.position;
    this.focal = focalPx;
  }

  end() {
    for (const k of ['sphere', 'cyl', 'dome']) {
      const f = this.fills[k], o = this.outlines[k];
      f.count = this.n[k];
      o.count = this.on[k];
      f.instanceMatrix.needsUpdate = true;
      o.instanceMatrix.needsUpdate = true;
      if (f.instanceColor) f.instanceColor.needsUpdate = true;
    }
  }

  // outline thickness in feet so it stays ~1.6 px on screen
  _outlineFor(p) {
    const d = Math.hypot(p.x - this.camPos.x, p.y - this.camPos.y, p.z - this.camPos.z);
    return Math.min(0.16, Math.max(0.015, (3.0 * d) / this.focal));
  }

  _put(kind, X, Y, Z, c, color, outline) {
    const m = this._m;
    // keep a right-handed basis (all our shapes are symmetric across local z)
    if (dot(X, cross(Y, Z)) < 0) Z = mul(Z, -1);
    if (this.n[kind] < CAP) {
      m.set(X.x, Y.x, Z.x, c.x, X.y, Y.y, Z.y, c.y, X.z, Y.z, Z.z, c.z, 0, 0, 0, 1);
      this.fills[kind].setMatrixAt(this.n[kind], m);
      this.fills[kind].setColorAt(this.n[kind], this._c.set(color));
      this.n[kind]++;
    }
    if (outline && this.on[kind] < CAP) {
      const t = this.ow;
      const sx = len(X), sy = len(Y), sz = len(Z);
      const kx = (sx + t) / sx, ky = kind === 'cyl' ? 1 : (sy + t) / sy, kz = (sz + t) / sz;
      m.set(X.x * kx, Y.x * ky, Z.x * kz, c.x, X.y * kx, Y.y * ky, Z.y * kz, c.y, X.z * kx, Y.z * ky, Z.z * kz, c.z, 0, 0, 0, 1);
      this.outlines[kind].setMatrixAt(this.on[kind]++, m);
    }
  }

  // Ellipsoid with axes X (lateral), Y (forward), Z (up), unit vectors + radii.
  ellipsoid(c, X, Y, Z, rx, ry, rz, color, outline = true) {
    this._put('sphere', mul(X, rx), mul(Y, ry), mul(Z, rz), c, color, outline);
  }
  sphere(c, r, color, outline = true) {
    this._put('sphere', V(r, 0, 0), V(0, r, 0), V(0, 0, r), c, color, outline);
  }
  // Dome (half sphere) whose flat side faces down along -Z
  dome(c, X, Y, Z, rx, ry, rz, color, outline = true) {
    // the dome geometry's pole is +Y, so map geometry Y → our Z
    this._put('dome', mul(X, rx), mul(Z, rz), mul(Y, -ry), c, color, outline);
  }
  limb(a, b, r, color, outline = true) {
    const d = sub(b, a);
    const l = len(d);
    if (l < 1e-4) return;
    const Y = mul(d, 1 / l);
    let X = cross(Y, Math.abs(Y.z) < 0.9 ? UP : V(1, 0, 0));
    X = norm(X);
    const Z = cross(X, Y);
    this._put('cyl', mul(X, r), mul(Y, l), mul(Z, r), lerp3(a, b, 0.5), color, outline);
  }

  // ---------- characters ----------
  // Resolve a heading for a field actor (unit vector on the ground).
  heading(a) {
    let st = this.state.get(a);
    if (!st) { st = { px: a.x, py: a.y, h: null }; this.state.set(a, st); }
    const vx = a.x - st.px, vy = a.y - st.py;
    st.px = a.x; st.py = a.y;
    const front = FRONT_POSES.has(a.pose);
    let want;
    if (a.faceAt) want = Math.atan2(a.faceAt.y - a.y, a.faceAt.x - a.x);
    else if (a.heading !== undefined) want = a.heading;
    else if (!front && Math.hypot(vx, vy) > 0.02) want = Math.atan2(vy, vx);
    else if (a.pose === 'catcher' || a.mask) want = Math.PI / 2;
    else if (!front) want = st.h ?? ((a.facing || 1) > 0 ? 0 : Math.PI);
    else want = Math.atan2(-a.y, -a.x); // face home plate
    if (st.h === null || Math.abs(Math.hypot(vx, vy)) > 25) st.h = want;
    let d = want - st.h;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    st.h += d * 0.25;
    return st.h;
  }

  // Convert one of the 2D poses (figures.js) into world joints.
  jointsFor(a) {
    const { J, front } = poseJoints(a.pose || 'stand', a.phase || 0);
    const S = ((a.height || 5) / 5) * (a.vis ?? 1.12);
    const hd = this.heading(a);
    const f = V(Math.cos(hd), Math.sin(hd), 0);
    const L = V(-f.y, f.x, 0); // character's left
    const base = V(a.x, a.y, (a.z || 0) + groundZ(a.x, a.y));
    const mir = a.mirror ? -1 : 1;
    const P = (p, lat = 0, depth = 0) => {
      if (front) return add(base, add(add(mul(L, p[0] * S * mir), mul(UP, p[1] * S)), mul(f, depth * S)));
      return add(base, add(add(mul(f, p[0] * S), mul(UP, p[1] * S)), mul(L, lat * S)));
    };
    const squat = front && J.hip[1] - J.kneeF[1] < 0.95;
    const hands = a.pose === 'out' || a.pose === 'safe' || a.pose === 'time' || a.pose === 'pointR' || a.pose === 'pointL' || a.pose === 'catchHigh' ? 0.15 : 0.45;
    const W = {
      f, L, S,
      hip: P(J.hip),
      neck: P(J.neck),
      head: add(P(J.head), mul(UP, 0.12 * S)),
      kneeF: P(J.kneeF, 0.24, squat ? 0.3 : 0.08), footF: P(J.footF, 0.24, 0.05),
      kneeB: P(J.kneeB, -0.24, squat ? 0.3 : 0.08), footB: P(J.footB, -0.24, 0.05),
      elF: P(J.elbowF, 0.5, hands * 0.6), handF: P(J.handF, 0.42, hands),
      elB: P(J.elbowB, -0.5, hands * 0.6), handB: P(J.handB, -0.42, hands),
    };
    if (!front) {
      W.shF = add(W.neck, add(mul(L, 0.42 * S), mul(UP, -0.12 * S)));
      W.shB = add(W.neck, add(mul(L, -0.42 * S), mul(UP, -0.12 * S)));
    } else {
      W.shF = add(W.neck, add(mul(L, 0.46 * S * mir), mul(UP, -0.12 * S)));
      W.shB = add(W.neck, add(mul(L, -0.46 * S * mir), mul(UP, -0.12 * S)));
    }
    if (J.bat) {
      const ang = J.batAngle;
      W.batTip = P([J.handB[0] - Math.sin(ang) * 2.6, J.handB[1] + Math.cos(ang) * 2.6], -0.1, 0);
    }
    return W;
  }

  // Apply IK overrides: a.ik = [{ joint: 'handF'|'handB'|'footF'|'footB', target: {x,y,z} }]
  applyIK(W, iks) {
    for (const k0 of iks || []) {
      if (!k0 || !k0.target) continue;
      const w = k0.w ?? 1;
      if (w <= 0.001) continue;
      const k = w >= 0.999 ? k0 : { joint: k0.joint, target: lerp3(W[k0.joint], k0.target, w) };
      const S = W.S || 1;
      const out = mul(W.L, k.joint.endsWith('F') ? 1 : -1);
      if (k.joint === 'handF' || k.joint === 'handB') {
        const sh = k.joint === 'handF' ? W.shF : W.shB;
        const el = solveIK(sh, k.target, 0.78 * S, 0.74 * S, add(mul(out, 1), V(0, 0, -0.6)));
        if (k.joint === 'handF') { W.elF = el; W.handF = k.target; } else { W.elB = el; W.handB = k.target; }
      } else {
        const hipSide = add(W.hip, mul(out, 0.24 * S));
        const kn = solveIK(hipSide, k.target, 1.12 * S, 1.3 * S, add(W.f, V(0, 0, 0.2)));
        if (k.joint === 'footF') { W.kneeF = kn; W.footF = k.target; } else { W.kneeB = kn; W.footB = k.target; }
      }
    }
    return W;
  }

  drawActor(a) {
    if (a.hidden) return;
    const W = this.applyIK(this.jointsFor(a), a.ik);
    this.drawBody(W, a);
  }

  // Draw a body from world joints. opts: kit, skin, glove, mask, ballInHand, num, gear ('catcher'), arms
  drawBody(W, o) {
    const kit = o.kit;
    const S = W.S || 1;
    this.ow = this._outlineFor(W.hip);
    const f = W.f, L = W.L;
    const skin = o.skin || '#e0ac69';
    const sock = o.gear === 'catcher' ? '#1f4fb0' : kit.trim || '#333';
    const pants = kit.pants;
    // torso frame
    const upT = norm(sub(W.neck, W.hip));
    let Lt = sub(L, mul(upT, dot(L, upT)));
    Lt = norm(Lt);
    const Ft = cross(Lt, upT); // forward (L = up × f, so L × up = f)
    // legs
    for (const side of [1, -1]) {
      const knee = side > 0 ? W.kneeF : W.kneeB, foot = side > 0 ? W.footF : W.footB;
      const hipSide = add(W.hip, mul(Lt, 0.22 * S * side));
      const ankle = add(foot, mul(UP, 0.18 * S));
      const shinTop = lerp3(knee, ankle, 0.08);
      this.limb(hipSide, knee, 0.2 * S, pants);
      this.sphere(knee, 0.2 * S, pants);
      this.limb(shinTop, ankle, (o.gear === 'catcher' ? 0.21 : 0.15) * S, sock);
      // shoe points along the shin's forward direction projected on the ground
      let fwd = V(f.x, f.y, 0);
      const fx = sub(foot, knee);
      if (Math.hypot(fx.x, fx.y) > 0.3 * S && !FRONT_POSES.has(o.pose)) fwd = norm(V(fx.x, fx.y, 0));
      const lat = cross(UP, fwd);
      this.ellipsoid(add(add(foot, mul(UP, 0.11 * S)), mul(fwd, 0.1 * S)), lat, fwd, UP, 0.17 * S, 0.36 * S, 0.13 * S, '#15161c');
    }
    // pelvis + torso
    this.ellipsoid(add(W.hip, mul(upT, 0.1 * S)), Lt, Ft, upT, 0.48 * S, 0.36 * S, 0.32 * S, pants);
    const tl = len(sub(W.neck, W.hip));
    const torsoC = lerp3(W.hip, W.neck, 0.56);
    this.ellipsoid(torsoC, Lt, Ft, upT, 0.52 * S, 0.37 * S, tl * 0.56, kit.jersey);
    // belt
    this.ellipsoid(add(W.hip, mul(upT, 0.3 * S)), Lt, Ft, upT, 0.47 * S, 0.34 * S, 0.06 * S, '#16161c', false);
    if (o.mask) {
      // plate umpire: chest protector
      this.ellipsoid(add(torsoC, mul(Ft, 0.2 * S)), Lt, Ft, upT, 0.44 * S, 0.24 * S, tl * 0.48, '#1d2233');
    }
    if (o.gear === 'catcher') this.ellipsoid(add(torsoC, mul(Ft, 0.18 * S)), Lt, Ft, upT, 0.46 * S, 0.26 * S, tl * 0.5, '#1f3e8a');
    // arms
    const glove = o.glove;
    for (const side of [1, -1]) {
      const sh = side > 0 ? W.shF : W.shB, el = side > 0 ? W.elF : W.elB, hand = side > 0 ? W.handF : W.handB;
      this.sphere(sh, 0.17 * S, kit.jersey);
      this.limb(sh, lerp3(sh, el, 0.75), 0.15 * S, kit.jersey);
      this.limb(lerp3(sh, el, 0.6), el, 0.12 * S, skin);
      this.sphere(el, 0.12 * S, skin);
      this.limb(el, hand, 0.11 * S, skin);
      const gl = (glove === 'F' && side > 0) || (glove === 'B' && side < 0);
      if (gl) {
        const gdir = norm(sub(hand, el));
        const glat = norm(cross(gdir, UP));
        this.ellipsoid(add(hand, mul(gdir, 0.12 * S)), glat, cross(glat, gdir), gdir, 0.34 * S, 0.14 * S, 0.4 * S, o.gloveColor || '#8a5524');
      } else {
        this.sphere(hand, 0.13 * S, o.battingGloves ? '#f2f2f2' : skin);
      }
      if (o.ballInHand && ((o.ballInHand === 'F' && side > 0) || (o.ballInHand === 'B' && side < 0))) this.sphere(add(hand, mul(UP, 0.08 * S)), 0.13, '#fbfbf6');
    }
    // neck + head
    const headC = W.head;
    this.limb(W.neck, lerp3(W.neck, headC, 0.6), 0.14 * S, skin, false);
    const hr = 0.42 * S;
    // the head looks along f (or the torso's forward if leaning)
    let hf = V(Ft.x + f.x, Ft.y + f.y, 0.0);
    hf = o.lookDir ? norm(V(o.lookDir.x, o.lookDir.y, 0)) : len(hf) > 0.2 ? norm(hf) : f;
    const hl = cross(UP, hf);
    this.sphere(headC, hr, skin);
    // face
    if (!o.noFace) {
      for (const s of [1, -1]) this.sphere(add(add(add(headC, mul(hf, hr * 0.88)), mul(hl, s * hr * 0.34)), mul(UP, hr * 0.12)), hr * 0.12, '#141414', false);
      this.sphere(add(add(headC, mul(hf, hr * 0.98)), mul(UP, -hr * 0.12)), hr * 0.14, skin, false);
    }
    // headgear
    if (o.gear === 'catcher') {
      this.sphere(add(headC, mul(UP, hr * 0.05)), hr * 1.12, '#1d3f9e');
      this.ellipsoid(add(headC, mul(hf, hr * 0.85)), hl, hf, UP, hr * 0.8, hr * 0.3, hr * 0.95, '#2a2f3a');
    } else if (kit.helmet) {
      this.dome(add(headC, mul(UP, hr * 0.05)), hl, hf, UP, hr * 1.16, hr * 1.16, hr * 1.12, kit.cap);
      this.ellipsoid(add(add(headC, mul(hl, -hr * 0.88)), mul(UP, -hr * 0.2)), hl, hf, UP, hr * 0.28, hr * 0.62, hr * 0.62, kit.cap);
      this.ellipsoid(add(add(headC, mul(hf, hr * 0.8)), mul(UP, hr * 0.32)), hl, hf, UP, hr * 0.8, hr * 0.42, hr * 0.06, kit.cap, false);
    } else {
      this.dome(add(headC, mul(UP, hr * 0.12)), hl, hf, UP, hr * 1.06, hr * 1.06, hr * 0.98, kit.cap);
      this.ellipsoid(add(add(headC, mul(hf, hr * 0.92)), mul(UP, hr * 0.14)), hl, hf, UP, hr * 0.72, hr * 0.6, hr * 0.05, kit.cap);
    }
    if (o.mask) {
      this.ellipsoid(add(headC, mul(hf, hr * 0.78)), hl, hf, UP, hr * 0.78, hr * 0.32, hr * 0.95, '#22252d');
    }
    // bat
    if (W.batTip && W.handB) {
      const knob = W.handB;
      const mid = lerp3(knob, W.batTip, 0.42);
      this.limb(knob, mid, 0.06, '#c7924f');
      this.limb(mid, W.batTip, 0.11, '#d9a865');
      this.sphere(W.batTip, 0.11, '#b9864a');
    }
  }
}
