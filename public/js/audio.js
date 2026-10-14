// All sound is synthesized with WebAudio — no audio files to download or license.
// Signal flow: voices → (sfx | crowd | music) buses → master → compressor → speakers,
// with a shared "stadium" convolution reverb send.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.8;
    this.musicOn = true;
    this.voiceOn = true;
    this.voiceStyle = 'classic';
    this.crowd = null;
    this.musicPlaying = null;
    this.wantMusic = null;
    this._voices = null;
  }

  // ---------- setup ----------
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.sfxVol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // stadium reverb: stereo noise impulse with an exponential tail
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverbIn.connect(this.reverb).connect(wet).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.35;
    this.sfx.connect(this.sfxSend).connect(this.reverbIn);

    this.crowdBus = ctx.createGain();
    this.crowdBus.gain.value = 0.9;
    this.crowdBus.connect(this.master);
    const cs = ctx.createGain();
    cs.gain.value = 0.25;
    this.crowdBus.connect(cs).connect(this.reverbIn);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
    this.musicBus.connect(this.master);
    const ms = ctx.createGain();
    ms.gain.value = 0.18;
    this.musicBus.connect(ms).connect(this.reverbIn);

    // noise buffers
    const n = ctx.sampleRate * 2;
    this._white = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this._white.getChannelData(0);
    for (let i = 0; i < n; i++) w[i] = Math.random() * 2 - 1;
    this._pink = ctx.createBuffer(1, n, ctx.sampleRate);
    const pk = this._pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
      pk[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    if (this.wantMusic) this.music(this.wantMusic);
  }

  setVolume(v) {
    this.sfxVol = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.1);
  }

  get ok() {
    return !!this.ctx && this.sfxVol > 0;
  }
  get now() {
    return this.ctx.currentTime;
  }

  // ---------- building blocks ----------
  _env(param, t0, a, peak, d, curve = 'exp') {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + a);
    if (curve === 'exp') param.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    else param.linearRampToValueAtTime(0.0001, t0 + a + d);
  }

  _noise({ when = 0, dur = 0.1, type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.002, pink = false, out = null, freqEnd = null, rate = 1 }) {
    if (!this.ok) return;
    const t0 = this.now + when;
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this._pink : this._white;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + attack + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g.gain, t0, attack, peak, dur);
    src.connect(f).connect(g).connect(out || this.sfx);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + attack + dur + 0.05);
  }

  _tone({ when = 0, freq = 440, dur = 0.15, type = 'sine', peak = 0.3, attack = 0.004, slideTo = null, out = null, detune = 0 }) {
    if (!this.ok) return;
    const t0 = this.now + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + attack + dur);
    const g = this.ctx.createGain();
    this._env(g.gain, t0, attack, peak, dur);
    o.connect(g).connect(out || this.sfx);
    o.start(t0);
    o.stop(t0 + attack + dur + 0.05);
  }

  // ---------- ballpark sounds ----------
  crack() {
    // Bat on ball: hard transient + ringing wood partials + a low thump.
    this._noise({ dur: 0.012, type: 'highpass', freq: 1800, q: 0.7, peak: 1.0, attack: 0.0005 });
    this._noise({ dur: 0.05, type: 'bandpass', freq: 2600, q: 2.5, peak: 0.45, attack: 0.001 });
    for (const [f, d, a] of [[540, 0.09, 0.5], [1210, 0.06, 0.35], [2380, 0.035, 0.22], [3900, 0.02, 0.12]]) {
      this._tone({ freq: f, dur: d, type: 'sine', peak: a, attack: 0.0008, slideTo: f * 0.97 });
    }
    this._tone({ freq: 140, dur: 0.07, type: 'sine', peak: 0.55, attack: 0.001, slideTo: 70 });
  }
  pop() {
    // Ball into leather: deep thump + leather slap + a little snap.
    this._tone({ freq: 95, dur: 0.09, type: 'sine', peak: 0.9, attack: 0.001, slideTo: 55 });
    this._noise({ dur: 0.045, type: 'bandpass', freq: 1100, q: 1.4, peak: 0.85, attack: 0.001 });
    this._noise({ dur: 0.012, type: 'highpass', freq: 3500, q: 0.8, peak: 0.4, attack: 0.0005 });
  }
  tick() {
    // foul tip / glove clip
    this._noise({ dur: 0.02, type: 'highpass', freq: 3000, q: 1, peak: 0.6, attack: 0.0005 });
    this._tone({ freq: 3400, dur: 0.03, type: 'triangle', peak: 0.15, attack: 0.0005, slideTo: 2600 });
  }
  thud() {
    this._noise({ dur: 0.14, type: 'lowpass', freq: 320, q: 1, peak: 1.0, attack: 0.002 });
    this._tone({ freq: 75, dur: 0.11, type: 'sine', peak: 0.5, attack: 0.001, slideTo: 45 });
    this._noise({ dur: 0.08, type: 'bandpass', freq: 900, q: 0.8, peak: 0.25, attack: 0.002, pink: true });
  }
  slide() {
    // dirt scrape with gravel crackle
    this._noise({ dur: 0.55, type: 'bandpass', freq: 1400, freqEnd: 500, q: 0.7, peak: 0.5, attack: 0.03, pink: true });
    for (let i = 0; i < 9; i++) this._noise({ when: Math.random() * 0.45, dur: 0.012, type: 'highpass', freq: 2500, peak: 0.25 * Math.random(), attack: 0.001 });
  }
  whoosh(dur = 0.5) {
    if (!this.ok) return;
    const t0 = this.now;
    const src = this.ctx.createBufferSource();
    src.buffer = this._white;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(500, t0);
    f.frequency.exponentialRampToValueAtTime(2600, t0 + dur * 0.8);
    f.frequency.exponentialRampToValueAtTime(900, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.08);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.1);
  }
  swing() {
    this._noise({ dur: 0.16, type: 'bandpass', freq: 600, freqEnd: 1800, q: 1.2, peak: 0.3, attack: 0.04 });
  }
  ouch() {
    // cartoon BONK
    this._tone({ freq: 720, dur: 0.22, type: 'square', peak: 0.12, attack: 0.002, slideTo: 160 });
    this._tone({ freq: 980, dur: 0.12, type: 'sine', peak: 0.25, attack: 0.001, slideTo: 300 });
    this._noise({ dur: 0.06, type: 'bandpass', freq: 1300, q: 1, peak: 0.6, attack: 0.001 });
  }

  // ---------- UI sounds ----------
  blip() {
    this._tone({ freq: 1320, dur: 0.035, type: 'sine', peak: 0.08 });
    this._tone({ freq: 2640, dur: 0.02, type: 'sine', peak: 0.03 });
  }
  select() {
    this._tone({ freq: 880, dur: 0.06, type: 'triangle', peak: 0.13 });
    this._tone({ freq: 1320, dur: 0.1, type: 'triangle', peak: 0.12, when: 0.045 });
  }
  back() {
    this._tone({ freq: 660, dur: 0.07, type: 'triangle', peak: 0.12, slideTo: 440 });
  }
  _bell(freq, when, peak = 0.16, dur = 0.5) {
    this._tone({ freq, dur, type: 'sine', peak, when, attack: 0.002 });
    this._tone({ freq: freq * 2.76, dur: dur * 0.4, type: 'sine', peak: peak * 0.35, when, attack: 0.002 });
    this._tone({ freq: freq * 5.4, dur: dur * 0.15, type: 'sine', peak: peak * 0.15, when, attack: 0.001 });
  }
  correct() {
    this._bell(midi(84), 0, 0.14, 0.4);
    this._bell(midi(91), 0.07, 0.14, 0.6);
  }
  wrong() {
    // sad trombone-ish "bwomp"
    if (!this.ok) return;
    const t0 = this.now;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(130, t0 + 0.45);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1600, t0);
    f.frequency.exponentialRampToValueAtTime(300, t0 + 0.45);
    const g = this.ctx.createGain();
    this._env(g.gain, t0, 0.02, 0.18, 0.45);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t0);
    o.stop(t0 + 0.55);
  }
  _brass(freq, when, dur, peak = 0.12) {
    if (!this.ok) return;
    const t0 = this.now + when;
    for (const det of [-7, 0, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq * 1.5, t0);
      f.frequency.linearRampToValueAtTime(freq * 6, t0 + 0.06);
      f.frequency.exponentialRampToValueAtTime(freq * 2.5, t0 + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak / 3, t0 + 0.03);
      g.gain.setValueAtTime(peak / 3, t0 + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }
  achievement() {
    [60, 64, 67, 72].forEach((n, i) => this._brass(midi(n + 12), i * 0.08, 0.16));
    this._brass(midi(84), 0.34, 0.6, 0.14);
    this._bell(midi(96), 0.34, 0.08, 0.8);
  }
  levelUp() {
    const seq = [[67, 0, 0.12], [72, 0.12, 0.12], [76, 0.24, 0.12], [79, 0.36, 0.28], [76, 0.62, 0.12], [79, 0.74, 0.5]];
    for (const [n, w, d] of seq) this._brass(midi(n), w, d, 0.14);
  }
  streak(level) {
    const base = midi(72 + Math.min(level, 6) * 2);
    this._bell(base, 0, 0.1, 0.25);
    this._bell(base * 1.5, 0.06, 0.1, 0.3);
  }
  countdown() {
    this._tone({ freq: 1400, dur: 0.07, type: 'sine', peak: 0.16 });
  }
  stamp() {
    this._tone({ freq: 90, dur: 0.12, type: 'sine', peak: 0.5, slideTo: 50 });
    this._noise({ dur: 0.05, type: 'lowpass', freq: 800, peak: 0.3 });
  }

  // ---------- the crowd ----------
  _crowdVoices({ when = 0, dur = 1.2, base = 200, formants = [[400, 4], [900, 6]], peak = 0.2, glide = 1.0, n = 7, attack = 0.25 }) {
    // A pile of detuned sawtooth "voices" through vowel formant filters = a crowd going "oooh" / "booo"
    if (!this.ok) return;
    const t0 = this.now + when;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const mix = this.ctx.createGain();
    mix.gain.value = 1 / n;
    for (const [fq, q] of formants) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = fq;
      f.Q.value = q;
      mix.connect(f).connect(g);
    }
    g.connect(this.crowdBus);
    for (let i = 0; i < n; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = base * (0.75 + Math.random() * 0.6);
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.linearRampToValueAtTime(f0 * glide, t0 + dur * 0.5);
      o.frequency.linearRampToValueAtTime(f0 * (glide > 1 ? 0.92 : glide * 0.95), t0 + dur);
      const vib = this.ctx.createOscillator();
      vib.frequency.value = 4 + Math.random() * 3;
      const vg = this.ctx.createGain();
      vg.gain.value = f0 * 0.02;
      vib.connect(vg).connect(o.frequency);
      o.connect(mix);
      o.start(t0 + Math.random() * 0.08);
      o.stop(t0 + dur + 0.1);
      vib.start(t0);
      vib.stop(t0 + dur + 0.1);
    }
  }
  _claps(count, span, when = 0, peak = 0.35) {
    for (let i = 0; i < count; i++) {
      const w = when + Math.random() * span;
      this._noise({ when: w, dur: 0.018, type: 'bandpass', freq: 1200 + Math.random() * 1600, q: 1.2, peak: peak * (0.4 + Math.random() * 0.6), attack: 0.0008, out: this.crowdBus });
    }
  }
  cheer(intensity = 1) {
    if (!this.ok) return;
    const k = Math.min(1.5, intensity);
    this._noise({ dur: 1.6 * k, type: 'bandpass', freq: 900, q: 0.6, peak: 0.28 * k, attack: 0.2, pink: true, out: this.crowdBus });
    this._noise({ dur: 1.3 * k, type: 'bandpass', freq: 2200, q: 0.9, peak: 0.12 * k, attack: 0.15, out: this.crowdBus });
    this._crowdVoices({ dur: 1.4 * k, base: 260, formants: [[700, 3], [1200, 4]], peak: 0.12 * k, glide: 1.12, attack: 0.15 });
    this._claps(Math.round(40 * k), 1.6 * k, 0.1, 0.3);
    if (Math.random() < 0.7) this._whistle(0.3 + Math.random() * 0.4);
  }
  ooh() {
    this._crowdVoices({ dur: 1.4, base: 210, formants: [[330, 5], [800, 7]], peak: 0.22, glide: 1.18, attack: 0.3 });
  }
  aww() {
    this._crowdVoices({ dur: 1.2, base: 230, formants: [[750, 4], [1150, 6]], peak: 0.16, glide: 0.8, attack: 0.1 });
  }
  boo() {
    this._crowdVoices({ dur: 1.5, base: 125, formants: [[330, 4], [700, 5]], peak: 0.24, glide: 0.92, attack: 0.25, n: 9 });
  }
  _whistle(when = 0) {
    this._tone({ when, freq: 2100, dur: 0.18, type: 'sine', peak: 0.07, slideTo: 2800, out: this.crowdBus });
    this._tone({ when: when + 0.22, freq: 2800, dur: 0.3, type: 'sine', peak: 0.06, slideTo: 1900, out: this.crowdBus });
  }

  // Low ambient murmur that runs during games, with random distant claps and chatter swells.
  startCrowd() {
    if (!this.ok || this.crowd) return;
    const ctx = this.ctx;
    const layers = [];
    for (const [freq, q, vol, rate] of [[350, 0.6, 0.05, 0.11], [800, 0.8, 0.035, 0.17], [1600, 1.0, 0.015, 0.23]]) {
      const src = ctx.createBufferSource();
      src.buffer = this._pink;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = vol * 0.45;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.crowdBus);
      src.start(0, Math.random() * 1.5);
      lfo.start();
      layers.push(src, lfo);
    }
    const timer = setInterval(() => {
      if (!this.ok) return;
      const r = Math.random();
      if (r < 0.18) this._claps(6 + Math.floor(Math.random() * 10), 0.9, 0, 0.08);
      else if (r < 0.24) this._whistle();
      else if (r < 0.3) this._crowdVoices({ dur: 0.8, base: 240, formants: [[600, 3], [1100, 4]], peak: 0.03, glide: 1.05, n: 4 });
    }, 1400);
    this.crowd = { layers, timer };
  }
  stopCrowd() {
    if (!this.crowd) return;
    for (const n of this.crowd.layers) { try { n.stop(); } catch (e) { /* stopped */ } }
    clearInterval(this.crowd.timer);
    this.crowd = null;
  }

  // ---------- ballpark organ ----------
  // Hammond-style additive tone with a Leslie-ish wobble.
  organNote(freq, dur, when = 0, peak = 0.07, out = null) {
    if (!this.ok) return;
    const t0 = this.now + when;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.setValueAtTime(peak, t0 + Math.max(0.02, dur - 0.04));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.05);
    const trem = this.ctx.createOscillator();
    trem.frequency.value = 6.4;
    const tg = this.ctx.createGain();
    tg.gain.value = peak * 0.18;
    trem.connect(tg).connect(g.gain);
    g.connect(out || this.musicBus);
    const bars = [[0.5, 0.6], [1, 1], [1.5, 0.55], [2, 0.7], [3, 0.35], [4, 0.3], [6, 0.12], [8, 0.1]];
    for (const [h, a] of bars) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * h;
      const og = this.ctx.createGain();
      og.gain.value = a / 3;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
    // key click / percussion
    this._tone({ when, freq: freq * 3, dur: 0.06, type: 'sine', peak: peak * 0.5, out: out || this.musicBus });
    trem.start(t0);
    trem.stop(t0 + dur + 0.1);
  }
  charge() {
    if (!this.ok || !this.musicOn) return;
    const seq = [[67, 0, 0.13], [72, 0.15, 0.13], [76, 0.3, 0.13], [79, 0.45, 0.3], [76, 0.8, 0.13], [79, 0.95, 0.65]];
    for (const [n, w, d] of seq) {
      this.organNote(midi(n), d, w, 0.09, this.sfx);
      this.organNote(midi(n - 12), d, w, 0.05, this.sfx);
    }
    this._claps(14, 0.3, 1.7, 0.4);
    this._crowdVoices({ when: 1.7, dur: 0.5, base: 200, formants: [[650, 3], [1100, 4]], peak: 0.18, glide: 1.1, attack: 0.05 });
  }
  // "da-da-da-da-DA... (clap clap)"
  rally() {
    if (!this.ok || !this.musicOn) return;
    const seq = [[60, 0], [62, 0.18], [64, 0.36], [65, 0.54], [67, 0.72], [69, 0.9], [71, 1.08], [72, 1.26]];
    seq.forEach(([n, w]) => this.organNote(midi(n), 0.16, w, 0.07, this.sfx));
    this._claps(10, 0.15, 1.55, 0.45);
    this._claps(10, 0.15, 1.85, 0.45);
  }

  // ---------- music ----------
  // A peppy 8-bar loop for the menus: organ chords, walking bass, drums.
  music(which) {
    this.wantMusic = which;
    if (!this.ctx) return;
    if (this.musicPlaying === which) return;
    this.stopMusic(true);
    if (!which) return;
    const ctx = this.ctx;
    const bpm = 132, beat = 60 / bpm;
    const prog = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [69, 72, 76], [65, 69, 72], [67, 71, 74], [67, 71, 74]];
    const bass = [36, 41, 43, 36, 45, 41, 43, 43];
    const melody = [
      [72, 0, 1], [76, 1, 1], [79, 2, 1.5], [76, 3.5, 0.5],
      [77, 4, 1], [81, 5, 1], [79, 6, 2],
      [79, 8, 1], [77, 9, 0.5], [76, 9.5, 0.5], [74, 10, 1], [72, 11, 1],
      [76, 12, 3],
      [76, 16, 1], [79, 17, 1], [84, 18, 1.5], [81, 19.5, 0.5],
      [81, 20, 1], [77, 21, 1], [74, 22, 2],
      [79, 24, 1], [77, 25, 1], [76, 26, 1], [74, 27, 1],
      [72, 28, 3],
    ];
    const barLen = 4 * beat;
    const loopLen = 8 * barLen;
    let loopStart = ctx.currentTime + 0.12;
    let nextLoop = loopStart;
    const out = this.musicBus;
    const kick = (t) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.2);
    };
    const noiseHit = (t, type, freq, dur, peak) => {
      const s = ctx.createBufferSource();
      s.buffer = this._white;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random()); s.stop(t + dur + 0.02);
    };
    const bassNote = (t, n, d) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + d + 0.02);
    };
    const lead = (t, n, d) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = midi(n);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.setValueAtTime(0.06, t + d * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(f).connect(g).connect(out);
      o.start(t); o.stop(t + d + 0.02);
    };
    const scheduleLoop = (t0) => {
      for (let b = 0; b < 8; b++) {
        const tb = t0 + b * barLen;
        // drums
        for (let i = 0; i < 4; i++) {
          const t = tb + i * beat;
          if (i % 2 === 0) kick(t);
          else noiseHit(t, 'bandpass', 1800, 0.12, 0.22);
          noiseHit(t, 'highpass', 7000, 0.03, 0.06);
          noiseHit(t + beat / 2, 'highpass', 7000, 0.03, 0.045);
        }
        // bass: root-fifth bounce
        const r = bass[b];
        [[0, r], [1, r + 7], [2, r + 12], [3, r + 7]].forEach(([i, n]) => bassNote(tb + i * beat, n, beat * 0.9));
        // organ comping on the off-beats
        for (const i of [0.5, 1.5, 2.5, 3.5]) {
          for (const n of prog[b]) this._organAt(tb + i * beat, midi(n), beat * 0.4, out);
        }
      }
      for (const [n, at, d] of melody) lead(t0 + at * beat, n, d * beat * 0.95);
    };
    const tick = () => {
      while (nextLoop < ctx.currentTime + 1.5) {
        scheduleLoop(nextLoop);
        nextLoop += loopLen;
      }
    };
    tick();
    this.musicPlaying = which;
    this.musicTimer = setInterval(tick, 400);
    this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
    this.musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(this.musicOn ? 0.55 : 0, ctx.currentTime + 0.6);
  }
  _organAt(t, freq, dur, out) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.01);
    g.gain.setValueAtTime(0.035, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    for (const [h, a] of [[1, 1], [2, 0.6], [3, 0.3], [4, 0.2]]) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * h;
      const og = ctx.createGain();
      og.gain.value = a / 2;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + dur + 0.02);
    }
  }
  stopMusic(immediate = false) {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx && this.musicPlaying) {
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
      this.musicBus.gain.linearRampToValueAtTime(0.0001, t + (immediate ? 0.05 : 0.5));
      // scheduled notes die out under the fade; restore the level for the next song
      setTimeout(() => { if (!this.musicPlaying && this.musicBus) this.musicBus.gain.value = this.musicOn ? 0.55 : 0; }, immediate ? 80 : 1600);
    }
    this.musicPlaying = null;
  }

  // ---------- voices ----------
  _pickVoice(kind) {
    if (!('speechSynthesis' in window)) return null;
    const vs = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!vs.length) return null;
    const prefer = kind === 'announcer'
      ? [/Google UK English Male/i, /Daniel/i, /Microsoft (George|Ryan)/i, /Male/i]
      : [/Google US English/i, /Microsoft (Guy|David|Mark|Andrew)/i, /Alex/i, /Fred/i];
    for (const re of prefer) {
      const v = vs.find((x) => re.test(x.name));
      if (v) return v;
    }
    return vs[0];
  }
  say(text, { urgent = false } = {}) {
    if (!this.voiceOn || !('speechSynthesis' in window) || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const styles = {
        classic: { rate: 1.05, pitch: 0.85 },
        bigleague: { rate: 0.82, pitch: 0.55 },
        robot: { rate: 1.25, pitch: 0.15 },
        hype: { rate: 1.2, pitch: 1.35 },
      };
      const s = styles[this.voiceStyle] || styles.classic;
      const v = this._pickVoice('ump');
      if (v) u.voice = v;
      u.rate = s.rate * (urgent ? 1.1 : 1);
      u.pitch = s.pitch;
      u.volume = Math.min(1, this.sfxVol + 0.2);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech is optional */ }
  }
  // Stadium PA announcer (only when nothing else is being said)
  announce(text) {
    if (!this.voiceOn || !('speechSynthesis' in window) || !text) return;
    try {
      if (window.speechSynthesis.speaking) return;
      const u = new SpeechSynthesisUtterance(text);
      const v = this._pickVoice('announcer');
      if (v) u.voice = v;
      u.rate = 0.88;
      u.pitch = 0.75;
      u.volume = Math.min(1, this.sfxVol);
      window.speechSynthesis.speak(u);
    } catch (e) { /* optional */ }
  }
}

export const audio = new AudioEngine();
