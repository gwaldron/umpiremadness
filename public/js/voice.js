// Voices: the umpire (you), the stadium PA announcer, and a hype TV commentator.
// Uses the browser's speech engine, picking the most natural-sounding voices available
// (Edge "Natural"/"Online" voices, Google voices, Apple enhanced voices, ...).
import { audio } from './audio.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const NUM = ['oh', 'one', 'two', 'three', 'four'];

const FIRST = ['Jayden', 'Maya', 'Luis', 'Ava', 'Marcus', 'Sofia', 'Tyler', 'Zoe', 'Diego', 'Emma', 'Caleb', 'Aaliyah', 'Ethan', 'Isabella', 'Noah', 'Mia', 'Jackson', 'Priya', 'Mateo', 'Harper', 'Darius', 'Lily', 'Kenji', 'Olivia', 'Brayden', 'Chloe', 'Andre', 'Grace', 'Owen', 'Leah', 'Javier', 'Nora', 'Malik', 'Ella', 'Ryan', 'Hana'];
const LAST = ['Rivera', 'Johnson', 'Kim', 'Okafor', 'Smith', 'Garcia', 'Nguyen', 'Brooks', 'Patel', 'Martinez', 'Walker', 'Chen', 'Robinson', 'Lopez', 'Murphy', 'Hughes', 'Rossi', 'Bennett', 'Diaz', 'Foster', 'Silva', 'Jensen', 'Ortiz', 'Carter', 'Tanaka', 'Reyes', 'Coleman', 'Park', 'Sullivan', 'Gomez'];
export function playerName() {
  return { first: pick(FIRST), last: pick(LAST) };
}

