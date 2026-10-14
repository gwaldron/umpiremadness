// Menu screens (DOM). Fully navigable with D-pad / stick / arrow keys; A = select, B = back.
import { el, escapeHtml, mini, lessonUrl, BOOTCAMP } from '../util.js';
import { audio } from '../audio.js';
import { input } from '../input.js';
import { DIVISIONS, GAME_NAMES, gameRole } from '../data/divisions.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { RULE, ACTIVE_RULES } from '../data/rules.js';
import { levelFromXp, xpForLevel, rankFor, SHIRT_UNLOCKS, CAP_UNLOCKS, randomName, careerStars, resetProfile } from '../storage.js';
import { UMP_SHIRTS, UMP_CAPS, SKINS, KITS, drawFigure } from '../render/figures.js';
import { Camera } from '../render/camera.js';
import { glyph } from './hud.js';
import { UmpPreview } from '../render3d/preview.js';

export class Screens {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.stack = [];
    this.focusEl = null;
  }

  get current() { return this.stack[this.stack.length - 1] || null; }
  get open() { return this.stack.length > 0; }

  // ---------- stack management ----------
  push(screen) {
    if (this.current) this.current.el.hidden = true;
    this.stack.push(screen);
    this.root.append(screen.el);
    this._wireFocus(screen);
    this._focusFirst(screen);
  }
  replace(screen) {
    while (this.stack.length) this.stack.pop().el.remove();
    this.push(screen);
  }
  pop() {
    const s = this.stack.pop();
    if (s) { s.el.remove(); s.onClose && s.onClose(); }
    if (this.current) {
      this.current.el.hidden = false;
      if (this.current.refresh) this.current.refresh();
      this._focusFirst(this.current, this.current.lastFocus);
    }
  }
  closeAll() {
    while (this.stack.length) { const s = this.stack.pop(); s.el.remove(); s.onClose && s.onClose(); }
    this.focusEl = null;
  }

  _wireFocus(screen) {
    screen.el.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t && e.pointerType === 'mouse') this._setFocus(t, false);
    });
    screen.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t && !t.disabled) audio.select();
    });
  }
  _navs(screen = this.current) {
    if (!screen) return [];
    return [...screen.el.querySelectorAll('[data-nav]')].filter((n) => !n.disabled && n.offsetParent !== null);
  }
  _focusFirst(screen, prefer) {
    const navs = this._navs(screen);
    const f = (prefer && navs.includes(prefer)) ? prefer : (screen.el.querySelector('[data-autofocus]:not([disabled])') || navs[0]);
    if (f) this._setFocus(f, false);
  }
  _setFocus(n, scroll = true) {
    if (this.focusEl) this.focusEl.classList.remove('focus');
    this.focusEl = n;
    if (!n) return;
    n.classList.add('focus');
    if (this.current) this.current.lastFocus = n;
    if (scroll) n.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  _move(dir) {
    const navs = this._navs();
    if (!navs.length) return;
    if (!this.focusEl || !navs.includes(this.focusEl)) return this._setFocus(navs[0]);
    const r0 = this.focusEl.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null, bs = Infinity;
    for (const n of navs) {
      if (n === this.focusEl) continue;
      const r = n.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - c0.x, dy = c.y - c0.y;
      let prim, sec;
      if (dir === 'UP') { prim = -dy; sec = Math.abs(dx); }
      else if (dir === 'DOWN') { prim = dy; sec = Math.abs(dx); }
      else if (dir === 'LEFT') { prim = -dx; sec = Math.abs(dy); }
      else { prim = dx; sec = Math.abs(dy); }
      if (prim <= 4) continue;
      const score = prim + sec * 2.2;
      if (score < bs) { bs = score; best = n; }
    }
    if (best) { this._setFocus(best); audio.blip(); }
  }

  handleAction(act) {
    const s = this.current;
    if (!s) return false;
    if (s.onAction && s.onAction(act)) return true;
    if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(act)) { this._move(act); return true; }
    if (act === 'A') {
      if (this.focusEl && this._navs().includes(this.focusEl)) this.focusEl.click();
      return true;
    }
    if (act === 'B' || act === 'ESC' || act === 'BACK') {
      if (s.back) { s.back(); audio.back(); }
      else if (s.canBack !== false && this.stack.length > 1) { this.pop(); audio.back(); }
      return true;
    }
    return true;
  }

  // ---------- helpers ----------
  topbar(title, backFn) {
    const b = el('button', { class: 'backbtn', 'data-nav': '', type: 'button', onclick: backFn || (() => this.pop()) });
    b.innerHTML = `${glyph('B')} Back`;
    return el('div', { class: 'topbar' }, b, el('h2', {}, title), el('div', { class: 'spacer' }));
  }
  screen(cls, ...kids) {
    return { el: el('div', { class: `screen ${cls}` }, ...kids) };
  }

  // ---------- TITLE ----------
  title() {
    const app = this.app;
    const p = app.profile;
    const lvl = levelFromXp(p.xp);
    const curXp = p.xp - xpForLevel(lvl), needXp = xpForLevel(lvl + 1) - xpForLevel(lvl);
    const ach = Object.keys(p.achievements).length;
    const cards = Object.keys(p.cards).length;
    const campDone = !!p.career['camp'];
    const wrap = el('div', { class: 'title-screen' });
    const left = el('div', { class: 'logo-block' });
    left.innerHTML = `
      <span class="logo-kicker">UMPIRE BOOTCAMP PRESENTS</span>
      <h1 class="logo">UMPIRE<span>MADNESS</span></h1>
      <p class="tagline"><b>Make the call. Own the field.</b> Balls &amp; strikes, bang-bang plays, infield flies, obstruction, the works — from AA all the way to Williamsport.</p>
      <div class="profile-chip">
        <div class="lvl">${lvl}</div>
        <div class="who"><div class="name">${escapeHtml(p.name || 'Rookie')}</div><div class="rank">${rankFor(lvl)} · ${p.xp.toLocaleString()} XP</div>
        <div class="xpbar"><i style="width:${Math.round((curXp / needXp) * 100)}%"></i></div></div>
      </div>
      <div class="controls-hint">
        <span class="only-pad">🎮 Controller ready</span>
        <span class="hide-touch">Keyboard: arrows/WASD move · <b>J</b>=A <b>K</b>=B <b>U</b>=X <b>I</b>=Y · Esc pause</span>
        <span class="only-touch">Tap buttons to call · drag on the field to move</span>
      </div>
      <p class="footer-note">📖 Learn the rules first at <a href="${BOOTCAMP}" target="_blank" rel="noopener">Umpire Bootcamp</a>. Progress saves on this device.</p>`;
    const menu = el('div', { class: 'menu' });
    const main = (cls, ico, t, d, fn, extra = {}) => {
      const b = el('button', { class: `menu-main ${cls}`, 'data-nav': '', type: 'button', onclick: fn, ...extra });
      b.innerHTML = `<span class="ico">${ico}</span><span><div class="t">${t}</div><div class="d">${d}</div></span>`;
      return b;
    };
    if (!campDone) menu.append(main('hero', '🎓', 'ROOKIE CAMP', 'New here? Start with Minors Camp: 7 training stations + a scrimmage.', () => this.push(this.campChooser()), { 'data-autofocus': '' }));
    menu.append(main(campDone ? 'hero' : '', '🏆', 'CAREER', `AA → AAA → Majors → All-Stars → Williamsport · ${careerStars(p)}★ earned`, () => this.push(this.career()), campDone ? { 'data-autofocus': '' } : {}));
    menu.append(main('', '🕹️', 'ARCADE', 'Plate Survival · Base Hustle · Rulebook Rumble · Blitz', () => this.push(this.arcade())));
    const row = el('div', { class: 'menu-row' });
    const mini = (ico, t, fn, badge) => {
      const b = el('button', { class: 'menu-mini', 'data-nav': '', type: 'button', onclick: fn });
      b.innerHTML = `<span class="ico">${ico}</span>${t}${badge ? `<span class="badge">${badge}</span>` : ''}`;
      return b;
    };
    row.append(
      mini('👕', 'Locker', () => this.push(this.locker())),
      mini('🏅', `Trophies`, () => this.push(this.trophies()), `${ach}/${ACHIEVEMENTS.length}`),
      mini('🗂️', 'Rule Cards', () => this.push(this.cards()), `${Math.min(cards, ACTIVE_RULES.length)}/${ACTIVE_RULES.length}`),
      mini('📊', 'Stats', () => this.push(this.stats())),
      mini('❓', 'How to Play', () => this.push(this.howto())),
      mini('🎓', 'Rookie Camp', () => this.push(this.campChooser())),
      mini('⚙️', 'Settings', () => this.push(this.settings())),
      mini('📖', 'Bootcamp', () => window.open(BOOTCAMP, '_blank', 'noopener')),
    );
    menu.append(row);
    wrap.append(left, menu);
    const s = { el: el('div', { class: 'screen' }, wrap), canBack: false };
    s.refresh = () => { const n = this.title(); s.el.replaceWith(n.el); s.el = n.el; this._wireFocus(s); };
    return s;
  }

  // ---------- CAREER ----------
  career() {
    const app = this.app;
    const p = app.profile;
    const total = careerStars(p);
    const wrapEl = el('div', { class: 'wrap' }, this.topbar(`CAREER · ${total}★`));
    const strip = el('div', { class: 'division-strip' });
    for (const d of DIVISIONS) {
      const locked = total < d.unlock;
      const div = el('div', { class: `division${locked ? ' locked' : ''}`, style: { borderColor: d.color + '88' } });
      const head = el('header');
      head.innerHTML = `<span style="font-size:34px">${d.icon}</span><div><div class="dname" style="color:${d.color}">${d.full.toUpperCase()}</div><div class="dsub">${escapeHtml(d.blurb)}</div></div><div class="stars-total">${careerStars(p, d.id)}/${d.games * 3}★</div>`;
      div.append(head);
      if (locked) {
        div.append(el('div', { class: 'lockmsg' }, `🔒 Earn ${d.unlock}★ total to unlock (you have ${total}★).`));
      } else {
        const games = el('div', { class: 'games' });
        for (let i = 0; i < d.games; i++) {
          const key = `${d.id}-${i}`;
          const rec = p.career[key];
          const prevDone = i === 0 || (p.career[`${d.id}-${i - 1}`] && p.career[`${d.id}-${i - 1}`].stars >= 1);
          const role = gameRole(d.id, i);
          const roleTxt = role === 'plate' ? '🧑‍⚖️ Plate game' : role === 'bases' ? '🏃 Bases game' : '⚡ Plate + Bases';
          const st = rec ? rec.stars : 0;
          const b = el('button', { class: 'game-tile', 'data-nav': '', type: 'button', disabled: !prevDone, onclick: () => app.startCareer(d.id, i) });
          b.innerHTML = `<span class="gt">${escapeHtml(GAME_NAMES[d.id][i])}</span><span class="gr">${roleTxt}${rec ? ` · best ${rec.best.toLocaleString()}` : ''}</span><span class="st">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>${prevDone ? '' : '<span class="gr">🔒 Finish the previous game</span>'}`;
          games.append(b);
        }
        div.append(games);
      }
      strip.append(div);
    }
    wrapEl.append(strip, el('p', { class: 'footer-note' }, '⭐ 60% correct = 1 star · 80% = 2 stars · 95% = 3 stars. Stars unlock new divisions.'));
    return this.screen('dim', wrapEl);
  }

  // ---------- ARCADE ----------
  arcade() {
    const app = this.app;
    const b = app.profile.best;
    const wrapEl = el('div', { class: 'wrap' }, this.topbar('ARCADE'));
    const grid = el('div', { class: 'grid' });
    const card = (ico, t, d, best, fn) => {
      const c = el('button', { class: 'card', 'data-nav': '', type: 'button', onclick: fn });
      c.innerHTML = `<div class="ico-big">${ico}</div><h3>${t}</h3><p>${d}</p><p style="margin-top:8px;color:var(--gold);font-weight:800">Best: ${best}</p>`;
      return c;
    };
    grid.append(
      card('⚡', 'Strike Zone Blitz', '60 seconds of rapid-fire balls and strikes. Wrong calls cost 3 seconds. How many can you get?', `${b.blitz || 0} calls`, () => app.startArcade('blitz')),
      card('🧑‍⚖️', 'Plate Survival', 'Endless at-bats that get faster and nastier. Three missed calls and you\'re ejected!', (b.plate || 0).toLocaleString(), () => app.startArcade('plate')),
      card('🏃', 'Base Hustle', 'Endless plays on the bases. Get your angle, sell the call. Three misses = ejected.', (b.bases || 0).toLocaleString(), () => app.startArcade('bases')),
      card('📕', 'Rulebook Rumble', '12 rule situations from every division — infield fly, obstruction, appeals, local rules and more.', (b.rumble || 0).toLocaleString(), () => app.startArcade('rumble')),
    );
    wrapEl.append(grid);
    return this.screen('dim', wrapEl);
  }

  // ---------- TROPHIES ----------
  trophies() {
    const p = this.app.profile;
    const got = Object.keys(p.achievements).length;
    const wrapEl = el('div', { class: 'wrap' }, this.topbar(`TROPHY CASE · ${got}/${ACHIEVEMENTS.length}`));
    const grid = el('div', { class: 'grid' });
    for (const a of ACHIEVEMENTS) {
      const has = !!p.achievements[a.id];
      const c = el('div', { class: `card${has ? ' gold' : ' locked'}`, 'data-nav': '', tabindex: '0' });
      c.innerHTML = `<div class="ico-big">${has ? a.icon : '🔒'}</div><h3>${has || !a.hidden ? escapeHtml(a.name) : '???'}</h3><p>${has || !a.hidden ? escapeHtml(a.desc) : 'Secret achievement — keep playing!'}</p>${has ? `<p style="margin-top:6px;color:var(--gold);font-size:12px">Unlocked ${new Date(p.achievements[a.id]).toLocaleDateString()}</p>` : ''}`;
      grid.append(c);
    }
    wrapEl.append(grid);
    return this.screen('dim', wrapEl);
  }

  // ---------- RULE CARDS ----------
  cards() {
    const p = this.app.profile;
    const got = ACTIVE_RULES.filter((r) => p.cards[r.id]).length;
    const wrapEl = el('div', { class: 'wrap' }, this.topbar(`RULE CARDS · ${got}/${ACTIVE_RULES.length}`));
    wrapEl.append(el('p', { class: 'footer-note', style: { marginTop: '-6px', marginBottom: '14px' } }, 'Unlock a card by meeting its situation in a game. Get it right 3 times to make it ⭐ GOLD.'));
    const grid = el('div', { class: 'grid' });
    for (const r of ACTIVE_RULES) {
      const c = p.cards[r.id];
      const gold = c && c.correct >= 3;
      const b = el('button', { class: `card${c ? '' : ' locked'}${gold ? ' gold' : ''}`, 'data-nav': '', type: 'button', onclick: () => c && this.push(this.cardDetail(r)) });
      b.innerHTML = c
        ? `<div class="ico-big">${r.icon}</div><h3>${escapeHtml(r.title)}${gold ? ' ⭐' : ''}</h3><p>${r.group} · seen ${c.seen} · right ${c.correct}</p>`
        : `<div class="ico-big">❔</div><h3>???</h3><p>${r.group}</p>`;
      grid.append(b);
    }
    wrapEl.append(grid);
    return this.screen('dim', wrapEl);
  }

  cardDetail(r) {
    const p = this.app.profile;
    p.stats.cardsRead = (p.stats.cardsRead || 0) + 1;
    this.app.save();
    this.app.checkAchievements();
    const c = p.cards[r.id] || { seen: 0, correct: 0 };
    const panel = el('div', { class: 'panel', style: { textAlign: 'left' } });
    panel.innerHTML = `<div style="font-size:54px">${r.icon}</div><h2>${escapeHtml(r.title)}</h2>
      <p style="color:var(--ink);font-size:16px;line-height:1.5">${mini(r.text)}</p>
      <p>Seen ${c.seen} · Right ${c.correct}${c.correct >= 3 ? ' · ⭐ GOLD' : ''}</p>`;
    const link = el('a', { class: 'btn ghost', href: lessonUrl(r.lesson), target: '_blank', rel: 'noopener', 'data-nav': '' }, '📖 Open the Bootcamp lesson');
    const close = el('button', { class: 'btn', 'data-nav': '', type: 'button', 'data-autofocus': '', onclick: () => this.pop() });
    close.innerHTML = `${glyph('B')} Close`;
    panel.append(el('div', { class: 'stack' }, link, close));
    return this.screen('dim', el('div', { class: 'modal-center' }, panel));
  }

  // ---------- STATS ----------
  stats() {
    const p = this.app.profile;
    const s = p.stats;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const lvl = levelFromXp(p.xp);
    const wrapEl = el('div', { class: 'wrap' }, this.topbar('STATS'));
    const grid = el('div', { class: 'statgrid' });
    const stat = (v, k) => { const d = el('div', { class: 'stat' }); d.innerHTML = `<div class="v">${v}</div><div class="k">${k}</div>`; return d; };
    grid.append(
      stat(s.calls.toLocaleString(), 'Total calls'),
      stat(`${pct(s.correct, s.calls)}%`, 'Accuracy'),
      stat(s.maxStreak, 'Best streak'),
      stat(lvl, `Level · ${rankFor(lvl)}`),
      stat(s.games, 'Games played'),
      stat(s.perfectGames, 'Perfect games'),
      stat(s.painted, 'Painted corners'),
      stat(s.bangBang, 'Bang-bang plays nailed'),
      stat(s.angleA, 'A-grade angles'),
      stat(s.perfectTiming, 'Perfectly timed calls'),
      stat(s.early, 'Quick triggers 😬'),
      stat(s.dayStreak || 0, 'Day streak'),
    );
    const bars = el('div', { class: 'bars' });
    const bar = (name, ok, n) => {
      const r = el('div', { class: 'barrow' });
      r.innerHTML = `<span>${name}</span><span class="track"><i style="width:${pct(ok, n)}%"></i></span><span>${n ? pct(ok, n) + '%' : '—'}</span>`;
      return r;
    };
    bars.append(bar('Balls & strikes', s.pitchOk, s.pitch), bar('Base calls', s.baseOk, s.base), bar('Rule situations', s.sitOk, s.sit), bar('Game management', s.lifeOk, s.life));
    const byCard = Object.entries(s.catTotals || {}).filter(([id]) => RULE[id]).sort((a, b) => b[1].n - a[1].n).slice(0, 12);
    if (byCard.length) {
      bars.append(el('h3', { style: { margin: '16px 0 4px' } }, 'By rule'));
      for (const [id, v] of byCard) bars.append(bar(`${RULE[id].icon} ${RULE[id].title}`, v.ok, v.n));
    }
    wrapEl.append(grid, bars);
    return this.screen('dim', wrapEl);
  }

  // ---------- LOCKER ----------
  locker() {
    const app = this.app;
    const p = app.profile;
    const lvl = levelFromXp(p.xp);
    const wrapEl = el('div', { class: 'wrap' }, this.topbar('LOCKER ROOM'));
    const box = el('div', { class: 'locker' });
    const prev = el('div', { class: 'locker-preview' });
    const cv = el('canvas', { width: 600, height: 640 });
    prev.append(cv);
    const right = el('div');
    let preview = null;
    if (app.field.is3d) { try { preview = new UmpPreview(cv); } catch (e) { preview = null; } }
    const draw = () => {
      if (preview) {
        preview.draw(p.look, { shirt: UMP_SHIRTS[p.look.shirt], cap: UMP_CAPS[p.look.cap], skin: SKINS[p.look.skin ?? 1] });
        return;
      }
      const g = cv.getContext('2d');
      const cam = new Camera();
      cam.fovY = 0.6;
      cam.setViewport(cv.width, cv.height);
      cam.lookAt({ x: 0, y: -11, z: 3.2 }, { x: 0, y: 0, z: 2.6 });
      g.clearRect(0, 0, cv.width, cv.height);
      const grd = g.createRadialGradient(cv.width / 2, cv.height * 0.8, 20, cv.width / 2, cv.height * 0.8, cv.width * 0.7);
      grd.addColorStop(0, '#3a8a3f'); grd.addColorStop(1, '#173d1b');
      g.fillStyle = grd; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#c98b52';
      g.beginPath(); g.ellipse(cv.width / 2, cv.height * 0.86, cv.width * 0.4, cv.height * 0.07, 0, 0, Math.PI * 2); g.fill();
      const kit = { ...KITS.ump, jersey: UMP_SHIRTS[p.look.shirt], shade: UMP_SHIRTS[p.look.shirt], cap: UMP_CAPS[p.look.cap] };
      const pose = ['out', 'safe', 'set', 'time'][Math.floor(performance.now() / 1400) % 4];
      drawFigure(g, cam, { x: 0, y: 0, kit, skin: SKINS[p.look.skin ?? 1], pose, phase: 1, vis: 1 });
      g.fillStyle = '#fff';
      g.font = '28px Bungee, Impact, sans-serif';
      g.textAlign = 'center';
      g.fillText(p.name || 'Rookie', cv.width / 2, 46);
      g.font = '18px Rubik, sans-serif';
      g.fillStyle = '#ffd34d';
      g.fillText(`${rankFor(lvl)} · Lv ${lvl}`, cv.width / 2, 74);
    };
    let raf;
    const loop = () => { draw(); raf = setTimeout(loop, preview ? 33 : 120); };
    loop();
    const changed = () => {
      p.stats.lockerChanged = (p.stats.lockerChanged || 0) + 1;
      app.save();
      app.checkAchievements();
      build();
    };
    const build = () => {
      right.innerHTML = '';
      const nameRow = el('div', { class: 'name-row' });
      nameRow.append(el('span', { class: 'name-big' }, p.name || 'Rookie'));
      nameRow.append(el('button', { class: 'btn ghost', 'data-nav': '', type: 'button', onclick: () => this.push(this.namePicker(false)) }, '🎰 New ump name'));
      right.append(nameRow);
      const sw = (title, list, colors, key) => {
        right.append(el('h3', {}, title));
        const row = el('div', { class: 'swatches' });
        for (const u of list) {
          const unlocked = u.ach ? !!p.achievements[u.ach] : lvl >= u.level;
          const b = el('button', { class: `swatch${p.look[key] === u.id ? ' on' : ''}${unlocked ? '' : ' locked'}`, 'data-nav': '', type: 'button', title: unlocked ? u.name : (u.ach ? 'Win the Williamsport Championship' : `Reach level ${u.level}`), style: { background: colors[u.id] } });
          b.addEventListener('click', () => {
            if (!unlocked) { audio.wrong(); app.toastMini(u.ach ? '🔒 Win the World Series Championship to unlock!' : `🔒 Reach level ${u.level} to unlock ${u.name}`); return; }
            p.look[key] = u.id;
            changed();
          });
          row.append(b);
        }
        right.append(row);
      };
      sw('Shirt', SHIRT_UNLOCKS, UMP_SHIRTS, 'shirt');
      sw('Cap', CAP_UNLOCKS, UMP_CAPS, 'cap');
      right.append(el('h3', {}, 'Skin tone'));
      const row = el('div', { class: 'swatches' });
      SKINS.forEach((c, i) => {
        const b = el('button', { class: `swatch${(p.look.skin ?? 1) === i ? ' on' : ''}`, 'data-nav': '', type: 'button', style: { background: c } });
        b.addEventListener('click', () => { p.look.skin = i; changed(); });
        row.append(b);
      });
      right.append(row);
      right.append(el('small', {}, 'Level up to unlock more colors. Win the World Series Championship for gold gear!'));
      const prevFocus = this.focusEl;
      if (this.current && this.current.el.contains(right)) this._focusFirst(this.current, prevFocus);
    };
    build();
    box.append(prev, right);
    wrapEl.append(box);
    const s = this.screen('dim', wrapEl);
    s.onClose = () => { clearTimeout(raf); if (preview) preview.dispose(); };
    s.refresh = () => build();
    return s;
  }

  namePicker(firstRun = true) {
    const app = this.app;
    const p = app.profile;
    let name = p.name || randomName();
    const panel = el('div', { class: 'panel' });
    const slot = el('div', { class: 'slot' }, name);
    const spin = () => {
      slot.classList.add('spin');
      let n = 0;
      const tick = () => {
        name = randomName();
        slot.textContent = name;
        audio.blip();
        if (++n < 10) setTimeout(tick, 60);
        else { slot.classList.remove('spin'); audio.select(); }
      };
      tick();
    };
    panel.append(
      el('h2', {}, firstRun ? 'WELCOME, BLUE!' : 'NEW UMP NAME'),
      el('p', {}, firstRun ? 'Every great umpire needs a great name. Spin until you love it.' : 'Spin for a new name.'),
      el('div', { class: 'slot-machine' }, slot),
    );
    const spinBtn = el('button', { class: 'btn ghost big', 'data-nav': '', type: 'button', onclick: spin });
    spinBtn.innerHTML = `🎰 SPIN`;
    const ok = el('button', { class: 'btn big', 'data-nav': '', 'data-autofocus': '', type: 'button' });
    ok.innerHTML = `${glyph('A')} THAT'S ME!`;
    ok.addEventListener('click', () => {
      p.name = name;
      app.save();
      if (firstRun) {
        this.replace(this.title());
        this.push(this.firstRunPrompt());
      } else this.pop();
    });
    panel.append(el('div', { class: 'stack' }, spinBtn, ok));
    const s = this.screen('dim', el('div', { class: 'modal-center' }, panel));
    if (firstRun) s.canBack = false;
    return s;
  }

  firstRunPrompt() {
    const app = this.app;
    const panel = el('div', { class: 'panel' });
    panel.innerHTML = `<div style="font-size:54px">🎓</div><h2>READY FOR ROOKIE CAMP?</h2><p>Minors Camp: 7 training stations — pitches, the slot, the bases, angles, rules and coaches — then a scrimmage. Highly recommended!</p>`;
    const go = el('button', { class: 'btn big', 'data-nav': '', 'data-autofocus': '', type: 'button', onclick: () => { this.closeAll(); app.startCamp(); } });
    go.innerHTML = `${glyph('A')} LET'S GO!`;
    const skip = el('button', { class: 'btn ghost', 'data-nav': '', type: 'button', onclick: () => this.pop() });
    skip.innerHTML = `${glyph('B')} Skip for now`;
    panel.append(el('div', { class: 'stack' }, go, skip));
    return this.screen('dim', el('div', { class: 'modal-center' }, panel));
  }

  // ---------- ROOKIE CAMP: pick a level ----------
  campChooser() {
    const app = this.app;
    const p = app.profile;
    const wrapEl = el('div', { class: 'wrap', style: { maxWidth: '820px' } }, this.topbar('ROOKIE CAMP'));
    wrapEl.append(el('p', { class: 'footer-note', style: { marginTop: '-6px', marginBottom: '14px' } }, 'Two levels. New umps start in Minors.'));
    const grid = el('div', { class: 'grid' });
    const card = (ico, t, d, done, fn, extra = {}) => {
      const c = el('button', { class: `card${done ? ' gold' : ''}`, 'data-nav': '', type: 'button', onclick: fn, ...extra });
      c.innerHTML = `<div class="ico-big">${ico}</div><h3>${t}</h3><p>${d}</p>${done ? `<p style="margin-top:8px;color:var(--gold);font-weight:800">${'★'.repeat(done.stars)}${'☆'.repeat(3 - done.stars)} completed</p>` : ''}`;
      return c;
    };
    grid.append(
      card('🧢', 'Minors Camp · Start here!', 'AA & AAA rules · about 15 minutes. 7 stations: balls & strikes, the slot, A/B/C positions, angles, fair/foul & catches, Minors local rules, coaches & safety, then a no-hints scrimmage. No infield fly, no dropped third strike.', p.career.camp, () => app.startCamp('minors'), { 'data-autofocus': '' }),
      card('🔥', 'Majors Camp', 'Full Little League rules · about 15 minutes. 7 stations: faster pitching, the dropped third strike, the infield fly, double plays, steals & back-picks, appeals & timing plays, game management, then a no-hints scrimmage.', p.career['camp-majors'], () => app.startCamp('majors')),
    );
    wrapEl.append(grid);
    return this.screen('dim', wrapEl);
  }

  // ---------- HOW TO PLAY ----------
  howto() {
    const wrapEl = el('div', { class: 'wrap' }, this.topbar('HOW TO PLAY'));
    const g = el('div', { class: 'howto' });
    const c = (t, html) => { const d = el('div', { class: 'card' }); d.innerHTML = `<h3>${t}</h3><p>${html}</p>`; return d; };
    g.append(
      c('🎮 Controls', `<b>Move:</b> left stick / WASD / arrows / drag on the field<br><b>Calls:</b> ${glyph('A')} ${glyph('B')} ${glyph('X')} ${glyph('Y')} (Xbox buttons, J K U I keys, or tap)<br><b>RT</b> = A (strike/out) · <b>LT</b> = B (ball/safe)<br><b>Pause:</b> Menu button / Esc`),
      c('🧑‍⚖️ Behind the plate', 'Move into <b>the slot</b> before the pitch. Watch the ball <b>into the glove</b>, pause, then call it. Calling while the ball is still flying = <b>Quick trigger</b> penalty. The K-Zone shows exactly where it crossed.'),
      c('🏃 On the bases', 'Run to <b>A, B or C</b> before the pitch. When the ball is hit, move for a <b>90° angle</b> to the throw (force) or the slide (tag) and <b>stop</b> before the play. Better angle = clearer UMP CAM.'),
      c('📕 Rule situations', 'Some plays freeze and ask for the ruling. You collect a <b>rule card</b> for each — and every card links to its Umpire Bootcamp lesson.'),
      c('🔥 Streaks & scoring', 'Right calls build a streak: x2 at 5, x3 at 10, x4 at 15. Bonuses for perfect timing, painted corners, A-grade angles, and bang-bang plays.'),
      c('🏆 Career', 'Earn stars to unlock divisions: AA → AAA → Majors → All-Stars → Williamsport. AA and AAA use the FXLL local rules from Bootcamp — no infield fly, no dropped third strike!'),
    );
    wrapEl.append(g);
    return this.screen('dim', wrapEl);
  }

  // ---------- SETTINGS ----------
  settings() {
    const app = this.app;
    const st = app.profile.settings;
    const wrapEl = el('div', { class: 'wrap', style: { maxWidth: '720px' } }, this.topbar('SETTINGS'));
    const list = el('div');
    const seg = (label, small, opts, key, after) => {
      const row = el('div', { class: 'setting' });
      row.innerHTML = `<div class="lbl"><b>${label}</b><small>${small}</small></div>`;
      const s = el('div', { class: 'seg' });
      for (const [v, t] of opts) {
        const b = el('button', { class: st[key] === v ? 'on' : '', 'data-nav': '', type: 'button' }, t);
        b.addEventListener('click', () => {
          st[key] = v;
          for (const x of s.children) x.classList.remove('on');
          b.classList.add('on');
          app.applySettings();
          app.save();
          after && after(v);
        });
        s.append(b);
      }
      row.append(s);
      list.append(row);
    };
    seg('Volume', 'Sound effects and crowd', [[0, 'Off'], [0.4, 'Low'], [0.8, 'Med'], [1, 'Loud']], 'volume', () => audio.select());
    seg('Umpire voice', 'Your calls spoken out loud', [[true, 'On'], [false, 'Off']], 'voice', (v) => v && audio.say('Strike!'));
    seg('Voice style', 'How your umpire sounds', [['classic', 'Classic'], ['bigleague', 'Big League'], ['hype', 'Hype'], ['robot', 'Robo-Ump']], 'voiceStyle', () => audio.say('Steee-rike!'));
    seg('Music & organ', 'Menu theme song and ballpark organ', [[true, 'On'], [false, 'Off']], 'music', (v) => v && audio.charge());
    seg('Hints', 'Zone box, ghost spots, coach tips', [['auto', 'Auto'], ['on', 'Always'], ['off', 'Never']], 'hints');
    seg('Screen shake', 'Big-moment camera shake', [[true, 'On'], [false, 'Off']], 'shake');
    if (app.field.is3d) seg('Graphics', 'Lower it if the game feels slow', [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], 'gfx');
    const resetRow = el('div', { class: 'setting' });
    resetRow.innerHTML = `<div class="lbl"><b>Reset progress</b><small>Erase your profile, stars and trophies on this device</small></div>`;
    const rb = el('button', { class: 'btn ghost', 'data-nav': '', type: 'button' }, 'Reset…');
    rb.addEventListener('click', () => this.push(this.confirm('Erase everything?', 'This deletes your name, XP, stars, rule cards and trophies on this device. It cannot be undone.', 'ERASE', () => {
      app.profile = resetProfile();
      app.save();
      this.closeAll();
      app.boot();
    })));
    resetRow.append(rb);
    list.append(resetRow);
    wrapEl.append(list, el('p', { class: 'footer-note' }, 'Umpire Madness is a companion to Umpire Bootcamp. Little League baseball rules; FXLL local rules for AA and AAA. Your league\'s current written rules always win.'));
    return this.screen('dim', wrapEl);
  }

  confirm(title, text, okLabel, fn) {
    const panel = el('div', { class: 'panel' });
    panel.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>`;
    const no = el('button', { class: 'btn', 'data-nav': '', 'data-autofocus': '', type: 'button', onclick: () => this.pop() });
    no.innerHTML = `${glyph('B')} Cancel`;
    const yes = el('button', { class: 'btn ghost', 'data-nav': '', type: 'button', onclick: () => { this.pop(); fn(); } }, okLabel);
    panel.append(el('div', { class: 'stack' }, no, yes));
    return this.screen('dim', el('div', { class: 'modal-center' }, panel));
  }

  // ---------- PAUSE ----------
  pause() {
    const app = this.app;
    const panel = el('div', { class: 'panel' });
    panel.innerHTML = `<h2>PAUSED</h2><p>Time out, Blue.</p>`;
    const resume = el('button', { class: 'btn big', 'data-nav': '', 'data-autofocus': '', type: 'button', onclick: () => app.resumeGame() });
    resume.innerHTML = `${glyph('A')} RESUME`;
    const how = el('button', { class: 'btn ghost', 'data-nav': '', type: 'button', onclick: () => this.push(this.howto()) }, '❓ How to play');
    const set = el('button', { class: 'btn ghost', 'data-nav': '', type: 'button', onclick: () => this.push(this.settings()) }, '⚙️ Settings');
    const quit = el('button', { class: 'btn ghost', 'data-nav': '', type: 'button', onclick: () => app.quitGame() }, '🚪 Quit to menu');
    panel.append(el('div', { class: 'stack' }, resume, how, set, quit));
    const s = this.screen('glass', el('div', { class: 'modal-center' }, panel));
    s.back = () => app.resumeGame();
    s.onAction = (act) => { if (act === 'START' || act === 'ESC') { app.resumeGame(); return true; } return false; };
    return s;
  }

  // ---------- RESULTS ----------
  results(r) {
    const app = this.app;
    const career = r.mode === 'career';
    const wrap = el('div', { class: 'results' });
    let head;
    if (r.mode === 'camp') head = r.acc >= 0.5 ? `${(r.cfg.level || 'minors') === 'majors' ? 'MAJORS' : 'MINORS'} CAMP DONE! 🎓` : 'CAMP COMPLETE';
    else if (r.gameOver) head = 'EJECTED! 🚪';
    else if (r.mode === 'blitz') head = "TIME'S UP!";
    else head = career ? (r.stars ? 'FINAL OUT!' : 'TOUGH GAME') : 'FINAL';
    wrap.innerHTML = `
      <div class="logo-kicker">${escapeHtml(r.cfg.title || '')}${career ? ` · ${escapeHtml(r.div.full)}` : ''}</div>
      <h2>${head}</h2>
      ${career || r.mode === 'camp' ? `<div class="big-stars">${[0, 1, 2].map((i) => `<span class="s${i < r.stars ? ' on' : ''}" style="animation-delay:${0.3 + i * 0.25}s">★</span>`).join('')}</div>` : ''}
      ${r.record ? '<div class="xp-gain">🎉 NEW PERSONAL BEST!</div>' : ''}
      <div class="rows">
        <div class="rowline"><span>Score</span><span>${r.score.toLocaleString()}</span></div>
        <div class="rowline"><span>Right calls</span><span>${r.correct} / ${r.calls}</span></div>
        <div class="rowline"><span>Accuracy</span><span>${Math.round(r.acc * 100)}%</span></div>
        <div class="rowline"><span>Best streak</span><span>🔥 ${r.bestStreak}</span></div>
        <div class="rowline"><span>XP earned</span><span>+${r.xpGain}${r.levelUp ? ` · LEVEL ${r.levelUp}!` : ''}</span></div>
      </div>
      ${r.achievements.length ? `<div class="newbadges">${r.achievements.map((a) => `<span class="nb">${a.icon} ${escapeHtml(a.name)}</span>`).join('')}</div>` : ''}
      ${career && !r.stars ? '<p class="footer-note">Get 60% of your calls right to earn a star and unlock the next game. Review the rule cards and try again!</p>' : ''}`;
    const actions = el('div', { class: 'actions' });
    const btn = (label, fn, primary, auto) => {
      const b = el('button', { class: `btn${primary ? ' big' : ' ghost'}`, 'data-nav': '', type: 'button', onclick: fn, ...(auto ? { 'data-autofocus': '' } : {}) });
      b.innerHTML = label;
      return b;
    };
    if (career) {
      const d = DIVISIONS.find((x) => x.id === r.cfg.div);
      const nextIdx = r.cfg.gameIndex + 1;
      const hasNext = r.stars >= 1 && nextIdx < d.games;
      if (hasNext) actions.append(btn(`${glyph('A')} NEXT GAME`, () => app.startCareer(d.id, nextIdx), true, true));
      actions.append(btn(hasNext ? '↻ Replay' : `${glyph('A')} REPLAY`, () => app.startCareer(d.id, r.cfg.gameIndex), !hasNext, !hasNext));
      actions.append(btn('🏆 Career map', () => { this.replace(this.title()); this.push(this.career()); }));
    } else if (r.mode === 'camp') {
      const lvl = r.cfg.level || 'minors';
      const key = lvl === 'majors' ? 'camp-majors' : 'camp';
      const prev = app.profile.career[key] || { stars: 0, best: 0 };
      app.profile.career[key] = { stars: Math.max(prev.stars, r.stars), best: Math.max(prev.best, r.score) };
      app.save();
      actions.append(btn(`${glyph('A')} START MY CAREER`, () => { this.replace(this.title()); this.push(this.career()); }, true, true));
      if (lvl === 'minors') actions.append(btn('🔥 Try Majors Camp', () => app.startCamp('majors')));
      actions.append(btn('↻ Camp again', () => app.startCamp(lvl)));
    } else {
      actions.append(btn(`${glyph('A')} PLAY AGAIN`, () => app.startArcade(r.mode), true, true));
      actions.append(btn('🕹️ Arcade', () => { this.replace(this.title()); this.push(this.arcade()); }));
    }
    actions.append(btn('🏠 Menu', () => this.replace(this.title())));
    wrap.append(actions);
    const s = this.screen('dim', wrap);
    s.canBack = false;
    s.back = () => this.replace(this.title());
    return s;
  }
}
