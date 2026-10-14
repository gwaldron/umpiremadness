// All sound is synthesized with WebAudio — no audio files to download.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxVol = 0.8;
    this.musicOn = true;
    this.voiceOn = true;
    this.crowdNode = null;
    this.voiceStyle = 'classic';
    this._noise = null;
  }

  // Must be called from a user gesture (click / key / gamepad press).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.sfxVol;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    // One second of white noise reused by every noisy sound.
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  setVolume(v) {
    this.sfxVol = v;
    if (this.master) this.master.gain.value = v;
  }

  get ok() {
    return !!this.ctx && this.sfxVol > 0;
  }

  _env(gainNode, t0, a, peak, d) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  _noiseBurst({ dur = 0.1, type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.002, when = 0, rate = 1 }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t0, attack, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + attack + dur + 0.05);
  }

  _tone({ freq = 440, dur = 0.15, type = 'sine', peak = 0.3, attack = 0.005, when = 0, slideTo = null }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = this.ctx.createGain();
    this._env(g, t0, attack, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + attack + dur + 0.05);
  }

  // ---- Ballpark sounds ----
  pop() {
    // Ball smacking into leather.
    this._noiseBurst({ dur: 0.07, type: 'bandpass', freq: 1800, q: 1.2, peak: 0.9 });
    this._tone({ freq: 180, dur: 0.06, type: 'sine', peak: 0.5, slideTo: 90 });
  }
  crack() {
    this._noiseBurst({ dur: 0.05, type: 'highpass', freq: 2500, q: 0.7, peak: 1 });
    this._tone({ freq: 900, dur: 0.05, type: 'triangle', peak: 0.4, slideTo: 300 });
    this._noiseBurst({ dur: 0.18, type: 'bandpass', freq: 600, q: 2, peak: 0.3, when: 0.01 });
  }
  tick() {
    this._noiseBurst({ dur: 0.03, type: 'highpass', freq: 4000, q: 1, peak: 0.5 });
  }
  thud() {
    this._noiseBurst({ dur: 0.12, type: 'lowpass', freq: 260, q: 1, peak: 1 });
    this._tone({ freq: 70, dur: 0.1, type: 'sine', peak: 0.5 });
  }
  slide() {
    this._noiseBurst({ dur: 0.45, type: 'bandpass', freq: 900, q: 0.6, peak: 0.35, attack: 0.03 });
  }
  whoosh() {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(400, t0);
    f.frequency.exponentialRampToValueAtTime(3000, t0 + 0.25);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.08, 0.35, 0.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.4);
  }
  ouch() {
    this._tone({ freq: 500, dur: 0.25, type: 'square', peak: 0.15, slideTo: 120 });
    this._noiseBurst({ dur: 0.08, type: 'bandpass', freq: 1200, q: 1, peak: 0.6 });
  }

  // ---- UI sounds ----
  blip() {
    this._tone({ freq: 880, dur: 0.05, type: 'triangle', peak: 0.12 });
  }
  select() {
    this._tone({ freq: 660, dur: 0.06, type: 'triangle', peak: 0.15 });
    this._tone({ freq: 990, dur: 0.08, type: 'triangle', peak: 0.15, when: 0.05 });
  }
  back() {
    this._tone({ freq: 500, dur: 0.07, type: 'triangle', peak: 0.12, slideTo: 330 });
  }
  correct() {
    this._tone({ freq: 784, dur: 0.1, type: 'square', peak: 0.12 });
    this._tone({ freq: 1175, dur: 0.18, type: 'square', peak: 0.12, when: 0.08 });
  }
  wrong() {
    this._tone({ freq: 160, dur: 0.35, type: 'sawtooth', peak: 0.16, slideTo: 90 });
    this._tone({ freq: 166, dur: 0.35, type: 'sawtooth', peak: 0.12, slideTo: 94 });
  }
  achievement() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) => this._tone({ freq: n, dur: 0.18, type: 'square', peak: 0.1, when: i * 0.07 }));
    this._tone({ freq: 1568, dur: 0.5, type: 'triangle', peak: 0.12, when: 0.36 });
  }
  levelUp() {
    const seq = [392, 523, 659, 784, 659, 784, 1047];
    seq.forEach((n, i) => this._tone({ freq: n, dur: 0.14, type: 'square', peak: 0.1, when: i * 0.09 }));
  }
  streak(level) {
    const base = 440 * Math.pow(2, Math.min(level, 12) / 12);
    this._tone({ freq: base, dur: 0.08, type: 'triangle', peak: 0.12 });
    this._tone({ freq: base * 1.5, dur: 0.12, type: 'triangle', peak: 0.12, when: 0.06 });
  }
  countdown() {
    this._tone({ freq: 1200, dur: 0.06, type: 'sine', peak: 0.15 });
  }
  cheer(intensity = 1) {
    // Crowd roar: layered noise swells.
    for (let i = 0; i < 3; i++) {
      this._noiseBurst({ dur: 1.1 * intensity, type: 'bandpass', freq: 700 + i * 500, q: 0.8, peak: 0.18 * intensity, attack: 0.15, when: i * 0.04 });
    }
  }
  boo() {
    this._noiseBurst({ dur: 0.9, type: 'lowpass', freq: 400, q: 2, peak: 0.25, attack: 0.2 });
    this._tone({ freq: 140, dur: 0.8, type: 'sawtooth', peak: 0.04, attack: 0.2, slideTo: 110 });
  }

  // Ballpark organ: the classic "Charge!" riff.
  charge() {
    if (!this.ok || !this.musicOn) return;
    const G4 = 392, C5 = 523, E5 = 659, G5 = 784;
    const seq = [[G4, 0, 0.12], [C5, 0.15, 0.12], [E5, 0.3, 0.12], [G5, 0.45, 0.28], [E5, 0.78, 0.12], [G5, 0.93, 0.6]];
    for (const [f, w, d] of seq) {
      this._tone({ freq: f, dur: d, type: 'square', peak: 0.07, when: w });
      this._tone({ freq: f * 2, dur: d, type: 'sine', peak: 0.05, when: w });
      this._tone({ freq: f / 2, dur: d, type: 'triangle', peak: 0.06, when: w });
    }
  }

  organNote(freq, dur, when = 0) {
    if (!this.ok || !this.musicOn) return;
    this._tone({ freq, dur, type: 'square', peak: 0.05, when });
    this._tone({ freq: freq * 2, dur, type: 'sine', peak: 0.04, when });
  }

  // A low ambient crowd murmur that runs while a game is in progress.
  startCrowd() {
    if (!this.ok || this.crowdNode) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.crowdNode = { src, lfo, g };
  }
  stopCrowd() {
    if (!this.crowdNode) return;
    try {
      this.crowdNode.src.stop();
      this.crowdNode.lfo.stop();
    } catch (e) { /* already stopped */ }
    this.crowdNode = null;
  }

  // ---- Umpire voice (speech synthesis) ----
  say(text, { urgent = false } = {}) {
    if (!this.voiceOn || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const styles = {
        classic: { rate: 1.05, pitch: 0.9 },
        bigleague: { rate: 0.8, pitch: 0.6 },
        robot: { rate: 1.25, pitch: 0.2 },
        hype: { rate: 1.2, pitch: 1.4 },
      };
      const s = styles[this.voiceStyle] || styles.classic;
      u.rate = s.rate * (urgent ? 1.1 : 1);
      u.pitch = s.pitch;
      u.volume = Math.min(1, this.sfxVol + 0.2);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech is optional */ }
  }
}

export const audio = new AudioEngine();
