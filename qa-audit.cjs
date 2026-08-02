/* Temporary QA audit script (not part of the app; delete after use) */
const fs = require('fs');

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

const html = read('index.html') || '';
const js = read('script.js') || '';
const css = read('style.css') || '';
const sw = read('service-worker.js') || '';
const spatial = read('spatial-effects.js') || '';
const privacy = read('privacy.html') || '';

console.log('=== 1. ID CROSS-CHECK ===');
const ids = new Set();
const re = /id=["']([^"']+)["']/g;
let m;
while ((m = re.exec(html))) ids.add(m[1]);
const refs = new Set();
const re2 = /\$\s*\(\s*["']([^"']+)["']\s*\)|getElementById\(["']([^"']+)["']\)/g;
while ((m = re2.exec(js))) {
  if (m[1]) refs.add(m[1]);
  if (m[2]) refs.add(m[2]);
}
const missing = [...refs].filter((id) => !ids.has(id));
console.log('HTML ids:', ids.size, '| JS refs:', refs.size);
console.log('Missing IDs in HTML:', missing.length ? missing : 'NONE');

// Also check querySelector('#...') refs
const refs3 = new Set();
const re3 = /querySelector\(["']#([A-Za-z][\w-]*)["']\)/g;
while ((m = re3.exec(js))) refs3.add(m[1]);
const missing3 = [...refs3].filter((id) => !ids.has(id));
console.log('querySelector # refs missing in HTML:', missing3.length ? missing3 : 'NONE');

console.log('');
console.log('=== 2. ASSET REFERENCES ===');
const jsAssetRefs = js.match(/["']\.?\/?(sounds\/[^"']+)["']/g) || [];
const uniq = [...new Set(jsAssetRefs.map((s) => s.replace(/["']/g, '')))];
for (const a of uniq) {
  const p = a.replace(/^\.\//, '');
  console.log('JS asset', a, fs.existsSync(p) ? 'OK' : 'MISSING');
}
const htmlScripts = html.match(/src=["'][^"']+["']/g) || [];
for (const s of htmlScripts) {
  const v = s.replace(/src=["']/, '').replace(/["']$/, '');
  if (v.startsWith('http')) {
    console.log('HTML script (external)', v);
    continue;
  }
  const p = v.replace(/^\.\//, '');
  console.log('HTML script', v, fs.existsSync(p) ? 'OK' : 'MISSING');
}
const htmlStyles = html.match(/href=["'][^"']+["']/g) || [];
for (const s of htmlStyles) {
  const v = s.replace(/href=["']/, '').replace(/["']$/, '');
  if (v.startsWith('http')) {
    console.log('HTML href (external)', v);
    continue;
  }
  const p = v.replace(/^\.\//, '');
  console.log('HTML href', v, fs.existsSync(p) ? 'OK' : 'MISSING');
}
// SW cached urls
const swUrls = sw.match(/['"]\/(?:index\.html|style\.css|script\.js|spatial-effects\.js|manifest\.json|privacy\.html|firebaseConfig\.js|icon[^'"]*\.png|sounds\/[^'"]+)['"]/g) || [];
const swUniq = [...new Set(swUrls.map((s) => s.replace(/['"]/g, '')))];
for (const u of swUniq) {
  const p = u.replace(/^\//, '');
  console.log('SW cached', u, p && fs.existsSync(p) ? 'OK' : 'MISSING(check base path)');
}
// manifest icons
let manifest = null;
try { manifest = JSON.parse(read('manifest.json')); } catch {}
if (manifest && manifest.icons) {
  for (const ic of manifest.icons) {
    const p = ic.src.replace(/^\//, '');
    console.log('Manifest icon', ic.src, fs.existsSync(p) ? 'OK' : 'MISSING');
  }
}

console.log('');
console.log('=== 3. CSS CHECKS ===');
const o = (css.match(/{/g) || []).length;
const c = (css.match(/}/g) || []).length;
console.log('Braces balanced:', o === c ? 'YES (' + o + ')' : 'NO open=' + o + ' close=' + c);
// duplicate selector check (simple)
const selCount = {};
const selRe = /^([^{}]+)\{/gm;
while ((m = selRe.exec(css))) {
  const sel = m[1].replace(/,\s+/g, ',').trim();
  selCount[sel] = (selCount[sel] || 0) + 1;
}
const dups = Object.entries(selCount).filter(([k, v]) => v > 1);
console.log('Duplicate selectors (exact):', dups.length ? dups.slice(0, 10) : 'NONE');

console.log('');
console.log('=== 4. HTML CHECKS ===');
const tags = ['authOverlay', 'habitModal', 'alarmModal', 'trashConfirmModal', 'trashPermanentModal', 'restoreConfirmModal'];
for (const t of tags) {
  console.log('has #' + t + ':', html.includes('id="' + t + '"') ? 'YES' : 'NO');
}
// Count section/div balance roughly
const openDiv = (html.match(/<div\b/g) || []).length;
const closeDiv = (html.match(/<\/div>/g) || []).length;
console.log('div open/close:', openDiv, '/', closeDiv, openDiv === closeDiv ? 'BALANCED' : 'UNBALANCED');
const openSec = (html.match(/<section\b/g) || []).length;
const closeSec = (html.match(/<\/section>/g) || []).length;
console.log('section open/close:', openSec, '/', closeSec, openSec === closeSec ? 'BALANCED' : 'UNBALANCED');

console.log('');
console.log('=== 5. EVENT LISTENER BINDINGS ===');
// Check every addEventListener target id in JS exists in HTML
const evtIds = new Set();
const reEvt = /getElementById\(["']([^"']+)["']\)[^;]*addEventListener|els\.([A-Za-z]+)\?\.addEventListener/g;
while ((m = reEvt.exec(js))) {
  if (m[1]) evtIds.add(m[1]);
}
// (els.xxx references are resolved at runtime; skip)

console.log('');
console.log('=== 6. SW / manifest theme ===');
console.log('manifest theme_color:', manifest ? manifest.theme_color : '?');
console.log('index theme-color meta:', /theme-color" content="#050a18"/.test(html) ? '#050a18 present' : 'CHECK');
console.log('SW cache name:', (sw.match(/habitTracker\.shell\.v\d+/) || ['?'])[0]);

console.log('');
console.log('=== 7. CONSOLE ERRORS / DEAD CODE QUICK SCAN ===');
// Look for obvious references to undefined functions (rough heuristic)
const knownFns = ['renderAnalytics', 'renderDashboard', 'renderWeekly', 'renderMonthly', 'renderSettings', 'renderTrash', 'renderXpUi', 'openAlarmModal', 'closeAlarmModal', 'stopAlarmSound', 'stopAlarmAudio', 'playAlarmAudio', 'openAuthOverlay', 'closeAuthOverlay', 'renderAccountAuthUi', 'unlockAlarmAudio', 'initAlarmAudioUnlock', 'hideTapToEnableMessage', 'showTapToEnableMessage'];
const called = new Set();
const reCall = /([A-Za-z_$][\w$]*)\s*\(/g;
while ((m = reCall.exec(js))) {
  const fn = m[1];
  if (knownFns.includes(fn)) called.add(fn);
}
const definedInHtml = /function\s+([A-Za-z_$][\w$]*)/g;
const htmlFns = new Set();
while ((m = definedInHtml.exec(html))) htmlFns.add(m[1]);
console.log('App functions called in script.js (sample):', [...called].join(', '));

console.log('');
console.log('=== DONE ===');

