// Baseball or softball: one switch for the whole game. It moves the pitcher (mound or circle),
// swaps the ball, the delivery and the players, and picks which rule situations come up.
// Rule differences follow Umpire Bootcamp's "Softball rules" lessons (leaving early, the circle rule).
import { DIVISIONS } from './data/divisions.js';

// rubber: front edge of the pitching rubber for the game being played (set by the app per division)
export const sport = { id: 'baseball', softball: false, rubber: 46 };

// Softball versions of the career ladder. Little League softball pitches from 35 ft in the Minor
// Division and 40 ft in Majors and up, and its World Series is played in Greenville, NC.
const SOFTBALL_DIVS = {
  AA: { full: 'AA Minors', blurb: 'Rookie windmill pitchers from 35 feet. Runners wait until the pitch reaches the batter.', mph: [28, 36] },
  AAA: { full: 'AAA Minors', blurb: 'Faster windmills, real steals, and still no dropped third strike.', mph: [32, 41] },
  MAJ: { full: 'Majors', blurb: 'The 40-foot circle: runners go on the release, plus the dropped third strike and the circle rule.', mph: [38, 48] },
  AS: { full: 'District All-Stars', blurb: 'Tournament softball. Big crowds, loud coaches, painted corners.', mph: [43, 54] },
  WS: { name: 'Greenville', full: 'Little League Softball World Series', blurb: 'The big show in Greenville, North Carolina, on national TV. The closest plays of your career.', mph: [47, 60] },
};
const BASEBALL_DIVS = Object.fromEntries(DIVISIONS.map((d) => [d.id, { name: d.name, full: d.full, blurb: d.blurb, mph: d.mph }]));

const listeners = new Set();
export function onSport(fn) { listeners.add(fn); }

export function setSport(id) {
  const sb = id === 'softball';
  sport.id = sb ? 'softball' : 'baseball';
  sport.softball = sb;
  for (const d of DIVISIONS) Object.assign(d, BASEBALL_DIVS[d.id], sb ? SOFTBALL_DIVS[d.id] : null);
  for (const fn of listeners) fn(sport);
}

const MINORS = (div) => !div || div.id === 'AA' || div.id === 'AAA';

// Front edge of the pitching rubber (feet from the back point of home plate).
export function rubberY(div) {
  if (!sport.softball) return 46;
  return MINORS(div) ? 35 : 40;
}
export const CIRCLE_R = 8; // softball pitching circle: 16 ft across

// Ball radius in feet: a baseball is 9 in around; Little League softball uses an 11-in ball in the
// Minor Division and a 12-in ball in Majors and up.
export function ballR(div) {
  if (!sport.softball) return 0.121;
  return MINORS(div) ? 0.146 : 0.159;
}
// Where a scripted pitch leaves the hand, and how high the pitcher holds the ball before it
export function releasePt() {
  return sport.softball ? { x: -0.7, y: sport.rubber - 2.6, z: 2.0 } : { x: -1, y: 42, z: 5 };
}
export function holdZ() { return sport.softball ? 3.2 : 5; }

// Situations and rule cards tagged sport: 'baseball' | 'softball' only come up in that sport
export function forSport(x) { return !x.sport || x.sport === sport.id; }

export function ballColor() { return sport.softball ? '#e4f23c' : '#fbfbf6'; }
export function seamColor() { return '#d0302f'; }

// Softball wording: the players are girls. Swaps he/him/his for she/her in game text.
const SWAP = { he: 'she', him: 'her', his: 'her', himself: 'herself', He: 'She', Him: 'Her', His: 'Her', Himself: 'Herself', HE: 'SHE', HIM: 'HER', HIS: 'HER' };
export function txt(s) {
  if (!sport.softball || typeof s !== 'string') return s;
  return s.replace(/\b(he|him|his|himself|He|Him|His|Himself|HE|HIM|HIS)\b/g, (w) => SWAP[w]);
}
