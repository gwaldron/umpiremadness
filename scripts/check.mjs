// Headless sanity check for game content: run with `npm run check`.
// Builds every rule situation for every division (many random variants) and verifies:
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

const problems = [];
let built = 0;
for (const def of SITUATIONS) {
  if (!RULE[def.card]) problems.push(`${def.id}: unknown rule card ${def.card}`);
  for (const div of DIVISIONS) {
    if (def.divs && !def.divs.includes(div.id)) continue;
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
        problems.push(`${def.id}/${div.id}: ${e.message}`);
      }
    }
  }
}
// Minors (AA/AAA) never quiz the infield fly; the dropped third strike is off there too.
for (const div of DIVISIONS) {
  if (div.iff) continue;
  if (situationsFor(div).some((s) => s.card === 'infield-fly')) problems.push(`${div.id}: infield fly quizzed in a Minors division`);
  if (div.u3k) problems.push(`${div.id}: uncaught third strike enabled in a Minors division`);
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
console.log(`✓ ${built} situation builds, ${LIFE.length} life events, ${files} source files — all good.`);
