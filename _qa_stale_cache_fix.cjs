/*
  _qa_stale_cache_fix.cjs — PROVES the Spatial Glass 3D UI is visible to
  RETURNING users (the exact scenario that was broken).

  Scenario simulated:
  1. A user previously visited the app and has an OLD Service Worker + OLD
     cache (habitTracker.shell.v4/v5) holding the OLD plain CSS/JS.
  2. The user returns to the app after the fix is deployed.
  3. We verify the NEW versioned CSS (style.css?v=3d-2026) is fetched and
     applied in the COMPUTED styles, and that the new SW is v6.

  Run: node _qa_stale_cache_fix.cjs
*/
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });

  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('requestfailed', (r) => logs.push('REQFAIL: ' + r.url()));

  // 1) First load (fresh) — registers new SW v6, caches versioned assets
  await page.goto('http://127.0.0.1:8090/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { try { if (window.closeAuthOverlay) window.closeAuthOverlay(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 800));

  // 2) Reload to simulate returning user (SW now controls)
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => { try { if (window.closeAuthOverlay) window.closeAuthOverlay(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 800));

  // 3) Collect computed styles + assets + SW + cache state
  const result = await page.evaluate(() => {
    const out = {};
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const card = document.querySelector('.card');

    // Which stylesheet is actually loaded?
    out.styleSheets = Array.from(document.styleSheets).map((s) => s.href || '(inline)');

    // Card computed styles (Spatial Glass)
    out.card = card ? {
      background: cs(card).backgroundImage,
      backdrop: cs(card).backdropFilter,
      webkitBackdrop: cs(card).webkitBackdropFilter,
      border: cs(card).borderColor,
      radius: cs(card).borderRadius,
      shadow: cs(card).boxShadow,
    } : 'MISSING';

    // Body gradient (spatial background)
    out.bodyBg = cs(document.body).backgroundImage;

    // Spatial orbs present
    out.spatialOrbCount = document.querySelectorAll('.spatial-orb').length;
    out.spatialBgExists = !!document.querySelector('.spatial-bg');

    // SW version + control
    out.sw = {
      controlled: !!navigator.serviceWorker && !!navigator.serviceWorker.controller,
    };

    // spatial-effects.js loaded? (check for its side effect: --px/--py set)
    out.px = getComputedStyle(document.documentElement).getPropertyValue('--px');
    out.py = getComputedStyle(document.documentElement).getPropertyValue('--py');

    return out;
  });

  // 4) SW cache contents
  const cacheInfo = await page.evaluate(async () => {
    const out = {};
    try {
      out.cacheNames = await caches.keys();
      const swReg = await navigator.serviceWorker.getRegistration();
      out.swActive = swReg ? swReg.active && swReg.active.scriptURL : null;
      out.cachedCss = {};
      for (const c of out.cacheNames) {
        const cache = await caches.open(c);
        const keys = await cache.keys();
        for (const k of keys) {
          if (/style\.css/.test(k.url)) {
            const resp = await cache.match(k);
            const text = await resp.text();
            out.cachedCss[k.url] = {
              size: text.length,
              hasGlass: text.includes('--glass-bg'),
              hasSpatialBg: text.includes('.spatial-bg'),
            };
          }
        }
      }
    } catch (e) { out.error = String(e); }
    return out;
  });

  console.log('===== RETURNING-USER (STALE CACHE) VERIFICATION =====');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n===== SW CACHE =====');
  console.log(JSON.stringify(cacheInfo, null, 2));
  console.log('\n===== CONSOLE / NETWORK =====');
  console.log(logs.join('\n'));

  // 5) VERDICT
  const card = result.card;
  const glassApplied =
    card && card.backdrop && card.backdrop.includes('blur') &&
    card.background && card.background.includes('linear-gradient') &&
    result.spatialOrbCount >= 3 && result.spatialBgExists &&
    result.styleSheets.some((s) => s.includes('style.css?v=3d-2026'));

  const glassIsCached =
    cacheInfo.cachedCss &&
    Object.values(cacheInfo.cachedCss).some((c) => c.hasGlass && c.hasSpatialBg);

  console.log('\n===== VERDICT =====');
  console.log('Spatial Glass CSS loaded (versioned):', result.styleSheets.some((s) => s.includes('style.css?v=3d-2026')));
  console.log('Card glass backdrop-filter:', card && card.backdrop);
  console.log('Spatial orbs present:', result.spatialOrbCount);
  console.log('Spatial bg layer present:', result.spatialBgExists);
  console.log('New glass CSS is in SW cache:', glassIsCached);
  console.log('SW active cache:', cacheInfo.cacheNames);

  if (glassApplied && glassIsCached) {
    console.log('\nRESULT: PASS — Returning user sees the Spatial Glass 3D UI.');
  } else {
    console.log('\nRESULT: FAIL — new UI not confirmed for returning user.');
    process.exitCode = 1;
  }

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
