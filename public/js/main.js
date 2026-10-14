// Umpire Madness — app bootstrap, main loop, and input routing.
import { input } from './input.js';
import { audio } from './audio.js';
import { voices } from './voice.js';
import { el, pick, lerp } from './util.js';
import { Camera, FieldRig } from './render/camera.js';
import { FieldRenderer, POS, UMP_SPOTS, BASES } from './render/field.js';
import { Field3D } from './render3d/world3d.js';
import { KITS, SKINS, UMP_SHIRTS, UMP_CAPS } from './render/figures.js';
import { loadProfile, saveProfile, touchDay, levelFromXp } from './storage.js';
import { ACHIEVEMENTS } from './data/achievements.js';
import { Hud } from './ui/hud.js';
import { confetti } from './ui/confetti.js';
import { Screens } from './ui/screens.js';
import { Session, buildCareer, buildCamp, buildRumble, ARCADE } from './game/session.js';
import { Timeline } from './scenes/timeline.js';

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

// 3D ballpark on a WebGL canvas underneath; the 2D canvas on top is a transparent overlay.
let field;
try {
  if (new URLSearchParams(location.search).get('gl') === '0') throw new Error('2D requested');
  field = new Field3D(document.getElementById('game3d'));
} catch (err) {
  console.warn('WebGL unavailable, using the 2D renderer', err);
  document.getElementById('game3d').remove();
  field = new FieldRenderer();
}

const app = {
  profile: loadProfile(),
  cam: new Camera(),
  field,
  hud: new Hud(),
  session: null,
  dpr: 1,
};
app.rig = new FieldRig(app.cam);
app.screens = new Screens(app);

app.save = () => saveProfile(app.profile);

app.applySettings = () => {
  const s = app.profile.settings;
  audio.setVolume(s.volume);
  audio.voiceOn = s.voice;
  audio.setMusic(s.music);
  audio.voiceStyle = s.voiceStyle;
  voices.enabled = s.voice;
  voices.style = s.voiceStyle;
  voices.extras = s.announcer !== false;
  if (app.field.setQuality) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    app.field.setQuality(s.gfx === 'auto' || !s.gfx ? (coarse ? 'medium' : 'high') : s.gfx);
  }
};

app.toast = ({ icon, kicker, title, desc, cls = '' }) => {
  const t = el('div', { class: `toast ${cls}` });
  t.innerHTML = `<div class="ti">${icon}</div><div><div class="tk">${kicker}</div><div class="tt">${title}</div><div class="td">${desc || ''}</div></div>`;
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4300);
};
app.toastMini = (text) => app.toast({ icon: '💬', kicker: 'HEADS UP', title: text, desc: '' });

app.checkAchievements = () => {
  const p = app.profile;
  const level = levelFromXp(p.xp);
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    let ok = false;
    try { ok = a.check(p, { level }); } catch (e) { ok = false; }
    if (ok) {
      p.achievements[a.id] = Date.now();
      app.toast({ icon: a.icon, kicker: 'ACHIEVEMENT UNLOCKED', title: a.name, desc: a.desc });
      audio.achievement();
      confetti.burst({ x: 0.5, y: 0.16, n: 45, power: 0.7 });
    }
  }
  app.save();
};

// ---------- game starts ----------
function startSession(cfg) {
  app.screens.closeAll();
  if (app.session) app.session.quit();
  audio.unlock();
  voices.warm();
  audio.stopMusic();
  app.session = new Session(app, cfg);
  app.session.start();
}
app.startCareer = (div, idx) => startSession(buildCareer(div, idx));
app.startCamp = (level = 'minors') => startSession(buildCamp(level));
app.startArcade = (mode) => startSession(mode === 'rumble' ? buildRumble() : { ...ARCADE[mode] });

app.pauseGame = () => {
  const s = app.session;
  if (!s || s.paused || s.ended) return;
  s.paused = true;
  window.speechSynthesis?.cancel();
  app.screens.push(app.screens.pause());
};
app.resumeGame = () => {
  const s = app.session;
  app.screens.closeAll();
  if (s) s.paused = false;
};
app.quitGame = () => {
  if (app.session) app.session.quit();
  app.session = null;
  app.screens.closeAll();
  app.screens.push(app.screens.title());
  audio.music('menu');
};
app.showResults = (r) => {
  const s = app.session;
  setTimeout(() => {
    if (app.session === s) app.session = null;
    app.screens.closeAll();
    app.screens.push(app.screens.results(r));
    setTimeout(() => { if (!app.session) audio.music('menu'); }, 2500);
    if (r.stars >= 2 || r.record) { audio.cheer(1.2); audio.charge(); confetti.rain({ n: r.stars >= 3 || r.record ? 200 : 120 }); }
  }, r.gameOver ? 1600 : 700);
};

app.hud.onPause = () => app.pauseGame();

