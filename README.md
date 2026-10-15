# Umpire Madness ⚾

An arcade-style training game for young **Little League baseball** umpires. It's a companion to
[Umpire Bootcamp](https://umpirebootcamp.gwaldron.workers.dev/), and every rule card links straight to its Bootcamp lesson.

**Make the call. Own the field.**

## What's in it

- **Behind the plate**: a first-person view through your mask. Get into the slot (the catcher's helmet really
  does block your view if you don't), track the pitch into the glove, then call **strike** or **ball**.
  The K-Zone replay shows exactly where it crossed. There are checked swings, foul tips, two-strike foul bunts,
  hit-by-pitch rulings (hands, swinging, in the zone, leaning in) and uncaught third strikes too.
- **On the bases**: you control the base umpire. Start in **A, B or C**, move for an angle as the play develops,
  then **stop**. The slow-motion **UMP CAM** is only as clear as your positioning: a bad angle squishes the picture,
  a fielder can block it, and standing far away pixelates it. Plays include force plays, steals, back-picks and
  double plays, with pulled feet, dropped balls, missed tags and empty-glove tags.
- **Rule situations**: infield fly, obstruction (both kinds), interference, batter's and catcher's interference,
  the running lane, base paths, fair/foul, catch/no catch, appeals, timing plays, balks (50/70), and
  **FXLL AA/AAA local rules**.
- **Ump life**: coaches, parents, lightning, missing throat guards, illegal bats.
- **Rookie Camp** in two levels: **Minors** (AA/AAA rules, where new umps start) and **Majors**. The infield fly and the
  dropped third strike are only quizzed at Majors and above, since Minors doesn't use them.
- **Little League mechanics**: on the 60-ft diamond the base umpire's B and C positions are outside the baselines.
- **Gamification**: XP and ranks, a 5-division career (AA → AAA → Majors → All-Stars → Williamsport), stars,
  45 achievements, a collectible rule-card set, unlockable gear in the Locker Room, streak multipliers,
  and arcade modes (Blitz, Plate Survival, Base Hustle, Rulebook Rumble).
- **Controls**: Xbox/standard gamepads (A/B/X/Y, RT = strike/out, LT = ball/safe, left stick to move, Menu to pause),
  keyboard (WASD/arrows, J K U I), or touch (on-screen buttons plus a floating thumbstick).

Rules follow the Little League rulebook as taught in Umpire Bootcamp. **Baseball first; softball is a later phase.**
The softball situations are drafted but switched off (`SOFTBALL_ENABLED` in `public/js/data/situations.js`).

## Run it locally

Needs Node.js 22 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:8787.

## Check content

```bash
npm run check
```

This builds every rule situation, with many random variants for every division, and verifies answers, timing and animation keyframes.

## Deploy (Cloudflare Workers static assets)

```bash
npx wrangler login
npm run deploy
```

It deploys to `https://umpiremadness.<your-subdomain>.workers.dev`.

## Code map

| Path | What |
| --- | --- |
| `public/js/main.js` | Boot, main loop, input routing, attract mode |
| `public/js/game/session.js` | Scoring, streaks, lives/timers, stats, achievements, career and arcade builders |
| `public/js/scenes/plate.js` + `pitcher3d.js` | Plate umpire: pitch physics, strike zone, batter and catcher, K-Zone, and the pitcher's 3D delivery |
| `public/js/scenes/base.js` | Base umpire: play generation, positioning and angle scoring |
| `public/js/scenes/umpcam.js` | Slow-motion close-up whose clarity depends on your angle, plus the Call Cam that cuts to your umpire selling the call |
| `public/js/scenes/situation.js` + `data/situations.js` | Scripted rule situations |
| `public/js/render3d/*` | three.js ballpark (bloom and color grade, waving flags, birds, night stars), cel-shaded instanced players with IK and faces, realistic close-up players for the plate view (`hero.js`: soft shading, real gear, jersey numbers), dirt-dust particles, Ump Cam inset rendering, Locker Room preview |
| `public/js/render/*` | Game camera and constants, plus the 2D fallback renderer (`?gl=0`, no WebGL, or a GPU that fails). Graphics step down gracefully: a lost context rebuilds the 3D view in place, real failures go full 3D → safe 3D (no MSAA/shadows, simple shading) → 2D, and a 2D fallback retries 3D after two days. `render/hero2d.js` paints the realistic close-up players on a 2D canvas so they look right in 2D too. Settings → Graphics shows the GPU and mode |
| `public/vendor/three/` | Vendored three.js (MIT) |
| `public/js/ui/*` | HUD and menus (gamepad-navigable), TV-style batter lower-third, confetti |
| `public/js/audio.js` + `voice.js` | Synthesized sound and music; umpire calls, PA announcer and TV commentary from pre-rendered voice clips (`public/audio/vo/`, made by `scripts/render-vo.py`) |
| `public/js/data/*` | Divisions, rule cards, achievements, ump-life events |

There are no build steps and no image files. The 3D ballpark is built with three.js from procedurally painted textures, and all sound effects (bat crack, mitt pop, crowd, ballpark organ, menu theme) are synthesized with WebAudio.

The only recorded audio is the voice work in `public/audio/vo/`: umpire calls, PA announcer, TV commentary and the crowd (cheers, groans and Little League chatter, layered in the game with random timing, pitch and pan into a crowd in the stands), rendered ahead of time with the open-source [Kokoro](https://github.com/hexgrad/kokoro) TTS model (Apache-2.0) by `scripts/render-vo.py` (setup steps are at the top of that script). Batter intros are stitched from pieces ("Now batting," + "Number 24." + first name + last name). To change a line, edit it in the script and re-render; use `--only u.,c.` to redo just some groups. Lines without a clip fall back to the browser's speech voice.
