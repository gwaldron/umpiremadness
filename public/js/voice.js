// Voices: the umpire (you), the stadium PA announcer, and a hype TV commentator.
// Lines are pre-rendered clips (scripts/render-vo.py, Kokoro neural TTS) played through WebAudio:
// the umpire on the field, the PA through a horn speaker with stadium echo, the commentator "on TV".
// Batter intros are stitched from pieces like real sports games. Anything without a clip falls back
// to the browser's speech engine.
import { audio } from './audio.js';
import { sport, txt } from './sport.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const NUM = ['oh', 'one', 'two', 'three', 'four'];
const VO = 'audio/vo/';

const FIRST = ['Jayden', 'Maya', 'Luis', 'Ava', 'Marcus', 'Sofia', 'Tyler', 'Zoe', 'Diego', 'Emma', 'Caleb', 'Aaliyah', 'Ethan', 'Isabella', 'Noah', 'Mia', 'Jackson', 'Priya', 'Mateo', 'Harper', 'Darius', 'Lily', 'Kenji', 'Olivia', 'Brayden', 'Chloe', 'Andre', 'Grace', 'Owen', 'Leah', 'Javier', 'Nora', 'Malik', 'Ella', 'Ryan', 'Hana'];
const LAST = ['Rivera', 'Johnson', 'Kim', 'Okafor', 'Smith', 'Garcia', 'Nguyen', 'Brooks', 'Patel', 'Martinez', 'Walker', 'Chen', 'Robinson', 'Lopez', 'Murphy', 'Hughes', 'Rossi', 'Bennett', 'Diaz', 'Foster', 'Silva', 'Jensen', 'Ortiz', 'Carter', 'Tanaka', 'Reyes', 'Coleman', 'Park', 'Sullivan', 'Gomez'];
// Softball rosters are girls (every name here already has a PA clip)
const GIRLS = FIRST.filter((n) => ['Maya', 'Ava', 'Sofia', 'Zoe', 'Emma', 'Aaliyah', 'Isabella', 'Mia', 'Priya', 'Harper', 'Lily', 'Olivia', 'Chloe', 'Grace', 'Leah', 'Nora', 'Ella', 'Hana'].includes(n));
export function playerName() {
  return { first: pick(sport.softball ? GIRLS : FIRST), last: pick(LAST) };
}

// Spoken situation rulings (situations.js "say") -> clip groups
const SAY = {
  "Infield fly! Batter's out!": 'u.iff',
  "That's obstruction!": 'u.obstruction',
  "Time! That's obstruction!": 'u.timeObstruction',
  'Foul ball!': 'u.foul',
  "That's a catch! He's out!": 'u.catchOut',
  "That's a catch! She's out!": 'u.catchOutSb',
  'No catch!': 'u.noCatch1',
  "He's out!": 'u.out',
  "She's out!": 'u.outSb',
  'Safe!': 'u.safe',
};

const COMMENTS = {
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
};

