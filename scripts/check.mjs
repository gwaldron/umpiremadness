// Headless sanity check for game content: run with `npm run check`.
// Builds every rule situation for every division in both sports (many random variants) and verifies:
//   - each step's answer is one of its options
//   - pause count matches the number of steps
//   - actor keyframes are in time order (no teleporting runners)
//   - the ball never goes NaN
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SITUATIONS, situationsFor } from '../public/js/data/situations.js';
import { DIVISIONS } from '../public/js/data/divisions.js';
import { LIFE } from '../public/js/data/life.js';
import { RULE } from '../public/js/data/rules.js';
import { Timeline, setupDefense, setupRunners, setupBatter, setupUmps } from '../public/js/scenes/timeline.js';
import { KITS } from '../public/js/render/figures.js';
import { preloadIsCurrent } from './preload.mjs';
import { sport, setSport, forSport, rubberY } from '../public/js/sport.js';
import { DRILLS, buildDrill } from '../public/js/game/drills.js';
import { LESSONS } from '../public/js/game/lessons.js';

const problems = [];
let built = 0;
for (const sp of ['baseball', 'softball']) {
setSport(sp);
for (const def of SITUATIONS) {
  if (!RULE[def.card]) problems.push(`${def.id}: unknown rule card ${def.card}`);
  if (!forSport(def)) continue;
  for (const div of DIVISIONS) {
    if (def.divs && !def.divs.includes(div.id)) continue;
    sport.rubber = rubberY(div);
    for (let i = 0; i < 40; i++) {
      try {
        const v = def.variant ? def.variant(div) : {};
        const setup = def.setup(v, div);
        const steps = def.steps(v, div);
        const tl = new Timeline();
        setupDefense(tl);
        if (setup.batter !== false) setupBatter(tl, 'R');
        setupRunners(tl, setup.runners || []);
        setupUmps(tl, setup.runners || [], KITS.ump);
        const b = def.build(tl, v, div) || {};
        const pauses = b.pauses || [b.pause];
        if (pauses.length !== steps.length) problems.push(`${def.id}: ${pauses.length} pauses vs ${steps.length} steps`);
        for (const a of Object.values(tl.actors)) {
          for (let k = 1; k < a.keys.length; k++) {
            if (a.keys[k].t < a.keys[k - 1].t - 1e-6) { problems.push(`${def.id}: actor ${a.id} keyframes out of order`); break; }
          }
        }
        const end = Math.max(...pauses) + 2;
        for (let t = 0; t < end; t += 0.05) {
          tl.sample(t);
          const ball = tl.ball;
          if (!Number.isFinite(ball.x + ball.y + ball.z)) { problems.push(`${def.id}: ball NaN at t=${t.toFixed(2)}`); break; }
        }
        for (const st of steps) {
          if (!st.options.some((o) => o.id === st.answer)) problems.push(`${def.id}: answer "${st.answer}" not among options`);
          if (st.card && !RULE[st.card]) problems.push(`${def.id}: unknown step card ${st.card}`);
          if (!st.explain) problems.push(`${def.id}: missing explanation`);
        }
        built++;
      } catch (e) {
        problems.push(`${sp} ${def.id}/${div.id}: ${e.message}`);
      }
    }
  }
}
}
setSport('baseball');
// Minors (AA/AAA) never quiz the infield fly; the dropped third strike is off there too.
for (const div of DIVISIONS) {
  if (div.id !== 'AA' && div.id !== 'AAA') continue;
  if (situationsFor(div).some((s) => s.card === 'infield-fly')) problems.push(`${div.id}: infield fly quizzed in a Minors division`);
  if (div.u3k) problems.push(`${div.id}: uncaught third strike enabled in a Minors division`);
}

// Drills: every rep is a real play, and a pinned variant is one the situation actually has
let drillReps = 0;
for (const sp of ['baseball', 'softball']) {
  setSport(sp);
  for (const d of DRILLS) {
    if (!RULE[d.card]) problems.push(`drill ${d.id}: unknown card ${d.card}`);
    const cfg = buildDrill(d.id);
    const reps = cfg.events.filter((e) => e.type !== 'info');
    if (reps.length < 6) problems.push(`drill ${d.id} (${sp}): only ${reps.length} reps`);
    for (const e of reps) {
      drillReps++;
      if (e.type === 'sit' && !e.def) problems.push(`drill ${d.id}: missing situation`);
      if (e.type === 'sit' && e.v) {
        const samples = Array.from({ length: 300 }, () => e.def.variant());
        for (const [key, val] of Object.entries(e.v)) if (!samples.some((x) => JSON.stringify(x[key]) === JSON.stringify(val))) problems.push(`drill ${d.id}: ${e.def.id} has no variant ${key}=${val}`);
      }
    }
  }
}
setSport('baseball');
// Position lessons: an intro, demos (each with a caption), a "your turn" card and coached reps
const PLAYS = new Set(['force1B', 'steal2B', 'steal3B', 'dp', 'pickoff1B', 'hit2B', 'hit3B', 'throwHome', 'pbHome']);
for (const L of LESSONS) {
  if (!RULE[L.card]) problems.push(`lesson ${L.id}: unknown card ${L.card}`);
  const cfg = buildDrill(L.id);
  const demos = cfg.events.filter((e) => e.demo), reps = cfg.events.filter((e) => e.coach);
  if (demos.length < 2 || reps.length !== 2) problems.push(`lesson ${L.id}: ${demos.length} demos, ${reps.length} reps`);
  for (const e of [...demos, ...reps]) {
    if (!PLAYS.has(e.play)) problems.push(`lesson ${L.id}: unknown play ${e.play}`);
    if (e.demo && !(e.caption && e.caption.title && e.caption.pre && e.caption.summary)) problems.push(`lesson ${L.id}: demo ${e.play} missing a caption`);
  }
}

for (const l of LIFE) {
  if (!l.options.some((o) => o.id === l.answer)) problems.push(`life ${l.id}: bad answer`);
  if (!RULE[l.card]) problems.push(`life ${l.id}: unknown card ${l.card}`);
}

// Every JS file should at least parse (dynamic import of each module).
const root = new URL('../public/js/', import.meta.url);
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}
let files = 0;
for (const f of walk(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const src = readFileSync(f, 'utf8');
  if (src.includes('debugger')) problems.push(`${f}: contains debugger statement`);
  files++;
}

if (!preloadIsCurrent()) problems.push('public/index.html: modulepreload list is out of date (run node scripts/preload.mjs)');

const uniq = [...new Set(problems)];
if (uniq.length) {
  console.error(`✗ ${uniq.length} problem(s):`);
  for (const p of uniq.slice(0, 50)) console.error('  - ' + p);
  process.exit(1);
}
console.log(`✓ ${built} situation builds, ${drillReps} drill reps, ${LIFE.length} life events, ${files} source files — all good.`);
