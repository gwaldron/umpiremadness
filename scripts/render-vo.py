"""Render the game's voice lines to MP3 clips with Kokoro (open neural TTS, Apache-2.0).

The browser's built-in speech voices can sound robotic, so the umpire calls, PA announcer and
TV commentator lines are rendered ahead of time and shipped as small MP3s. Batter intros are
stitched from pieces ("Now batting," + "Number 24." + "Jayden" + "Okafor!") like real sports games.

Setup (once, outside the repo):
    python -m venv ttsenv && ttsenv/Scripts/python -m pip install kokoro-onnx soundfile
    download kokoro-v1.0.onnx and voices-v1.0.bin from
    https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Run from the repo root:
    ttsenv/Scripts/python scripts/render-vo.py --model path/kokoro-v1.0.onnx --voices path/voices-v1.0.bin

Writes public/audio/vo/<role>/*.mp3 and public/audio/vo/manifest.json.
Player name lists are read from public/js/voice.js so the two never drift apart.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'audio' / 'vo'

# role -> (kokoro voice, base speed)
ROLES = {
    'u': ('am_fenrir', 1.0),   # the umpire (you)
    'pa': ('am_michael', 0.9),  # stadium PA announcer
    'c': ('af_bella', 1.08),    # TV color commentator
}

ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty']


def words(n):
    if n < 20:
        return ONES[n]
    t, o = divmod(n, 10)
    return TENS[t] + ('-' + ONES[o] if o else '')


def name_lists():
    src = (ROOT / 'public' / 'js' / 'voice.js').read_text(encoding='utf-8')
    out = {}
    for key in ('FIRST', 'LAST'):
        m = re.search(r'const ' + key + r' = \[(.*?)\];', src, re.S)
        out[key] = re.findall(r"'([^']+)'", m.group(1))
    return out['FIRST'], out['LAST']


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def lines():
    """(group, role, text, speed multiplier). A group with several lines picks one at random in the game."""
    L = []
    u = lambda g, t, sp=1.0: L.append(('u.' + g, 'u', t, sp))
    pa = lambda g, t, sp=1.0: L.append(('pa.' + g, 'pa', t, sp))
    c = lambda g, t, sp=1.0: L.append(('c.' + g, 'c', t, sp))

    # --- umpire calls ---
    u('strike', 'Strike!'); u('strike', 'Strike!', 0.86); u('strike', 'Strike, right there!', 1.05)
    u('ball', 'Ball.'); u('ball', 'Ball!', 0.95); u('ball', "That's a ball.")
    for b in range(4):
        for s in range(3):
            u(f'count.{b}{s}', f"{'Oh' if b == 0 else words(b).capitalize()} and {'oh' if s == 0 else words(s)}.", 1.05)
    u('k', 'Strike three!', 0.92); u('k', "Strike three! You're out!"); u('k', 'Strike three! Ring him up!')
    u('bb', 'Ball four! Take your base!')
    u('out', "He's out!"); u('out', 'Out!'); u('out', "You're out!")
    u('outClose', "He's out!", 0.85); u('outClose', 'Out! He is out!'); u('outClose', "Ohh, he's out!")
    u('safe', 'Safe!'); u('safe', "He's safe!")
    u('safeClose', 'Safe! Safe!'); u('safeClose', "He's safe!", 0.86); u('safeClose', 'Safe, safe, safe!', 1.08)
    u('foul', 'Foul ball!'); u('foul', 'Foul!')
    u('tip', 'Foul tip! Strike!'); u('tip', 'Tipped! Strike!')
    u('hbp', 'Time! Take your base!')
    u('iff', "Infield fly! Batter's out!")
    u('nocatch', 'No catch! No catch!')
    u('play', 'Play ball!'); u('play', "Let's play!")
    u('obstruction', "That's obstruction!")
    u('timeObstruction', "Time! That's obstruction!")
    u('catchOut', "That's a catch! He's out!")
    u('noCatch1', 'No catch!')
    u('balk', "That's a balk!")

    # --- stadium PA ---
    pa('nowBatting', 'Now batting,'); pa('steppingIn', 'Stepping in,'); pa('upNext', 'Up next,')
    for n in range(1, 43):
        pa(f'num.{n}', f'Number {words(n)}.')
    first, last = name_lists()
    for f in first:
        pa(f'first.{f}', f)
    for l in last:
        pa(f'last.{l}', f'{l}!')
    pa('welcome', 'Ladies and gentlemen, welcome to the ballpark!')
    pa('welcome', "Ladies and gentlemen, boys and girls, it's game time!")
    pa('yourUmp', "Please welcome your umpire for today's game!")
    pa('yourUmp', "Give it up for today's umpire!")
    pa('camp', 'Welcome to Rookie Camp! Let\'s go, Blue!')
    pa('blitz', 'Sixty seconds on the clock. Ready? Go!')
    pa('mode.plate', "It's Plate Survival! Let's go, Blue!")
    pa('mode.bases', "It's Base Hustle! Let's go, Blue!")
    pa('mode.rumble', "It's Rulebook Rumble! Let's go, Blue!")
    pa('letsGo', "Let's go, Blue!")

    # --- TV color commentary ---
    for g, ts in {
        'bangGood': ['Bang-bang play, and the ump nails it!', 'What a call!', 'Perfect angle. Perfect call!', 'Oh, that was close, and the ump got it!'],
        'painted': ['Right on the black! Great eye!', 'Painted corner, and the ump saw it!', 'Ooh, nasty pitch. Great call!'],
        'angle': ['Look at that positioning!', 'That ump was in the perfect spot!'],
        'streak5': ['The ump is heating up!', 'Five in a row!'],
        'streak10': ['This ump is on fire!', 'Somebody call the fire department!'],
        'streak20': ['Is this ump a robot?', 'Unbelievable! Twenty straight!'],
        'miss': ["Ooh, the replay doesn't agree.", 'Everybody misses one!', 'Shake it off, Blue!', "That one's going on the blooper reel!"],
        'quick': ['Whoa, too quick on the trigger!', 'Patience, Blue!'],
        'ouch': ['Ouch! Right in the lane!', 'That had to hurt!'],
        'ejected': ["And that's an ejection! See you next time, Blue!"],
        'champion': ['World Series champion umpire!'],
    }.items():
        for t in ts:
            c(g, t)
    return L


def polish(x, sr):
    """Trim silence, fade the edges, and level the clip."""
    x = np.asarray(x, dtype=np.float32)
    idx = np.flatnonzero(np.abs(x) > 0.012)
    if len(idx):
        a = max(0, idx[0] - int(0.03 * sr))
        b = min(len(x), idx[-1] + int(0.08 * sr))
        x = x[a:b]
    f = min(len(x) // 4, int(0.012 * sr))
    if f > 0:
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
    rms = float(np.sqrt(np.mean(x ** 2))) or 1e-6
    peak = float(np.max(np.abs(x))) or 1e-6
    gain = min(0.16 / rms, 0.89 / peak)
    return x * gain


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    ap.add_argument('--only', default='', help='comma-separated group prefixes to (re)render, e.g. u.,c.')
    args = ap.parse_args()

    k = Kokoro(args.model, args.voices)
    only = [p for p in args.only.split(',') if p]
    man_path = OUT / 'manifest.json'
    manifest = json.loads(man_path.read_text()) if (only and man_path.exists()) else {}
    if only:
        for g in list(manifest):
            if any(g.startswith(p) for p in only):
                del manifest[g]

    counts = {}
    todo = [l for l in lines() if not only or any(l[0].startswith(p) for p in only)]
    for i, (group, role, text, sp) in enumerate(todo):
        voice, base = ROLES[role]
        samples, sr = k.create(text, voice=voice, speed=base * sp, lang='en-us')
        y = polish(samples, sr)
        counts[group] = counts.get(group, 0) + 1
        name = slug(group.split('.', 1)[1]) + ('' if counts[group] == 1 else f'-{counts[group]}') + '.mp3'
        rel = f'{role}/{name}'
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        sf.write(dest, y, sr, format='MP3', compression_level=0.6)
        manifest.setdefault(group, []).append({'f': rel, 'd': round(len(y) / sr, 3), 't': text})
        print(f'[{i + 1}/{len(todo)}] {group}: {text}', flush=True)

    man_path.write_text(json.dumps(manifest, indent=0, ensure_ascii=False), encoding='utf-8')
    total = sum(p.stat().st_size for p in OUT.rglob('*.mp3'))
    print(f'done: {sum(len(v) for v in manifest.values())} clips, {total / 1024:.0f} KB', flush=True)


if __name__ == '__main__':
    sys.exit(main())
