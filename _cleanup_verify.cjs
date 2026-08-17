/* Temporary post-cleanup verification script (deleted after run) */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (!cond) failures++;
};

// 1. All production files present
const prodFiles = [
  'index.html', 'script.js', 'style.css', 'manifest.json',
  'service-worker.js', 'firebaseConfig.js', 'package.json',
  'privacy.html', 'spatial-effects.js', 'vercel.json',
  'icon.png', 'icon-192.png', 'icon-512.png', '.gitignore',
  'sounds/alarm1.mp3', 'sounds/alarm2.mp3',
  'sounds/alarm3.mp3', 'sounds/alarm4.mp3',
];
for (const f of prodFiles) ok('exists: ' + f, fs.existsSync(f));

// 2. index.html references resolve
const html = fs.readFileSync('index.html', 'utf8');
const refs = [];
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const v = m[1];
  if (v.startsWith('http') || v.startsWith('#') || v.startsWith('data:')) continue;
  refs.push(v.replace(/^\.\//, '').replace(/\?.*$/, ''));
}
for (const r of refs) ok('index.html ref: ' + r, fs.existsSync(r));

// 3. service-worker.js cached urls resolve
const sw = fs.readFileSync('service-worker.js', 'utf8');
const swRefs = [...new Set(
  [...sw.matchAll(/['"]\/([^"']+)['"]/g)].map(m => m[1]).filter(v =>
    v.endsWith('.js') || v.endsWith('.css') || v.endsWith('.html') ||
    v.endsWith('.json') || v.endsWith('.png') || v.endsWith('.mp3') ||
    v === 'index.html'
  )
)].map(v => v.replace(/\?.*$/, ''));
for (const r of swRefs) {
  if (r === '') continue;
  ok('sw cached: /' + r, fs.existsSync(r));
}

// 4. manifest.json icons resolve
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
for (const ic of manifest.icons) {
  const p = ic.src.replace(/^\//, '').replace(/\?.*$/, '');
  ok('manifest icon: ' + ic.src, fs.existsSync(p));
}

// 5. No QA/debug/proof files remain
const leftover = fs.readdirSync('.').filter(f =>
  /^(_qa_|qa-|_proof_|_cleanup_verify)/.test(f)
);
ok('no QA/proof/debug files remain', leftover.length === 0);

// 6. JS syntax check for production scripts
try {
  new Function(fs.readFileSync('script.js', 'utf8'));
  ok('script.js syntax', true);
} catch (e) {
  ok('script.js syntax', false);
}
try {
  new Function(fs.readFileSync('firebaseConfig.js', 'utf8'));
  ok('firebaseConfig.js syntax', true);
} catch (e) {
  ok('firebaseConfig.js syntax', false);
}
try {
  new Function(fs.readFileSync('spatial-effects.js', 'utf8'));
  ok('spatial-effects.js syntax', true);
} catch (e) {
  ok('spatial-effects.js syntax', false);
}

// 7. CSS brace balance
const css = fs.readFileSync('style.css', 'utf8');
let open = 0, close = 0;
for (const ch of css) { if (ch === '{') open++; if (ch === '}') close++; }
ok('style.css braces balanced (' + open + '/' + close + ')', open === close);

// 8. HTML has service worker registration + manifest + firebase
ok('html links manifest', html.includes('rel="manifest"'));
ok('html loads firebaseConfig', html.includes('firebaseConfig.js'));
ok('html registers service worker', html.includes('service-worker.js'));

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECKS FAILED'));
process.exit(failures === 0 ? 0 : 1);

