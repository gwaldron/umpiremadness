// Little League (46/60) ballpark drawn in perspective.
import { clamp } from '../util.js';
import { drawFigure } from './figures.js';
import { sport, ballColor, CIRCLE_R } from '../sport.js';

const R2 = Math.SQRT1_2;
export const BASE_DIST = 60;
const B = BASE_DIST * R2; // 42.43
export const BASES = {
  home: { x: 0, y: 0 },
  first: { x: B, y: B },
  second: { x: 0, y: 2 * B },
  third: { x: -B, y: B },
};
export const BASE_LIST = [BASES.home, BASES.first, BASES.second, BASES.third];
export const RUBBER = { x: 0, y: 46 };
export const FENCE_R = 200;

// Default defensive spots
export const POS = {
  P: { x: 0, y: 44 },
  C: { x: 0, y: -2.8 },
  '1B': { x: 47, y: 54 },
  '2B': { x: 20, y: 76 },
  SS: { x: -21, y: 75 },
  '3B': { x: -46, y: 52 },
  LF: { x: -88, y: 145 },
  CF: { x: 0, y: 165 },
  RF: { x: 88, y: 145 },
};

// Two-umpire starting spots for the base umpire. On Little League's 60-ft diamond,
// B and C are OUTSIDE the baselines (behind the 1B-2B and 2B-3B lines, near second).
export const UMP_SPOTS = {
  A: { x: 52, y: 47.5, label: 'A' },
  B: { x: 21, y: 88, label: 'B' }, // behind the second baseman, by the outfield grass
  C: { x: -21, y: 88, label: 'C' },
  PU: { x: 0, y: -6.5, label: 'PU' },
};

const COLORS = {
  sky1: '#3e8fe0', sky2: '#a9d6ff',
  grass: '#3f9b3a', grassLight: '#4caf46', grassDark: '#2f7f2c',
  dirt: '#c98b52', dirtDark: '#b97a43', chalk: '#f7f7f2',
  fence: '#1f5a36', fenceTop: '#f2c230', beyond: '#2a6b31', track: '#b47a48',
};

function arcPts(cx, cy, r, a0, a1, n, z = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  return pts;
}
function circlePts(cx, cy, r, n = 24, z = 0) {
  return arcPts(cx, cy, r, 0, Math.PI * 2, n, z).slice(0, n);
}

