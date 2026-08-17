# Project Cleanup — Execution Plan

## Overview
Complete project cleanup of temporary QA, proof, debug and generated files.
All files below were verified to have ZERO references in production code
(index.html, script.js, style.css, spatial-effects.js, service-worker.js,
firebaseConfig.js, privacy.html, manifest.json).

## Steps
- [x] 1. Delete QA/proof/debug/generated files at project root
- [x] 2. Delete node_modules/ (QA-only tooling; package.json has no deps)
- [x] 3. Remove empty folders (.well-known was empty; recreated per KEEP list)
- [x] 4. Verify production files intact and no broken references
- [x] 5. Final verification report

## Final State
- Deleted: 16 QA/proof/debug scripts + 2 proof PNGs + node_modules/
- Kept: all production files (index.html, script.js, style.css, manifest.json,
  service-worker.js, firebaseConfig.js, package.json, privacy.html,
  spatial-effects.js, vercel.json, icon.png, icon-192.png, icon-512.png,
  .gitignore, sounds/, .well-known/, .vercel/)
- Backup commit: a652a8a "chore: backup snapshot before project cleanup"

## Verification (post-cleanup)
- ALL production files present (HTML/JS/CSS/manifest/SW/firebase/privacy/spatial/vercel/icons/sounds)
- ALL index.html src/href references resolve (manifest, icons, style.css, privacy.html, firebaseConfig.js, script.js, spatial-effects.js)
- ALL service-worker.js cached URLs resolve (index, manifest, privacy, icons, sounds, firebaseConfig, style, script, spatial-effects)
- ALL manifest.json icons resolve (icon.png, icon-512.png)
- script.js, firebaseConfig.js, spatial-effects.js: syntax OK
- style.css: braces balanced (353/353)
- index.html correctly links manifest, loads firebaseConfig, registers service worker
- No QA/proof/debug files remain

## Files to DELETE (all verified unused)
- _proof_fixed_dashboard.png
- _proof_fixed_modal.png
- _qa_all_components.cjs
- _qa_check.cjs
- _qa_fix_css.cjs
- _qa_production_check.cjs
- _qa_responsive.cjs
- _qa_stale_cache_fix.cjs
- _qa_verify.cjs
- _qa_verify.js
- _qa_verify2.cjs
- _qa_verify3.cjs
- qa-audit.cjs
- qa-audit.js
- qa-audit2.cjs
- qa-fix.cjs
- TODO.md
- node_modules/

## Files to KEEP (production)
- index.html, script.js, style.css, manifest.json, service-worker.js
- firebaseConfig.js, package.json, privacy.html, spatial-effects.js, vercel.json
- icon.png, icon-192.png, icon-512.png, .gitignore
- sounds/ (alarm1-4.mp3), .well-known/, .vercel/
