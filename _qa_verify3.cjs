const fs = require('fs');
const js = fs.readFileSync('script.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

console.log('=== 1. accountGuestBtn handler ===');
const guestBtnRefs = js.match(/accountGuestBtn/g) || [];
console.log('accountGuestBtn refs in script.js:', guestBtnRefs.length);
// Look for addEventListener on accountGuestBtn
console.log('Has accountGuestBtn listener:', js.includes("getElementById('accountGuestBtn')") || js.includes("$('accountGuestBtn')"));

console.log('\n=== 2. Desktop alarm-bell CSS (outside media query) ===');
// Find where .alarm-bell-btn is defined. Find the last closing brace index of max-width:768px block
const mobileBlock = css.indexOf('@media (max-width: 768px)');
const desktopBell = css.indexOf('.alarm-bell-btn', 0);
console.log('.alarm-bell-btn first occurrence index:', desktopBell);
console.log('mobile media query starts at:', mobileBlock);
console.log('Is first .alarm-bell-btn INSIDE mobile media query?', desktopBell > mobileBlock);
// Check for any desktop definitions before the media query
const beforeMobile = css.slice(0, mobileBlock);
console.log('Has .alarm-bell-btn before mobile block:', beforeMobile.includes('.alarm-bell-btn'));
console.log('Has .alarm-bell-popover before mobile block:', beforeMobile.includes('.alarm-bell-popover'));

console.log('\n=== 3. aria-labels on action buttons ===');
// bell button creation
const bellIdx = js.indexOf("bellBtn.dataset.action = 'toggleAlarmPopover'");
console.log('bell aria-label present:', js.slice(bellIdx, bellIdx + 600).includes('aria-label'));
const doneIdx = js.indexOf("doneBtn.dataset.action = 'setStatus'");
console.log('done button aria-label present:', js.slice(doneIdx, doneIdx + 300).includes('aria-label'));
const ndIdx = js.indexOf("ndBtn.dataset.action = 'setStatus'");
console.log('nd button aria-label present:', js.slice(ndIdx, ndIdx + 300).includes('aria-label'));

console.log('\n=== 4. Popover position approach ===');
const popPos = css.indexOf('.alarm-bell-popover{');
console.log('.alarm-bell-popover base (no media) defined:', css.slice(0, mobileBlock).includes('.alarm-bell-popover'));

console.log('\n=== 5. Duplicate CSS blocks ===');
const iconBtnCount = (css.match(/\.icon-btn\{/g) || []).length;
console.log('.icon-btn{ blocks:', iconBtnCount);
const authStatusCount = (css.match(/\.auth-status\{/g) || []).length;
console.log('.auth-status{ blocks:', authStatusCount);

