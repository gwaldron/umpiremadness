// Rookie Camp position lessons (A, B, C): first watch the umpire's track on a ball in the infield and a
// ball to the outfield (the demo umpire moves by himself along a dotted gold track, with captions), then
// do it yourself twice: one ball in the infield, one to the outfield. After each call your trail is drawn
// next to the gold track, with notes.
// The movements follow Umpire Bootcamp's A/B/C position and working-area lessons.
const rep = (play, extra = {}) => ({ type: 'base', play, coach: true, ...extra });
const demo = (play, caption, extra = {}) => ({ type: 'base', play, demo: true, tutorial: true, caption, ...extra });
const badge = (letter) => `<span class="pos-badge">${letter}</span>`;

export const LESSONS = [
  {
    id: 'posA', icon: badge('A'), title: 'A Position', card: 'abc', div: 'AAA',
    desc: 'Bases empty: start in foul ground behind first. Ball in the infield? Step into fair territory for an angle. Ball to the outfield? Come into the working area.',
    intro: 'With the **bases empty**, the base umpire starts in **A**: in **foul ground behind first base**, facing the plate. From A there are two reads: **ball stays in the infield** → step into **fair territory** and get an angle on the play at first. **Ball goes to the outfield** → come **into the infield working area**, pivot, and watch the batter-runner touch first. Watch the **gold dots**.',
    demos: [
      demo('force1B', { title: 'A POSITION · BALL IN THE INFIELD', pre: 'Bases empty: start in A, in foul ground behind first base. Watch the gold dots.',
        summary: 'Ball stayed in the infield, so the umpire **came well into fair territory**, to a spot about **45 degrees off the foul line** (halfway between the foul line and the baseline), for a clear **angle on the play at first**. Then he **stopped and got set** before the ball arrived, watched the foot hit the bag, listened for the glove, and made the call.' }, { runners: [] }),
      demo('hit2B', { title: 'A POSITION · BALL TO THE OUTFIELD', pre: 'Bases empty again. This time the ball goes to the outfield. Watch where he goes.',
        summary: 'Ball to the outfield, so the umpire **came into the infield working area**, pivoted to watch the batter-runner **touch first**, and was already in place for the **play at second**. Remember: ball stays in the infield, you stay out. Ball goes to the outfield, you come in.' }, { runners: [] }),
    ],
    // your turn: one ball in the infield, one to the outfield
    reps: () => [rep('force1B', { runners: [] }), rep('hit2B', { runners: [] })],
  },
  {
    id: 'posB', icon: badge('B'), title: 'B Position', card: 'abc', div: 'AAA',
    desc: 'Runner on first only: start in B. Ball in the infield? Hold your spot. Ball to the outfield? Come into the working area. Steal? Follow the runner.',
    intro: 'With a runner on **first base only**, start in **B**: behind the infielders between first and second, back by the edge of the outfield grass. **Ball stays in the infield** → **hold your spot** and adjust a step or two to see the play. **Ball goes to the outfield** → move **into the working area**. **Steal** → follow the runner and get an angle on the tag at second, staying out of his path.',
    demos: [
      demo('dp', { title: 'B POSITION · BALL IN THE INFIELD', pre: 'Runner on first: start in B. Watch what he does on a ground ball.',
        summary: 'Ball stayed in the infield, so from B the umpire **held his spot** and adjusted only a step or two to see the force at second, then turned to see the relay to first. **Don\'t chase the play**: from B you already have the angle.' }, { hold: true }),
      demo('hit3B', { title: 'B POSITION · BALL TO THE OUTFIELD', pre: 'Runner on first again. A base hit to the outfield. Watch him come in.',
        summary: 'Ball to the outfield, so the umpire **let the runner go by first**, then came into the **working area**: just north of the mound, about even with second and third. He **never goes past the mound** toward home, and kept the ball in front of him for the **play at third**.' }),
      demo('steal2B', { title: 'B POSITION · STEAL', pre: 'Runner on first. He\'s going! Watch the umpire follow the play.',
        summary: 'On the steal, the umpire **followed the runner** toward second, **stayed out of his path**, and **stopped** with an angle that shows the **tag and the base** together.' }),
    ],
    reps: () => [rep('dp', { hold: true }), rep('hit3B')],
  },
  {
    id: 'posC', icon: badge('C'), title: 'C Position', card: 'abc', div: 'AAA',
    desc: 'Runner on second or third: start in C. Same reads as B: hold on an infield ball, come in on an outfield ball, follow a steal.',
    intro: 'With a runner on **second or third**, start in **C**: behind the infielders between second and third, back by the edge of the outfield grass. The reads are the **same as B**: **ball in the infield** → **hold your spot** and adjust; **ball to the outfield** → **into the working area**; **steal** → follow the runner to an angle at third.',
    demos: [
      demo('force1B', { title: 'C POSITION · BALL IN THE INFIELD', pre: 'Runner on second: start in C. Watch him on a ground ball.',
        summary: 'Ball stayed in the infield, so from C the umpire **held his spot** and adjusted a step for the **play at first**, keeping the runner from second in view too.' }, { runners: [2], hold: true }),
      demo('hit2B', { title: 'C POSITION · BALL TO THE OUTFIELD', pre: 'Runner on second. A hit to the outfield. Watch him come in.',
        summary: 'Ball to the outfield, so the umpire **let the runner from second go by**, then came into the **working area**: just north of the mound, about even with second and third, never past the mound. The runner scored, and he was in place for the **play at second** on the batter-runner.' }, { runners: [2] }),
      demo('steal3B', { title: 'C POSITION · STEAL', pre: 'Runner on second. He\'s going to third! Watch the umpire.',
        summary: 'On the steal of third, the umpire **followed the play** toward third, stayed out of the runner\'s path, and **stopped** with an angle on the tag.' }),
    ],
    reps: () => [rep('force1B', { runners: [2], hold: true }), rep('hit2B', { runners: [2] })],
  },
];

export const LESSON = Object.fromEntries(LESSONS.map((l) => [l.id, l]));

export function buildLesson(id) {
  const L = LESSON[id];
  const reps = L.reps();
  return {
    mode: 'drill', drill: L.id, lesson: true, title: `Lesson: ${L.title}`, badge: 'LESSON', div: L.div, redoMisses: true, reps: reps.length,
    events: [
      { type: 'info', title: `📍 ${L.title.toUpperCase()}`, sub: 'First watch, then your turn', body: L.intro, card: L.card },
      ...L.demos,
      { type: 'info', title: 'YOUR TURN!', sub: 'One ball in the infield, one to the outfield · your track vs. the gold dots after each call', body: 'Take your starting spot, then move on the hit just like the demo: on a ball in the **infield**, **hold** (from B or C) or **step in for an angle** (from A); on a ball to the **outfield**, **come into the working area**. Get **set** before the play, then make the call.', card: L.card },
      ...reps,
    ],
  };
}
