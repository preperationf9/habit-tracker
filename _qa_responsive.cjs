/* =====================================================================
   _qa_responsive.cjs - Cross-Device Consistency QA (automated)
   ---------------------------------------------------------------------
   Verifies that the Spatial Glass 3D UI is visually identical across
   desktop / laptop / tablet / Android / iPhone by checking the CSS/HTML
   contract that enforces it:
     . PWA + color-scheme meta tags (index.html)
     . iOS safe-area insets (env(safe-area-inset-*)) for main/modal/auth/footer
     . tall-modal centering (margin:auto) so no clipped dialogs on phones
     . 16px+ inputs/selects (no iOS auto-zoom)
     . touch polish: tap-highlight transparent, touch-action manipulation,
       text-size-adjust, -webkit-overflow-scrolling
     . breakpoint coverage across ALL widths 320->desktop
     . glass identity preserved (backdrop-filter + glass vars still present;
       no flat replacement)
     . no horizontal scroll (overflow-x guards + *{max-width:100%})
     . 100dvh fallback present
     . reduced-motion + hover:none performance guards present
     . CSS brace balance
   Run:  node _qa_responsive.cjs
   ===================================================================== */
'use strict';

const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra) {
  if (ok) {
    pass++;
    console.log('PASS: ' + name);
  } else {
    fail++;
    failures.push(name + (extra ? ' -- ' + extra : ''));
    console.log('FAIL: ' + name + (extra ? ' -- ' + extra : ''));
  }
}

