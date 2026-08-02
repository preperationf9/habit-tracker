const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('script.js', 'utf8');

// 1. ID cross-check
const ids = new Set();
const re = /id=["']([^"']+)["']/g;
let m;
while ((m = re.exec(html))) ids.add(m[1]);

const refs = new Set();
const re2 = /\$\('([^']+)'\)|\$\("([^"]+)"\)|getElementById\('([^']+)'\)|getElementById\("([^"]+)"\)/g;
while ((m = re2.exec(js))) {
  if (m[1]) refs.add(m[1]);
  if (m[2]) refs.add(m[2]);
  if (m[3]) refs.add(m[3]);
  if (m[4]) refs.add(m[4]);
}
const missing = [...refs].filter((id) => !ids.has(id));
console.log('=== ID CROSS-CHECK ===');
console.log('HTML ids:', ids.size, '| JS refs:', refs.size);
console.log('Missing IDs in HTML:', missing.length ? missing : 'NONE');

// 2. Asset references
console.log('=== ASSET REFERENCES ===');
const jsAssetRefs = js.match(/["']\.?\/?(sounds\/[^"']+)["']/g) || [];
const uniq = [...new Set(jsAssetRefs.map((s) => s.replace(/["']/g, '')))];
for (const a of uniq) {
  const p = a.replace(/^\.\//, '');
  console.log(a, fs.existsSync(p) ? 'OK' : 'MISSING');
}
const htmlScripts = html.match(/src=["'][^"']+["']/g) || [];
for (const s of htmlScripts) {
  const v = s.replace(/src=["']/, '').replace(/["']$/, '');
  if (v.startsWith('http')) { console.log(v, '(external)'); continue; }
  const p = v.replace(/^\.\//, '');
  console.log(v, fs.existsSync(p) ? 'OK' : 'MISSING');
}
const htmlStyles = html.match(/href=["'][^"']+["']/g) || [];
for (const s of htmlStyles) {
  const v = s.replace(/href=["']/, '').replace(/["']$/, '');
  if (v.startsWith('http')) { console.log(v, '(external)'); continue; }
  const p = v.replace(/^\.\//, '');
  console.log(v, fs.existsSync(p) ? 'OK' : 'MISSING');
}

console.log('=== SPECIFIC CHECKS ===');
console.log('accountGuestBtn in HTML?', html.includes('id="accountGuestBtn"') ? 'YES' : 'NO');
console.log('accountGuestBtn in JS els?', /accountGuestBtn:\s*\$\(['"]accountGuestBtn['"]\)/.test(js) ? 'YES' : 'NO');
console.log('accountGuestBtn handler?', /els\.accountGuestBtn\?\.addEventListener/.test(js) ? 'YES' : 'NO');
console.log('accountGoogleOverlayBtn in HTML?', html.includes('id="accountGoogleOverlayBtn"') ? 'YES' : 'NO');
console.log('accountGoogleOverlayBtn in JS els?', /accountGoogleOverlayBtn:\s*\$\(['"]accountGoogleOverlayBtn['"]\)/.test(js) ? 'YES' : 'NO');
console.log('openAuthBtn id in HTML?', html.includes('id="openAuthBtn"') ? 'YES' : 'NO');
const oaIdx = js.indexOf('openAuthBtn');
console.log('JS openAuthBtn context:', JSON.stringify(js.slice(Math.max(0, oaIdx - 40), oaIdx + 60)));

// 3. JS syntax check
console.log('=== JS SYNTAX CHECK ===');
try {
  new Function(js);
  console.log('script.js: SYNTAX OK');
} catch (e) {
  console.log('script.js SYNTAX ERROR:', e.message);
}

