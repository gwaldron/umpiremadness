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

// Outline of all skinned (dirt) areas, appended to the current path.
function dirtPathInto(g) {
  const t = 49.85;
  const a0 = Math.atan2(t - 46, t), a1 = Math.atan2(t - 46, -t);
  g.moveTo(0, -3);
  g.lineTo(t, t);
  g.arc(0, 46, 50, a0, a1);
  g.lineTo(-t, t);
  g.closePath();
}

// ---------- The ballfield, painted top-down in world feet ----------
// region: { x0, x1, y0, y1 }, ppf: pixels per foot
// opts.softball: no mound (the pitching circle is its own mesh, so it can move between 35 and 40 ft)
export function paintField(region, ppf, detail = 1, opts = {}) {
  const W = Math.round((region.x1 - region.x0) * ppf);
  const H = Math.round((region.y1 - region.y0) * ppf);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // world → canvas (flip y so +y is up)
  g.setTransform(ppf, 0, 0, -ppf, -region.x0 * ppf, region.y1 * ppf);
  const rnd = mulberry(1234 + Math.round(ppf));
  const px = 1 / ppf; // one pixel in feet

  // --- grass everywhere ---
  g.fillStyle = '#3d9a3a';
  g.fillRect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);
  // mowing pattern: diamonds aligned with the baselines
  const s = 20;
  g.save();
  for (let i = -30; i <= 30; i++) {
    for (let j = -10; j <= 30; j++) {
      if ((i + j) % 2 !== 0) continue;
      const u0 = j * s, v0 = i * s;
      const pts = [[u0, v0], [u0 + s, v0], [u0 + s, v0 + s], [u0, v0 + s]].map(([u, v]) => [(u - v) / 2, (u + v) / 2]);
      const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
      if (cx < region.x0 - s || cx > region.x1 + s || cy < region.y0 - s || cy > region.y1 + s) continue;
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = 'rgba(120,200,90,0.16)';
      g.fill();
    }
  }
  g.restore();

  // --- beyond the fence: darker rough grass ---
  g.save();
  g.beginPath();
  g.rect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);
  g.moveTo(0, 0);
  g.arc(0, 0, 200, Math.PI * 0.25, Math.PI * 0.75);
  g.closePath();
  g.restore();

  // --- warning track ---
  g.beginPath();
  g.arc(0, 0, 200.5, Math.PI * 0.22, Math.PI * 0.78);
  g.arc(0, 0, 190, Math.PI * 0.78, Math.PI * 0.22, true);
  g.closePath();
  g.fillStyle = '#b77d4a';
  g.fill();

  // --- infield dirt (50-ft arc around the rubber, joined to the foul lines) ---
  const dirt = '#c98a50';
  const t = 49.85;
  const a0 = Math.atan2(t - 46, t), a1 = Math.atan2(t - 46, -t);
  const dirtPath = () => {
    g.beginPath();
    g.moveTo(0, -3);
    g.lineTo(t, t);
    g.arc(0, 46, 50, a0, a1);
    g.lineTo(-t, t);
    g.closePath();
  };
  dirtPath();
  g.fillStyle = dirt;
  g.fill();
  // lip where grass meets dirt
  g.lineWidth = 0.9;
  g.strokeStyle = 'rgba(90,70,30,0.35)';
  g.stroke();

  // --- infield grass with base cutouts ---
  const o = 4.24;
  g.save();
  g.beginPath();
  g.moveTo(0, o); g.lineTo(38.2, B); g.lineTo(0, 80.6); g.lineTo(-38.2, B); g.closePath();
  g.fillStyle = '#3d9a3a';
  g.fill();
  g.clip();
  for (let i = -6; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      if ((i + j) % 2 !== 0) continue;
      const u0 = j * s, v0 = i * s;
      const pts = [[u0, v0], [u0 + s, v0], [u0 + s, v0 + s], [u0, v0 + s]].map(([u, v]) => [(u - v) / 2, (u + v) / 2]);
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = 'rgba(120,200,90,0.16)';
      g.fill();
    }
  }
  g.restore();
  g.beginPath();
  g.moveTo(0, o); g.lineTo(38.2, B); g.lineTo(0, 80.6); g.lineTo(-38.2, B); g.closePath();
  g.lineWidth = 0.7;
  g.strokeStyle = 'rgba(90,70,30,0.3)';
  g.stroke();

  const circ = (x, y, r, fill, lip = true) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    if (lip) { g.lineWidth = 0.6; g.strokeStyle = 'rgba(90,70,30,0.3)'; g.stroke(); }
  };
  circ(0, 0, 11, dirt);
  circ(B, B, 7, dirt);
  circ(-B, B, 7, dirt);
  circ(0, 2 * B, 7, dirt);
  if (!opts.softball) circ(0, 46, 6, '#c27f45');

  // --- dirt texture: clumps and specks, density scaled to this texture's resolution ---
  const fine = Math.min(16, Math.max(1, ppf / 4));
  const bx0 = Math.max(region.x0, -55), bx1 = Math.min(region.x1, 55);
  const by0 = Math.max(region.y0, -12), by1 = Math.min(region.y1, 100);
  const dirtArea = Math.max(0, bx1 - bx0) * Math.max(0, by1 - by0);
  const dirtSpots = Math.min(60000, Math.round(dirtArea * 0.75 * fine * detail));
  g.save();
  dirtPath();
  g.clip();
  for (let i = 0; i < dirtSpots; i++) {
    const x = bx0 + rnd() * (bx1 - bx0), y = by0 + rnd() * (by1 - by0);
    const r = ((0.08 + rnd() * 0.35) / Math.sqrt(fine)) * (rnd() < 0.05 ? 3 : 1);
    g.fillStyle = rnd() < 0.5 ? 'rgba(120,80,40,0.18)' : 'rgba(235,190,140,0.16)';
    g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  // worn paths from the mound and around the bases
  for (const [x, y, r] of [...(opts.softball ? [] : [[0, 46, 4]]), [B - 1, B, 4], [-B + 1, B, 4], [0, 2 * B - 1, 4], [0, -1, 6]]) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(110,70,35,0.25)');
    gr.addColorStop(1, 'rgba(110,70,35,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.restore();

  // --- grass blades / speckles (kept off the dirt) ---
  const area = (region.x1 - region.x0) * (region.y1 - region.y0);
  const grassSpots = Math.min(70000, Math.round(area * 0.18 * fine * detail));
  g.save();
  g.beginPath();
  g.rect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);
  dirtPathInto(g);
  g.clip('evenodd');
  const blade = Math.max(px, 0.35 / Math.sqrt(fine));
  for (let i = 0; i < grassSpots; i++) {
    const x = region.x0 + rnd() * (region.x1 - region.x0), y = region.y0 + rnd() * (region.y1 - region.y0);
    g.fillStyle = rnd() < 0.5 ? 'rgba(20,70,20,0.12)' : 'rgba(170,230,120,0.08)';
    g.fillRect(x, y, blade, blade * 2.2);
  }
  g.restore();

  // --- chalk ---
  g.strokeStyle = '#f8f8f2';
  g.lineCap = 'butt';
  const line = (x0, y0, x1, y1, w = 0.3) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  line(0.8, 0.8, 200 * R2, 200 * R2);
  line(-0.8, 0.8, -200 * R2, 200 * R2);
  // running lane: last 30 ft to first, 3 ft into foul ground
  const off = 3 * R2;
  line(30 * R2 + off, 30 * R2 - off, B + off, B - off, 0.25);
  line(30 * R2, 30 * R2, 30 * R2 + off, 30 * R2 - off, 0.25);
  // batter's boxes (LL: 3 x 6 ft, 6 in off the plate)
  for (const side of [-1, 1]) {
    const x0 = side * (0.708 + 0.5), x1 = side * (0.708 + 3.5);
    g.lineWidth = 0.22;
    g.strokeRect(Math.min(x0, x1), -2.3, Math.abs(x1 - x0), 6);
  }
  // catcher's box
  g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(-1.6, -2.3); g.lineTo(-1.6, -8); g.lineTo(1.6, -8); g.lineTo(1.6, -2.3); g.stroke();
  // coach's boxes
  for (const sx of [-1, 1]) {
    const cx = sx * (B + 8), cy = B - 8;
    g.lineWidth = 0.2;
    g.setLineDash([1, 0.8]);
    g.strokeRect(cx - (sx > 0 ? 0 : 4), cy - 6, 4, 10);
    g.setLineDash([]);
  }
  // on-deck circles
  for (const sx of [-1, 1]) {
    g.beginPath(); g.arc(sx * 22, -14, 2.5, 0, Math.PI * 2);
    g.fillStyle = '#c98a50'; g.fill();
    g.lineWidth = 0.2; g.strokeStyle = '#f8f8f2'; g.stroke();
  }

  // --- texture noise overlay ---
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.18;
  g.globalCompositeOperation = 'overlay';
  const pat = g.createPattern(noiseTile(), 'repeat');
  g.fillStyle = pat;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
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
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
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
  const rnd = mulberry(77);
  const layer = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgb(128,128,128)';
    g.fillRect(0, 0, size, size);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save();
      g.translate(ox, oy);
      draw(g, mulberry(5));
      g.restore();
    }
    return g.getImageData(0, 0, size, size).data;
  };
  const grass = layer((g, r) => {
    for (let i = 0; i < 2600; i++) {
      const x = r() * size, y = r() * size, len = 6 + r() * 14, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      const v = r() < 0.5 ? 70 + r() * 40 : 170 + r() * 60;
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 1 + r() * 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  });
  const dirt = layer((g, r) => {
    for (let i = 0; i < 5000; i++) {
      const x = r() * size, y = r() * size, rr = 0.6 + r() * 1.8;
      const v = r() < 0.5 ? 85 + r() * 40 : 160 + r() * 55;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 90; i++) {
      const x = r() * size, y = r() * size, rr = 2 + r() * 4;
      g.fillStyle = 'rgb(205,200,195)';
      g.beginPath(); g.ellipse(x, y, rr, rr * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgb(80,70,60)';
      g.beginPath(); g.ellipse(x + 1, y + 1.2, rr * 0.9, rr * 0.4, r() * 3, 0, Math.PI * 2); g.fill();
    }
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

// Patch a Lambert material so it multiplies in the tiling ground detail.
export function addGroundDetail(material, detail, { scale = 0.45, strength = 0.42 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.uniforms.detailScale = { value: scale };
    shader.uniforms.detailStrength = { value: strength };
    shader.vertexShader = 'varying vec2 vDetailPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vDetailPos = (modelMatrix * vec4(position, 1.0)).xy;'
    );
    shader.fragmentShader = 'varying vec2 vDetailPos;\nuniform sampler2D detailMap;\nuniform float detailScale;\nuniform float detailStrength;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    vec3 dt = texture2D(detailMap, vDetailPos * detailScale).rgb;
    float grassy = clamp((diffuseColor.g - diffuseColor.r) * 7.0 + 0.45, 0.0, 1.0);
    float d = mix(dt.g, dt.r, grassy);
    diffuseColor.rgb *= mix(1.0, d * 2.0, detailStrength);
  }`
    );
  };
  material.customProgramCacheKey = () => 'ground-detail';
  return material;
}