app.boot = () => {
  app.applySettings();
  audio.music('menu');
  touchDay(app.profile);
  app.save();
  app.screens.closeAll();
  if (!app.profile.name) {
    app.screens.push(app.screens.title());
    app.screens.push(app.screens.namePicker(true));
  } else {
    app.screens.push(app.screens.title());
  }
};

// ---------- input routing ----------
input.attach(canvas);
input.onUnlock(() => { audio.unlock(); voices.warm(); });
input.on((act) => {
  if (app.screens.open) {
    app.screens.handleAction(act);
    return;
  }
  if (app.session) app.session.onAction(act);
});
input.onModeChange = (m) => {
  if (m === 'gamepad' && !app.profile.stats.gamepad) {
    app.profile.stats.gamepad = 1;
    app.checkAchievements();
  }
};
document.body.dataset.input = 'keyboard';
if (matchMedia('(pointer: coarse)').matches) { input.mode = 'touch'; document.body.dataset.input = 'touch'; }

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !app.noAutoPause) app.pauseGame();
});
window.addEventListener('contextmenu', (e) => { if (e.target === canvas) e.preventDefault(); });

// ---------- sizing ----------
function resize() {
  app.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * app.dpr);
  canvas.height = Math.round(h * app.dpr);
  app.cam.setViewport(canvas.width, canvas.height);
  if (app.field.resize) app.field.resize(w, h, app.dpr);
  document.body.classList.toggle('portrait', h > w);
}
window.addEventListener('resize', resize);
resize();

// ---------- attract mode: around the horn behind the menus ----------
const attract = {
  t: 0,
  actors: null,
  ball: { x: 0, y: 44, z: 4, visible: true, trail: [] },
  seq: ['C', '3B', '2B', '1B', 'SS', 'P'],
  i: 0,
  seg: null,
  init() {
    let i = 0;
    this.actors = {};
    for (const k of ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF']) {
      this.actors[k] = { ...POS[k], kit: KITS.def, skin: SKINS[i++ % SKINS.length], pose: k === 'C' ? 'catcher' : 'ready', glove: 'F' };
    }
    const look = app.profile.look;
    const kit = { ...KITS.ump, jersey: UMP_SHIRTS[look.shirt] || UMP_SHIRTS.navy, cap: UMP_CAPS[look.cap] || UMP_CAPS.black };
    kit.shade = kit.jersey;
    this.actors.BU = { ...UMP_SPOTS.A, kit, skin: SKINS[look.skin ?? 1], pose: 'set' };
    this.actors.PU = { ...UMP_SPOTS.PU, kit, skin: SKINS[2], pose: 'set', mask: true };
    this.list = Object.values(this.actors);
    this._next(0);
  },
  _next(t) {
    const from = this.actors[this.seq[this.i % this.seq.length]];
    this.i++;
    const to = this.actors[this.seq[this.i % this.seq.length]];
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    this.seg = { t0: t, t1: t + d / 70, from, to, d };
  },
  update(dt) {
    this.t += dt;
    if (!this.actors) this.init();
    const s = this.seg;
    if (this.t >= s.t1 + 0.6) { audio.ok && Math.random() < 0.0 && audio.pop(); this._next(this.t); }
    const u = Math.min(1, Math.max(0, (this.t - s.t0) / (s.t1 - s.t0)));
    const b = this.ball;
    b.x = lerp(s.from.x, s.to.x, u);
    b.y = lerp(s.from.y, s.to.y, u);
    b.z = 3.5 + 4 * Math.min(5, s.d * 0.05) * u * (1 - u);
    if (u < 1) { b.trail.push({ x: b.x, y: b.y, z: b.z }); if (b.trail.length > 6) b.trail.shift(); } else b.trail.length = 0;
    const tt = this.t;
    app.rig.set({ x: Math.sin(tt * 0.09) * 26, y: 58 + Math.cos(tt * 0.11) * 14 }, 82 + Math.sin(tt * 0.07) * 12, 0.5 + Math.sin(tt * 0.05) * 0.08);
    app.rig.update(dt);
  },
  render() {
    app.field.draw(g, app.cam, { actors: this.list, ball: this.ball });
  },
};

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  // clamp: never step backwards (frame timestamps can lag after a long stall) or too far forward
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) * (app.speed || 1); // app.speed: debug fast-forward
  last = now;
  if (app.freeze) { requestAnimationFrame(frame); return; } // debug: hold the current picture
  input.poll(dt);
  const s = app.session;
  try {
    if (s) {
      if (!s.ended) s.update(dt);
      s.render(g);
    } else {
      attract.update(dt);
      attract.render();
    }
  } catch (err) {
    console.error(err);
  }
  input.drawStick(g, app.dpr);
  requestAnimationFrame(frame);
}

// Debug/test hook: advance the simulation manually (e.g. when the tab is throttled).
app.step = (dt = 1 / 60, n = 1) => {
  for (let i = 0; i < n; i++) {
    input.poll(dt);
    if (app.session && !app.session.ended) app.session.update(dt);
    else attract.update(dt);
  }
  if (app.session) app.session.render(g);
  else attract.render();
};

app.boot();
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.__ump = app;
