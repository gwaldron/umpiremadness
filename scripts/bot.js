// Debug autoplayer. Paste into the browser console (or inject) on a running game.
// Usage: __bot.start({ smart: true, speed: 2 })  →  __bot.report()
(() => {
  const app = window.__ump;
  const bot = {
    log: [], errors: [], timer: null, picks: 0, events: new Set(),
    start({ smart = true, speed = 2, mode = null } = {}) {
      this.smart = smart;
      app.speed = speed;
      window.addEventListener('error', (e) => this.errors.push(String(e.message) + ' @' + e.filename + ':' + e.lineno));
      window.addEventListener('unhandledrejection', (e) => this.errors.push('rej ' + String(e.reason)));
      const origErr = console.error;
      console.error = (...a) => { this.errors.push(a.map(String).join(' ')); origErr(...a); };
      this.timer = setInterval(() => this.tick(), 250);
    },
    stop() { clearInterval(this.timer); app.speed = 1; },
    tick() {
      const s = app.session;
      const hud = app.hud;
      if (!s) return;
      if (s.ev) this.events.add(s.ev.kind + ':' + (s.ev.play || (s.ev.def && s.ev.def.id) || ''));
      if (s.paused) return;
      if (hud.verdictHandler) { hud._continue(); return; }
      if (hud.optHandler && hud.optList.length) {
        const ev = s.ev;
        let pick = hud.optList[Math.floor(Math.random() * hud.optList.length)].btn;
        // Prefer the right answer sometimes when it is cheaply knowable
        if (this.smart && ev && ev.kind === 'atbat' && ev.pk && ev.pk.judge && ev.pk.t > ev.pk.tGlove + 0.3) {
          const o = hud.optList.find((x) => x.id === (ev.pk.judge.strike || ev.pk.kind === 'swingMiss' ? 'strike' : 'ball'));
          if (o) pick = o.btn;
        }
        if (ev && ev.kind === 'atbat' && ev.pk && ev.pk.kind && ['take', 'swingMiss', 'check'].includes(ev.pk.kind) && ev.pk.t < ev.pk.tGlove + 0.3) return; // wait for the glove
        if (ev && ev.kind === 'base' && ev.state === 'cam' && ev.cam && ev.cam.seenAt === null) return;
        if (this.smart && ev && ev.kind === 'base' && ev.state === 'cam') {
          const c = ev.crits[ev.critIdx];
          pick = c.out ? 'A' : 'B';
        }
        if (this.smart && ev && ev.kind === 'sit' && ev.state === 'ask') {
          const st = ev.steps[ev.stepIdx];
          pick = (hud.optList.find((x) => x.id === st.answer) || {}).btn || pick;
        }
        this.picks++;
        hud._pick(pick);
      }
    },
    report() {
      return { picks: this.picks, errors: this.errors.slice(0, 20), events: [...this.events], session: app.session ? { idx: app.session.idx, score: app.session.score, calls: app.session.calls, ok: app.session.correctCalls, ended: app.session.ended } : null, screen: app.screens.current && app.screens.current.el.className };
    },
  };
  window.__bot = bot;
})();
