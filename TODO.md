# Project Cleanup — Execution Plan

## Overview
Complete project cleanup of temporary QA, proof, debug and generated files.
All files below were verified to have ZERO references in production code
(index.html, script.js, style.css, spatial-effects.js, service-worker.js,
firebaseConfig.js, privacy.html, manifest.json).

## Steps
- [ ] 1. Delete QA/proof/debug/generated files at project root
- [ ] 2. Delete node_modules/ (QA-only tooling; package.json has no deps)
- [ ] 3. Remove empty folders (if any become empty)
- [ ] 4. Verify production files intact and no broken references
- [ ] 5. Final verification report

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
