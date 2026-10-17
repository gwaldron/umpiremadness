// Living ground and trees: 3D grass blades around wherever the camera is looking, leafy trees and pines
// built from leaf cards, and one breeze (with gusts) that moves them all.
import * as THREE from 'three';
import { CHALK_GLSL } from './textures.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- The breeze ----------
// Shared uniforms: uTime, and uWind = (direction x, direction y, strength 0..1). The direction veers
// slowly and the strength comes and goes in gusts.
export const WIND = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(0.6, 0.8, 0.5) } };
export function updateWind(t) {
  const a = 1.0 + Math.sin(t * 0.031) * 0.6;
  const gust = 0.42 + 0.22 * Math.sin(t * 0.21) + 0.16 * Math.sin(t * 0.57 + 1.3) + 0.1 * Math.sin(t * 1.43 + 0.4);
  WIND.uTime.value = t;
  WIND.uWind.value.set(Math.cos(a), Math.sin(a), Math.max(0.12, gust));
}

// ---------- Grass ----------
// One tile of blade clumps, T feet square. The vertex shader wraps every clump to its copy nearest the
// patch center, so the blades stay put in the world while the patch follows the camera. Each blade takes
// its color from the painted field under it (mow stripes, wear and all), turns white on a chalk line,
// shrinks away on dirt, at the patch edge and far from the eye, and leans with the wind.
export class Grass {
  constructor(planes, { lite = false, detail = null } = {}) {
    this.planes = planes; // [outer, infield] field planes: { m, region }
    const T = lite ? 22 : 28, step = lite ? 0.24 : 0.17, per = lite ? 3 : 4;
    this.T = T;
    const r = mulberry(11);
    const n = Math.floor(T / step);
    const count = n * n * per;
    const pos = new Float32Array(count * 9), root = new Float32Array(count * 6), tip = new Float32Array(count * 3), seed = new Float32Array(count * 3);
    let b = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = (i + r()) * step, cy = (j + r()) * step;
        for (let k = 0; k < per; k++) {
          const x = cx + (r() - 0.5) * step * 0.8, y = cy + (r() - 0.5) * step * 0.8;
          const h = 0.13 + r() * 0.13, w = 0.03 + r() * 0.025;
          const a = r() * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
          const lean = (r() - 0.5) * 0.12, la = r() * 6.283;
          const s = r();
          const v = [[-ca * w / 2, -sa * w / 2, 0, 0], [ca * w / 2, sa * w / 2, 0, 0], [Math.cos(la) * lean, Math.sin(la) * lean, h, 1]];
          for (let q = 0; q < 3; q++) {
            const o = (b * 3 + q);
            pos[o * 3] = v[q][0]; pos[o * 3 + 1] = v[q][1]; pos[o * 3 + 2] = v[q][2];
            root[o * 2] = x; root[o * 2 + 1] = y;
            tip[o] = v[q][3];
            seed[o] = s;
          }
          b++;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRoot', new THREE.BufferAttribute(root, 2));
    geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const reg = (p) => new THREE.Vector4(p.region.x0, p.region.y0, p.region.x1 - p.region.x0, p.region.y1 - p.region.y0);
    this.u = {
      uCenter: { value: new THREE.Vector2(0, 40) }, uEye: { value: new THREE.Vector3(0, -10, 5) }, uTile: { value: T },
      uMapOut: { value: planes[0].m.material.map }, uRegOut: { value: reg(planes[0]) },
      uMapIn: { value: planes[1].m.material.map }, uRegIn: { value: reg(planes[1]) }, uDetail: { value: detail },
    };
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u, WIND);
      sh.vertexShader = `attribute vec2 aRoot; attribute float aTip; attribute float aSeed;
uniform vec2 uCenter; uniform vec3 uEye; uniform float uTile;
uniform sampler2D uMapOut; uniform sampler2D uMapIn; uniform vec4 uRegOut; uniform vec4 uRegIn; uniform sampler2D uDetail;
uniform float uTime; uniform vec3 uWind;
varying vec3 vBlade;
${CHALK_GLSL}
` + sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 0.0, 1.0);')
        .replace('#include <begin_vertex>', `
  vec2 root = aRoot + uTile * floor((uCenter - aRoot) / uTile + 0.5);
  vec2 uvIn = (root - uRegIn.xy) / uRegIn.zw;
  vec3 g = (uvIn.x > 0.0 && uvIn.y > 0.0 && uvIn.x < 1.0 && uvIn.y < 1.0)
    ? textureLod(uMapIn, uvIn, 0.0).rgb : textureLod(uMapOut, (root - uRegOut.xy) / uRegOut.zw, 0.0).rgb;
  float grassy = smoothstep(0.55, 0.9, clamp((g.g - g.r) * 7.0 + 0.45, 0.0, 1.0));
  // the same big soft patches the ground shader puts in the turf
  float patchy = textureLod(uDetail, root * 0.011, 0.0).b * 0.62 + textureLod(uDetail, root * 0.0034 + 0.37, 0.0).b * 0.38 - 0.5;
  g *= 1.0 + patchy * 0.34;
  g.r += max(patchy, 0.0) * 0.05;
  float edge = 1.0 - smoothstep(uTile * 0.14, uTile * 0.49, length(root - uCenter));
  edge *= edge;
  float far = 1.0 - smoothstep(38.0, 62.0, distance(vec3(root, 0.0), uEye));
  float ch = chalk(root, vec2(0.06, 0.0), vec2(0.0, 0.06));
  float k = grassy * edge * far * (1.0 - 0.55 * ch);
  vec3 p = position * k;
  float wave = sin(uTime * 2.3 + dot(root, uWind.xy) * 0.5 + aSeed * 6.28) * 0.5 + 0.5;
  float roll = sin(uTime * 0.8 - dot(root, uWind.xy) * 0.09) * 0.5 + 0.5; // gusts rolling across the grass
  float bend = aTip * k * (0.025 + 0.11 * uWind.z * (0.35 + 0.65 * wave) * (0.4 + 0.6 * roll));
  p.xy += uWind.xy * bend;
  p.z -= bend * bend * 2.5;
  vec3 transformed = vec3(root + p.xy, p.z + 0.015);
  vec3 tintC = aSeed > 0.86 ? vec3(1.1, 1.06, 0.78) : aSeed < 0.12 ? vec3(0.86, 0.95, 0.86) : vec3(1.0); // a few drier, a few deeper blades
  vBlade = mix(g * tintC, vec3(0.86, 0.86, 0.83), ch) * mix(0.8, 1.2, aTip) * (0.9 + 0.2 * aSeed);`);
      sh.fragmentShader = 'varying vec3 vBlade;\n' + sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb = vBlade;');
    };
    mat.customProgramCacheKey = () => 'grass-blades';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 5;
    this.mesh = mesh;
    this._d = new THREE.Vector3();
  }

  // follow the camera: center the patch where it looks, but no farther than the patch reaches
  update(camera) {
    const e = camera.position, d = camera.getWorldDirection(this._d);
    const hl = Math.hypot(d.x, d.y) || 1;
    const reach = d.z < -0.02 ? (e.z / -d.z) * hl : 1e9;
    const go = Math.min(reach, this.T * 0.38);
    this.u.uCenter.value.set(e.x + (d.x / hl) * go, e.y + (d.y / hl) * go);
    this.u.uEye.value.copy(e);
    // the infield gets repainted when the sport changes
    this.u.uMapOut.value = this.planes[0].m.material.map;
    this.u.uMapIn.value = this.planes[1].m.material.map;
  }
}

