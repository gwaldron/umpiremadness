// Drills: short, focused practice on one kind of call (Rookie Camp → Drills). About 8-10 reps with
// instant feedback; a missed rep comes back at the end as a practice redo (same play, no points), and
// stars come from how many you got right on the first try.
import { shuffle } from '../util.js';
import { DIV } from '../data/divisions.js';
import { SITUATIONS, situationsFor } from '../data/situations.js';
import { FAIRFOUL_PLUS, FAIRFOUL_KINDS } from '../data/fairfoul.js';
import { CATCH_PLUS, CATCH_KINDS } from '../data/catches.js';
import { LESSON, buildLesson } from './lessons.js';

const sit = (id) => SITUATIONS.find((s) => s.id === id);

// n reps of one situation, cycling through its variants (shuffled, no back-to-back repeats)
function variantReps(id, kinds, n, key = 'k') {
  const def = sit(id);
  const out = [];
  while (out.length < n) {
    let round = shuffle([...kinds]);
    if (out.length && round[0] === out[out.length - 1].v[key] && round.length > 1) round = [...round.slice(1), round[0]];
    for (const k of round) if (out.length < n) out.push({ type: 'sit', def, v: { [key]: k } });
  }
  return out;
}

export const DRILLS = [
  {
    id: 'fairfoul', icon: '📏', title: 'Fair or Foul?', card: 'fair-foul', div: 'AAA',
    desc: 'Rollers that spin foul, balls over the bag, fly balls past the base, touched balls.',
    tip: "Before first or third base, a grounder is judged where it **stops or is touched**. Past the base, it's where it **first lands** (or where it **passes the bag**). The lines and bases are **fair**.",
    // 21 kinds of play (the 5 classics plus 16 families on either line), 12 different ones per drill
    reps: () => shuffle([
      ...['rollFoul', 'overBag', 'flyBounce', 'touchedFoul', 'hitsBag'].map((k) => ({ type: 'sit', def: sit('fairfoul'), v: { k } })),
      ...FAIRFOUL_KINDS.map((k) => ({ type: 'sit', def: FAIRFOUL_PLUS, v: { k, side: Math.random() < 0.5 ? '1B' : '3B' } })),
    ]).slice(0, 12),
  },
  {
    id: 'safeout', icon: '👟', title: 'Safe or Out?', card: 'force-play', div: 'AAA',
    desc: 'Force plays, steals, pickoffs and double plays. Watch for the pulled foot and the dropped ball!',
    tip: "On a force play, **listen** for the ball in the glove and **watch** the foot hit the bag. On a tag, watch the **glove touch the runner**. And there's no tie: **ball first = out**.",
    reps: () => shuffle([
      { type: 'base', play: 'force1B', runners: [] },
      { type: 'base', play: 'force1B', twist: 'pulled' },
      { type: 'base', play: 'force1B', twist: 'dropped' },
      { type: 'base', play: 'force1B', runners: [2] },
      { type: 'base', play: 'steal2B' },
      { type: 'base', play: 'steal2B' },
      { type: 'base', play: 'pickoff1B' },
      { type: 'base', play: 'steal3B' },
      { type: 'base', play: 'dp' },
      { type: 'base', play: 'hit2B' },
      { type: 'sit', def: sit('headfirst') }, // beat the tag... but how did he slide?
    ]),
  },
  {
    id: 'plate', icon: '🏠', title: 'Plays at the Plate', card: 'plate-plays', div: 'MAJ',
    desc: "You're the plate umpire: open the gate on a passed ball, work the wedge on a throw home, and make the call.",
    tip: "Pitch gets by? **Open the gate**: step out of the catcher's way, **away from the ball**. Throw coming home? **Work the wedge**: the triangle of you, the catcher and the runner coming in. Keep moving so it stays **open** and you can see between them. Then get set, watch the tag, and sell the call.",
    reps: () => shuffle([
      ...Array.from({ length: 4 }, () => ({ type: 'base', play: 'pbHome', tutorial: true })),
      ...Array.from({ length: 4 }, () => ({ type: 'base', play: 'throwHome', tutorial: true })),
    ]),
  },
  {
    id: 'catch', icon: '🫴', title: 'Catch or No Catch?', card: 'catch', div: 'AAA',
    desc: 'Diving grabs, traps, crashes into the fence, and balls bounced from one fielder to another.',
    tip: 'A catch needs **secure possession** in the glove or hand. Did the ball **touch the ground** first? Did he **hold on** through the fall?',
    // 14 kinds of play (the 4 classics plus 10 more), 10 different ones per drill
    reps: () => shuffle([
      ...['trap', 'clean', 'fence', 'carom'].map((k) => ({ type: 'sit', def: sit('catch'), v: { k } })),
      ...CATCH_KINDS.map((k) => ({ type: 'sit', def: CATCH_PLUS, v: { k } })),
    ]).slice(0, 10),
  },
  {
    id: 'interference', icon: '🚧', title: 'Interference & Obstruction', card: 'interference', div: 'AAA',
    desc: 'Runners hit by the ball, collisions, rundowns, the running lane, the catcher and the batter.',
    tip: "**Interference** is the **offense** getting in the way (runner, batter). **Obstruction** is a **fielder** without the ball getting in the runner's way. Decide who did it first!",
    reps: (div) => {
      const ids = ['hit-runner', 'collide', 'obs-delayed', 'obs-rundown', 'plate-block', 'slide-myth', 'ci', 'bi', 'lane', 'basepath'];
      const ok = new Set(situationsFor(div).map((s) => s.id));
      return shuffle(ids.filter((id) => ok.has(id))).map((id) => ({ type: 'sit', def: sit(id) }));
    },
  },
];

export const DRILL = Object.fromEntries(DRILLS.map((d) => [d.id, d]));

export function buildDrill(id) {
  if (LESSON[id]) return buildLesson(id); // the A/B/C position lessons run the same way
  const d = DRILL[id];
  const reps = d.reps(DIV[d.div]);
  return {
    mode: 'drill', drill: d.id, title: `Drill: ${d.title}`, badge: 'DRILL', div: d.div, redoMisses: true, reps: reps.length,
    events: [
      { type: 'info', title: `${d.icon} ${d.title.toUpperCase()}`, sub: `${reps.length} plays · miss one and you'll see it again at the end`, body: d.tip, card: d.card },
      ...reps,
    ],
  };
}
