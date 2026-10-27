// Game-management moments: coaches, parents, safety, equipment. Quick 3-choice decisions.
export const LIFE = [
  {
    id: 'tie-coach', card: 'bang-bang', who: 'Coach Rizzo', role: 'Visiting manager', mood: 'mad',
    text: '"Come ON, Blue! That was a tie — and the tie goes to the runner! Everybody knows that!"',
    options: [
      { id: 'a', label: '"Coach, there\'s no tie rule. The ball beat him. Let\'s play."' },
      { id: 'b', label: '"You\'re right, coach. Tie goes to the runner. He\'s safe."' },
      { id: 'c', label: '"One more word and you\'re gone!"' },
    ],
    answer: 'a',
    explain: 'There is **no "tie goes to the runner" rule**. Stay calm, answer the actual question in one sentence, and get the game moving. Don\'t change a judgment call because someone yelled, and don\'t threaten an ejection for a single complaint.',
  },
  {
    id: 'bunt-myth', card: 'myth-bunt', who: 'Coach Hayes', role: 'Home manager', mood: 'mad',
    text: '"Blue! The batter squared around and left the bat over the plate. That\'s a strike — the bat never came back!" (The pitch was a foot outside, and the batter never moved the bat at it.)',
    options: [
      { id: 'a', label: '"Ball, coach. Holding the bat there isn\'t an attempt. The batter has to offer at the pitch."' },
      { id: 'b', label: '"You\'re right, coach. Didn\'t pull it back, so it\'s a strike."' },
      { id: 'c', label: '"Any bat over the plate is a bunt. Strike."' },
    ],
    answer: 'a',
    explain: 'There\'s **no "pull the bat back" rule**. A bunt attempt (a strike) means the batter **offers at the pitch** by moving the bat toward the ball. Just holding the bat in the zone on a pitch outside it is a **ball**. Answer in one sentence and play on.',
  },
  {
    id: 'strike-zone-coach', card: 'handling-questions', who: 'Coach Park', role: 'Home manager', mood: 'mad',
    text: '"That pitch was in the dirt! Where was that, Blue?!"',
    options: [
      { id: 'a', label: 'Ignore it. Turn around and get set for the next pitch.' },
      { id: 'b', label: 'Walk over and argue about where the pitch was.' },
      { id: 'c', label: 'Tell the catcher to tell his coach to be quiet.' },
    ],
    answer: 'a',
    explain: 'A single grumble about balls and strikes is **normal disappointment**, not a crisis. Don\'t argue judgment calls and don\'t drag players into it. Get set and keep the same zone. If it turns personal or keeps going, then address it calmly.',
  },
  {
    id: 'rule-question', card: 'handling-questions', who: 'Coach Alvarez', role: 'Visiting manager', mood: 'confused',
    text: '"Hey ump, quick question — why wasn\'t that an infield fly? Runners were on first and second!"',
    options: [
      { id: 'a', label: '"There were two outs, coach — the rule only applies with fewer than two."' },
      { id: 'b', label: '"Judgment call, coach. Go sit down."' },
      { id: 'c', label: '"I don\'t have to explain anything to you."' },
    ],
    answer: 'a',
    explain: 'A **rule question** deserves a **short, clear answer** using the rule\'s words. Listen, answer the real question in a sentence, and put the ball back in play. Being curt just makes things worse.',
  },
  {
    id: 'parent', card: 'handling-questions', who: 'Loud Parent', role: 'Bleachers, third-base side', mood: 'mad',
    text: '"Get some glasses, ump! You\'re blind! BOOOO!"',
    options: [
      { id: 'a', label: 'Don\'t engage the stands. If it keeps up, ask the manager or Game Coordinator to handle it.' },
      { id: 'b', label: 'Turn around and yell back at the parent.' },
      { id: 'c', label: 'Stop the game and lecture the whole crowd.' },
    ],
    answer: 'a',
    explain: '**Never argue with spectators.** If it\'s disruptive or keeps going, bring in the **manager** or the **Game Coordinator / site leader** — handling fans is their job. You keep umpiring.',
  },
  {
    id: 'partner-help', card: 'handling-questions', who: 'Coach Brooks', role: 'Home manager', mood: 'confused',
    text: '"Blue, I think the first baseman dropped the ball after the tag. Can you ask your partner? He had a better look."',
    options: [
      { id: 'a', label: 'Meet privately with your partner, then give one final answer.' },
      { id: 'b', label: '"Nope. I made my call."' },
      { id: 'c', label: 'Ask the crowd what they saw.' },
    ],
    answer: 'a',
    explain: 'Judgment calls aren\'t votes, but if **your partner may have seen something you missed** (like a dropped ball), it\'s smart to **meet privately** and get it right. Then state the final ruling and play on.',
  },
  {
    id: 'lightning', card: 'safety', who: 'Thunder', role: 'Sky, 3rd inning', mood: 'storm',
    text: 'You hear thunder in the distance. The home coach says, "It\'s far away — let\'s just finish the inning!"',
    options: [
      { id: 'a', label: 'Stop the game now and follow the league\'s lightning procedure.' },
      { id: 'b', label: 'Finish the inning, then decide.' },
      { id: 'c', label: 'Let both coaches vote on it.' },
    ],
    answer: 'a',
    explain: '**Weather is not a judgment contest.** Follow the league\'s written lightning procedure: stop play and get everybody to safety. Don\'t resume because one team wants to keep going.',
  },
  {
    id: 'throat-guard', card: 'equipment', who: 'Catcher', role: 'Between innings', mood: 'nice',
    text: 'The new catcher jogs out wearing a mask with **no throat protector** dangling from it.',
    options: [
      { id: 'a', label: 'Hold play until the catcher has a mask with a throat protector.' },
      { id: 'b', label: 'Let it go — it\'s only one inning.' },
      { id: 'c', label: 'Give the catcher your own plate mask.' },
    ],
    answer: 'a',
    explain: 'Every catcher\'s mask needs a **dangling throat protector**. Have the manager fix missing or improper equipment **before** play continues. Safety gear isn\'t optional.',
  },
  {
    id: 'bat-mark', card: 'equipment', who: 'Batter', role: 'On deck', mood: 'nice',
    text: 'You notice the next batter\'s bat **doesn\'t have the USA Baseball mark**.',
    options: [
      { id: 'a', label: 'Remove the bat and have the manager get a legal one.' },
      { id: 'b', label: 'Let him use it this at-bat and warn him for next time.' },
      { id: 'c', label: 'Call him out.' },
    ],
    answer: 'a',
    explain: 'Every bat must carry the **USA Baseball mark**. If it doesn\'t, **remove it from play** and have the manager supply a legal bat — before the at-bat, not after.',
  },
  {
    id: 'swinging-bats', card: 'safety', who: 'Dugout', role: 'Between innings', mood: 'nice',
    text: 'Three kids are swinging bats just outside the dugout gate while the on-deck batter warms up.',
    options: [
      { id: 'a', label: 'Send them back in — only the one on-deck batter may swing.' },
      { id: 'b', label: 'It\'s fine as long as they\'re careful.' },
      { id: 'c', label: 'Ignore it — that\'s the coach\'s job.' },
    ],
    answer: 'a',
    explain: 'Only **one on-deck batter** may take practice swings. Everybody else and every loose bat stays **inside the dugout**. Stop unsafe actions right away.',
  },
  {
    id: 'practice-catcher', card: 'safety', who: 'Backup Catcher', role: 'Warm-ups', mood: 'nice',
    text: 'A player is catching the pitcher\'s warm-up throws **without a mask**.',
    options: [
      { id: 'a', label: 'Stop the warm-up until he puts on a mask and uses a catcher\'s mitt.' },
      { id: 'b', label: 'It\'s just warm-ups — let it go.' },
      { id: 'c', label: 'Tell the pitcher to throw softer.' },
    ],
    answer: 'a',
    explain: 'Anyone catching warm-ups needs a **catcher\'s mask** and a **catcher\'s mitt**. Stop the warm-up until it\'s fixed.',
  },
  {
    id: 'signal-fair', card: 'signals', who: 'Your Partner', role: 'Pregame', mood: 'nice',
    text: '"Quick quiz before we start: a ground ball is fair down the line. What do you do?"',
    options: [
      { id: 'a', label: 'Point toward fair territory. No voice.' },
      { id: 'b', label: 'Yell "FAIR BALL!" and point.' },
      { id: 'c', label: 'Raise both hands.' },
    ],
    answer: 'a',
    explain: 'Fair ball: **point into fair territory — no voice call**. You only use your voice for "Foul!" (with both hands up). Yelling "fair" can sound like "foul" from far away.',
  },
  {
    id: 'signal-ball', card: 'signals', who: 'Your Partner', role: 'Pregame', mood: 'nice',
    text: '"Pitch is a ball. What\'s your mechanic behind the plate?"',
    options: [
      { id: 'a', label: 'Stay down in your stance and say "Ball" clearly — no hand signal.' },
      { id: 'b', label: 'Stand up and wave your left hand.' },
      { id: 'c', label: 'Say nothing — they know it\'s a ball.' },
    ],
    answer: 'a',
    explain: 'For a **ball**: **stay in position** and **announce "Ball"** — no hand signal. Strikes get the voice **and** the right-hand mechanic.',
  },
  {
    id: 'calm-ejection', card: 'handling-questions', who: 'Coach Dixon', role: 'Visiting manager', mood: 'mad',
    text: 'The coach has been yelling at you for three innings. Now he kicks dirt on home plate and calls you a name.',
    options: [
      { id: 'a', label: 'Calmly set the boundary and use the league\'s ejection/escalation process.' },
      { id: 'b', label: 'Yell louder than him so he knows who\'s boss.' },
      { id: 'c', label: 'Pretend it didn\'t happen.' },
    ],
    answer: 'a',
    explain: '**Personal attacks and unsportsmanlike conduct** cross the line. Don\'t match his volume — stay calm, make the boundary unmistakable, and use the **league\'s formal procedure**. Involve the site leader if needed, and document it after the game.',
  },
  {
    id: 'darkness', card: 'safety', who: 'The Sun', role: 'Going down fast', mood: 'storm',
    text: 'It\'s getting dark and you can barely see the pitches. One team is losing and wants to keep playing.',
    options: [
      { id: 'a', label: 'Apply the league\'s darkness rule — stop when it isn\'t safe to see.' },
      { id: 'b', label: 'Keep going — the losing team deserves a chance.' },
      { id: 'c', label: 'Ask the parents to turn on their car headlights.' },
    ],
    answer: 'a',
    explain: 'If players can\'t safely see the ball, it\'s a **safety** issue. Apply the league\'s darkness procedure exactly — the score doesn\'t change the decision.',
  },
];
