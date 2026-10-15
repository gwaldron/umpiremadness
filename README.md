# Umpire Madness ⚾🥎

An arcade-style training game for young **Little League baseball and softball** umpires. It's a companion to
[Umpire Bootcamp](https://umpirebootcamp.gwaldron.workers.dev/), and every rule card links straight to its Bootcamp lesson.

**Make the call. Own the field.**

## What's in it

- **Baseball or softball**: one switch on the title screen (or in Settings) changes the whole game. Softball moves
  the pitcher into a flat, chalked 16-ft circle (35 ft in Minors, 40 ft in Majors and up), swaps in the big yellow
  ball (11 in for Minors, 12 in for Majors and up), pitches underhand with a windmill delivery (rise balls, drop balls
  and change-ups), puts ponytails and face-cage helmets on the players, and ends the career in Greenville. Softball
  adds its own rules from Bootcamp: **leaving early** (an immediate out; Majors and up may leave on the release,
  Minors when the pitch reaches the batter) and **the circle rule**.
- **Behind the plate**: a first-person view through your mask. Get into the slot (the catcher's helmet really
  does block your view if you don't) and adjust any time during the at-bat; the slot is judged as each pitch
  reaches the plate. Track the pitch into the glove, then call **strike** or **ball**. The strike zone box over the plate
  is **Smart** by default (Settings → Strike zone box): miss a pitch and it pops up, then it fades away as you nail
  3 calls in a row. Rookie levels start with it on. It can also be set to Always or Never.
  The K-Zone replay shows exactly where it crossed. There are checked swings, foul tips, two-strike foul bunts,
  hit-by-pitch rulings (hands, swinging, in the zone, leaning in) and uncaught third strikes too.
- **On the bases**: you control the base umpire. Start in **A, B or C**, move for an angle as the play develops,
  then **stop**. The slow-motion **UMP CAM** is only as clear as your positioning: a bad angle squishes the picture,
  a fielder can block it, and standing far away pixelates it. Plays include force plays, steals, back-picks and
  double plays, with pulled feet, dropped balls, missed tags and empty-glove tags.
- **Rule situations**: infield fly, obstruction (both kinds), interference, batter's and catcher's interference,
  the running lane, base paths, fair/foul, catch/no catch, appeals and timing plays (plus leaving early and the circle
  rule in softball). Balks aren't included: they only apply on the 90-ft diamond, which the game doesn't cover yet.
- **Ump life**: coaches, parents, lightning, missing throat guards, illegal bats.
- **Rookie Camp** in two levels: **Minors** (AA/AAA rules, where new umps start) and **Majors**. The infield fly and the
  dropped third strike are only quizzed at Majors and above, since Minors doesn't use them.
- **Little League mechanics**: on the 60-ft diamond the base umpire's B and C positions are outside the baselines.
  The game uses general Little League rules, not any one league's local rules.
- **Gamification**: XP and ranks, a 5-division career (AA → AAA → Majors → All-Stars → Williamsport, or Greenville in softball), stars,
  45 achievements, a collectible rule-card set, unlockable gear in the Locker Room, streak multipliers,
  and arcade modes (Blitz, Plate Survival, Base Hustle, Rulebook Rumble).
- **Controls**: Xbox/standard gamepads (A/B/X/Y, RT = strike/out, LT = ball/safe, left stick to move, Menu to pause),
  keyboard (WASD/arrows, J K U I), or touch (on-screen buttons plus a floating thumbstick).

Rules follow the Little League rulebook as taught in Umpire Bootcamp. The sport switch lives in `public/js/sport.js`:
situations and rule cards tagged `sport: 'softball'` (or `'baseball'`) only come up in that sport, and softball game
text reads "she/her" (`txt()`).

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

This builds every rule situation, with many random variants for every division, and verifies answers, timing and animation keyframes. It also checks that the `<link rel="modulepreload">` list in `public/index.html` matches the code: with no bundler, preloading every module lets them download in parallel instead of as a waterfall. After adding or removing a JS file, run:

```bash
node scripts/preload.mjs
```

While the game loads, `index.html` shows an inline splash screen (logo, spinning ball, progress bar); `main.js` reports progress with `window.__splash.step()` and fades it out after the first frame.

## 3D art (Blender)

The ballpark kit, the ballplayer body and the bleacher fan are modeled in Blender **from code**: each asset is a Python script in `art/` that builds the model and exports it to `public/models/`. Edit the script, then rebuild (Blender 4.2 or newer):

```bash
blender --background --factory-startup --python art/ballpark.py
```

```bash
blender --background --factory-startup --python art/player.py
```

```bash
blender --background --factory-startup --python art/fan.py
```

Each also saves a `.blend` to `art/out/` (not committed) to open in Blender.

- **`art/ballpark.py` → `ballpark.glb`**: dugouts (cinder block, team-colored roofs, helmet cubbies, bat rack, water cooler), aluminum bleachers with aisles and rails, the backstop with padding and a netting hood, light towers, the scoreboard with its marquee, foul poles, and tree models. It uses the game's own coordinates (feet, Z up, home plate at the origin). The game swaps in its chain-link texture, live scoreboard canvas and night lamps by material name, and instances the trees. Repeated pieces (the six bleacher sections, four light towers and both dugout bodies) are built once and placed several times, so the file stores each mesh only once (about 360 KB). Until it loads (or if it can't), the procedural stand-ins in `render3d/stadium.js` stay.
- **`art/player.py` → `player.glb`**: a smooth kid ballplayer in uniform. The body is fused from overlapping shapes (voxel remesh), with clean seams at the belt, sleeves and socks, and auto-weighted to 18 bones. Each face stores its uniform region (jersey, pants, socks, cleats, skin...) in a vertex color, so one shader colors any team and a whole player is one draw call. `render3d/rig.js` poses the bones every frame from the joints the game already computes, so every player on the field uses it. The head, face, caps and helmets, gloves, bat, catcher's gear and softball bubble braids still draw on top.
- **`art/fan.py` → `fan.glb`**: a low-poly seated fan (about 350 triangles plus an optional cap), split into parts: shirt, pants, shoes, head, hair, cap, and arms that pivot at the shoulder. The game draws the whole crowd with one instanced mesh per part, gives each fan their own colors (some kids, some caps), and swings the arms up into a waving V when the crowd cheers.

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

There are no build steps and no image files. The ground is painted procedurally, and all sound effects (bat crack, mitt pop, crowd, ballpark organ, menu theme) are synthesized with WebAudio.

The only recorded audio is the voice work in `public/audio/vo/`: umpire calls, PA announcer, TV commentary and the crowd (cheers, groans and Little League chatter, layered in the game with random timing, pitch and pan into a crowd in the stands), rendered ahead of time with the open-source [Kokoro](https://github.com/hexgrad/kokoro) TTS model (Apache-2.0) by `scripts/render-vo.py` (setup steps are at the top of that script). Batter intros are stitched from pieces ("Now batting," + "Number 24." + first name + last name). To change a line, edit it in the script and re-render; use `--only u.,c.` to redo just some groups. Lines without a clip fall back to the browser's speech voice.
