// Stick-and-blob ballplayers drawn as billboards in the 3D field.
// Each pose returns joint positions in feet for a 5-ft figure.
//   x = forward (side view) or screen-right (front view), z = up.

export const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a86b3c', '#d9a066'];

export const KITS = {
  def: { jersey: '#f4f6fa', trim: '#1f5fe0', pants: '#c3c9d4', cap: '#1f5fe0', shade: '#d5dae3' },
  off: { jersey: '#d62839', trim: '#8c0f1d', pants: '#eef0f3', cap: '#a3121f', helmet: true, shade: '#a81d2c' },
  ump: { jersey: '#1d2b53', trim: '#0d1530', pants: '#7d838f', cap: '#141414', shade: '#141d3a' },
  coach: { jersey: '#d62839', trim: '#8c0f1d', pants: '#2b2f38', cap: '#a3121f', shade: '#a81d2c' },
};

export const UMP_SHIRTS = {
  navy: '#1d2b53', powder: '#7fb2e5', black: '#16181d', red: '#b3202e', purple: '#5b2a86',
  green: '#25a244', gold: '#d4a017', pink: '#e0569b', orange: '#ef7d1a',
};
export const UMP_CAPS = { black: '#141414', navy: '#16224a', red: '#9e1b28', gold: '#c8961a', white: '#eef0f3', camo: '#56613f' };

const TAU = Math.PI * 2;

function legIK(hip, a1, a2, L1 = 1.1, L2 = 1.35) {
  const knee = [hip[0] + Math.sin(a1) * L1, hip[1] - Math.cos(a1) * L1];
  const foot = [knee[0] + Math.sin(a2) * L2, knee[1] - Math.cos(a2) * L2];
  return [knee, foot];
}
function armIK(sh, a1, a2, L1 = 0.75, L2 = 0.7) {
  const elbow = [sh[0] + Math.sin(a1) * L1, sh[1] - Math.cos(a1) * L1];
  const hand = [elbow[0] + Math.sin(a2) * L2, elbow[1] - Math.cos(a2) * L2];
  return [elbow, hand];
}