class Voices {
  constructor() {
    this.enabled = true;
    this.extras = true; // announcer + commentator
    this.style = 'classic';
    this.lastComment = 0;
    this.cache = null;
    this.man = null; // clip manifest
    this.bufs = new Map(); // file -> AudioBuffer | Promise
    this.playing = { u: [], pa: [], b: [], c: [], f: [] };
    this.chains = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => { this.cache = null; };
    }
  }

  // ---------- clips ----------
  // Load the manifest and preload every clip in the background (umpire calls first).
  warm() {
    if (this._warm || typeof fetch === 'undefined') return this._warm;
    this._warm = fetch(VO + 'manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        this.man = m;
        if (m && audio.ctx) {
          // umpire calls first, then the crowd's cheers and groans, then everything else
          const rank = (g) => (g[0] === 'u' ? 0 : g === 'crowd.cheer' || g === 'crowd.groan' ? 1 : 2);
          const groups = Object.keys(m).sort((a, b) => rank(a) - rank(b));
          (async () => {
            for (const g of groups) for (const c of m[g]) { try { await this._load(c.f); } catch (e) { /* skip */ } }
          })();
        }
        return m;
      })
      .catch(() => null);
    return this._warm;
  }

  _load(f) {
    let b = this.bufs.get(f);
    if (!b) {
      b = fetch(VO + f)
        .then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => audio.ctx.decodeAudioData(ab, res, rej)))
        .then((buf) => { this.bufs.set(f, buf); return buf; });
      b.catch(() => this.bufs.delete(f));
      this.bufs.set(f, b);
    }
    return Promise.resolve(b);
  }

  // Effects chain per role, built once the audio context exists.
  _chain(role) {
    const ctx = audio.ctx;
    if (!this.chains) this.chains = {};
    if (this.chains[role]) return this.chains[role];
    const input = ctx.createGain();
    let tail = input;
    const add = (node) => { tail.connect(node); tail = node; return node; };
    if (role === 'pa') {
      // horn-speaker tone, a touch of grit, then a stadium slapback echo
      const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 260;
      const lp = add(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 5200;
      const pk = add(ctx.createBiquadFilter()); pk.type = 'peaking'; pk.frequency.value = 1900; pk.Q.value = 0.9; pk.gain.value = 6;
      const sh = add(ctx.createWaveShaper());
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
      sh.curve = curve;
      const out = add(ctx.createGain()); out.gain.value = 0.85;
      out.connect(audio.master);
      const dl = ctx.createDelay(1); dl.delayTime.value = 0.26;
      const fb = ctx.createGain(); fb.gain.value = 0.3;
      const dlv = ctx.createGain(); dlv.gain.value = 0.38;
      out.connect(dl); dl.connect(fb).connect(dl); dl.connect(dlv).connect(audio.master);
      const send = ctx.createGain(); send.gain.value = 0.75;
      out.connect(send).connect(audio.reverbIn);
    } else if (role === 'c') {
      // TV: clean, tight and close — no stadium reverb
      const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 110;
      const pk = add(ctx.createBiquadFilter()); pk.type = 'peaking'; pk.frequency.value = 3200; pk.gain.value = 3;
      const comp = add(ctx.createDynamicsCompressor()); comp.threshold.value = -20; comp.ratio.value = 3;
      const out = add(ctx.createGain()); out.gain.value = 0.95;
      out.connect(audio.master);
    } else {
      // the umpire on the field: present, with a little ballpark air (the sfx bus has a reverb send)
      const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 90;
      const pk = add(ctx.createBiquadFilter()); pk.type = 'peaking'; pk.frequency.value = 2800; pk.gain.value = 3.5;
      const out = add(ctx.createGain()); out.gain.value = 1.15;
      out.connect(audio.sfx);
    }
    this.chains[role] = input;
    return input;
  }

  // Play a sequence of clip groups. seq: [group | { g: group, gap }]. Returns false if clips can't be used.
  async _play(role, seq, { interrupt = true, rate = 1, robot = false } = {}) {
    if (!audio.ctx || !this.man || !seq.length) return false;
    const items = seq.map((s) => (typeof s === 'string' ? { g: s, gap: 0.06 } : s));
    const chosen = [];
    for (const it of items) {
      const list = this.man[it.g];
      if (!list) return false;
      chosen.push({ c: pick(list), gap: it.gap ?? 0.06 });
    }
    let bufs;
    try { bufs = await Promise.all(chosen.map((x) => this._load(x.c.f))); } catch (e) { return false; }
    const ctx = audio.ctx;
    if (interrupt) this.stop(role);
    let dest = this._chain(role);
    const rb = robot ? this._robot(dest) : null;
    if (rb) dest = rb.ring;
    let t = ctx.currentTime + 0.03;
    const t0 = t;
    for (let i = 0; i < bufs.length; i++) {
      const src = ctx.createBufferSource();
      src.buffer = bufs[i];
      src.playbackRate.value = rate;
      src.connect(dest);
      src.start(t);
      this.playing[role].push(src);
      src.onended = () => { const p = this.playing[role]; const k = p.indexOf(src); if (k >= 0) p.splice(k, 1); };
      t += bufs[i].duration / rate + chosen[i].gap;
    }
    if (rb) rb.osc.stop(t + 0.3);
    if (role !== 'u') this._duck(t0, t);
    return true;
  }

  stop(role) {
    for (const s of this.playing[role]) { try { s.stop(); } catch (e) { /* already stopped */ } }
    this.playing[role] = [];
  }

  // Robo-Ump: ring modulator
  _robot(dest) {
    const ctx = audio.ctx;
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 55;
    osc.connect(ring.gain);
    osc.start();
    ring.connect(dest);
    return { ring, osc };
  }

  // Lower the crowd under the PA and commentary
  _duck(t0, t1) {
    const g = audio.crowdBus && audio.crowdBus.gain;
    if (!g) return;
    g.cancelScheduledValues(t0);
    g.setTargetAtTime(0.5, t0, 0.08);
    g.setTargetAtTime(0.9, t1 + 0.1, 0.4);
  }

  // ---------- browser speech fallback ----------
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

  // Try clips first; fall back to the browser voice.
  async _say(role, seq, fallback, opts = {}) {
    this.warm();
    if (this._warm) await this._warm;
    const ok = await this._play(role, seq, opts).catch(() => false);
    if (!ok && fallback) {
      const tts = {
        u: ['ump', { ...this._umpStyle(), interrupt: true }],
        pa: ['announcer', { rate: 0.9, pitch: 0.8, volume: 0.95 }],
        c: ['commentator', { rate: 1.12, pitch: 1.05, volume: 0.9 }],
      }[role];
      this._speak(fallback, tts[0], tts[1]);
    }
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
  _clipStyle(fast) {
    const r = { classic: 1, bigleague: 0.88, hype: 1.1, robot: 1 }[this.style] || 1;
    return { rate: r * (fast ? 1.05 : 1), robot: this.style === 'robot' };
  }
  ump(text, opts = {}) {
    if (!this.enabled || !text) return;
    text = txt(text);
    const g = SAY[text];
    if (g) this._say('u', [g], text, this._clipStyle(opts.fast));
    else this._speak(text, 'ump', { ...this._umpStyle(), interrupt: true });
  }

  // Context-aware calls. kind: strike | ball | k | bb | out | safe | foul | tip | hbp | iff | nocatch | play
  call(kind, ctx = {}) {
    if (!this.enabled) return;
    const hasCount = ctx.balls !== undefined;
    const sayCount = hasCount && Math.random() < 0.45;
    const countG = hasCount ? `u.count.${Math.min(3, ctx.balls)}${Math.min(2, ctx.strikes)}` : null;
    const countTxt = hasCount ? ` ${NUM[ctx.balls] || ctx.balls} and ${NUM[ctx.strikes] || ctx.strikes}.` : '';
    const map = {
      strike: ['u.strike', 'Strike!', true],
      ball: ['u.ball', 'Ball.', true],
      k: [sport.softball ? 'u.kSb' : 'u.k', 'Strike three!'],
      bb: ['u.bb', 'Ball four! Take your base!'],
      out: [(ctx.close ? 'u.outClose' : 'u.out') + (sport.softball ? 'Sb' : ''), txt("He's out!")],
      safe: [(ctx.close ? 'u.safeClose' : 'u.safe') + (sport.softball ? 'Sb' : ''), 'Safe!'],
      // safe, and why
      offBag: [sport.softball ? 'u.offBagSb' : 'u.offBag', txt("Safe! He's off the bag!")],
      ballDown: ['u.ballDown', "Safe! Ball's on the ground!"],
      foul: ['u.foul', 'Foul ball!'],
      tip: ['u.tip', 'Foul tip! Strike!'],
      hbp: ['u.hbp', 'Time! Take your base!'],
      iff: ['u.iff', "Infield fly! Batter's out!"],
      nocatch: ['u.nocatch', 'No catch! No catch!'],
      play: ['u.play', 'Play ball!'],
    }[kind];
    if (!map) { this.ump(kind, { fast: ctx.close }); return; }
    const [g, line, counts] = map;
    const seq = [{ g, gap: 0.14 }];
    if (counts && sayCount && countG) seq.push(countG);
    this._say('u', seq, line + (counts && sayCount ? countTxt : ''), this._clipStyle(ctx.close || ctx.fast));
  }

  // ---------- stadium PA ----------
  // seq: clip groups to stitch; text: what to say if there are no clips
  announce(text, { chime = true, seq = null } = {}) {
    if (!this.enabled || !this.extras || !text) return;
    if (chime) audio.paChime();
    setTimeout(() => this._say('pa', seq || [], seq ? text : text), chime ? 650 : 0);
  }
  batter(b) {
    if (!b.name) return;
    const intro = pick(['nowBatting', 'nowBatting', 'steppingIn', 'upNext']);
    const seq = [{ g: 'pa.' + intro, gap: 0.22 }];
    if (intro !== 'upNext') seq.push({ g: `pa.num.${b.num}`, gap: 0.32 });
    seq.push({ g: `pa.first.${b.name.first}`, gap: 0.09 }, `pa.last.${b.name.last}`);
    const text = intro === 'upNext' ? `Up next... ${b.name.first}... ${b.name.last}!` : `${intro === 'nowBatting' ? 'Now batting' : 'Stepping in'}... number ${b.num}... ${b.name.first} ${b.name.last}!`;
    this.announce(text, { chime: Math.random() < 0.5, seq });
  }
  // Start-of-session PA intro. mode: career | camp | blitz | plate | bases | rumble | ...
  modeIntro(mode, title, umpName) {
    if (mode === 'career') this.announce(`Ladies and gentlemen... welcome to ${title}! Your umpire today... ${umpName}!`, { seq: [{ g: 'pa.welcome', gap: 0.45 }, 'pa.yourUmp'] });
    else if (mode === 'camp') this.announce(`Welcome to ${title}! Let's go, ${umpName}!`, { seq: [{ g: 'pa.welcome', gap: 0.45 }, 'pa.camp'] });
    else if (mode === 'blitz') this.announce('Sixty seconds on the clock... GO!', { seq: ['pa.blitz'] });
    else if (['plate', 'bases', 'rumble'].includes(mode)) this.announce(`It's ${title}! Let's go, ${umpName}!`, { seq: [`pa.mode.${mode}`] });
    else this.announce(`It's ${title}! Let's go, ${umpName}!`, { seq: ['pa.letsGo'] });
  }
  gameIntro(title, umpName) { this.modeIntro('career', title, umpName); }

  // ---------- the crowd ----------
  // Pre-rendered fan shouts layered with random timing, pitch (some kids) and pan into a crowd in the
  // stands, through a little air and the stadium reverb. Returns how many shouts actually played.
  _crowdIn() {
    if (this._crowdNode) return this._crowdNode;
    const ctx = audio.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    lp.connect(hp).connect(audio.crowdBus);
    this._crowdNode = lp;
    return lp;
  }
  crowd(group, { n = 6, spread = 0.5, gain = 0.5, rate = [0.95, 1.3], when = 0 } = {}) {
    if (!audio.ctx || !audio.ok || !this.man || !this.man[group]) return 0;
    const ctx = audio.ctx;
    const list = this.man[group];
    const dest = this._crowdIn();
    const t0 = ctx.currentTime + 0.02 + when;
    let played = 0;
    for (let i = 0; i < n; i++) {
      const c = list[Math.floor(Math.random() * list.length)];
      const buf = this.bufs.get(c.f);
      if (!(buf instanceof AudioBuffer)) { this._load(c.f).catch(() => {}); continue; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate[0] + Math.random() * (rate[1] - rate[0]);
      const g = ctx.createGain();
      g.gain.value = gain * (0.45 + Math.random() * 0.55);
      src.connect(g);
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.6 - 0.8;
        g.connect(pan).connect(dest);
      } else g.connect(dest);
      src.start(t0 + Math.random() * spread);
      played++;
    }
    return played;
  }
  // a cheer for a good call (k: 0.3 small, 1 big, 1.3 huge)
  cheer(k = 1) {
    return this.crowd('crowd.cheer', { n: Math.round(4 + 9 * k), gain: 0.3 + 0.22 * k, spread: 0.35 + 0.3 * k, rate: [1.0, 1.35] });
  }
  groan(k = 1) {
    return this.crowd('crowd.groan', { n: Math.round(3 + 6 * k), gain: 0.34, spread: 0.45, rate: [0.95, 1.25] });
  }
  // Little League chatter from the stands while the game is on ("Hey batter batter!")
  startChatter(active = () => true) {
    if (this._chatter) return;
    const tick = () => {
      this._chatter = setTimeout(tick, 1400 + Math.random() * 2600);
      if (active() && Math.random() < 0.8) this.crowd(Math.random() < 0.15 ? (sport.softball ? 'crowd.chatterSb' : 'crowd.chatterBb') : 'crowd.chatter', { n: Math.random() < 0.25 ? 2 : 1, gain: 0.2, spread: 0.6, rate: [0.97, 1.3] });
    };
    this._chatter = setTimeout(tick, 1500);
  }
  stopChatter() {
    clearTimeout(this._chatter);
    this._chatter = null;
  }

  // ---------- the batter ----------
  // A pitch hits the batter and they yell. Uses rendered batter clips (b.ouch) when there are some;
  // until then, the "Ouch!" from the start of the commentator's line, pitched up and played on the field.
  async ouch() {
    if (!this.enabled) return;
    this.warm();
    if (this._warm) await this._warm;
    if (await this._play('b', ['b.ouch'], { rate: 1 + Math.random() * 0.12 }).catch(() => false)) return;
    const c = this.man && audio.ctx && (this.man['c.ouch'] || []).find((x) => /^ouch!/i.test(x.t));
    if (c) {
      try {
        const buf = await this._load(c.f);
        const ctx = audio.ctx;
        const rate = 1.16 + Math.random() * 0.08;
        const len = 0.45; // "Ouch!" ends here, before "Right in the lane!"
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const g = ctx.createGain();
        const t0 = ctx.currentTime + 0.01, end = t0 + len / rate;
        g.gain.setValueAtTime(1.2, t0);
        g.gain.setValueAtTime(1.2, end - 0.04);
        g.gain.linearRampToValueAtTime(0, end);
        src.connect(g).connect(this._chain('b'));
        src.start(t0, 0, len);
        return;
      } catch (e) { /* fall back to the browser voice */ }
    }
    this._speak('Ouch!', 'batter', { rate: 1.15, pitch: 1.7 });
  }

  // ---------- the fielders ----------
  // A runner takes off and the infielders holler "He's going!" (softball: "She's going!"), like they do
  // in a real game. Sometimes a second one joins in a beat later.
  async going(echo = true) {
    if (!this.enabled || typeof window === 'undefined') return; // (the content check runs plays outside a browser)
    this.warm();
    if (this._warm) await this._warm;
    const g = sport.softball ? 'f.goingSb' : 'f.going';
    const ok = await this._play('f', [g], { interrupt: false, rate: 1.05 + Math.random() * 0.12 }).catch(() => false);
    if (!ok) { this._speak(txt("He's going!"), 'fielder', { rate: 1.2, pitch: 1.5 }); return; }
    if (echo && Math.random() < 0.55) setTimeout(() => this.going(false), 260 + Math.random() * 220);
  }

  // ---------- TV commentator (short hype lines, never spammy) ----------
  comment(kind, { force = false } = {}) {
    if (!this.enabled || !this.extras) return;
    const now = performance.now();
    if (!force && now - this.lastComment < 9000) return;
    if (!force && Math.random() < 0.35) return;
    const lines = COMMENTS[kind];
    if (!lines) return;
    this.lastComment = now;
    setTimeout(() => this._say('c', ['c.' + kind], pick(lines)), 450);
  }
}

export const voices = new Voices();
