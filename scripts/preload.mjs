// Keep index.html's <link rel="modulepreload"> list in sync with the code.
// With no bundler, the browser only discovers a module's imports after downloading it, so on a phone
// the module graph loads as a slow waterfall. Preloading every module lets them all download at once.
//
//   node scripts/preload.mjs          rewrite the list in public/index.html
//   node scripts/preload.mjs --check  exit 1 if the list is out of date (used by check.mjs)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..', 'public');
const START = '<!-- modulepreload:start -->';
const END = '<!-- modulepreload:end -->';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

export function preloadBlock() {
  const files = [
    join(root, 'vendor', 'three', 'three.module.min.js'),
    join(root, 'vendor', 'three', 'three.core.min.js'),
    ...walk(join(root, 'vendor', 'three', 'addons')),
    ...walk(join(root, 'js')),
  ];
  const lines = files.map((f) => `  <link rel="modulepreload" href="${relative(root, f).split(sep).join('/')}">`);
  return `${START}\n${lines.join('\n')}\n  ${END}`;
}

export function preloadIsCurrent() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const a = html.indexOf(START), b = html.indexOf(END);
  return a >= 0 && b > a && html.slice(a, b + END.length) === preloadBlock();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    if (!preloadIsCurrent()) { console.error('index.html modulepreload list is out of date: run node scripts/preload.mjs'); process.exit(1); }
    console.log('modulepreload list is current');
  } else {
    const path = join(root, 'index.html');
    const html = readFileSync(path, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END);
    if (a < 0 || b < a) { console.error('markers not found in index.html'); process.exit(1); }
    writeFileSync(path, html.slice(0, a) + preloadBlock() + html.slice(b + END.length));
    console.log('updated index.html modulepreload list');
  }
}