console.log('===== index.html - PWA / viewport meta =====');
check('viewport has viewport-fit=cover', /name=["']viewport["'][^>]*viewport-fit=cover/.test(html) || /viewport-fit=cover/.test(html));
check('color-scheme dark meta present', /name=["']color-scheme["'][^>]*content=["']dark["']/.test(html) || html.includes('color-scheme'));
check('theme-color meta present', html.includes('name="theme-color"'));
check('mobile-web-app-capable present', /name=["']mobile-web-app-capable["']/.test(html) || html.includes('mobile-web-app-capable'));
check('apple-mobile-web-app-capable present', html.includes('apple-mobile-web-app-capable'));
check('apple status-bar style black-translucent', html.includes('black-translucent'));
check('apple-mobile-web-app-title present', html.includes('apple-mobile-web-app-title'));
check('manifest linked', html.includes('rel="manifest"'));
check('apple-touch-icon present', html.includes('apple-touch-icon'));
check('format-detection telephone=no', html.includes('telephone=no'));

console.log('\n===== style.css - safe-area / viewport =====');
check('env(safe-area-inset-*) used in @supports', /@supports\s*\(padding:\s*env\(safe-area-inset-top\)\)/.test(css));
check('.main safe-area insets', css.includes('env(safe-area-inset-left)') && css.includes('env(safe-area-inset-right)'));
check('.modal safe-area bottom', css.includes('env(safe-area-inset-bottom)'));
check('auth-overlay safe-area padding', /auth-overlay\s*{[^}]*env\(safe-area-inset-top\)/.test(css) || css.includes('.auth-overlay{padding:env(safe-area-inset-top)'));
check('standalone display-mode media query', /@media\s*\(display-mode:\s*standalone\)/.test(css));
check('100dvh viewport-height fallback', css.includes('100dvh') && css.includes('min-height:100vh'));
check('dynamic viewport comment (URL bar/keyboard)', css.includes('dynamic viewport height'));

console.log('\n===== style.css - no clipped dialogs / zoom =====');
check('modal margin:auto centering (tall-modal fix)', /\.modal-card\s*{[^}]*margin:\s*auto/.test(css));
check('modal scrollable + touch scroll', /\.modal\s*{[^}]*overflow:\s*auto[^}]*\-webkit-overflow-scrolling:\s*touch/.test(css));
check('inputs font-size 16px (no iOS zoom)', /input,select,textarea\s*{[^}]*font-size:\s*16px/.test(css));
check('alarm-bell-select font-size 16px', /\.alarm-bell-select\s*{[^}]*font-size:\s*16px/.test(css));

console.log('\n===== style.css - touch polish =====');
check('tap-highlight transparent', css.includes('-webkit-tap-highlight-color:transparent'));
check('touch-action manipulation', css.includes('touch-action:manipulation'));
check('text-size-adjust 100%', css.includes('text-size-adjust:100%') && css.includes('-webkit-text-size-adjust:100%'));
check('-webkit-overflow-scrolling:touch', css.includes('-webkit-overflow-scrolling:touch'));
check('overscroll-behavior-y none', css.includes('overscroll-behavior-y:none'));
check('scroll-behavior smooth', css.includes('scroll-behavior:smooth'));

console.log('\n===== style.css - no horizontal scroll =====');
check('html overflow-x hidden', /html\s*{[^}]*overflow-x:\s*hidden/.test(css));
check('body overflow-x hidden', /body\s*{[^}]*overflow-x:\s*hidden/.test(css));
check('* max-width 100% guard', /(\s|\*)\*\{[^}]*max-width:\s*100%/.test(css) || css.includes('*{max-width:100%}'));
check('top-right wraps', /\.top-right\s*{[^}]*flex-wrap:\s*wrap/.test(css));
check('auth-badge-text ellipsis (no clipped text)', /\.auth-badge-text\s*{[^}]*text-overflow:\s*ellipsis/.test(css));
check('weekly table mobile overflow-x auto', /\.weekly-table\s*{[^}]*overflow-x:\s*auto/.test(css) || /@media \(max-width: 820px\)\s*{[^}]*\.weekly-table\{overflow-x:auto/.test(css));

console.log('\n===== style.css - glass identity preserved (never flat) =====');
check('glass background var --glass-bg present', css.includes('--glass-bg:') && css.includes('linear-gradient'));
check('backdrop-filter on .card', /\.card\s*{[^}]*backdrop-filter:\s*blur\(var\(--glass-blur\)\)/.test(css));
check('-webkit-backdrop-filter on .card', /\.card\s*{[^}]*\-webkit-backdrop-filter:\s*blur\(var\(--glass-blur\)\)/.test(css));
check('glass modal backdrop-filter', /\.modal-card\s*{[^}]*backdrop-filter:\s*blur\(var\(--glass-blur-lg\)\)/.test(css));
check('glass auth card backdrop-filter', /\.auth-overlay-card\s*{[^}]*backdrop-filter:\s*blur\(var\(--glass-blur-lg\)\)/.test(css));
check('glow shadows preserved (depth identity)', css.includes('--shadow-card:') && css.includes('--shadow-lift:') && css.includes('--glow-brand:'));
check('glow-btn gradient (not flat)', /\.glow-btn\s*{[^}]*linear-gradient/.test(css));
check('progress-fill gradient (not flat)', /\.progress-fill\s*{[^}]*linear-gradient/.test(css));

console.log('\n===== style.css - breakpoint coverage (320->desktop) =====');
const breakpoints = ['max-width: 820px', 'max-width: 768px', 'max-width: 540px', 'max-width: 480px', 'max-width: 412px', 'max-width: 390px', 'max-width: 360px', 'max-width: 340px'];
for (const bp of breakpoints) {
  check('breakpoint present: ' + bp, css.includes(bp));
}

// Brace-aware block extractor: returns the full body of the FIRST media query
// whose '@media' + needle matches. Handles nested braces correctly.
function mediaBlock(needle) {
  const at = css.indexOf('@media' + needle);
  if (at === -1) return '';
  const openBrace = css.indexOf('{', at);
  if (openBrace === -1) return '';
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  return '';
}

console.log('\n===== style.css - performance / motion guards =====');
const reducedMotionBlock = mediaBlock(' (prefers-reduced-motion: reduce)');
const hoverNoneBlock = mediaBlock(' (hover: none)');
const mobile540Block = mediaBlock(' (max-width: 540px)');
check('prefers-reduced-motion block', reducedMotionBlock.includes('animation-duration'));
check('reduced motion kills animations', reducedMotionBlock.includes('transition-duration') && reducedMotionBlock.includes('animation-iteration-count'));
check('hover:none block (touch devices)', hoverNoneBlock !== '');
check('hover:none disables card tilt hover', hoverNoneBlock.includes('.card:not(#card-habits):hover{transform:none}'));
check('hover:none card :active micro-interaction', hoverNoneBlock.includes('.card:active,'));
check('mobile blur reduction (540px)', mobile540Block.includes('.spatial-orb{filter:blur(46px);opacity:.42}'));

console.log('\n===== style.css - structure sanity =====');
let open = 0, close = 0;
for (const ch of css) { if (ch === '{') open++; if (ch === '}') close++; }
check('CSS braces balanced (' + open + '/' + close + ')', open === close);
check('no duplicate .icon-btn base block', (css.match(/\.icon-btn\{/g) || []).length === 1);
check('no duplicate .auth-status base block', (css.match(/\.auth-status\{/g) || []).length === 1);
check('.view transition present (view switch polish)', /\.view\{transition:[^}]*opacity/.test(css));

console.log('\n===== SUMMARY =====');
console.log('PASS: ' + pass);
console.log('FAIL: ' + fail);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  x ' + f));
  process.exitCode = 1;
} else {
  console.log('All cross-device consistency checks passed');
}

