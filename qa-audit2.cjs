/* Temporary QA audit #2 */
const fs = require('fs');
const js = fs.readFileSync('script.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const spatial = fs.readFileSync('spatial-effects.js', 'utf8');

console.log('=== A. console.log statements in script.js ===');
const logs = js.match(/console\.(log|warn|error|debug)\([^;]*/g) || [];
console.log('Count:', logs.length);
logs.forEach((l) => console.log('  ', l.slice(0, 110)));

console.log('');
console.log('=== B. openAuthBtn context ===');
const idx = js.indexOf('openAuthBtn');
if (idx !== -1) {
  console.log(js.slice(Math.max(0, idx - 250), idx + 150));
} else {
  console.log('openAuthBtn not found in script.js');
}

console.log('');
console.log('=== C. Duplicate CSS selectors (full list) ===');
const selCount = {};
const selRe = /^([^{}]+)\{/gm;
let m;
while ((m = selRe.exec(css))) {
  const sel = m[1].replace(/\s+/g, ' ').trim();
  selCount[sel] = (selCount[sel] || 0) + 1;
}
const dups = Object.entries(selCount).filter(([k, v]) => v > 1);
for (const [k, v] of dups) {
  console.log('  x' + v, k);
}

console.log('');
console.log('=== D. spatial-effects.js selectors vs CSS ===');
// Check if tilt/magnetic selectors exist in CSS
const magneticSel = ['.glow-btn', '.ghost-btn', '.danger-btn', '.check-btn', '.delete-btn', '.icon-btn', '.nav-item', '.alarm-bell-btn', '.month-nav-btn', '.hamburger'];
for (const s of magneticSel) {
  console.log('  CSS has', s, ':', css.includes(s) ? 'YES' : 'NO');
}
console.log('  --mx/--my used in CSS:', (css.match(/--mx|--my/g) || []).length);
console.log('  --htx/--hty used in CSS:', (css.match(/--htx|--hty/g) || []).length);
console.log('  --px/--py used in CSS:', (css.match(/--px|--py/g) || []).length);

console.log('');
console.log('=== E. z-index values ===');
const zs = css.match(/z-index:\s*\d+/g) || [];
console.log(zs);

console.log('');
console.log('=== F. prefers-reduced-motion present in all files ===');
for (const [name, content] of [['style.css', css], ['spatial-effects.js', spatial]]) {
  console.log(name, content.includes('prefers-reduced-motion') ? 'YES' : 'NO');
}

console.log('');
console.log('=== G. backdrop-filter usage ===');
console.log('style.css:', (css.match(/backdrop-filter/g) || []).length);
console.log('spatial-effects.js:', (spatial.match(/backdrop-filter/g) || []).length);

console.log('');
console.log('=== H. Check for inline overflow/width issues in HTML ===');
const widthIssues = html.match(/min-width:\s*\d{4}px/g) || [];
console.log('large min-width in HTML:', widthIssues);

console.log('');
console.log('=== I. service-worker fetch logic sanity ===');
console.log('api bypass:', sw_has_api(js) ? 'n/a' : 'n/a');

function sw_has_api() {
  const sw = fs.readFileSync('service-worker.js', 'utf8');
  return sw.includes("/api/");
}
const sw = fs.readFileSync('service-worker.js', 'utf8');
console.log('SW /api/ bypass:', sw.includes('/api/') ? 'YES' : 'NO');
console.log('SW cache-first static:', sw.includes('isStaticAsset') ? 'YES' : 'NO');
console.log('SW network-first nav:', sw.includes('networkResp') ? 'YES' : 'NO');
console.log('DONE');

