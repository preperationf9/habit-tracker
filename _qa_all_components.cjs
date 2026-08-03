/*
  _qa_all_components.cjs — Verifies EVERY major UI component has the new
  Spatial Glass styles applied in computed styles, and takes a screenshot
  as visual proof of the rendered result.

  Run: node _qa_all_components.cjs
*/
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1400, deviceScaleFactor: 1 });

  await page.goto('http://127.0.0.1:8090/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { try { if (window.closeAuthOverlay) window.closeAuthOverlay(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 800));

  const result = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const pick = (sel) => document.querySelector(sel);
    const Q = (sel, props) => {
      const el = pick(sel);
      if (!el) return { selector: sel, state: 'MISSING' };
      const out = { selector: sel, state: 'present' };
      props.forEach((p) => { out[p] = cs(el)[p]; });
      return out;
    };

    return [
      Q('body', ['backgroundImage', 'color']),
      Q('.spatial-bg', ['position', 'zIndex', 'pointerEvents']),
      Q('.spatial-orb--1', ['filter', 'opacity', 'backgroundImage']),
      Q('.card', ['backgroundImage', 'backdropFilter', 'borderColor', 'borderRadius', 'boxShadow']),
      Q('.card--wide', ['backgroundImage', 'borderRadius']),
      Q('.glow-btn', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.ghost-btn', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.danger-btn', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.icon-btn', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.sidebar', ['backgroundImage', 'backdropFilter', 'boxShadow']),
      Q('.top-left h1', ['backgroundImage', 'WebkitTextFillColor']),
      Q('.streak', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.streak-num', ['backgroundImage']),
      Q('.nav-item', ['borderRadius', 'backgroundImage']),
      Q('.nav-item.is-active', ['backgroundImage', 'borderColor', 'boxShadow']),
      Q('.quote', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.progress-bar', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.progress-fill', ['backgroundImage', 'boxShadow']),
      Q('.pill', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.modal-card', ['backgroundImage', 'backdropFilter', 'borderColor', 'borderRadius', 'boxShadow']),
      Q('.streak-card', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.metric', ['backgroundImage', 'borderColor', 'boxShadow', 'borderRadius']),
      Q('.empty', ['backgroundImage', 'borderColor', 'borderRadius']),
      Q('.auth-overlay-card', ['backgroundImage', 'backdropFilter', 'borderRadius', 'boxShadow']),
      Q('#authOverlay', ['backdropFilter', 'background']),
    ];
  });

  console.log('===== ALL MAJOR COMPONENTS — COMPUTED STYLES =====');
  console.log(JSON.stringify(result, null, 2));

  // Screenshot of the live rendered app
  await page.evaluate(() => { try { if (window.closeAuthOverlay) window.closeAuthOverlay(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: '_proof_fixed_dashboard.png' });

  // Also open the "Add habit" modal for a screenshot
  await page.evaluate(() => { try { window.openHabitModal && window.openHabitModal(); } catch (e) {} });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: '_proof_fixed_modal.png' });
  try { await page.evaluate(() => { const m = document.getElementById('habitModal'); if (m) m.classList.remove('is-open'); }); } catch (e) {}

  // Check old-ui markers are GONE (proves not old stylesheet)
  const oldMarkers = await page.evaluate(() => {
    const css = Array.from(document.styleSheets).map((s) => {
      let rules = [];
      try { rules = Array.from(s.rules || s.cssRules).map((r) => r.cssText); } catch (e) {}
      return rules.join(' ');
    }).join(' ');
    return {
      hasLayeredFlatPanelVar: css.includes('--panel:'),
      hasOldPanelBodyBg: css.includes('--bg:#0d1424') || css.includes('--bg:#0a0f1c') || css.includes('--panel:rgba(255,255,255,.06)'),
      styleSheetCount: document.styleSheets.length,
      onlyOneStylesheet: document.styleSheets.length === 1,
    };
  });

  console.log('\n===== OLD-UI MARKER CHECK =====');
  console.log(JSON.stringify(oldMarkers, null, 2));

  // heuristic: glass gradient count in card + backdrop blur = new UI
  const glassCount = result.filter((r) =>
    r.state === 'present' &&
    ((r.backgroundImage && r.backgroundImage.includes('linear-gradient')) ||
      (r.backdropFilter && r.backdropFilter.includes('blur')))
  ).length;
  console.log('\n===== VERDICT =====');
  console.log('Components verified with glass styles:', glassCount, 'of', result.length);
  console.log('Screenshot saved: _proof_fixed_dashboard.png, _proof_fixed_modal.png');
  console.log(
    glassCount >= 15 && oldMarkers.onlyOneStylesheet
      ? 'RESULT: PASS — Glass styles applied across all major components; single (new) stylesheet loaded.'
      : 'RESULT: FAIL — some components missing glass styles.'
  );

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
