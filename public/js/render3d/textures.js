// Procedural textures painted on canvases (no image files).
import * as THREE from 'three';

const R2 = Math.SQRT1_2;
const B = 60 * R2; // 42.43 ft

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small tileable noise canvas used to break up flat colors.
let _noise = null;
export function noiseTile(size = 256) {
  if (_noise) return _noise;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = mulberry(7);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (rnd() - 0.5) * 90;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _noise = c;
  return c;
}

function texFrom(canvas, { repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------- The ballfield, painted top-down in world feet ----------
// Three ground planes share this painter at different resolutions, so everything is placed in world
// feet from fixed seeds and the planes match where they overlap. The canvases carry the shapes,
// mowing, wear and contact shadows; fine grain comes from the tiling detail texture, and the chalk
// lines are drawn by the ground shader (addGroundDetail), so they stay sharp at any distance.
const ARC_T = 49.85; // where the infield arc meets the foul lines
const ARC_A0 = Math.atan2(ARC_T - 46, ARC_T), ARC_A1 = Math.atan2(ARC_T - 46, -ARC_T);
const GRASS_O = 4.24; // the infield grass starts 3 ft inside the baselines
const FENCE_R = 201; // mowed lawn ends at the outfield wall
const FOUL_FENCE = 25; // side fences, this far out from the foul lines
const MOUND_CUT = 6.6; // dirt circle around the mound (baseball)
const LAWN = '#3c9637';
const ROUGH = '#2e6b30'; // matches the big plane under everything
const DIRT = '#c4834a';
const TRACK = '#b47a4b';
const SHADE = '16,22,10';
const DAMP = '86,46,18';
const TAU = Math.PI * 2;

// foul-line frame: s along the line (side +1 = first base), d out into foul ground
const lineP = (side, s, d) => [side * R2 * (s + d), R2 * (s - d)];
export const ON_DECK = [lineP(-1, 12, 18), lineP(1, 12, 18)]; // on-deck circles, by each dugout

function cutouts(softball) {
  return [[0, 0, 11], [B, B, 7], [-B, B, 7], [0, 2 * B, 7], ...(softball ? [] : [[0, 46, MOUND_CUT]])];
}
function arcPath(g) {
  g.moveTo(0, -3);
  g.lineTo(ARC_T, ARC_T);
  g.arc(0, 46, 50, ARC_A0, ARC_A1);
  g.lineTo(-ARC_T, ARC_T);
  g.closePath();
}
function circlesPath(g, cs) {
  for (const [x, y, r] of cs) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
}
function diamondPath(g) {
  g.moveTo(0, GRASS_O); g.lineTo(38.2, B); g.lineTo(0, 80.6); g.lineTo(-38.2, B); g.closePath();
}
// the same shapes as point tests (for grass tufts along the edges)
const inArc = (x, y) => (y < ARC_T ? y >= -3 + (Math.abs(x) * (ARC_T + 3)) / ARC_T : Math.hypot(x, y - 46) <= 50);
const inDiamond = (x, y) => Math.abs(x) / 38.2 + Math.abs(y - 42.42) / 38.2 < 1;
function isDirt(x, y, cs) {
  let inCut = false;
  for (const [cx, cy, r] of cs) if (Math.hypot(x - cx, y - cy) < r) { inCut = true; break; }
  if (inCut) return true;
  return inArc(x, y) && !inDiamond(x, y);
}

// Soft contact shadows: stacked rectangles fade out over `blur` feet
function softRect(g, cx, cy, w, h, ang, blur, a, rgb = SHADE) {
  const n = 5;
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  g.fillStyle = `rgba(${rgb},${(a / n).toFixed(4)})`;
  for (let k = 0; k < n; k++) {
    const e = blur * (1 - (2 * k) / (n - 1));
    g.fillRect(-w / 2 - e, -h / 2 - e, w + 2 * e, h + 2 * e);
  }
  g.restore();
}
function softDisc(g, x, y, r, a, rgb = SHADE) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`);
  gr.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
// A soft dark band on the inside of an arc wall (r0 -> r1 gets darker)
function wallBand(g, r0, r1, a0, a1, a) {
  const gr = g.createRadialGradient(0, 0, r0, 0, 0, r1);
  gr.addColorStop(0, `rgba(${SHADE},0)`);
  gr.addColorStop(0.7, `rgba(${SHADE},${a * 0.45})`);
  gr.addColorStop(1, `rgba(${SHADE},${a})`);
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath(); g.fill();
}

// One cleat print: a pressed sole plus its studs, toe pointing along `ang`
const STUDS = [[0.36, 0], [0.28, 0.11], [0.28, -0.11], [0.16, 0.13], [0.16, -0.13], [-0.3, 0.08], [-0.3, -0.08], [-0.38, 0]];
function printInto(sole, studs, x, y, ang, len) {
  const c = Math.cos(ang), s = Math.sin(ang);
  sole.moveTo(x + c * len * 0.5, y + s * len * 0.5);
  sole.ellipse(x, y, len * 0.5, len * 0.19, ang, 0, TAU);
  const r = len * 0.028;
  for (const [u, v] of STUDS) {
    const px = x + (c * u - s * v) * len, py = y + (s * u + c * v) * len;
    studs.moveTo(px + r, py);
    studs.arc(px, py, r, 0, TAU);
  }
}

// Everything that's scattered (blobs, prints) comes from one fixed seed, shared by every plane.
let _feat = null;
function fieldFeatures() {
  if (_feat) return _feat;
  const r = mulberry(2024);
  const lawn = [];
  for (let i = 0; i < 170; i++) lawn.push([-262 + r() * 524, -112 + r() * 414, 12 + r() * 30, r() < 0.5]);
  const dirt = [];
  while (dirt.length < 220) {
    const x = -56 + r() * 112, y = -12 + r() * 110;
    if (isDirt(x, y, cutouts(false))) dirt.push([x, y, 1.5 + r() * 6, r() < 0.55, 0.1 + r() * 0.12]);
  }
  // cleat prints: [x, y, angle, length]
  const prints = [];
  const near = (n, cx, cy, rad, ang = null, spread = Math.PI) => {
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * rad;
      prints.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, ang === null ? r() * TAU : ang + (r() - 0.5) * spread, 0.82 + r() * 0.14]);
    }
  };
  for (const side of [-1, 1]) {
    // batters: back foot and front foot, toes toward the plate
    near(6, side * 2.75, -0.7, 0.8, side > 0 ? Math.PI : 0, 0.9);
    near(6, side * 2.55, 1.8, 1.0, side > 0 ? Math.PI * 0.92 : Math.PI * 0.08, 1.1);
  }
  near(12, 0, -3.4, 1.2, Math.PI / 2, 1.2); // catcher
  near(6, 0.4, -5.6, 1.0, Math.PI / 2, 0.8); // plate umpire
  near(14, 0, 2, 9.5); // around home
  // runners' strides down the lines and around the bases
  const run = (x0, y0, x1, y1, off, n) => {
    const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, a = Math.atan2(uy, ux);
    for (let s = 2 + r() * 2, k = 0; s < L - 2 && k < n; s += 2.6 + r() * 0.6, k++) {
      const lat = off + (k % 2 ? 0.32 : -0.32) + (r() - 0.5) * 0.25;
      prints.push([x0 + ux * s + uy * lat, y0 + uy * s - ux * lat, a + (r() - 0.5) * 0.3, 0.84 + r() * 0.1]);
    }
  };
  for (const off of [-0.5, 0.3, 1.0]) run(1.5, 1.5, B, B, off, 30);
  for (const off of [-0.8, 0.6]) run(B, B, 0, 2 * B, off, 30);
  run(0, 2 * B, -B, B, 0.4, 30);
  run(-B, B, -1.5, 1.5, 0.3, 30);
  for (const [bx, by] of [[B, B], [0, 2 * B], [-B, B]]) near(14, bx, by, 4.5);
  for (const [fx, fy] of [[47, 54], [20, 76], [-21, 75], [-46, 52]]) near(10, fx, fy, 2.2, Math.atan2(-fy, -fx), 1.6);
  near(8, 0, 46, MOUND_CUT - 0.4); // mound apron (the mound hides the middle)
  for (const [x, y] of ON_DECK) near(8, x, y, 2);
  _feat = { lawn, dirt, prints };
  return _feat;
}

// Walk every grass/dirt edge (sampled every `step` ft) and call fn(x, y, nx, ny) where n points into the dirt.
function walkEdges(cs, step, fn) {
  const test = (x, y, nx, ny) => {
    const a = isDirt(x + nx * 0.3, y + ny * 0.3, cs), b = isDirt(x - nx * 0.3, y - ny * 0.3, cs);
    if (a !== b) a ? fn(x, y, nx, ny) : fn(x, y, -nx, -ny);
  };
  const seg = (x0, y0, x1, y1) => {
    const L = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    for (let s = 0; s < L; s += step) test(x0 + (x1 - x0) * (s / L), y0 + (y1 - y0) * (s / L), nx, ny);
  };
  const circ = (cx, cy, rad, a0 = 0, a1 = TAU) => {
    for (let a = a0; a < a1; a += step / rad) test(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, Math.cos(a), Math.sin(a));
  };
  circ(0, 46, 50, ARC_A0, ARC_A1);
  seg(0, -3, ARC_T, ARC_T);
  seg(0, -3, -ARC_T, ARC_T);
  seg(0, GRASS_O, 38.2, B); seg(38.2, B, 0, 80.6); seg(0, 80.6, -38.2, B); seg(-38.2, B, 0, GRASS_O);
  for (const [x, y, rad] of cs) circ(x, y, rad);
}

// region: { x0, x1, y0, y1 }, ppf: pixels per foot
// opts.softball: no mound cutout (the pitching circle is its own mesh, so it can move between 35 and 40 ft)
// opts.inner: the part of this region a sharper plane covers (its fine details are skipped here)
// opts.trees: [{ x, y, h }] for soft shade under the trees
export function paintField(region, ppf, opts = {}) {
  const W = Math.round((region.x1 - region.x0) * ppf);
  const H = Math.round((region.y1 - region.y0) * ppf);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // world -> canvas (flip y so +y is up)
  g.setTransform(ppf, 0, 0, -ppf, -region.x0 * ppf, region.y1 * ppf);
  const F = fieldFeatures();
  const cs = cutouts(opts.softball);
  const rx0 = region.x0, ry0 = region.y0, RW = region.x1 - region.x0, RH = region.y1 - region.y0;
  const rect = () => g.rect(rx0 - 1, ry0 - 1, RW + 2, RH + 2);
  const inside = (x, y, m = 0) => x > rx0 - m && x < region.x1 + m && y > ry0 - m && y < region.y1 + m;
  const inn = opts.inner;
  // is this spot left to this plane (not hidden under a sharper one)?
  const mine = (x, y, m = 0) => inside(x, y, m) && !(inn && x > inn.x0 + m && x < inn.x1 - m && y > inn.y0 + m && y < inn.y1 - m);
  const infieldMine = !(inn && inn.x0 <= -58 && inn.x1 >= 58 && inn.y0 <= -14 && inn.y1 >= 100);
  const fine = ppf >= 8;
  const r = mulberry(99);

  // --- rough grass outside the park, the mowed lawn inside ---
  g.fillStyle = ROUGH;
  g.fillRect(rx0 - 1, ry0 - 1, RW + 2, RH + 2);
  g.save();
  // the lawn: between the side fences, inside the outfield wall
  const apex = -FOUL_FENCE / R2;
  const sR = (() => { // how far up the fence line the wall circle is reached
    const b = apex * R2, cc = apex * apex - FENCE_R * FENCE_R;
    return -b + Math.sqrt(b * b - cc);
  })();
  const aR = Math.atan2(apex + sR * R2, sR * R2);
  g.beginPath();
  g.moveTo(0, apex);
  g.lineTo(sR * R2, apex + sR * R2);
  g.arc(0, 0, FENCE_R, aR, Math.PI - aR);
  g.closePath();
  g.clip();
  g.fillStyle = LAWN;
  g.fillRect(rx0, ry0, RW, RH);
  // mowing stripes, 15 ft wide, running out to center field
  const SW = 15;
  g.fillStyle = 'rgba(150,222,108,0.2)';
  for (let k = Math.floor((rx0 + SW / 2) / (2 * SW)) - 1; k * 2 * SW - SW / 2 < region.x1; k++) g.fillRect(k * 2 * SW - SW / 2, ry0, SW, RH);
  g.fillStyle = 'rgba(14,52,16,0.09)';
  for (let k = Math.floor((rx0 - SW / 2) / (2 * SW)) - 1; k * 2 * SW + SW / 2 < region.x1; k++) g.fillRect(k * 2 * SW + SW / 2, ry0, SW, RH);
  // clean-up laps around the infield arc and along the warning track (fair ground only)
  g.save();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(400, 400); g.lineTo(-400, 400); g.closePath(); g.clip();
  const lap = (cx, cy, r0, r1, light) => {
    g.beginPath(); g.arc(cx, cy, r1, 0, TAU); g.moveTo(cx + r0, cy); g.arc(cx, cy, r0, TAU, 0, true);
    g.fillStyle = LAWN; g.fill();
    g.fillStyle = light ? 'rgba(150,222,108,0.2)' : 'rgba(14,52,16,0.08)'; g.fill();
  };
  lap(0, 46, 55.5, 61, false);
  lap(0, 46, 49, 55.5, true);
  lap(0, 0, 176, 183, false);
  lap(0, 0, 183, 190.5, true);
  g.restore();
  g.restore();
  // big soft patches of lighter and darker grass, everywhere
  for (const [x, y, rad, light] of F.lawn) {
    if (!inside(x, y, rad)) continue;
    softDisc(g, x, y, rad, 0.07, light ? '170,230,120' : '10,40,10');
  }

  // --- concrete pads under the bleachers ---
  g.fillStyle = '#928f87';
  for (const side of [-1, 1]) {
    const [cx, cy] = lineP(side, 73, 40);
    g.save();
    g.translate(cx, cy);
    g.rotate(side > 0 ? Math.PI / 4 : Math.PI * 0.75);
    g.fillRect(-40.5, -10.75, 81, 21.5);
    g.restore();
  }

  // --- warning track ---
  g.beginPath();
  g.arc(0, 0, 200.5, Math.PI * 0.22, Math.PI * 0.78);
  g.arc(0, 0, 190, Math.PI * 0.78, Math.PI * 0.22, true);
  g.closePath();
  g.fillStyle = TRACK;
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 90; i++) {
    const a = Math.PI * (0.22 + 0.56 * r()), rad = 190 + r() * 10.5;
    softDisc(g, Math.cos(a) * rad, Math.sin(a) * rad, 2 + r() * 4, 0.16, r() < 0.5 ? '120,70,40' : '220,170,120');
  }
  g.restore();

  // --- the infield skin: arc, base paths and cutouts in one dirt color ---
  const union = () => { g.beginPath(); arcPath(g); circlesPath(g, cs); };
  union();
  g.fillStyle = DIRT;
  g.fill();
  // dirt spills a little onto the grass, so the edges aren't knife-cut
  g.strokeStyle = 'rgba(196,131,74,0.16)';
  for (const w of [0.85, 0.55, 0.28]) { g.lineWidth = w; g.stroke(); }

  if (infieldMine) {
    g.save();
    union();
    g.clip();
    // mottled clay: damp and dry patches
    for (const [x, y, rad, dark, a] of F.dirt) {
      if (!inside(x, y, rad)) continue;
      softDisc(g, x, y, rad, a, dark ? '150,88,42' : '228,176,122');
    }
    if (fine) {
      // drag marks: arcs swept around the infield, and rings around home
      const sweep = (cx, cy, r0, r1, clipHome) => {
        g.save();
        if (clipHome) { g.beginPath(); rect(); g.moveTo(11, 0); g.arc(0, 0, 11, 0, TAU); g.clip('evenodd'); }
        const lt = new Path2D(), dk = new Path2D();
        let k = 0;
        for (let rad = r0; rad < r1; rad += 0.42, k++) {
          const p = k % 2 ? lt : dk, jx = cx + (r() - 0.5) * 0.3, jy = cy + (r() - 0.5) * 0.3;
          p.moveTo(jx + rad, jy);
          p.arc(jx, jy, rad, 0, TAU);
        }
        g.lineWidth = 0.17;
        g.strokeStyle = 'rgba(255,226,182,0.05)'; g.stroke(lt);
        g.strokeStyle = 'rgba(96,54,22,0.045)'; g.stroke(dk);
        g.restore();
      };
      sweep(0, 46, 20, 50.5, true);
      sweep(0, 0, 4.5, 11.2, false);
    }
    // damp, darker clay around home (wetted and packed), the batter's boxes darkest
    {
      const gr = g.createRadialGradient(0, 0.4, 0, 0, 0.4, 11.4);
      gr.addColorStop(0, `rgba(${DAMP},0.36)`);
      gr.addColorStop(0.6, `rgba(${DAMP},0.2)`);
      gr.addColorStop(1, `rgba(${DAMP},0.02)`);
      g.fillStyle = gr;
      g.fillRect(-12, -11, 24, 23);
      for (const side of [-1, 1]) softRect(g, side * 2.71, 0.7, 3, 6, 0, 0.6, 0.16, DAMP);
    }
    if (!opts.softball) {
      const gr = g.createRadialGradient(0, 46, 4.8, 0, 46, MOUND_CUT + 0.4);
      gr.addColorStop(0, `rgba(${DAMP},0.34)`);
      gr.addColorStop(1, `rgba(${DAMP},0.04)`);
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 46, MOUND_CUT + 0.5, 0, TAU); g.fill();
    }
    // worn ground where fielders stand and runners round the bases
    for (const [x, y, rad, a] of [[B - 2.5, B + 1.5, 4.5, 0.2], [-B + 2.5, B + 1.5, 4.5, 0.2], [0, 2 * B - 2.5, 5, 0.2], [47, 54, 3.5, 0.16], [20, 76, 3.5, 0.16], [-21, 75, 3.5, 0.16], [-46, 52, 3.5, 0.16]]) {
      if (inside(x, y, rad)) softDisc(g, x, y, rad, a, '120,68,30');
    }
    // the batters' dug-in holes
    for (const side of [-1, 1]) {
      for (const [x, y, rx, ry, a] of [[side * 2.8, -0.9, 0.62, 0.42, 0.55], [side * 2.5, 1.75, 0.55, 0.36, 0.3]]) {
        if (!inside(x, y, 1)) continue;
        g.save();
        g.translate(x, y);
        g.scale(rx, ry);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, `rgba(70,36,14,${a})`);
        gr.addColorStop(0.7, `rgba(80,42,16,${a * 0.6})`);
        gr.addColorStop(0.85, `rgba(225,175,120,${a * 0.35})`);
        gr.addColorStop(1, 'rgba(225,175,120,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
        g.restore();
      }
    }
    g.restore();
  }

  // --- infield grass, checkerboard mowed, with the base cutouts ---
  g.save();
  g.beginPath(); diamondPath(g); g.clip();
  g.beginPath(); rect(); circlesPath(g, cs); g.clip('evenodd');
  g.fillStyle = LAWN;
  g.fillRect(-40, 0, 80, 84);
  const SQ = 13.5;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const u0 = 3 + i * SQ, v0 = 3 + j * SQ;
    const pts = [[u0, v0], [u0 + SQ, v0], [u0 + SQ, v0 + SQ], [u0, v0 + SQ]].map(([u, v]) => [(u - v) * R2, (u + v) * R2]);
    g.beginPath();
    pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fillStyle = (i + j) % 2 ? 'rgba(14,52,16,0.07)' : 'rgba(150,222,108,0.2)';
    g.fill();
  }
  for (const [x, y, rad, light] of F.lawn) {
    if (Math.hypot(x, y - 42) < 60 + rad) softDisc(g, x, y, rad, 0.07, light ? '170,230,120' : '10,40,10');
  }
  // the cutouts' dirt spills onto the grass a little
  g.beginPath(); circlesPath(g, cs);
  g.strokeStyle = 'rgba(196,131,74,0.16)';
  for (const w of [0.85, 0.55, 0.28]) { g.lineWidth = w; g.stroke(); }
  g.restore();
  // ...and the infield grass spills onto the base paths
  g.save();
  g.beginPath(); rect(); diamondPath(g); g.clip('evenodd');
  g.beginPath(); rect(); circlesPath(g, cs); g.clip('evenodd');
  g.beginPath(); diamondPath(g);
  g.strokeStyle = 'rgba(60,150,55,0.16)';
  for (const w of [0.7, 0.4]) { g.lineWidth = w; g.stroke(); }
  g.restore();

  // --- grass tufts poking over every grass/dirt edge ---
  if (fine) {
    const tufts = [new Path2D(), new Path2D(), new Path2D()];
    walkEdges(cs, Math.max(0.08, 1.8 / ppf), (x, y, nx, ny) => {
      if (!mine(x, y, 0.5)) return;
      const out = 0.04 + r() * r() * 0.3, back = 0.1, lat = (r() - 0.5) * 0.12;
      const p = tufts[(r() * 3) | 0];
      p.moveTo(x - nx * back + ny * lat, y - ny * back - nx * lat);
      p.lineTo(x + nx * out + ny * (lat + (r() - 0.5) * 0.12), y + ny * out - nx * (lat + (r() - 0.5) * 0.12));
    });
    g.lineCap = 'round';
    g.lineWidth = Math.max(0.02, 1.1 / ppf);
    ['rgba(52,128,46,0.85)', 'rgba(84,160,66,0.8)', 'rgba(36,98,34,0.75)'].forEach((s, i) => { g.strokeStyle = s; g.stroke(tufts[i]); });
    g.lineCap = 'butt';
  }

  // --- on-deck circles: trampled to dirt in the middle ---
  for (const [x, y] of ON_DECK) {
    if (!inside(x, y, 3)) continue;
    const gr = g.createRadialGradient(x, y, 0, x, y, 2.45);
    gr.addColorStop(0, 'rgba(176,118,66,0.85)');
    gr.addColorStop(0.75, 'rgba(176,118,66,0.6)');
    gr.addColorStop(1, 'rgba(120,120,60,0.15)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, 2.45, 0, TAU); g.fill();
  }

  // --- cleat prints ---
  {
    const sole = new Path2D(), studs = new Path2D();
    let n = 0;
    for (const [x, y, a, len] of F.prints) {
      if (!mine(x, y, 1) || !isDirt(x, y, cs) || Math.hypot(x, y - 46) < 5.6) continue;
      printInto(sole, studs, x, y, a, len);
      n++;
    }
    if (n) {
      g.fillStyle = 'rgba(92,52,22,0.12)';
      g.fill(sole);
      if (ppf >= 12) { g.fillStyle = 'rgba(70,38,15,0.22)'; g.fill(studs); }
    }
  }

  // --- contact shadows from the ballpark (dugouts, stands, walls, towers, trees) ---
  for (const side of [-1, 1]) {
    const ang = side > 0 ? Math.PI / 4 : Math.PI * 0.75;
    const [dx, dy] = lineP(side, 17, 29.6);
    softRect(g, dx, dy, 21.5, 10.4, ang, 1.4, 0.5);
    const [bx, by] = lineP(side, 73, 40);
    softRect(g, bx, by, 79, 18.5, ang, 1.6, 0.42);
    const [fx, fy] = lineP(side, 73, 32.5);
    softRect(g, fx, fy, 80, 2.4, ang, 1, 0.22); // the low front rows sit right on the pad
    const [ex, ey] = lineP(side, 115, FOUL_FENCE);
    softRect(g, ex, ey, 180, 0.9, ang, 0.5, 0.18); // side fence
  }
  wallBand(g, 195.5, 200.3, Math.PI * 0.22, Math.PI * 0.78, 0.36); // outfield wall
  wallBand(g, 31.5, 35.4, Math.PI * 1.18, Math.PI * 1.82, 0.4); // backstop pads
  for (const [x, y] of [[-95, 5], [95, 5], [-165, 175], [165, 175]]) if (inside(x, y, 6)) softDisc(g, x, y, 5.5, 0.5);
  for (const sx of [-1, 1]) if (inside(sx * 200 * R2, 200 * R2, 3)) softDisc(g, sx * 200 * R2, 200 * R2, 1.6, 0.35);
  {
    const th = Math.atan2(-238, 118) + Math.PI / 2, ct = Math.cos(th), st = Math.sin(th);
    for (const lx of [-16, 16]) softDisc(g, -118 + lx * ct - 0.6 * st, 238 + lx * st + 0.6 * ct, 3.6, 0.45);
    softRect(g, -118 - 0.8 * st, 238 + 0.8 * ct, 48, 6, th, 3, 0.18);
  }
  for (const t of opts.trees || []) {
    const rad = 4 + t.h * 0.22;
    if (inside(t.x, t.y, rad)) softDisc(g, t.x, t.y, rad, 0.34);
  }

  // --- a little per-pixel grain ---
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.1;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = g.createPattern(noiseTile(), 'repeat');
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return texFrom(c);
}

// ---------- Mound top (baseball): planar, 11.2 ft across, centered on the mound ----------
// Damp clay with the pitcher's push-off hole in front of the rubber and the landing hole down the slope.
export function moundTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const k = size / 11.2;
  g.setTransform(k, 0, 0, -k, size / 2, size / 2); // feet, +y toward second base
  const r = mulberry(46);
  g.fillStyle = '#c07c43';
  g.fillRect(-6, -6, 12, 12);
  for (let i = 0; i < 40; i++) softDisc(g, (r() - 0.5) * 11, (r() - 0.5) * 11, 0.8 + r() * 2, 0.14, r() < 0.5 ? '150,88,42' : '228,176,122');
  // the slope is wetter (darker) toward the bottom, the table on top drier
  const gr = g.createRadialGradient(0, 0, 1.4, 0, 0, 5.7);
  gr.addColorStop(0, `rgba(${DAMP},0)`);
  gr.addColorStop(1, `rgba(${DAMP},0.34)`);
  g.fillStyle = gr;
  g.fillRect(-6, -6, 12, 12);
  // drag rings
  for (let rad = 0.8, i = 0; rad < 5.6; rad += 0.38, i++) {
    g.beginPath(); g.arc((r() - 0.5) * 0.1, (r() - 0.5) * 0.1, rad, 0, TAU);
    g.lineWidth = 0.13;
    g.strokeStyle = i % 2 ? 'rgba(255,226,182,0.06)' : 'rgba(96,54,22,0.06)';
    g.stroke();
  }
  // worn strip down the front (home is toward -y), the push-off hole and the landing hole
  softRect(g, -0.2, -2.3, 1.6, 4.4, 0, 0.6, 0.22, '110,60,26');
  const hole = (x, y, rx, ry, a) => {
    g.save(); g.translate(x, y); g.scale(rx, ry);
    const h = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    h.addColorStop(0, `rgba(64,32,12,${a})`);
    h.addColorStop(0.65, `rgba(78,40,16,${a * 0.6})`);
    h.addColorStop(0.85, `rgba(228,180,126,${a * 0.4})`);
    h.addColorStop(1, 'rgba(228,180,126,0)');
    g.fillStyle = h;
    g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    g.restore();
  };
  hole(0.1, -0.45, 0.75, 0.32, 0.6);
  hole(-0.45, -4.4, 0.75, 0.55, 0.65);
  const sole = new Path2D(), studs = new Path2D();
  for (let i = 0; i < 14; i++) printInto(sole, studs, (r() - 0.5) * 1.6 - 0.3, -1 - r() * 3.8, -Math.PI / 2 + (r() - 0.5) * 0.9, 0.85);
  for (let i = 0; i < 8; i++) printInto(sole, studs, (r() - 0.5) * 2.4, (r() - 0.5) * 1.6 + 0.4, r() * TAU, 0.85);
  g.fillStyle = 'rgba(92,52,22,0.15)'; g.fill(sole);
  g.fillStyle = 'rgba(70,38,15,0.28)'; g.fill(studs);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.12;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = g.createPattern(noiseTile(), 'repeat');
  g.fillRect(0, 0, size, size);
  return texFrom(c);
}

// ---------- Softball pitching circle (the dirt disc, 17.4 ft across; the chalk ring is its own mesh) ----------
// Damp in the middle, the pitcher's drag line and stride marks toward home (-y); alpha gives the
// edge a ragged, grassy fringe (used with alphaTest).
export function circleTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = 8.7, k = size / (2 * R);
  g.setTransform(k, 0, 0, -k, size / 2, size / 2);
  const r = mulberry(35);
  g.beginPath(); g.arc(0, 0, 8.25, 0, TAU);
  g.fillStyle = DIRT; g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 50; i++) softDisc(g, (r() - 0.5) * 16, (r() - 0.5) * 16, 1 + r() * 3, 0.14, r() < 0.55 ? '150,88,42' : '228,176,122');
  for (let rad = 0.6, i = 0; rad < 8.4; rad += 0.42, i++) {
    g.beginPath(); g.arc((r() - 0.5) * 0.15, (r() - 0.5) * 0.15, rad, 0, TAU);
    g.lineWidth = 0.15;
    g.strokeStyle = i % 2 ? 'rgba(255,226,182,0.05)' : 'rgba(96,54,22,0.05)';
    g.stroke();
  }
  const gr = g.createRadialGradient(0, -0.8, 0, 0, -0.8, 7.5);
  gr.addColorStop(0, `rgba(${DAMP},0.4)`);
  gr.addColorStop(0.6, `rgba(${DAMP},0.18)`);
  gr.addColorStop(1, `rgba(${DAMP},0.04)`);
  g.fillStyle = gr;
  g.fillRect(-9, -9, 18, 18);
  // the pivot foot's drag line, then the stride landing area
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(78,40,16,0.14)';
  g.beginPath(); g.moveTo(0.15, -0.1); g.quadraticCurveTo(0.25, -1.3, 0.1, -2.6);
  for (const w of [0.5, 0.32, 0.18]) { g.lineWidth = w; g.stroke(); }
  softRect(g, -0.25, -3.6, 1.4, 1.6, 0, 0.5, 0.22, '84,44,18');
  const sole = new Path2D(), studs = new Path2D();
  for (let i = 0; i < 12; i++) printInto(sole, studs, -0.3 + (r() - 0.5) * 1.2, -3.2 - r() * 1.4, -Math.PI / 2 + (r() - 0.5) * 0.8, 0.8);
  for (let i = 0; i < 10; i++) printInto(sole, studs, (r() - 0.5) * 3, (r() - 0.5) * 2, r() * TAU, 0.8);
  g.fillStyle = 'rgba(92,52,22,0.15)'; g.fill(sole);
  g.fillStyle = 'rgba(70,38,15,0.28)'; g.fill(studs);
  g.restore();
  // a ragged grass-edge fringe in the alpha
  g.lineCap = 'round';
  g.lineWidth = 0.05;
  g.strokeStyle = DIRT;
  g.beginPath();
  for (let a = 0; a < TAU; a += 0.006) {
    const out = 8.2 + r() * r() * 0.45, ca = Math.cos(a), sa = Math.sin(a);
    g.moveTo(ca * 8.1, sa * 8.1); g.lineTo(ca * out, sa * out);
  }
  g.stroke();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'overlay'; // the faint grain it leaves outside the disc is below alphaTest
  g.globalAlpha = 0.12;
  g.fillStyle = g.createPattern(noiseTile(), 'repeat');
  g.fillRect(0, 0, size, size);
  return texFrom(c);
}

// ---------- Outfield wall art (wraps the fence arc) ----------
export function wallTexture() {
  const W = 4096, H = 160;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1d5a35';
  g.fillRect(0, 0, W, H);
  // padding seams
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 3;
  for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  // ad panels (u runs from the left-field pole to the right-field pole)
  const ads = [
    [0.12, 'PLAY BALL!', '#ffd34d', '#0b1530'],
    [0.29, 'UMPIRE BOOTCAMP', '#0b1530', '#ffd34d'],
    [0.5, 'MAKE THE CALL', '#d62839', '#ffffff'],
    [0.71, 'OWN THE FIELD', '#1f5fe0', '#ffffff'],
    [0.88, 'GO BLUE!', '#ffffff', '#0b1530'],
  ];
  for (const [u, text, bg, fg] of ads) {
    const w = 520, x = u * W - w / 2;
    g.fillStyle = bg;
    g.fillRect(x, 26, w, 108);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 4;
    g.strokeRect(x + 6, 32, w - 12, 96);
    g.fillStyle = fg;
    g.font = '64px Bungee, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, u * W, 82, w - 40);
  }
  // distance markers
  g.fillStyle = '#ffffff';
  g.font = 'bold 54px Bungee, Impact, sans-serif';
  g.textAlign = 'center';
  for (const [u, t] of [[0.03, '200'], [0.4, '200'], [0.6, '200'], [0.97, '200']]) g.fillText(t, u * W, 84);
  return texFrom(c, { aniso: 8 });
}

// ---------- Chain-link fence (alpha) ----------
export function chainLinkTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(200,210,215,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(S, S);
  g.moveTo(S, 0); g.lineTo(0, S);
  g.stroke();
  const t = texFrom(c, { repeat: true });
  return t;
}

// ---------- Scoreboard face ----------
export function scoreboardCanvas() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  return c;
}
export function paintScoreboard(c, info = {}) {
  const g = c.getContext('2d');
  g.fillStyle = '#0b1530';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#ffd34d';
  g.lineWidth = 16;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#ffd34d';
  g.font = '86px Bungee, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('UMPIRE MADNESS', c.width / 2, 100);
  g.font = '44px Bungee, Impact, sans-serif';
  g.fillStyle = '#ffffff';
  const cells = [['BALL', info.balls ?? 0], ['STRIKE', info.strikes ?? 0], ['OUT', info.outs ?? 0]];
  cells.forEach(([label, v], i) => {
    const x = 210 + i * 300;
    g.fillStyle = '#9fb3e8';
    g.font = '40px Bungee, Impact, sans-serif';
    g.fillText(label, x, 220);
    g.fillStyle = '#ff5a3c';
    for (let k = 0; k < (label === 'BALL' ? 3 : 2); k++) {
      g.beginPath();
      g.arc(x - 50 + k * 50, 300, 18, 0, Math.PI * 2);
      g.fillStyle = k < v ? (label === 'BALL' ? '#2fd67b' : '#ff5a3c') : '#26324f';
      g.fill();
    }
  });
  g.fillStyle = '#ffffff';
  g.font = '50px Bungee, Impact, sans-serif';
  g.fillText(info.line || 'PLAY BALL!', c.width / 2, 420);
}

// ---------- Soft cloud puff ----------
export function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const rnd = mulberry(99);
  for (let i = 0; i < 26; i++) {
    const x = 90 + rnd() * 330, y = 120 + (rnd() - 0.5) * 70, r = 40 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Flags ----------
export function flagTexture(kind = 'stars') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 144;
  const g = c.getContext('2d');
  if (kind === 'stars') {
    for (let i = 0; i < 13; i++) {
      g.fillStyle = i % 2 ? '#f5f5f5' : '#c8102e';
      g.fillRect(0, (i * 144) / 13, 256, 144 / 13 + 1);
    }
    g.fillStyle = '#1f2f6b';
    g.fillRect(0, 0, 108, 78);
    g.fillStyle = '#ffffff';
    for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.arc(10 + k * 17.5 + (r % 2) * 8, 9 + r * 15, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // team pennant: stripe + star
    g.fillStyle = kind;
    g.fillRect(0, 0, 256, 144);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(0, 60, 256, 24);
    g.fillStyle = '#ffd34d';
    g.font = 'bold 90px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('★', 70, 74);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Glow sprite (stadium lights, sun) ----------
export function glowTexture(color = '255,250,220') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${color},1)`);
  gr.addColorStop(0.25, `rgba(${color},0.6)`);
  gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Baseball with seams ----------
// softball: optic yellow with red stitches
export function ballTexture(color = '#fbfbf6') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#d0302f';
  g.lineWidth = 5;
  g.setLineDash([6, 5]);
  g.beginPath();
  for (let x = 0; x <= 256; x += 4) {
    const y = 64 + Math.sin((x / 256) * Math.PI * 4) * 34;
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Text label sprite ----------
export function labelTexture(text, color = '#ffd34d') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.font = '92px Bungee, Impact, sans-serif';
  // longer labels ("YOU", "WORKING AREA") shrink to fit instead of running off the edges
  const fit = Math.min(92, (92 * 112) / Math.max(1, g.measureText(text).width));
  g.font = `${Math.floor(fit)}px Bungee, Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = Math.max(5, fit * 0.13);
  g.strokeStyle = '#0b1530';
  g.strokeText(text, 64, 70);
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Tiling ground detail: R = grass blades, G = dirt grain/pebbles ----------
export function groundDetailTexture(size = 512) {
  // Each shape is drawn once, plus a wrapped copy where it crosses an edge, so the layer tiles.
  const layer = (n, make, draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgb(128,128,128)';
    g.fillRect(0, 0, size, size);
    const r = mulberry(5);
    for (let i = 0; i < n; i++) {
      const s = make(r, i);
      const xs = [0], ys = [0];
      if (s.x < s.m) xs.push(size); else if (s.x > size - s.m) xs.push(-size);
      if (s.y < s.m) ys.push(size); else if (s.y > size - s.m) ys.push(-size);
      for (const ox of xs) for (const oy of ys) draw(g, s, s.x + ox, s.y + oy);
    }
    return g.getImageData(0, 0, size, size).data;
  };
  const grass = layer(2600, (r) => {
    const x = r() * size, y = r() * size, len = 6 + r() * 14, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const v = r() < 0.5 ? 70 + r() * 40 : 170 + r() * 60;
    return { x, y, len, a, v, w: 1 + r() * 1.6, m: len + 2 };
  }, (g, s, x, y) => {
    g.strokeStyle = `rgb(${s.v},${s.v},${s.v})`;
    g.lineWidth = s.w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(s.a) * s.len, y + Math.sin(s.a) * s.len); g.stroke();
  });
  const dirt = layer(5090, (r, i) => {
    if (i < 5000) {
      const x = r() * size, y = r() * size, rr = 0.6 + r() * 1.8;
      const v = r() < 0.5 ? 85 + r() * 40 : 160 + r() * 55;
      return { x, y, rr, v, m: rr + 1 };
    }
    const x = r() * size, y = r() * size, rr = 2 + r() * 4;
    return { x, y, rr, pebble: true, a0: r() * 3, a1: r() * 3, m: rr + 3 };
  }, (g, s, x, y) => {
    if (!s.pebble) {
      g.fillStyle = `rgb(${s.v},${s.v},${s.v})`;
      g.beginPath(); g.arc(x, y, s.rr, 0, Math.PI * 2); g.fill();
      return;
    }
    g.fillStyle = 'rgb(205,200,195)';
    g.beginPath(); g.ellipse(x, y, s.rr, s.rr * 0.7, s.a0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgb(80,70,60)';
    g.beginPath(); g.ellipse(x + 1, y + 1.2, s.rr * 0.9, s.rr * 0.4, s.a1, 0, Math.PI * 2); g.fill();
  });
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const og = out.getContext('2d');
  const img = og.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = grass[i * 4];
    img.data[i * 4 + 1] = dirt[i * 4];
    img.data[i * 4 + 2] = 128;
    img.data[i * 4 + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// Chalk lines, drawn by the ground shader instead of painted: each line is filtered across its width
// by the pixel's footprint measured along the line's normal (a tent filter two pixels wide), so lines
// are sharp up close and fade smoothly far away instead of breaking into dashes, at any texture size.
const CHALK_GLSL = `
float chalkTent(float x, float f) {
  float t = clamp(x / f, -1.0, 1.0);
  return t < 0.0 ? 0.5 * (1.0 + t) * (1.0 + t) : 1.0 - 0.5 * (1.0 - t) * (1.0 - t);
}
// how much of a line of half-width w, d away, covers this pixel (fw: pixel footprint across the line)
float chalkCov(float d, float w, float fw) {
  fw = max(fw, 1e-4);
  return chalkTent(d + w, fw) - chalkTent(d - w, fw);
}
float chalkSeg(vec2 p, vec2 a, vec2 b, float w, vec2 px, vec2 py) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec2 q = pa - ba * h;
  float d = length(q);
  vec2 n = d > 1e-4 ? q / d : normalize(vec2(-ba.y, ba.x));
  return chalkCov(d, w, abs(dot(n, px)) + abs(dot(n, py)));
}
float chalkRing(vec2 p, vec2 c, float r, float w, vec2 px, vec2 py) {
  vec2 q = p - c;
  float l = max(length(q), 1e-4);
  vec2 n = q / l;
  return chalkCov(abs(l - r), w, abs(dot(n, px)) + abs(dot(n, py)));
}
float chalkBox(vec2 p, vec2 a, vec2 b, float w, vec2 px, vec2 py) {
  float c = chalkSeg(p, a, vec2(b.x, a.y), w, px, py);
  c = max(c, chalkSeg(p, vec2(b.x, a.y), b, w, px, py));
  c = max(c, chalkSeg(p, b, vec2(a.x, b.y), w, px, py));
  return max(c, chalkSeg(p, vec2(a.x, b.y), a, w, px, py));
}
// p: world feet; px, py: how p changes per pixel
float chalk(vec2 p, vec2 px, vec2 py) {
  const float W = 0.125; // 3-inch lines
  float c = 0.0;
  if (abs(p.x) < 6.0 && p.y > -9.0 && p.y < 5.0) {
    // batter's boxes (Little League: 3 x 6 ft, 6 in off the plate) and the catcher's box
    c = max(chalkBox(p, vec2(1.208, -2.3), vec2(4.208, 3.7), W, px, py), chalkBox(p, vec2(-4.208, -2.3), vec2(-1.208, 3.7), W, px, py));
    c = max(c, chalkSeg(p, vec2(-1.6, -2.3), vec2(-1.6, -8.0), W, px, py));
    c = max(c, chalkSeg(p, vec2(-1.6, -8.0), vec2(1.6, -8.0), W, px, py));
    c = max(c, chalkSeg(p, vec2(1.6, -8.0), vec2(1.6, -2.3), W, px, py));
  }
  // the rest in the nearer foul line's frame: x = feet along the line, y = feet out into foul ground
  float sx = p.x < 0.0 ? -1.0 : 1.0;
  vec2 q = vec2(sx * p.x + p.y, sx * p.x - p.y) * 0.70710678;
  vec2 qx = vec2(sx * px.x + px.y, sx * px.x - px.y) * 0.70710678;
  vec2 qy = vec2(sx * py.x + py.y, sx * py.x - py.y) * 0.70710678;
  // foul line: from the front of the batter's box out to the fence
  c = max(c, chalkSeg(q, vec2(5.233, 0.0), vec2(200.0, 0.0), W, qx, qy));
  if (q.x > 25.0 && q.x < 70.0 && q.y > -1.0 && q.y < 14.0) {
    if (sx > 0.0) {
      // running lane: the last 30 ft to first base, 3 ft into foul ground
      c = max(c, chalkSeg(q, vec2(30.0, 0.0), vec2(30.0, 3.0), W, qx, qy));
      c = max(c, chalkSeg(q, vec2(30.0, 3.0), vec2(60.0, 3.0), W, qx, qy));
    }
    // coach's box, open on the far side
    c = max(c, chalkSeg(q, vec2(54.0, 13.0), vec2(54.0, 9.0), W, qx, qy));
    c = max(c, chalkSeg(q, vec2(54.0, 9.0), vec2(66.0, 9.0), W, qx, qy));
    c = max(c, chalkSeg(q, vec2(66.0, 9.0), vec2(66.0, 13.0), W, qx, qy));
  }
  // on-deck circle (5 ft across) by each dugout
  if (q.x > 8.0 && q.x < 16.0 && q.y > 14.0 && q.y < 22.0) c = max(c, chalkRing(q, vec2(12.0, 18.0), 2.5, W, qx, qy));
  return c;
}
`;

// Patch a Lambert material so it multiplies in the tiling ground detail.
// opts.chalk: also draw the chalk lines (the field planes only)
export function addGroundDetail(material, detail, { scale = 0.45, strength = 0.42, chalk = false } = {}) {
  if (chalk) material.defines = { ...(material.defines || {}), GROUND_CHALK: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.uniforms.detailScale = { value: scale };
    shader.uniforms.detailStrength = { value: strength };
    shader.vertexShader = 'varying vec2 vDetailPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vDetailPos = (modelMatrix * vec4(position, 1.0)).xy;'
    );
    shader.fragmentShader = 'varying vec2 vDetailPos;\nuniform sampler2D detailMap;\nuniform float detailScale;\nuniform float detailStrength;\n' +
      (chalk ? CHALK_GLSL : '') + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    vec3 dt = texture2D(detailMap, vDetailPos * detailScale).rgb;
    float grassy = clamp((diffuseColor.g - diffuseColor.r) * 7.0 + 0.45, 0.0, 1.0);
    float d = mix(dt.g, dt.r, grassy);
    diffuseColor.rgb *= mix(1.0, d * 2.0, detailStrength);
#ifdef GROUND_CHALK
    float ch = chalk(vDetailPos, dFdx(vDetailPos), dFdy(vDetailPos));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.92, 0.89), ch * (0.82 + 0.18 * dt.g));
#endif
  }`
    );
  };
  material.customProgramCacheKey = () => (chalk ? 'ground-detail-chalk' : 'ground-detail');
  return material;
}
