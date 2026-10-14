// Career ladder. Local-rule flags follow the Umpire Bootcamp FXLL rule cards.
export const DIVISIONS = [
  {
    id: 'AA', name: 'AA', full: 'AA Minors', icon: '🧢', color: '#3fa2ff',
    blurb: 'Kid-pitch rookies. Slower pitches, big zone helpers, and FXLL local rules.',
    mph: [34, 42], heights: [3.9, 4.6], edge: [1.2, 5.5], hints: true, zoneHelper: true,
    iff: false, u3k: false, local: 'AA',
    bangBang: [0.2, 0.45], unlock: 0, games: 4,
  },
  {
    id: 'AAA', name: 'AAA', full: 'AAA Minors', icon: '⚾', color: '#2fd67b',
    blurb: 'Faster arms, real steals, and still no infield fly or dropped third strike.',
    mph: [40, 50], heights: [4.2, 4.9], edge: [0.9, 4.5], hints: true, zoneHelper: false,
    iff: false, u3k: false, local: 'AAA',
    bangBang: [0.17, 0.4], unlock: 6, games: 4,
  },
  {
    id: 'MAJ', name: 'Majors', full: 'Majors', icon: '🔥', color: '#ff7a1a',
    blurb: 'Full Little League rules: infield fly, uncaught third strike, and tougher pitches.',
    mph: [48, 60], heights: [4.4, 5.4], edge: [0.6, 3.5], hints: false, zoneHelper: false,
    iff: true, u3k: true, local: null,
    bangBang: [0.14, 0.34], unlock: 14, games: 4,
  },
  {
    id: 'AS', name: 'All-Stars', full: 'District All-Stars', icon: '⭐', color: '#c07bff',
    blurb: 'Tournament baseball. Big crowds, loud coaches, painted corners.',
    mph: [55, 66], heights: [4.6, 5.6], edge: [0.35, 2.6], hints: false, zoneHelper: false,
    iff: true, u3k: true, local: null,
    bangBang: [0.12, 0.3], unlock: 24, games: 4,
  },
  {
    id: 'WS', name: 'Williamsport', full: 'Little League World Series', icon: '🏆', color: '#ffd34d',
    blurb: 'The big show on national TV. The closest plays of your career.',
    mph: [60, 72], heights: [4.8, 5.8], edge: [0.2, 2.0], hints: false, zoneHelper: false,
    iff: true, u3k: true, local: null,
    bangBang: [0.1, 0.26], unlock: 34, games: 3,
  },
];

export const DIV = Object.fromEntries(DIVISIONS.map((d) => [d.id, d]));

export const GAME_NAMES = {
  AA: ['Opening Day', 'Saturday Doubleheader', 'Under the Lights', 'AA Championship'],
  AAA: ['Rivalry Night', 'Picture Day Game', 'Rain Delay Special', 'AAA Championship'],
  MAJ: ['Majors Opener', 'Sunday Showdown', 'Packed Bleachers', 'City Championship'],
  AS: ['District Opener', 'Elimination Game', 'Sectional Final', 'State Title'],
  WS: ['Pool Play', 'U.S. Final', 'World Series Championship'],
};

// Which role you work in each career game (two-umpire crew alternates).
export function gameRole(divId, idx) {
  if (divId === 'WS' && idx === 2) return 'mixed';
  if (idx === 3) return 'mixed';
  return idx % 2 === 0 ? 'plate' : 'bases';
}
