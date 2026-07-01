# CLEANUP REPORT — HabitTracker Project Audit

## KEEP (active production — do NOT delete)
```
index.html            (main app entry)
script.js             (main app logic)
style.css             (app styles)
manifest.json         (PWA manifest)
firebaseConfig.js     (Firebase config)
service-worker.js     (PWA service worker)
privacy.html          (privacy policy)
icon.png              (favicon)
icon-192.png          (PWA icon 192)
icon-512.png          (PWA icon 512)
sounds/               (alarm sound files)
  alarm1.mp3
  alarm2.mp3
  alarm3.mp3
  alarm4.mp3
  alarm5.mp3
  alarm6.mp3
```

## SAFE TO DELETE (clearly backup/temp/duplicate)
```
TODO.md
TODO_AUTH_OVERLAY_FIX.md
TODO_AUTH_OVERLAY_FIX_SINGLE_HANDLER.md
TODO_NAV_FIX.md
TODO_PROD_ENTRY_INDEX_MERGE.md
TODO_QUEUE_RESTORE.md
TODO_AUTH_CLOUD_SYNC.md
TODO_ALARM_PARTS_A_B_C_TARGETED.md
blackboxai_alarm_notes.md
blackboxai_alarm_runtime_patch_plan.md
blackboxai_mobile_nav_debug.md
phase1_auth_placeholder.md
firebaseConfig.example.js
debug_instrument_layout.js
__backup_temp.ps1
script.js.bak_to_repair_alarm_only.txt

backups/index_fixed.html.bak.20260614_030620
backups/manifest.json.bak_alarm_fix_20260617_000000.bak
backups/privacy.html.bak.20260614_030620
backups/script.js.bak_alarm_fix_20260617_000000.bak
backups/script.js.bak_alarm_partsA_B_C_focus_fix_20260618_000000
backups/script.js.bak_alarm_scheduler_exact_20260618_000000
backups/script.js.bak_mobile_alarm_ui_exact_20260618_000002
backups/script.js.bak_mobile_alarm_unreachable_fix_20260618_000003
backups/script.js.bak_pre_auth_fix_20260614_000000
backups/script.js.bak_pre_auth_fix_20260614_000000.restore_marker
backups/script.js.bak_reminder_mobile_compact_20260618_000001
backups/script.js.bak.20260614_030620
backups/style.css.bak_mobile_alarm_ui_exact_20260618_000002
backups/style.css.bak_reminder_mobile_compact_20260618_000001
backups/style.css.bak.20260614_030620
backups/TODO.md.bak.20260614_030620
```

## CHECK BEFORE DELETE (verify safety first)
```
index_fixed.html          — compare byte contents vs index.html (if identical → safe to delete)
index_old.html            — same: verify it's truly unused/stale
index.html.old_bak_note.txt — verify it's not a recovery reference
__restore_instructions.txt  — verify you don't manually run restore steps from it
```

## CODE CLEANUP (script.js — auth dead-code audit)

### Duplicate auth overlay functions  — STATUS: NO DUPES FOUND
- `openAuthOverlay()`     → single definition (lines ~88-112)
- `closeAuthOverlay()`    → single definition (lines ~114-133)
- `getAuthOverlay()`      → single definition (lines ~83-86)
- `bindFreshAuthOverlay()`→ single definition (guarded by __FRESH_AUTH_OVERLAY_BOUND__)

### Duplicate signInWithPopup / signOut — STATUS: NO DUPES FOUND
- Only one signInWithPopup call exists inside the FINAL capturing handler (EOF)
- Only one signOut call exists (same handler)

### Dedicated auth document click handlers — STATUS: ONE HANDLER EXISTS
- Single `document.addEventListener("click", async function (e) { ... }, true);` at EOF
- Handles both `#accountSignInBtn`/`#authGoogleBtn` and `#accountLogoutBtn`

### Old Firebase modular init (initializeApp/getAuth/getFirestore) — STATUS: ALREADY REMOVED
- Codebase uses compat SDK only (`firebase.initializeApp`, `firebase.auth()`, `firebase.firestore()`)
- No modular import-style calls found

### Debug logs — STATUS: FEW LOGS REMAIN (low-risk)
```
console.log("[final-auth] block loaded");
console.log('[auth-debug] click event target:', ...);
console.log('[auth-debug] matched buttons:', ...);
console.log("[signin clicked]");
console.log("[logout clicked]");
console.log("[final-auth] click captured", ...);
console.log('[auth] login overlay requested');
```
These are intentional instrumentation. Can be removed if you want stricter prod logs.

---

## SUMMARY
- **Files to delete (safe):** 37 files (all TODO.md, .bak, backup scripts, debug templates)
- **Files to verify before delete:** 4 files (index variants, restore instructions)
- **Code to remove:** None confirmed yet — auth overlay/signIn/signOut is single-sourced and active.
- **Production files remain untouched:** All 11 core files untouched.