class Voices {
  constructor() {
    this.enabled = true;
    this.extras = true; // announcer + commentator
    this.style = 'classic';
    this.lastComment = 0;
    this.cache = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => { this.cache = null; };
    }
  }

  get ok() {
    return 'speechSynthesis' in window && audio.ctx && audio.sfxVol > 0;
  }

  // Rank the device's voices for a role.
  _voice(role) {
    if (!('speechSynthesis' in window)) return null;
    if (!this.cache) this.cache = {};
    if (this.cache[role] !== undefined) return this.cache[role];
    const vs = window.speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    const male = /(guy|davis|andrew|brian|christopher|eric|roger|steffan|tony|ryan|daniel|alex|fred|david|mark|george|thomas|aaron|arthur|oliver|male)/i;
    const female = /(aria|jenny|michelle|ana|emma|sonia|libby|samantha|karen|moira|tessa|zira|susan|hazel|female|ava|allison)/i;
    const want = { ump: { male: 1, us: 1 }, announcer: { male: 1, deep: 1 }, commentator: { male: 0.5, us: 1 } }[role] || {};
    const used = new Set(Object.values(this.cache).filter(Boolean).map((v) => v.name));
    let best = null, bs = -1e9;
    for (const v of vs) {
      let s = 0;
      if (/natural|neural/i.test(v.name)) s += 60;
      if (/online/i.test(v.name)) s += 25;
      if (/google/i.test(v.name)) s += 30;
      if (/enhanced|premium/i.test(v.name)) s += 25;
      if (/en[-_]US/i.test(v.lang) && want.us) s += 10;
      if (male.test(v.name)) s += 15 * (want.male || 0);
      if (female.test(v.name)) s -= 5 * (want.male || 0);
      if (role === 'announcer' && /(UK|GB|Andrew|Brian|Daniel|George)/i.test(v.name + v.lang)) s += 12;
      if (used.has(v.name)) s -= 20; // give each role its own voice when possible
      if (v.localService === false) s += 3;
      if (s > bs) { bs = s; best = v; }
    }
    this.cache[role] = best;
    return best;
  }

  _speak(text, role, { rate = 1, pitch = 1, interrupt = false, volume = 1 } = {}) {
    if (!this.enabled || !('speechSynthesis' in window) || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = this._voice(role);
      if (v) u.voice = v;
      u.rate = rate;
      u.pitch = pitch;
      u.volume = Math.min(1, audio.sfxVol * volume + 0.15);
      if (interrupt) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech is optional */ }
  }

  // ---------- the umpire (you) ----------
  _umpStyle() {
    return {
      classic: { rate: 1.05, pitch: 0.9 },
      bigleague: { rate: 0.85, pitch: 0.6 },
      robot: { rate: 1.2, pitch: 0.1 },
      hype: { rate: 1.25, pitch: 1.3 },
    }[this.style] || { rate: 1.05, pitch: 0.9 };
  }
  ump(text, opts = {}) {
    const s = this._umpStyle();
    this._speak(text, 'ump', { rate: s.rate * (opts.fast ? 1.12 : 1), pitch: s.pitch, interrupt: true });
  }

  // Context-aware calls. kind: strike | ball | k | bb | out | safe | foul | tip | hbp | iff | nocatch | play
  call(kind, ctx = {}) {
    if (!this.enabled) return;
    const count = ctx.balls !== undefined ? `${NUM[ctx.balls] || ctx.balls} and ${NUM[ctx.strikes] || ctx.strikes}` : '';
    const sayCount = count && Math.random() < 0.45;
    let line;
    switch (kind) {
      case 'strike': line = pick(['Strike!', 'Steee-rike!', 'Strike!', 'Strike!']) + (sayCount ? ` ${count}.` : ''); break;
      case 'ball': line = pick(['Ball.', 'Ball.', "That's a ball."]) + (sayCount ? ` ${count}.` : ''); break;
      case 'k': line = pick(['Strike three!', 'Steee-rike three!', "Strike three! You're out!", 'Strike three! Ring him up!']); break;
      case 'bb': line = 'Ball four! Take your base!'; break;
      case 'out': line = ctx.close ? pick(["He's OUT!", 'OUT! He is out!', "Ohhh, he's out!"]) : pick(["He's out!", 'Out!', "Yer out!"]); break;
      case 'safe': line = ctx.close ? pick(['Safe! Safe!', "He's SAFE!", 'Safe, safe, safe!']) : pick(['Safe!', "He's safe!"]); break;
      case 'foul': line = 'Foul ball!'; break;
      case 'tip': line = pick(['Foul tip! Strike!', 'Tipped! Strike!']); break;
      case 'hbp': line = 'Time! Take your base!'; break;
      case 'iff': line = "Infield fly! Batter's out!"; break;
      case 'nocatch': line = 'No catch! No catch!'; break;
      case 'play': line = pick(['Play ball!', "Let's play!", 'Play!']); break;
      default: line = kind;
    }
    this.ump(line, { fast: ctx.close });
  }

  // ---------- stadium PA ----------
  announce(text, { chime = true } = {}) {
    if (!this.enabled || !this.extras || !text) return;
    if (chime) audio.paChime();
    setTimeout(() => this._speak(text, 'announcer', { rate: 0.9, pitch: 0.8, volume: 0.95 }), chime ? 650 : 0);
  }
  batter(b) {
    if (!b.name) return;
    this.announce(pick([
      `Now batting... number ${b.num}... ${b.name.first} ${b.name.last}!`,
      `Stepping in... number ${b.num}, ${b.name.first} ${b.name.last}!`,
      `Up next... ${b.name.first}... ${b.name.last}!`,
    ]), { chime: Math.random() < 0.5 });
  }
  gameIntro(title, umpName) {
    this.announce(pick([
      `Ladies and gentlemen... welcome to ${title}! Your umpire today... ${umpName}!`,
      `It's ${title}! Give it up for your umpire... ${umpName}!`,
    ]));
  }

  // ---------- TV commentator (short hype lines, never spammy) ----------
  comment(kind, { force = false } = {}) {
    if (!this.enabled || !this.extras) return;
    const now = performance.now();
    if (!force && now - this.lastComment < 9000) return;
    if (!force && Math.random() < 0.35) return;
    const lines = {
      bangGood: ['Bang-bang play... and the ump NAILS it!', 'What a call!', 'Perfect angle. Perfect call!', 'Oh, that was close... and the ump got it!'],
      painted: ['Right on the black! Great eye!', 'Painted corner, and the ump saw it!', 'Ooh, nasty pitch. Great call!'],
      angle: ['Look at that positioning!', 'That ump was in the perfect spot!'],
      streak5: ['The ump is heating up!', 'Five in a row!'],
      streak10: ['This ump is ON FIRE!', 'Somebody call the fire department!'],
      streak20: ['Is this ump a robot?!', 'Unbelievable! Twenty straight!'],
      miss: ["Ooh, the replay doesn't agree...", 'Everybody misses one!', 'Shake it off, Blue!', "That one's going on the blooper reel!"],
      quick: ['Whoa, too quick on the trigger!', 'Patience, Blue!'],
      ouch: ['Ouch! Right in the lane!', 'That had to hurt!'],
      ejected: ["And that's an ejection! See you next time, Blue!"],
      champion: ['WORLD SERIES CHAMPION UMPIRE!'],
    }[kind];
    if (!lines) return;
    this.lastComment = now;
    setTimeout(() => this._speak(pick(lines), 'commentator', { rate: 1.12, pitch: 1.05, volume: 0.9 }), 450);
  }
}

export const voices = new Voices();
