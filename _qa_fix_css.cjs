const fs = require('fs');

// ---- 1. Load & reflow the 768px media query to remove duplicated alarm-bell rules ----
const css = fs.readFileSync('style.css', 'utf8');

const startIdx = css.indexOf('@media (max-width: 768px){');
if (startIdx === -1) throw new Error('media 768 block not found');

let brace = css.indexOf('{', startIdx);
if (brace === -1) throw new Error('opening brace not found');

let depth = 0;
let endIdx = -1;
for (let i = brace; i < css.length; i++) {
  if (css[i] === '{') depth++;
  else if (css[i] === '}') {
    depth--;
    if (depth === 0) { endIdx = i; break; }
  }
}
if (endIdx === -1) throw new Error('closing brace not found');

const trimmedBlock =
`@media (max-width: 768px){
  .habit-item{display:flex; flex-direction:row; align-items:flex-start; gap:8px;}
  .habit-left{flex:1 1 auto; min-width:0;}
  .habit-actions{flex:0 0 auto; display:flex; flex-direction:row; gap:8px; align-items:flex-start; flex-wrap:nowrap;}

  .alarm-bell-btn{width:48px;height:48px;}
}`;

const newCss = css.slice(0, startIdx) + trimmedBlock + css.slice(endIdx + 1);

// ---- 2. Popover must be fixed so viewport coords stay correct on scroll ----
let finalCss = newCss.replace(
  '.alarm-bell-popover{\n  position:absolute;',
  '.alarm-bell-popover{\n  position:fixed;'
);

// ---- 3. Sanity: brace balance ----
let open = 0, close = 0;
for (const ch of finalCss) { if (ch === '{') open++; if (ch === '}') close++; }
console.log('Braces balanced:', open === close, '(' + open + ' / ' + close + ')');

fs.writeFileSync('style.css', finalCss);
console.log('style.css updated. Block len before:', endIdx - startIdx + 1, '-> after:', trimmedBlock.length);

