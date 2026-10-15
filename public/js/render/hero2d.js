// A 2D canvas stand-in for the 3D People renderer, so the realistic close-up players (render3d/hero.js)
// also draw on devices without working WebGL. It offers the same primitives (sphere, ellipsoid, dome,
// limb, taper, decal, blob), projects them with the game camera, and paints soft-shaded shapes
// back to front.

const OUTLINE = 'rgba(12,16,30,0.6)';

function hexRgb(c) {
  if (c[0] === '#') {
    const n = parseInt(c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
const cache = new Map();
function tone(c, k) {
  const key = c + k;
  let v = cache.get(key);
  if (!v) {
    const [r, g, b] = hexRgb(c);
    const f = (x) => Math.max(0, Math.min(255, Math.round(k >= 1 ? x + (255 - x) * (k - 1) : x * k)));
    v = `rgb(${f(r)},${f(g)},${f(b)})`;
    cache.set(key, v);
  }
  return v;
}

// convex hull (monotone chain) of [{x, y}]
function hull(pts) {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

// unit-sphere sample directions (latitude rings x longitudes)
function samples(dome) {
  const out = [];
  for (let la = dome ? 0 : -75; la <= 90; la += 25) {
    const phi = (la * Math.PI) / 180;
    const n = la >= 89 ? 1 : 12;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      out.push([Math.cos(phi) * Math.cos(th), Math.cos(phi) * Math.sin(th), Math.sin(phi)]);
    }
  }
  return out;
}
const SPH = samples(false);
const DOME = samples(true);

export class Painter2D {
  constructor() {
    this.shapes = [];
    this.family = 'hero';
    this.ow = 0;
    this.decals = new Map();
    this.flat = true; // lets hero.js skip details that only work with a depth buffer
  }

  begin(g, cam) {
    this.g = g;
    this.cam = cam;
    this.shapes.length = 0;
    this.lw = Math.max(1, cam.h / 700);
  }

  useFamily(name) { this.family = name; }
  _outlineFor() { return 0; }

  _depth(c) { return this.cam.toCam(c.x, c.y, c.z).z; }

  _push(shape, c, outline) {
    shape.depth = this._depth(c) - (outline ? 0 : 0.03);
    shape.gloss = this.family === 'gloss';
    shape.outline = outline;
    this.shapes.push(shape);
  }

  // ground contact shadow
  blob(x, y, r) {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const q = this.cam.project(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.02);
      if (q) pts.push(q);
    }
    if (pts.length > 5) this.shapes.push({ kind: 'shadow', pts, depth: 1e9 });
  }

  sphere(c, r, color, outline = true) {
    const q = this.cam.project(c.x, c.y, c.z);
    if (!q) return;
    this._push({ kind: 'circle', x: q.x, y: q.y, r: r * q.s, color }, c, outline);
  }

  _ellip(c, X, Y, Z, rx, ry, rz, color, outline, dirs) {
    const pts = [];
    for (const [a, b, d] of dirs) {
      const q = this.cam.project(c.x + X.x * rx * a + Y.x * ry * b + Z.x * rz * d, c.y + X.y * rx * a + Y.y * ry * b + Z.y * rz * d, c.z + X.z * rx * a + Y.z * ry * b + Z.z * rz * d);
      if (q) pts.push(q);
    }
    if (pts.length < 4) return;
    this._push({ kind: 'poly', pts: hull(pts), color }, c, outline);
  }
  ellipsoid(c, X, Y, Z, rx, ry, rz, color, outline = true) { this._ellip(c, X, Y, Z, rx, ry, rz, color, outline, SPH); }
  dome(c, X, Y, Z, rx, ry, rz, color, outline = true) { this._ellip(c, X, Y, Z, rx, ry, rz, color, outline, DOME); }

  limb(a, b, r, color, outline = true) { this._capsule(a, b, r, r, color, outline); }
  taper(a, b, r, color, outline = true) { this._capsule(a, b, r, r * 0.68, color, outline); }
  _capsule(a, b, ra, rb, color, outline) {
    const pa = this.cam.project(a.x, a.y, a.z), pb = this.cam.project(b.x, b.y, b.z);
    if (!pa || !pb) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    this._push({ kind: 'capsule', ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, ra: ra * pa.s, rb: rb * pb.s, color }, mid, outline);
  }

  // jersey numbers / lettering, drawn when they face the camera
  decal(c, n, up, w, h, key, paint) {
    const e = this.cam.eye;
    const toCam = { x: e.x - c.x, y: e.y - c.y, z: e.z - c.z };
    if (n.x * toCam.x + n.y * toCam.y + n.z * toCam.z <= 0) return;
    let img = this.decals.get(key);
    if (!img) { img = paint(); this.decals.set(key, img); }
    const right = { x: up.y * n.z - up.z * n.y, y: up.z * n.x - up.x * n.z, z: up.x * n.y - up.y * n.x };
    const P = (k1, k2) => this.cam.project(c.x + right.x * w * k1 + up.x * h * k2, c.y + right.y * w * k1 + up.y * h * k2, c.z + right.z * w * k1 + up.z * h * k2);
    const o = P(0, 0), px = P(0.5, 0), py = P(0, 0.5);
    if (!o || !px || !py) return;
    this._push({ kind: 'decal', img, o, px, py }, c, false);
  }

  end() {
    const g = this.g;
    this.shapes.sort((a, b) => b.depth - a.depth);
    g.save();
    g.lineJoin = 'round';
    // pass 1: a thick dark stroke under every part, so only the outer silhouette keeps an outline
    g.strokeStyle = OUTLINE;
    g.lineWidth = this.lw * 2.4;
    for (const s of this.shapes) if (s.outline && this._path(g, s)) g.stroke();
    // pass 2: the shaded parts, back to front
    for (const s of this.shapes) this._paint(g, s);
    g.restore();
  }

  // trace a shape's outline path (circles, hulls and capsules); false if it has none
  _path(g, s) {
    if (s.kind === 'circle') { g.beginPath(); g.arc(s.x, s.y, Math.max(0.4, s.r), 0, Math.PI * 2); return true; }
    if (s.kind === 'poly') { g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); return true; }
    if (s.kind === 'capsule') {
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const L = Math.hypot(dx, dy) || 0.001;
      const nx = -dy / L, ny = dx / L;
      const ang = Math.atan2(ny, nx);
      g.beginPath();
      g.moveTo(s.ax + nx * s.ra, s.ay + ny * s.ra);
      g.lineTo(s.bx + nx * s.rb, s.by + ny * s.rb);
      g.arc(s.bx, s.by, Math.max(0.2, s.rb), ang, ang + Math.PI, true);
      g.lineTo(s.ax - nx * s.ra, s.ay - ny * s.ra);
      g.arc(s.ax, s.ay, Math.max(0.2, s.ra), ang + Math.PI, ang, true);
      g.closePath();
      return true;
    }
    return false;
  }

  _fillShaded(g, s, cx, cy, size) {
    const gr = g.createRadialGradient(cx - size * 0.35, cy - size * 0.4, size * 0.05, cx, cy, size * 1.15);
    gr.addColorStop(0, tone(s.color, s.gloss ? 1.45 : 1.18));
    gr.addColorStop(0.55, s.color);
    gr.addColorStop(1, tone(s.color, 0.62));
    g.fillStyle = gr;
    g.fill();
    if (s.gloss && size > 4) {
      g.save();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.ellipse(cx - size * 0.32, cy - size * 0.42, size * 0.32, size * 0.13, -0.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  _paint(g, s) {
    if (s.kind === 'shadow') {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      s.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
    } else if (s.kind === 'circle') {
      if (s.r < 0.4) return;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      this._fillShaded(g, s, s.x, s.y, s.r);
    } else if (s.kind === 'poly') {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      g.beginPath();
      s.pts.forEach((p, i) => {
        if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      });
      g.closePath();
      const size = Math.max(maxX - minX, maxY - minY) / 2;
      if (size < 0.4) return;
      this._fillShaded(g, s, (minX + maxX) / 2, (minY + maxY) / 2, size);
    } else if (s.kind === 'capsule') {
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const L = Math.hypot(dx, dy) || 0.001;
      const nx = -dy / L, ny = dx / L;
      const ang = Math.atan2(ny, nx);
      g.beginPath();
      g.moveTo(s.ax + nx * s.ra, s.ay + ny * s.ra);
      g.lineTo(s.bx + nx * s.rb, s.by + ny * s.rb);
      g.arc(s.bx, s.by, Math.max(0.2, s.rb), ang, ang + Math.PI, true);
      g.lineTo(s.ax - nx * s.ra, s.ay - ny * s.ra);
      g.arc(s.ax, s.ay, Math.max(0.2, s.ra), ang + Math.PI, ang, true);
      g.closePath();
      // shade across the limb: lit edge toward the upper-left
      const lit = nx * -0.6 + ny * -0.8 > 0 ? 1 : -1;
      const r = Math.max(s.ra, s.rb);
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      const gr = g.createLinearGradient(mx + nx * r * lit, my + ny * r * lit, mx - nx * r * lit, my - ny * r * lit);
      gr.addColorStop(0, tone(s.color, s.gloss ? 1.4 : 1.15));
      gr.addColorStop(0.45, s.color);
      gr.addColorStop(1, tone(s.color, 0.62));
      g.fillStyle = gr;
      g.fill();
    } else if (s.kind === 'decal') {
      const { o, px, py, img } = s;
      // affine map of the image's unit square onto the projected decal
      const ax = (px.x - o.x) * 2, ay = (px.y - o.y) * 2, bx = (o.x - py.x) * 2, by = (o.y - py.y) * 2;
      g.save();
      g.setTransform(ax / img.width, ay / img.width, bx / img.height, by / img.height, o.x - ax / 2 - bx / 2, o.y - ay / 2 - by / 2);
      g.drawImage(img, 0, 0);
      g.restore();
    }
  }
}