// ---- Side-view poses (x is "forward") ----
const SIDE = {
  stand() {
    const hip = [0, 2.45], neck = [0.05, 3.95];
    return { hip, neck, head: [0.1, 4.45], kneeF: [0.12, 1.35], footF: [0.25, 0], kneeB: [-0.1, 1.35], footB: [-0.2, 0], elbowF: [0.2, 3.2], handF: [0.3, 2.5], elbowB: [-0.15, 3.2], handB: [-0.1, 2.5] };
  },
  run(p) {
    const s = Math.sin(p * TAU), c = Math.cos(p * TAU);
    const hip = [0, 2.3 + 0.1 * Math.abs(c)];
    const neck = [0.45, 3.75 + 0.1 * Math.abs(c)];
    const [kneeF, footF] = legIK(hip, 0.8 * s, 0.8 * s - 0.4 - 0.9 * Math.max(0, -s));
    const [kneeB, footB] = legIK(hip, -0.8 * s, -0.8 * s - 0.4 - 0.9 * Math.max(0, s));
    const [elbowF, handF] = armIK(neck, -0.9 * s, -0.9 * s + 1.5);
    const [elbowB, handB] = armIK(neck, 0.9 * s, 0.9 * s + 1.5);
    const low = Math.min(footF[1], footB[1]);
    const J = { hip, neck, head: [0.6, 4.22 + 0.1 * Math.abs(c)], kneeF, footF, kneeB, footB, elbowF, handF, elbowB, handB };
    if (low < 0) for (const k in J) J[k] = [J[k][0], J[k][1] - low];
    return J;
  },
  slide() {
    return { hip: [0, 0.55], neck: [-1.35, 1.25], head: [-1.7, 1.6], kneeF: [0.95, 0.5], footF: [2.0, 0.25], kneeB: [0.6, 0.2], footB: [-0.1, 0.15], elbowF: [-1.0, 1.8], handF: [-0.7, 2.4], elbowB: [-1.6, 1.8], handB: [-1.3, 2.4] };
  },
  dive() {
    return { hip: [0, 0.55], neck: [1.35, 0.65], head: [1.8, 0.75], kneeF: [-1.0, 0.45], footF: [-2.0, 0.5], kneeB: [-0.95, 0.3], footB: [-1.9, 0.25], elbowF: [2.0, 0.65], handF: [2.6, 0.55], elbowB: [1.9, 0.75], handB: [2.5, 0.7] };
  },
  reach() {
    return { hip: [0.35, 1.9], neck: [1.25, 3.0], head: [1.6, 3.35], kneeF: [1.15, 0.95], footF: [1.75, 0], kneeB: [-0.25, 1.1], footB: [-0.75, 0], elbowF: [1.95, 3.0], handF: [2.65, 3.0], elbowB: [1.7, 2.6], handB: [2.1, 2.3] };
  },
  tag() {
    return { hip: [-0.15, 1.6], neck: [0.65, 2.85], head: [0.95, 3.2], kneeF: [0.55, 0.9], footF: [0.55, 0], kneeB: [-0.6, 0.85], footB: [-0.75, 0], elbowF: [1.0, 1.6], handF: [1.35, 0.55], elbowB: [0.95, 2.0], handB: [1.1, 1.2] };
  },
  throw(p) {
    const t = Math.min(1, p);
    const a = -2.6 + t * 4.2;
    const neck = [0.1 + 0.4 * t, 3.85];
    const [elbowB, handB] = armIK(neck, a, a + 0.3 * (1 - t));
    return { hip: [0.1 * t, 2.3], neck, head: [0.2 + 0.4 * t, 4.33], kneeF: [0.7, 1.1], footF: [1.2, 0], kneeB: [-0.6, 1.2], footB: [-1.0, 0], elbowF: [0.9, 3.6], handF: [1.1, 3.0], elbowB, handB };
  },
  bat(p = 0) {
    // p: 0 stance, 0..1 swing
    const hip = [0, 2.2], neck = [-0.05 + 0.25 * p, 3.75];
    const hands = p <= 0 ? [-0.5, 3.55] : [-0.5 + p * 1.4, 3.55 - p * 0.8];
    return { hip, neck, head: [0.05 + 0.2 * p, 4.25], kneeF: [0.7, 1.2], footF: [0.95, 0], kneeB: [-0.7, 1.2], footB: [-0.95, 0], elbowF: [0.0, 3.0], handF: hands, elbowB: [-0.7, 3.2], handB: hands, bat: true, batAngle: p <= 0 ? -0.5 : -0.5 + p * 3.6 };
  },
};

// ---- Front-view poses (x is screen-right) ----
const FRONT = {
  stand() {
    return { hip: [0, 2.45], neck: [0, 3.95], head: [0, 4.45], kneeF: [0.3, 1.35], footF: [0.38, 0], kneeB: [-0.3, 1.35], footB: [-0.38, 0], elbowF: [0.62, 3.2], handF: [0.7, 2.5], elbowB: [-0.62, 3.2], handB: [-0.7, 2.5] };
  },
  ready() {
    return { hip: [0, 1.95], neck: [0, 3.35], head: [0, 3.85], kneeF: [0.75, 1.1], footF: [0.85, 0], kneeB: [-0.75, 1.1], footB: [-0.85, 0], elbowF: [0.6, 2.4], handF: [0.35, 1.6], elbowB: [-0.6, 2.4], handB: [-0.35, 1.6] };
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
  catchHigh() {
    return { ...FRONT.stand(), elbowF: [0.55, 4.6], handF: [0.35, 5.35], elbowB: [-0.55, 4.6], handB: [-0.25, 5.25] };
  },
  catcher() {
    return { hip: [0, 1.2], neck: [0, 2.6], head: [0, 3.05], kneeF: [0.85, 1.15], footF: [0.75, 0], kneeB: [-0.85, 1.15], footB: [-0.75, 0], elbowF: [0.55, 2.0], handF: [0.3, 2.1], elbowB: [-0.75, 1.9], handB: [-0.7, 1.4] };
  },
  pitch(p) {
    // Wind-up seen from the plate: knee lift, stride, release, follow-through.
    const S = FRONT.stand();
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