export class FieldRenderer {
  constructor() {
    this.trees = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * 0.18 + (Math.PI * 0.64) * (i / 25) + (Math.random() - 0.5) * 0.03;
      const r = 235 + Math.random() * 40;
      this.trees.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, h: 28 + Math.random() * 22, w: 14 + Math.random() * 10, c: Math.random() < 0.5 ? '#256b2c' : '#2d7a34' });
    }
    this.scoreboardText = 'UMPIRE MADNESS';
    this.excite = 0;
    this._buildStands();
    this.checker = [];
    const s = 22;
    for (let i = -14; i <= 14; i++) {
      for (let j = 0; j <= 14; j++) {
        if ((i + j) % 2 !== 0) continue;
        // diamond cells aligned with the base paths (u = x+y, v = y-x)
        const u0 = j * s, v0 = i * s;
        const corners = [[u0, v0], [u0 + s, v0], [u0 + s, v0 + s], [u0, v0 + s]].map(([u, v]) => [(u - v) / 2, (u + v) / 2, 0]);
        const cx = (corners[0][0] + corners[2][0]) / 2, cy = (corners[0][1] + corners[2][1]) / 2;
        if (Math.hypot(cx, cy) > FENCE_R + 30) continue;
        this.checker.push(corners);
      }
    }
  }

  _buildStands() {
    const shirts = ['#d62839', '#1f5fe0', '#f4f6fa', '#ffd34d', '#2fd67b', '#ff7a1a', '#7b3fe4', '#111827', '#e85d9b', '#38bdf8'];
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a86b3c'];
    this.stands = [];
    this.crowd = [];
    for (const side of [-1, 1]) {
      const u = { x: side * R2, y: R2 }; // along the foul line
      const n = { x: side * R2, y: -R2 }; // into foul ground
      const P = (s, d) => ({ x: u.x * s + n.x * d, y: u.y * s + n.y * d });
      const s0 = 34, s1 = 112;
      for (let r = 0; r < 5; r++) {
        const d = 31 + r * 3, z = 1.2 + r * 1.4;
        this.stands.push({ side, r, quad: [P(s0, d), P(s1, d), P(s1, d + 3), P(s0, d + 3)], z, zPrev: r ? z - 1.4 : 0, d });
        for (let s = s0 + 1.2; s < s1 - 1; s += 2.1) {
          if (Math.random() < 0.28) continue;
          const p = P(s + (Math.random() - 0.5) * 0.6, d + 1.4);
          this.crowd.push({ x: p.x, y: p.y, z, shirt: shirts[(Math.random() * shirts.length) | 0], skin: skins[(Math.random() * skins.length) | 0], ph: Math.random() * 6.28, hat: Math.random() < 0.3 });
        }
      }
    }
    this.towers = [{ x: -70, y: 10 }, { x: 70, y: 10 }, { x: -150, y: 175 }, { x: 150, y: 175 }];
    this.ads = [
      { a: 0.33, text: 'UMPIRE BOOTCAMP', bg: '#0b1530', fg: '#ffd34d' },
      { a: 0.43, text: 'MAKE THE CALL', bg: '#d62839', fg: '#ffffff' },
      { a: 0.57, text: 'OWN THE FIELD', bg: '#1f5fe0', fg: '#ffffff' },
      { a: 0.67, text: 'PLAY BALL!', bg: '#ffd34d', fg: '#0b1530' },
    ];
  }

  cheer(amount = 1) {
    this.excite = Math.max(this.excite, amount);
  }

  draw(g, cam, world = {}) {
    const W = cam.w, H = cam.h;
    this.excite = Math.max(0, this.excite - 0.012);
    // Sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, COLORS.sky1);
    sky.addColorStop(0.6, COLORS.sky2);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Clouds (screen-space, parallax-free but cheap)
    this._clouds(g, cam);

    // Ground base
    cam.fillPoly(g, [[-700, -120, 0], [700, -120, 0], [700, 700, 0], [-700, 700, 0]], COLORS.beyond);
    // Field grass inside the fence (fan + foul territory)
    const fan = [[-60, -40, 0], [60, -40, 0], [FENCE_R * R2 + 30, FENCE_R * R2 - 30, 0], ...arcPts(0, 0, FENCE_R, Math.PI * 0.25, Math.PI * 0.75, 30), [-FENCE_R * R2 - 30, FENCE_R * R2 - 30, 0]];
    cam.fillPoly(g, fan, COLORS.grass);
    // Mowing pattern
    g.save();
    if (cam.polyPath(g, fan)) g.clip();
    g.fillStyle = COLORS.grassLight;
    for (const c of this.checker) {
      if (cam.polyPath(g, c)) g.fill();
    }
    g.restore();
    // Warning track
    const track = [...arcPts(0, 0, FENCE_R, Math.PI * 0.25, Math.PI * 0.75, 30), ...arcPts(0, 0, FENCE_R - 10, Math.PI * 0.75, Math.PI * 0.25, 30)];
    cam.fillPoly(g, track, COLORS.track);

    // Infield dirt: 50-ft arc around the rubber, joined to the foul lines.
    const t = 49.85;
    const a0 = Math.atan2(t - RUBBER.y, t - RUBBER.x);
    const a1 = Math.atan2(t - RUBBER.y, -t - RUBBER.x);
    const dirt = [[0, -2, 0], [t, t, 0], ...arcPts(RUBBER.x, RUBBER.y, 50, a0, a1, 32), [-t, t, 0]];
    cam.fillPoly(g, dirt, COLORS.dirt);
    // Infield grass
    const o = 4.24;
    const infieldGrass = [[0, o, 0], [38.2, B, 0], [0, 80.6, 0], [-38.2, B, 0]];
    cam.fillPoly(g, infieldGrass, COLORS.grass);
    g.save();
    if (cam.polyPath(g, infieldGrass)) {
      g.clip();
      g.fillStyle = COLORS.grassLight;
      for (const c of this.checker) if (cam.polyPath(g, c)) g.fill();
    }
    g.restore();
    // Cutouts
    cam.fillPoly(g, circlePts(0, 0, 11, 28), COLORS.dirt);
    cam.fillPoly(g, circlePts(B, B, 7, 20), COLORS.dirt);
    cam.fillPoly(g, circlePts(-B, B, 7, 20), COLORS.dirt);
    cam.fillPoly(g, circlePts(0, 2 * B, 7, 20), COLORS.dirt);
    if (sport.softball) cam.fillPoly(g, circlePts(0, sport.rubber, CIRCLE_R + 0.6, 28), COLORS.dirt);
    else cam.fillPoly(g, circlePts(RUBBER.x, RUBBER.y, 5, 20), COLORS.dirtDark);

    // Chalk
    g.strokeStyle = COLORS.chalk;
    g.lineCap = 'butt';
    const chalkW = (p) => {
      const pr = cam.project(p[0], p[1], 0);
      return pr ? Math.max(1, pr.s * 0.3) : 1;
    };
    const chalk = (a, b) => {
      // Draw long lines in pieces so width tapers with distance
      const n = 12;
      for (let i = 0; i < n; i++) {
        const p = [a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n), 0];
        const q = [a[0] + (b[0] - a[0]) * ((i + 1) / n), a[1] + (b[1] - a[1]) * ((i + 1) / n), 0];
        g.lineWidth = chalkW(p);
        if (cam.line(g, p, q)) g.stroke();
      }
    };
    // the foul lines start at the front corner of the batter's boxes, not through them
    chalk([3.7, 3.7], [FENCE_R * R2, FENCE_R * R2]);
    chalk([-3.7, 3.7], [-FENCE_R * R2, FENCE_R * R2]);
    // Running lane (last half of the way to first, 3 ft into foul ground)
    const off = 3 * R2;
    chalk([30 * R2 + off, 30 * R2 - off], [B + off, B - off]);
    chalk([30 * R2, 30 * R2], [30 * R2 + off, 30 * R2 - off]);
    // Batter's boxes (LL: 3 x 6 ft, 6 inches off the plate)
    for (const side of [-1, 1]) {
      const x0 = side * (0.708 + 0.5), x1 = side * (0.708 + 3.5);
      const box = [[x0, -2.3], [x1, -2.3], [x1, 3.7], [x0, 3.7]];
      for (let i = 0; i < 4; i++) {
        g.lineWidth = chalkW([box[i][0], box[i][1]]) * 0.7;
        if (cam.line(g, box[i], box[(i + 1) % 4])) g.stroke();
      }
    }

    // Bases
    const bag = (bx, by, rot = Math.PI / 4) => {
      const s = 0.62;
      const pts = [0, 1, 2, 3].map((i) => {
        const a = rot + (i * Math.PI) / 2;
        return [bx + Math.cos(a) * s * Math.SQRT2, by + Math.sin(a) * s * Math.SQRT2, 0.25];
      });
      cam.fillPoly(g, pts, '#ffffff');
    };
    bag(B - 0.9, B, 0);
    bag(0, 2 * B, 0);
    bag(-B + 0.9, B, 0);
    // Home plate pentagon (17 in): white top on a black rubber edge
    const pent = (k, z) => [[0, 0], [0.708, 0.706], [0.708, 1.414], [-0.708, 1.414], [-0.708, 0.706]].map(([x, y]) => [x * k, 0.75 + (y - 0.75) * k, z]);
    cam.fillPoly(g, pent(1.07, 0.01), '#1b1c21');
    cam.fillPoly(g, pent(0.97, 0.03), '#ffffff');
    // Rubber (softball: the pitcher's plate in a chalked 16-ft circle)
    if (sport.softball) {
      const ring = circlePts(0, sport.rubber, CIRCLE_R, 40);
      g.lineWidth = chalkW([0, sport.rubber]) * 0.8;
      for (let i = 0; i < ring.length; i++) if (cam.line(g, ring[i], ring[(i + 1) % ring.length])) g.stroke();
      const y = sport.rubber;
      cam.fillPoly(g, [[-1, y, 0.05], [1, y, 0.05], [1, y + 0.5, 0.05], [-1, y + 0.5, 0.05]], '#ffffff');
    } else cam.fillPoly(g, [[-1, 46, 0.4], [1, 46, 0.4], [1, 46.5, 0.4], [-1, 46.5, 0.4]], '#ffffff');

    // Fence + foul-side fences
    this._fence(g, cam);
    this._scoreboard(g, cam);
    this._standsAndCrowd(g, cam);

    // Marks in the dirt (cleat marks, where a ball hit the ground)
    if (world.scuffs) for (const s of world.scuffs) this._scuff(g, cam, s);
    // Markers on the ground (A/B/C spots, hints, rings)
    if (world.markers) for (const m of world.markers) this._marker(g, cam, m);
    if (world.paths) for (const p of world.paths) this._path(g, cam, p);

    // Sprites sorted far-to-near
    const sprites = [];
    if (world.actors) for (const a of world.actors) {
      if (a.hidden) continue;
      const c = cam.toCam(a.x, a.y, 0);
      sprites.push({ d: c.z, a });
    }
    sprites.sort((p, q) => q.d - p.d);
    // Ball shadow first
    if (world.ball && world.ball.visible !== false) this._ballShadow(g, cam, world.ball);
    for (const s of sprites) {
      if (s.a.ring) this._ring(g, cam, s.a.x, s.a.y, s.a.ring);
      drawFigure(g, cam, s.a);
    }
    if (world.ball && world.ball.visible !== false) this._ball(g, cam, world.ball);
    if (world.overlay) world.overlay(g, cam);
  }

  _clouds(g, cam) {
    const t = performance.now() / 1000;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    const hz = cam.project(0, 1500, 0);
    const hy = hz ? hz.y : cam.h * 0.2;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 0.27 + t * 0.004) % 1.2 - 0.1) * cam.w;
      const y = hy - cam.h * (0.08 + (i % 3) * 0.06);
      if (y < -40) continue;
      const r = cam.h * 0.04;
      g.beginPath();
      g.ellipse(x, y, r * 2.4, r, 0, 0, Math.PI * 2);
      g.ellipse(x + r * 1.6, y - r * 0.4, r * 1.6, r * 0.9, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  _fence(g, cam) {
    // Trees beyond the fence
    const trees = this.trees.map((tr) => ({ tr, d: cam.toCam(tr.x, tr.y, 0).z })).sort((a, b) => b.d - a.d);
    for (const { tr } of trees) {
      const p = cam.project(tr.x, tr.y, 0);
      if (!p) continue;
      g.fillStyle = '#5b3a1e';
      g.fillRect(p.x - p.s * 1.2, p.y - p.s * tr.h * 0.35, p.s * 2.4, p.s * tr.h * 0.35);
      g.fillStyle = tr.c;
      g.beginPath();
      g.ellipse(p.x, p.y - p.s * tr.h * 0.62, p.s * tr.w * 0.5, p.s * tr.h * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Outfield wall: vertical band, 6 ft
    const n = 36;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.25 + (Math.PI * 0.5) * (i / n);
      const b = Math.PI * 0.25 + (Math.PI * 0.5) * ((i + 1) / n);
      const p0 = [Math.cos(a) * FENCE_R, Math.sin(a) * FENCE_R];
      const p1 = [Math.cos(b) * FENCE_R, Math.sin(b) * FENCE_R];
      cam.fillPoly(g, [[p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], 6], [p0[0], p0[1], 6]], i % 2 ? COLORS.fence : '#225f3a');
      cam.fillPoly(g, [[p0[0], p0[1], 5.6], [p1[0], p1[1], 5.6], [p1[0], p1[1], 6.2], [p0[0], p0[1], 6.2]], COLORS.fenceTop);
    }
    this._ads(g, cam);
    this._towers(g, cam);
    // Foul pole tips
    for (const sx of [-1, 1]) {
      const px = sx * FENCE_R * R2, py = FENCE_R * R2;
      g.strokeStyle = '#ffd400';
      const p = cam.project(px, py, 0);
      if (p) {
        g.lineWidth = Math.max(1.5, p.s * 0.5);
        if (cam.line(g, [px, py, 0], [px, py, 30])) g.stroke();
      }
    }
    // Dugout-side fences parallel to the foul lines (25 ft into foul ground)
    for (const sx of [-1, 1]) {
      const pts = [];
      const off = 25 * Math.SQRT2;
      const a = [sx * 18, 18 - off];
      const b = [sx * (FENCE_R * R2 + 12), FENCE_R * R2 + 12 - off];
      for (let i = 0; i < 10; i++) {
        const p = [a[0] + (b[0] - a[0]) * (i / 10), a[1] + (b[1] - a[1]) * (i / 10)];
        const q = [a[0] + (b[0] - a[0]) * ((i + 1) / 10), a[1] + (b[1] - a[1]) * ((i + 1) / 10)];
        pts.push([p, q]);
      }
      for (const [p, q] of pts) {
        cam.fillPoly(g, [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], 4], [p[0], p[1], 4]], 'rgba(40,52,60,0.55)');
      }
      // Dugout: a low dark box tucked against the side fence
      const d0 = [sx * 30, 2 - 28], d1 = [sx * 44, 16 - 28];
      const back = (p) => [p[0] + sx * 5, p[1] - 5];
      const b0 = back(d0), b1 = back(d1);
      cam.fillPoly(g, [[b0[0], b0[1], 0], [b1[0], b1[1], 0], [b1[0], b1[1], 6.5], [b0[0], b0[1], 6.5]], '#1b2233');
      cam.fillPoly(g, [[d0[0], d0[1], 0], [d1[0], d1[1], 0], [d1[0], d1[1], 2.5], [d0[0], d0[1], 2.5]], '#3a4560');
      cam.fillPoly(g, [[d0[0], d0[1], 6.5], [d1[0], d1[1], 6.5], [b1[0], b1[1], 6.8], [b0[0], b0[1], 6.8]], sx > 0 ? '#c62f3d' : '#2f62c6');
    }
  }

  _standsAndCrowd(g, cam) {
    const t = performance.now() / 1000;
    // far side first so near rows overlap far ones
    const rows = this.stands.map((s) => ({ s, d: cam.toCam(s.quad[0].x, s.quad[0].y, 0).z })).sort((a, b) => b.d - a.d);
    for (const { s } of rows) {
      const q = s.quad;
      // riser (front face) then seat plank
      cam.fillPoly(g, [[q[0].x, q[0].y, s.zPrev], [q[1].x, q[1].y, s.zPrev], [q[1].x, q[1].y, s.z], [q[0].x, q[0].y, s.z]], '#7d8696');
      cam.fillPoly(g, [[q[0].x, q[0].y, s.z], [q[1].x, q[1].y, s.z], [q[2].x, q[2].y, s.z], [q[3].x, q[3].y, s.z]], s.r % 2 ? '#c3cad6' : '#aeb7c5');
    }
    const ex = this.excite;
    const people = this.crowd.map((p) => ({ p, d: cam.toCam(p.x, p.y, p.z).z })).filter((o) => o.d > cam.near).sort((a, b) => b.d - a.d);
    for (const { p } of people) {
      const hop = ex > 0.05 ? Math.max(0, Math.sin(t * 9 + p.ph)) * 1.4 * ex : Math.sin(t * 1.3 + p.ph) * 0.05;
      const base = cam.project(p.x, p.y, p.z + hop);
      if (!base) continue;
      const s = base.s;
      if (s < 0.5) continue;
      const bw = Math.max(1.5, 1.1 * s), bh = Math.max(2, 1.9 * s);
      g.fillStyle = p.shirt;
      g.fillRect(base.x - bw / 2, base.y - bh, bw, bh);
      g.fillStyle = p.skin;
      g.beginPath(); g.arc(base.x, base.y - bh - 0.45 * s, Math.max(1, 0.5 * s), 0, Math.PI * 2); g.fill();
      if (p.hat && s > 2) { g.fillStyle = p.shirt; g.fillRect(base.x - 0.55 * s, base.y - bh - 0.95 * s, 1.1 * s, 0.35 * s); }
      if (ex > 0.3 && s > 1.5) {
        // arms up!
        g.strokeStyle = p.skin;
        g.lineWidth = Math.max(1, 0.3 * s);
        g.beginPath();
        g.moveTo(base.x - bw / 2, base.y - bh * 0.8); g.lineTo(base.x - bw, base.y - bh - 0.9 * s);
        g.moveTo(base.x + bw / 2, base.y - bh * 0.8); g.lineTo(base.x + bw, base.y - bh - 0.9 * s);
        g.stroke();
      }
    }
  }

  _towers(g, cam) {
    for (const tw of this.towers) {
      const b = cam.project(tw.x, tw.y, 0);
      if (!b) continue;
      g.strokeStyle = '#5b6474';
      g.lineWidth = Math.max(1.5, b.s * 1.2);
      if (cam.line(g, [tw.x, tw.y, 0], [tw.x, tw.y, 70])) g.stroke();
      const top = cam.project(tw.x, tw.y, 72);
      if (!top) continue;
      const w = Math.max(6, top.s * 12), h = Math.max(4, top.s * 7);
      g.fillStyle = '#3b4252';
      g.fillRect(top.x - w / 2, top.y - h / 2, w, h);
      g.fillStyle = '#fff8d6';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        g.beginPath();
        g.arc(top.x - w / 3 + (i * w) / 3, top.y - h / 4 + (j * h) / 2, Math.max(1, w * 0.1), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  _ads(g, cam) {
    for (const ad of this.ads) {
      const a0 = Math.PI * (ad.a - 0.05), a1 = Math.PI * (ad.a + 0.05);
      // note: angles measured from +x; fence fan runs 0.25π..0.75π
      const p0 = [Math.cos(a1) * (FENCE_R - 0.3), Math.sin(a1) * (FENCE_R - 0.3)];
      const p1 = [Math.cos(a0) * (FENCE_R - 0.3), Math.sin(a0) * (FENCE_R - 0.3)];
      if (!cam.polyPath(g, [[p0[0], p0[1], 0.6], [p1[0], p1[1], 0.6], [p1[0], p1[1], 5.2], [p0[0], p0[1], 5.2]])) continue;
      g.fillStyle = ad.bg;
      g.fill();
      const pa = cam.project(p0[0], p0[1], 2.9), pb = cam.project(p1[0], p1[1], 2.9);
      if (!pa || !pb) continue;
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const size = Math.min((pa.s + pb.s) * 0.5 * 3.2, len / (ad.text.length * 0.62));
      if (size < 4) continue;
      g.save();
      g.translate((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
      g.rotate(Math.atan2(pb.y - pa.y, pb.x - pa.x));
      g.fillStyle = ad.fg;
      g.font = `${size}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ad.text, 0, 0);
      g.restore();
    }
  }

  _scoreboard(g, cam) {
    const x0 = -150, y0 = 240, w = 54, z0 = 14, h = 20;
    const a = [x0, y0, z0], b = [x0 + w * 0.8, y0 + w * 0.6, z0];
    // posts
    g.strokeStyle = '#3b3f48';
    const pp = cam.project(x0 + 6, y0 + 4, 0);
    if (pp) {
      g.lineWidth = Math.max(1, pp.s * 1.5);
      if (cam.line(g, [x0 + 6, y0 + 4, 0], [x0 + 6, y0 + 4, z0])) g.stroke();
      if (cam.line(g, [b[0] - 6, b[1] - 4, 0], [b[0] - 6, b[1] - 4, z0])) g.stroke();
    }
    if (!cam.polyPath(g, [a, b, [b[0], b[1], z0 + h], [a[0], a[1], z0 + h]])) return;
    g.fillStyle = '#10213f';
    g.fill();
    g.strokeStyle = '#f2c230';
    g.lineWidth = 2;
    g.stroke();
    const pa = cam.project(a[0], a[1], z0 + h * 0.5), pb = cam.project(b[0], b[1], z0 + h * 0.5);
    if (pa && pb) {
      const size = Math.max(6, (pa.s + pb.s) * 0.5 * 5.2);
      g.save();
      g.translate((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
      g.rotate(Math.atan2(pb.y - pa.y, pb.x - pa.x));
      g.fillStyle = '#ffd34d';
      g.font = `${size}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(this.scoreboardText, 0, 0);
      g.restore();
    }
  }

  _scuff(g, cam, s) {
    const rx = s.r * (s.sx || 1), ry = s.r * (s.sy || 1), c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, u = Math.cos(a) * rx, v = Math.sin(a) * ry;
      pts.push([s.x + u * c - v * sn, s.y + u * sn + v * c, 0.04]);
    }
    if (!cam.polyPath(g, pts)) return;
    g.fillStyle = `rgba(62,36,14,${(s.a ?? 0.85) * 0.85})`;
    g.fill();
  }

  // A dotted path on the ground (where the umpire went, or the track to follow)
  _path(g, cam, path) {
    const pts = path.pts || [];
    if (pts.length < 2) return;
    const gap = path.gap ?? 0.8;
    g.fillStyle = path.color || '#ffffff';
    g.globalAlpha = 0.7;
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = carry; d <= L; d += gap) {
        const k = L > 0 ? d / L : 0;
        const p = cam.project(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 0.05);
        if (!p) continue;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(1.5, (path.r ?? 0.2) * p.s), 0, Math.PI * 2);
        g.fill();
        carry = d + gap - L;
      }
    }
    g.globalAlpha = 1;
  }

  _marker(g, cam, m) {
    if (m.poly) {
      // a highlighted band on the ground (e.g. the B/C start zones)
      if (!cam.polyPath(g, m.poly.map((p) => [p.x, p.y, 0.05]))) return;
      g.fillStyle = 'rgba(255,211,77,0.2)';
      g.fill();
      g.lineWidth = m.width || 2.5;
      g.strokeStyle = m.color || 'rgba(255,211,77,0.95)';
      if (m.dash) g.setLineDash(m.dash);
      g.stroke();
      g.setLineDash([]);
      if (m.label) {
        const cx = m.poly.reduce((s, p) => s + p.x, 0) / m.poly.length, cy = m.poly.reduce((s, p) => s + p.y, 0) / m.poly.length;
        const p = cam.project(cx, cy, 0);
        if (p) {
          g.fillStyle = m.color || '#fff';
          g.font = `${clamp(p.s * 3.2, 11, cam.h * 0.032)}px Bungee, Impact, sans-serif`; // (capped: a close-up would blow it up)
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(m.label, p.x, p.y);
        }
      }
      return;
    }
    const pts = circlePts(m.x, m.y, m.r || 3, 24, 0.05);
    if (!cam.polyPath(g, pts)) return;
    g.lineWidth = m.width || 2.5;
    g.strokeStyle = m.color || 'rgba(255,255,255,0.85)';
    if (m.dash) g.setLineDash(m.dash);
    g.stroke();
    g.setLineDash([]);
    if (m.fill) {
      g.fillStyle = m.fill;
      g.fill();
    }
    if (m.label) {
      const p = cam.project(m.x, m.y, 0);
      if (p) {
        g.fillStyle = m.color || '#fff';
        g.font = `${clamp(p.s * 3.2, 11, cam.h * 0.032)}px Bungee, Impact, sans-serif`; // (capped: a close-up would blow it up)
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(m.label, p.x, p.y);
      }
    }
  }

  _ring(g, cam, x, y, ring) {
    const pulse = 1 + 0.12 * Math.sin(performance.now() / 160);
    const pts = circlePts(x, y, 2.4 * pulse, 24, 0.05);
    if (!cam.polyPath(g, pts)) return;
    g.lineWidth = 3;
    g.strokeStyle = ring === true ? '#ffd34d' : ring;
    g.stroke();
    g.fillStyle = 'rgba(255,211,77,0.18)';
    g.fill();
  }

  _ballShadow(g, cam, b) {
    const p = cam.project(b.x, b.y, 0);
    if (!p) return;
    const r = Math.max(1.5, p.s * 0.35) * (1 / (1 + (b.z || 0) * 0.02));
    g.fillStyle = `rgba(0,0,0,${0.35 / (1 + (b.z || 0) * 0.03)})`;
    g.beginPath();
    g.ellipse(p.x, p.y, r * 1.4, r * 0.6, 0, 0, Math.PI * 2);
    g.fill();
  }

  _ball(g, cam, b) {
    // Trail
    if (b.trail && b.trail.length > 1) {
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineCap = 'round';
      for (let i = 1; i < b.trail.length; i++) {
        const p = cam.project(b.trail[i - 1].x, b.trail[i - 1].y, b.trail[i - 1].z);
        const q = cam.project(b.trail[i].x, b.trail[i].y, b.trail[i].z);
        if (!p || !q) continue;
        g.lineWidth = Math.max(1, q.s * 0.25) * (i / b.trail.length);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
      }
    }
    const p = cam.project(b.x, b.y, b.z || 0);
    if (!p) return;
    const r = Math.max(2.6, p.s * 0.2 * (sport.softball ? 1.3 : 1));
    g.fillStyle = sport.softball ? ballColor() : '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    if (r > 5) {
      g.strokeStyle = '#d0302f';
      g.lineWidth = Math.max(1, r * 0.12);
      g.beginPath(); g.arc(p.x - r * 0.9, p.y, r * 0.75, -0.9, 0.9); g.stroke();
      g.beginPath(); g.arc(p.x + r * 0.9, p.y, r * 0.75, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
    }
  }
}
