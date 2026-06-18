# HabitTracker Alarm/Reminder Production Fix - Task Tracker

## Plan Steps
1. Inspect existing alarm/reminder system in `script.js` (alarmTime normalization, scheduler, shouldTriggerAlarm, modal, sound, STOP/SNOOZE, persistence keys).
2. Identify root cause(s) preventing reliable triggering (foreground/background/close).
3. Implement production-grade alarm scheduling within existing architecture:
   - keep `localStorage` as runtime source of truth
   - do not break habit CRUD, analytics, XP/levels/streak/history, firebase/queue/save
4. Fix foreground behavior:
   - exact due triggering while app open
   - STOP prevents re-trigger today
   - SNOOZE re-triggers once at snooze time
   - refresh/re-render does not lose pending alarms
5. Add background/PWA support:
   - create/register `service-worker.js` if missing
   - notification permission request wiring (minimal UI only if needed)
   - use `showNotification()` from SW where possible
   - cache app shell safely
6. Add missed-alarm recovery on app reopen/refresh inside grace window (popup + notification).
7. Add optional native Android WebView bridge hooks (no web breakage).
8. Add temporary `[alarm]` console logs only (required prefixes); remove noisy ones after verification.
9. Run verification scenarios list and record results.

## Progress
- [x] Step 1: Inspect alarm/reminder code in `script.js`
- [ ] Step 2: Identify root cause(s)
- [ ] Step 3: Implement alarm fixes
- [ ] Step 4: Fix foreground behavior
- [ ] Step 5: Implement PWA/background support
- [ ] Step 6: Missed-alarm recovery
- [ ] Step 7: Android bridge hooks
- [ ] Step 8: Logging + cleanup
- [ ] Step 9: Verification results

