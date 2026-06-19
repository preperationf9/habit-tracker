# TODO_ALARM_PARTS_A_B_C_TARGETED

- [ ] Step 0: Verify backup created for script.js before edits.
- [ ] Step 1: Implement exact next-due scheduling in `startAlarmScheduler()` (setTimeout to next due per habit) and add 5s safety scan.
- [ ] Step 2: Implement real mobile audio unlock: preload `sounds/alarm1..4.mp3`, set `window.__alarmAudioUnlocked` after successful gesture, and retry if play is blocked.
- [ ] Step 3: Add retry-on-tap when audio play() is blocked inside alarm modal.
- [ ] Step 4: Make modal open/close focus-safe: blur activeElement before hiding; focus STOP button on open.
- [ ] Step 5: Regression check: confirm queue engine, firebase, habit CRUD, XP/streak remain untouched.
- [ ] Step 6: Report functions changed and mobile verification steps.

