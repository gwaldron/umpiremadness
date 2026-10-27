// Small math + misc helpers shared by every module.
import { txt } from './sport.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Game randomness goes through rng(), which a session can seed so a play can be replayed exactly.
let rng = Math.random;
export function setRng(fn) { rng = fn || Math.random; }
export function withRng(fn, body) {
  const prev = rng;
  rng = fn;
  try { return body(); } finally { rng = prev; }
}
export const newSeed = () => (Math.random() * 4294967296) >>> 0;
// mulberry32
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a = 0, b = 1) => a + rng() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(rng() * arr.length)];
export const chance = (p) => rng() < p;
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function weighted(entries) {
  // entries: [[value, weight], ...]
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

// 2D vectors as {x, y}
export const v2 = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const perp = (a) => ({ x: -a.y, y: a.x });
export const lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Distance from point p to segment ab, plus the parameter t of the closest point.
export function segDist(p, a, b) {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  const c = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { d: dist(p, c), t };
}

export function fmtInches(feet) {
  const inches = Math.abs(feet) * 12;
  return inches < 1 ? inches.toFixed(1) : inches.toFixed(1);
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tiny **bold** markdown for explanation text.
// Markdown-ish **bold**; in softball, he/him/his read she/her
export function mini(s) {
  return escapeHtml(txt(s)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export const BOOTCAMP = 'https://umpirebootcamp.gwaldron.workers.dev/';
// lessons live on the course page; the site root is the Bootcamp / Umpire Madness landing page
export const lessonUrl = (id) => (id ? `${BOOTCAMP}bootcamp#${id}` : BOOTCAMP);

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
