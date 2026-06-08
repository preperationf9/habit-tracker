Alarm feature plan (minimal additive changes)

1) index.html + index_fixed.html
- Add alarm popup modal:
  - id="alarmModal" class="modal"
  - include elements:
    - id="alarmHabitName" (for message)
    - STOP button id="alarmStopBtn"
    - SNOOZE button id="alarmSnoozeBtn"
- Add sound picker inside Add Habit modal:
  - 4 radio inputs named/ids e.g. alarmSound
  - default alarmSound=1
  - input ids: habitAlarmSound1..4

2) script.js
- Add helper functions (additive, do not delete existing):
  - parseHabitReminderTime(habit): compute today’s target Date from hour/min/sec string plus AM/PM
  - shouldTriggerForHabit(habit, now): uses reminderType/reminderDays
  - schedule loop: setInterval every 10s or so, but only triggers when time matches within same minute.
  - state.meta.reminder: { currentAlarm?: {habitId, scheduledAt, silencedUntil}, lastTriggeredAtByHabit:{} }
- Add persistence:
  - store current silencedUntil and lastTriggeredAtByHabit.
- Audio:
  - function unlockAudioIfNeeded(): create Audio(), try play with muted first.
  - function getSelectedAlarmSound(): based on habit-specific alarmSound or default.
  - function playReminderSound(url): play, handle pause
- Notifications:
  - requestNotificationPermissionOnce() called on init if notifications unsupported.
  - show browser Notification with body "Time to complete your habit: {name}".

3) STOP/SNOOZE
- STOP: clear alarm occurrence, store silencedUntil=now+
- SNOOZE: reschedule by updating silencedUntil=now+5min and store current alarm open.

Only modify the above files. No CSS changes unless absolutely required (modal uses existing .modal and .modal-card styles).
