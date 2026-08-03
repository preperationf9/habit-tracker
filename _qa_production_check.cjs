/*
  _qa_production_check.cjs — Verifies the LIVE PRODUCTION deployment
  (https://habit-tracker-three-mocha.vercel.app) serves and renders the
  Spatial Glass 3D UI for a returning user.
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

  // First load (registers SW)
  await page.goto('https://habit-tracker-three-mocha.vercel.app/', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => { try { if (window.closeAuthOverlay) window.closeAuthOverlay(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 800));

  // Reload = returning user
  await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { try { if (window.closeAuthOverlay) window.closeAuthOverlay(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 800));

  const result = await page.evaluate(() => {
    const out = {};
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const card = document.querySelector('.card');
    out.styleSheets = Array.from(document.styleSheets).map((s) => s.href || '(inline)');
    out.card = card ? {
      background: cs(card).backgroundImage,
      backdrop: cs(card).backdropFilter,
      radius: cs(card).borderRadius,
    } : 'MISSING';
    out.spatialOrbCount = document.querySelectorAll('.spatial-orb').length;
    out.spatialBgExists = !!document.querySelector('.spatial-bg');
    out.swControlled = !!navigator.serviceWorker && !!navigator.serviceWorker.controller;
    return out;
  });

  const cacheInfo = await page.evaluate(async () => {
    const o = {};
    try { o.cacheNames = await caches.keys(); o.cachedCss = {};
      for (const c of o.cacheNames) {
        const cache = await caches.open(c);
        for (const k of await cache.keys()) {
          if (/style\.css/.test(k.url)) {
            const t = await (await cache.match(k)).text();
            o.cachedCss[k.url] = { hasGlass: t.includes('--glass-bg'), hasSpatialBg: t.includes('.spatial-bg') };
          }
        }
      }
    } catch (e) { o.error = String(e); }
    return o;
  });

  console.log('===== PRODUCTION VERIFICATION =====');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n===== PRODUCTION SW CACHE =====');
  console.log(JSON.stringify(cacheInfo, null, 2));

  const ok =
    result.card && result.card.backdrop && result.card.backdrop.includes('blur') &&
    result.spatialOrbCount >= 3 && result.spatialBgExists &&
    result.styleSheets.some((s) => s.includes('style.css?v=3d-2026')) &&
    cacheInfo.cacheNames.some((n) => n.includes('v6')) &&
    Object.values(cacheInfo.cachedCss || {}).some((c) => c.hasGlass && c.hasSpatialBg);

  console.log('\n===== VERDICT =====');
  console.log(ok ? 'PASS — PRODUCTION serves and renders the Spatial Glass 3D UI for returning users.' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
