// Achievements. `check(p, ctx)` runs after every call and at the end of every game.
// p = profile, ctx = { result?, game? }
const S = (p) => p.stats;
const card = (p, id) => (p.cards[id] && p.cards[id].correct) || 0;

export const ACHIEVEMENTS = [
  { id: 'first', icon: '⚾', name: 'Play Ball!', desc: 'Make your very first call.', check: (p) => S(p).calls >= 1 },
  { id: 'calls100', icon: '💯', name: 'Century Club', desc: 'Make 100 calls.', check: (p) => S(p).calls >= 100 },
  { id: 'calls500', icon: '🦾', name: 'Iron Ump', desc: 'Make 500 calls.', check: (p) => S(p).calls >= 500 },
  { id: 'streak10', icon: '🦅', name: 'Eagle Eye', desc: '10 correct calls in a row.', check: (p) => S(p).maxStreak >= 10 },
  { id: 'streak25', icon: '🤖', name: 'Robo-Ump', desc: '25 correct calls in a row.', check: (p) => S(p).maxStreak >= 25 },
  { id: 'streak50', icon: '🧊', name: 'Absolute Zero', desc: '50 correct calls in a row. Ice cold.', check: (p) => S(p).maxStreak >= 50 },
  { id: 'punchout', icon: '👊', name: 'Punch Out', desc: 'Ring up 10 strike threes.', check: (p) => S(p).strikeThrees >= 10 },
  { id: 'painted', icon: '🎨', name: 'Painted Corner', desc: 'Correctly call a pitch within 1 inch of the zone edge.', check: (p) => S(p).painted >= 1 },
  { id: 'painter', icon: '🖼️', name: 'Picasso', desc: 'Correctly call 15 painted-corner pitches.', check: (p) => S(p).painted >= 15 },
  { id: 'framed', icon: '🕵️', name: 'Frame Job Foiled', desc: 'Call a ball even though the catcher framed it into the zone.', check: (p) => S(p).framedFoiled >= 1 },
  { id: 'slot', icon: '🎯', name: 'Slot Machine', desc: 'Be set in the slot for 25 pitches.', check: (p) => S(p).slotOk >= 25 },
  { id: 'patience', icon: '🧘', name: 'Patience, Grasshopper', desc: '25 perfectly timed calls.', check: (p) => S(p).perfectTiming >= 25 },
  { id: 'jumped', icon: '🐇', name: 'Jumped the Gun', desc: 'Call a pitch before it reaches the glove. (Oops.)', hidden: true, check: (p) => S(p).early >= 1 },
  { id: 'bangbang', icon: '💥', name: 'Bang-Bang!', desc: 'Get a play right that was decided by less than 0.05 seconds.', check: (p) => S(p).bangBang >= 1 },
  { id: 'bangbang10', icon: '🎆', name: 'No Such Thing as a Tie', desc: 'Get 10 bang-bang plays right.', check: (p) => S(p).bangBang >= 10 },
  { id: 'angle', icon: '📐', name: 'Angle Master', desc: 'Earn an A position grade on 10 base plays.', check: (p) => S(p).angleA >= 10 },
  { id: 'abc', icon: '🔤', name: 'Easy as A-B-C', desc: 'Start in the correct A, B, or C spot 15 times.', check: (p) => S(p).startOk >= 15 },
  { id: 'ouch', icon: '🤕', name: 'Human Backstop', desc: 'Get drilled by a throw while standing in the lane. Ouch!', hidden: true, check: (p) => S(p).ouch >= 1 },
  { id: 'dp', icon: '✌️', name: 'Double Trouble', desc: 'Get both calls right on a double play.', check: (p) => S(p).dpBoth >= 1 },
  { id: 'iff', icon: '🪁', name: 'Infield Fly Guy', desc: 'Rule correctly on 5 infield-fly situations.', check: (p) => card(p, 'infield-fly') >= 5 },
  { id: 'obstruct', icon: '🧱', name: 'Obstruction Detective', desc: 'Rule correctly on 5 obstruction or interference plays.', check: (p) => card(p, 'obstruction') + card(p, 'interference') + card(p, 'batter-interference') + card(p, 'catchers-interference') + card(p, 'running-lane') >= 5 },
  { id: 'u3k', icon: '🏃', name: 'Drop It Like It\'s Hot', desc: 'Rule correctly on 5 uncaught third strikes.', check: (p) => card(p, 'uncaught-third-strike') >= 5 },
  { id: 'timing', icon: '⏳', name: 'Timing Is Everything', desc: 'Get a timing play right.', check: (p) => card(p, 'timing-play') >= 1 },
  { id: 'appeal', icon: '🤐', name: 'Say Nothing', desc: 'Handle 3 appeal plays the right way.', check: (p) => card(p, 'appeal-tagup') + card(p, 'appeal-missed') >= 3 },
  { id: 'myths', icon: '🧨', name: 'Myth Buster', desc: 'Bust 5 rule myths.', check: (p) => card(p, 'myth-hands') + card(p, 'bang-bang') + card(p, 'myth-slide') + card(p, 'myth-bunt') >= 5 },
  { id: 'local', icon: '📋', name: 'Know Your Division', desc: 'Get FXLL local rules right in both AA and AAA.', check: (p) => card(p, 'local-aa') >= 1 && card(p, 'local-aaa') >= 1 },
  { id: 'coach', icon: '😎', name: 'Ice Cold', desc: 'Handle 5 coaches the right way.', check: (p) => card(p, 'handling-questions') >= 5 },
  { id: 'safety', icon: '⛑️', name: 'Safety First', desc: 'Make 3 correct safety decisions.', check: (p) => card(p, 'safety') + card(p, 'equipment') >= 3 },
  { id: 'cards10', icon: '🗂️', name: 'Card Collector', desc: 'Unlock 10 rule cards.', check: (p) => Object.keys(p.cards).length >= 10 },
  { id: 'cardsAll', icon: '📚', name: 'Walking Rulebook', desc: 'Unlock 28 rule cards.', check: (p) => Object.keys(p.cards).length >= 28 },
  { id: 'perfect', icon: '💎', name: 'Perfect Game', desc: 'Finish a career game with every call right.', check: (p) => S(p).perfectGames >= 1 },
  { id: 'hattrick', icon: '🌟', name: 'Hat Trick', desc: 'Earn 3 stars on 3 career games.', check: (p) => S(p).threeStars >= 3 },
  { id: 'gradAA', icon: '🎓', name: 'AA Graduate', desc: 'Finish every AA game.', check: (p) => done(p, 'AA', 4) },
  { id: 'gradAAA', icon: '🎓', name: 'AAA Graduate', desc: 'Finish every AAA game.', check: (p) => done(p, 'AAA', 4) },
  { id: 'gradMAJ', icon: '🔥', name: 'Majors Material', desc: 'Finish every Majors game.', check: (p) => done(p, 'MAJ', 4) },
  { id: 'allstar', icon: '⭐', name: 'All-Star Ump', desc: 'Finish every All-Star game.', check: (p) => done(p, 'AS', 4) },
  { id: 'champion', icon: '🏆', name: 'Williamsport Champion', desc: 'Work the Little League World Series Championship. Unlocks gold gear!', check: (p) => !!(p.career['WS-2'] && p.career['WS-2'].stars >= 1) },
  { id: 'blitz20', icon: '⚡', name: 'Blitz Kid', desc: 'Get 15+ calls right in one Blitz.', check: (p) => p.best.blitz >= 15 },
  { id: 'blitz35', icon: '🌩️', name: 'Lightning Blue', desc: 'Get 25+ calls right in one Blitz.', check: (p) => p.best.blitz >= 25 },
  { id: 'ejected', icon: '🚪', name: 'Ejected!', desc: 'Run out of lives in a survival mode. It happens to the best of us.', hidden: true, check: (p) => S(p).ejections >= 1 },
  { id: 'pad', icon: '🎮', name: 'Controller Connected', desc: 'Play with a game controller.', check: (p) => S(p).gamepad >= 1 },
  { id: 'locker', icon: '👕', name: 'Looking Sharp', desc: 'Customize your gear in the Locker Room.', check: (p) => S(p).lockerChanged >= 1 },
  { id: 'reader', icon: '📖', name: 'Bookworm', desc: 'Open 10 rule cards to read them.', check: (p) => S(p).cardsRead >= 10 },
  { id: 'days3', icon: '📅', name: 'Regular', desc: 'Play 3 days in a row.', check: (p) => S(p).dayStreak >= 3 },
  { id: 'level10', icon: '🧙', name: 'Zone Wizard', desc: 'Reach level 10.', check: (p, ctx) => ctx.level >= 10 },
];

function done(p, div, n) {
  for (let i = 0; i < n; i++) if (!(p.career[`${div}-${i}`] && p.career[`${div}-${i}`].stars >= 1)) return false;
  return true;
}

export const ACH = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
