// Profile, settings, and progression — saved in localStorage on this device.
import { todayKey, pick, randInt } from './util.js';

const KEY = 'umpire-madness.v1';

export const RANKS = [
  [1, 'Rookie Blue'], [3, 'Sandlot Ump'], [5, 'Little League Ump'], [7, 'Plate Boss'],
  [10, 'Zone Wizard'], [13, 'Diamond Judge'], [16, 'All-Star Ump'], [20, 'Williamsport Crew'], [25, 'Hall of Fame Blue'],
];

export function xpForLevel(n) {
  return 125 * (n - 1) * n;
}
export function levelFromXp(xp) {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n++;
  return n;
}
export function rankFor(level) {
  let r = RANKS[0][1];
  for (const [lv, name] of RANKS) if (level >= lv) r = name;
  return r;
}

// Unlockable gear: shirts and caps.
export const SHIRT_UNLOCKS = [
  { id: 'navy', name: 'League Navy', level: 1 },
  { id: 'powder', name: 'Powder Blue', level: 2 },
  { id: 'black', name: 'Midnight Black', level: 4 },
  { id: 'red', name: 'Cardinal Red', level: 6 },
  { id: 'purple', name: 'Royal Purple', level: 8 },
  { id: 'green', name: 'Turf Green', level: 10 },
  { id: 'pink', name: 'Hot Pink', level: 12 },
  { id: 'orange', name: 'Blaze Orange', level: 15 },
  { id: 'gold', name: 'Champion Gold', ach: 'champion' },
];
export const CAP_UNLOCKS = [
  { id: 'black', name: 'Classic Black', level: 1 },
  { id: 'navy', name: 'Navy', level: 1 },
  { id: 'red', name: 'Red', level: 5 },
  { id: 'white', name: 'White', level: 9 },
  { id: 'camo', name: 'Camo', level: 14 },
  { id: 'gold', name: 'Gold Crown', ach: 'champion' },
];

const ADJ = ['Captain', 'Thunder', 'Turbo', 'Iron', 'Steady', 'Golden', 'Rocket', 'Cosmic', 'Mighty', 'Fearless', 'Lightning', 'Eagle-Eye', 'Big Time', 'Silent', 'Hustle', 'Blue', 'Ice Cold', 'Sir', 'Atomic', 'Laser'];
const NOUN = ['Zone', 'Hammer', 'Punchout', 'Rulebook', 'Brush', 'Mask', 'Diamond', 'Indicator', 'Wall', 'Hawk', 'Whistle', 'Thumb', 'Blue', 'Strike', 'Clicker', 'Chalk', 'Slot', 'Signal', 'Gavel', 'Radar'];
export function randomName() {
  const a = pick(ADJ);
  let n = pick(NOUN);
  while (n === a) n = pick(NOUN);
  return Math.random() < 0.35 ? `${a} ${n} ${randInt(2, 99)}` : `${a} ${n}`;
}
export const NAME_PARTS = { ADJ, NOUN };

function defaults() {
  return {
    v: 1,
    name: null,
    created: Date.now(),
    xp: 0,
    look: { shirt: 'navy', cap: 'black', skin: 1 },
    settings: { volume: 0.8, voice: true, music: true, voiceStyle: 'classic', hints: 'auto', shake: true },
    career: {},
    best: { blitz: 0, plate: 0, bases: 0, rumble: 0 },
    stats: {
      calls: 0, correct: 0,
      pitch: 0, pitchOk: 0, base: 0, baseOk: 0, sit: 0, sitOk: 0, life: 0, lifeOk: 0,
      perfectTiming: 0, early: 0, painted: 0, framedFoiled: 0, bangBang: 0, angleA: 0, startOk: 0,
      maxStreak: 0, strikeThrees: 0, games: 0, perfectGames: 0, threeStars: 0, dpBoth: 0, ouch: 0,
      slotOk: 0, cardsRead: 0, gamepad: 0, lockerChanged: 0, days: [], dayStreak: 0, ejections: 0,
      catTotals: {},
    },
    cards: {},
    achievements: {},
    seenIntro: false,
  };
}

function merge(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  for (const k of Object.keys(saved)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) {
      base[k] = merge(base[k], saved[k]);
    } else {
      base[k] = saved[k];
    }
  }
  return base;
}

export function loadProfile() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) { saved = null; }
  return merge(defaults(), saved);
}

export function saveProfile(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (e) { /* storage may be unavailable (private mode) */ }
}

export function resetProfile() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return defaults();
}

// Track daily play streaks.
export function touchDay(p) {
  const today = todayKey();
  const days = p.stats.days || [];
  if (days[days.length - 1] === today) return;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = todayKey(y);
  p.stats.dayStreak = days[days.length - 1] === yesterday ? (p.stats.dayStreak || 1) + 1 : 1;
  days.push(today);
  p.stats.days = days.slice(-30);
}

export function careerStars(p, divId = null) {
  let n = 0;
  for (const [k, v] of Object.entries(p.career)) {
    if (divId && !k.startsWith(divId + '-')) continue;
    n += v.stars || 0;
  }
  return n;
}