// ---------- Trees ----------
function leafTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(7);
  for (let i = 0; i < 520; i++) {
    const a = r() * 6.283, d = Math.pow(r(), 0.6) * 0.44 * S;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.94;
    const len = 9 + r() * 10, rot = r() * 6.283;
    // lighter on top and toward the edge facing the sun, darker inside
    const lit = 0.55 + 0.45 * (1 - y / S) * 0.8 + (r() - 0.5) * 0.3 - (1 - d / (0.44 * S)) * 0.18;
    g.fillStyle = `hsl(${92 + r() * 26}, ${42 + r() * 18}%, ${Math.round(18 + 26 * Math.max(0, Math.min(1, lit)))}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.ellipse(0, 0, len / 2, len * 0.24, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(20,40,15,0.35)';
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function pineTexture() {
  const W = 256, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry(9);
  // a fir branch along the middle: stem from the left (trunk) to the right (tip), needles fanning off it
  for (let i = 0; i < 900; i++) {
    const u = r();
    const x = 6 + u * (W - 14), y0 = H / 2 + (r() - 0.5) * 6;
    const reach = (1 - u * 0.75) * (H * 0.46) * (0.5 + r() * 0.5);
    const a = (r() < 0.5 ? -1 : 1) * (0.55 + r() * 0.6);
    const L = 10 + r() * 14;
    g.strokeStyle = `hsl(${128 + r() * 22}, ${30 + r() * 20}%, ${Math.round(14 + r() * 18 + (1 - u) * 4)}%)`;
    g.lineWidth = 1.3 + r();
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + Math.cos(a) * L * 0.6, y0 + Math.sin(a) * Math.min(reach, L));
    g.stroke();
  }
  g.strokeStyle = '#4a3423';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W - 10, H / 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Geometry builder: quads and tubes with position, normal, uv, color, and wind weights
// (aSway: how far from the ground, 0..1; aFlut: 1 on leaves, which flutter)
class Builder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.s = []; this.f = []; this.i = []; }
  v(p, n, uv, c, s, f) {
    this.p.push(...p); this.n.push(...n); this.uv.push(...uv); this.c.push(c, c, c); this.s.push(s); this.f.push(f);
    return this.p.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aFlut', new THREE.Float32BufferAttribute(this.f, 1));
    g.setIndex(this.i);
    return g;
  }
}
const H = 30; // trees are built 30 ft tall, then scaled per spot
const sway = (z) => Math.pow(Math.max(0, z) / H, 1.6);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

function tube(B, a, b, r0, r1, sides = 7, shade = 1) {
  const ax = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const up = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm([ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]]);
  const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const base = B.p.length / 3;
  for (let k = 0; k <= sides; k++) {
    const t = (k / sides) * 6.283, c = Math.cos(t), s = Math.sin(t);
    const n = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
    for (const [p, rr, vv] of [[a, r0, 0], [b, r1, 1]]) {
      const q = [p[0] + n[0] * rr, p[1] + n[1] * rr, p[2] + n[2] * rr];
      B.v(q, n, [k / sides, vv], shade * (0.75 + 0.25 * (q[2] / H)), sway(q[2]), 0);
    }
  }
  for (let k = 0; k < sides; k++) {
    const o = base + k * 2;
    B.i.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  }
}

// a leaf card: a square facing n, around c, its normals bent toward the crown center's outward direction
function card(B, c, n, size, center, rads, u0 = 0, u1 = 1) {
  const up = Math.abs(n[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
  const a = norm([n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]]);
  const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const base = B.p.length / 3;
  for (const [x, y, uu, vv] of [[-1, -1, u0, 0], [1, -1, u1, 0], [1, 1, u1, 1], [-1, 1, u0, 1]]) {
    const q = [c[0] + (a[0] * x + b[0] * y) * size / 2, c[1] + (a[1] * x + b[1] * y) * size / 2, c[2] + (a[2] * x + b[2] * y) * size / 2];
    const out = norm([(q[0] - center[0]) / rads[0], (q[1] - center[1]) / rads[0], (q[2] - center[2]) / rads[1]]);
    const nn = norm([out[0] * 0.8 + n[0] * 0.2, out[1] * 0.8 + n[1] * 0.2, out[2] * 0.8 + n[2] * 0.2 + 0.15]);
    // darker low and inside the crown
    const hgt = (q[2] - (center[2] - rads[1])) / (2 * rads[1]);
    const rad = Math.hypot((q[0] - center[0]) / rads[0], (q[1] - center[1]) / rads[0], (q[2] - center[2]) / rads[1]);
    const shade = 0.5 + 0.32 * Math.min(1, Math.max(0, hgt)) + 0.22 * Math.min(1, rad);
    B.v(q, nn, [uu, vv], shade, sway(q[2]), 1);
  }
  B.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function broadleaf(seed, shape) {
  const r = mulberry(seed);
  const T = new Builder(), L = new Builder();
  const cz = H * shape.cz, rx = H * shape.rx, rz = H * shape.rz;
  const top = cz - rz * 0.2;
  tube(T, [0, 0, 0], [0.4, 0.2, top], 1.0, 0.45, 8);
  const limbs = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + r() * 0.6, z0 = H * (0.3 + r() * 0.18);
    const end = [Math.cos(a) * rx * 0.62, Math.sin(a) * rx * 0.62, cz + (r() - 0.3) * rz * 0.6];
    tube(T, [0.2, 0.1, z0], end, 0.42, 0.14, 5);
    limbs.push(end);
  }
  const center = [0, 0, cz];
  for (let i = 0; i < shape.cards; i++) {
    // more cards near the surface of the crown, clustered around the limb ends
    const lim = limbs[i % limbs.length];
    const useLimb = r() < 0.35;
    const th = r() * 6.283, ph = Math.acos(2 * r() - 1), rr = 0.45 + 0.55 * Math.pow(r(), 0.5);
    const p = useLimb
      ? [lim[0] + (r() - 0.5) * rx * 0.6, lim[1] + (r() - 0.5) * rx * 0.6, lim[2] + (r() - 0.5) * rz * 0.6]
      : [Math.sin(ph) * Math.cos(th) * rx * rr, Math.sin(ph) * Math.sin(th) * rx * rr, cz + Math.cos(ph) * rz * rr];
    const out = norm([p[0] - center[0], p[1] - center[1], (p[2] - center[2]) * 0.8]);
    const n = norm([out[0] + (r() - 0.5) * 1.2, out[1] + (r() - 0.5) * 1.2, out[2] + (r() - 0.5) * 1.2]);
    card(L, p, n, rx * (0.62 + r() * 0.3), center, [rx, rz]);
  }
  return { trunk: T.geometry(), leaves: L.geometry() };
}

function pine(seed) {
  const r = mulberry(seed);
  const T = new Builder(), L = new Builder();
  tube(T, [0, 0, 0], [0, 0, H * 0.97], 0.75, 0.12, 7, 0.9);
  const tiers = 9;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const z = H * (0.18 + 0.76 * f);
    const R = H * (0.27 * (1 - f) + 0.035);
    const n = 9 - Math.round(f * 4);
    const off = r() * 6.283;
    for (let j = 0; j < n; j++) {
      const a = off + (j / n) * 6.283 + (r() - 0.5) * 0.3;
      const droop = R * (0.32 + r() * 0.15);
      // a branch card from the trunk out and down, lying mostly flat, a little tilted
      const ca = Math.cos(a), sa = Math.sin(a);
      const w = R * 0.62;
      const p0 = [0, 0, z], p1 = [ca * R, sa * R, z - droop];
      const side = [-sa * w / 2, ca * w / 2, 0];
      const tilt = (r() - 0.5) * 0.4 * w;
      const base = L.p.length / 3;
      const nUp = norm([ca * 0.35, sa * 0.35, 1]);
      const quad = [[p0, -1, 0, 0], [p1, -1, 1, 0], [p1, 1, 1, 1], [p0, 1, 0, 1]];
      for (const [p, s, uu, vv] of quad) {
        const q = [p[0] + side[0] * s, p[1] + side[1] * s, p[2] + tilt * s];
        const shade = 0.55 + 0.4 * f + 0.1 * (uu);
        L.v(q, nUp, [uu, vv], shade, sway(q[2]), 1);
      }
      L.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { trunk: T.geometry(), leaves: L.geometry() };
}

// wind in the trees: the whole tree leans and rocks with the gusts (more toward the top), and the
// leaves flutter on their own
function windTrees(mat, key) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND);
    sh.vertexShader = 'attribute float aSway; attribute float aFlut; uniform float uTime; uniform vec3 uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  {
    vec3 ip = instanceMatrix[3].xyz;
    float ph = ip.x * 0.043 + ip.y * 0.061;
    vec3 wl = normalize(transpose(mat3(instanceMatrix)) * vec3(uWind.xy, 0.0));
    float rock = 0.55 + 0.45 * sin(uTime * 0.9 + ph) + 0.25 * sin(uTime * 2.1 + ph * 1.7);
    float lean = aSway * uWind.z * (1.1 + rock * 1.1);
    transformed += wl * lean;
    transformed.z -= lean * lean * 0.04;
    float fl = aFlut * (0.08 + 0.18 * uWind.z);
    transformed += vec3(sin(uTime * 6.3 + position.x * 1.7 + position.z * 0.9 + ph),
                        sin(uTime * 5.1 + position.y * 1.9 + ph * 2.0),
                        sin(uTime * 7.7 + position.z * 1.3)) * fl;
  }`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// spots: [{ x, y, h }] (h: the tree's height in feet). Returns a Group of instanced trees.
export function buildTrees(spots, seed = 5) {
  const r = mulberry(seed);
  const leafTex = leafTexture(), pineTex = pineTexture();
  const bark = windTrees(new THREE.MeshLambertMaterial({ color: '#6a4a33', vertexColors: true }), 'tree-bark');
  const leaves = windTrees(new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true }), 'tree-leaves');
  const needles = windTrees(new THREE.MeshLambertMaterial({ map: pineTex, alphaTest: 0.38, side: THREE.DoubleSide, vertexColors: true }), 'tree-needles');
  const kinds = [
    { ...broadleaf(21, { cz: 0.64, rx: 0.3, rz: 0.3, cards: 90 }), mat: leaves },
    { ...broadleaf(22, { cz: 0.66, rx: 0.24, rz: 0.36, cards: 85 }), mat: leaves },
    { ...broadleaf(23, { cz: 0.58, rx: 0.36, rz: 0.26, cards: 100 }), mat: leaves },
    { ...pine(31), mat: needles },
    { ...pine(32), mat: needles },
  ];
  const group = new THREE.Group();
  const pick = spots.map(() => (r() < 0.38 ? 3 + ((r() * 2) | 0) : (r() * 3) | 0));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  // tints: each tree a slightly different green
  const tint = new THREE.Color();
  kinds.forEach((kd, k) => {
    const mine = spots.filter((_, i) => pick[i] === k);
    if (!mine.length) return;
    const trunk = new THREE.InstancedMesh(kd.trunk, bark, mine.length);
    const crown = new THREE.InstancedMesh(kd.leaves, kd.mat, mine.length);
    mine.forEach((sp, i) => {
      const sc = sp.h / H, wide = 0.85 + r() * 0.35;
      m.compose(v.set(sp.x, sp.y, 0), q.setFromAxisAngle(z, r() * 6.283), s.set(sc * wide, sc * wide, sc));
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, tint.setScalar(0.82 + r() * 0.3));
    });
    group.add(trunk, crown);
  });
  return group;
}
