# Task TODO: Reminder OFF feature (per habit)

## Plan checkpoints
- [ ] 1) Update habit data model: add `habit.reminder = { enabled: boolean }` with defaults.
- [ ] 2) Add per-habit UI toggle button “Reminder ON / OFF” in `renderDashboard()`.
- [ ] 3) Wire toggle handler in `bindEvents()` to set `habit.reminder.enabled` and `save()`.
- [ ] 4) Implement a **separate reminder scheduler** (new code) that fires reminders only when `habit.reminder.enabled === true`.
- [ ] 5) Implement immediate cancel on OFF: cancel only reminder timers for that habit and clear any queued reminder triggers.
- [ ] 6) Ensure re-enable reschedules fresh reminders without duplicates.
- [ ] 7) Add minimal UI refresh so button label reflects current state.

## Test
- [ ] Manual test: turn OFF → no reminders fire; alarms continue working.
- [ ] Manual test: turn ON again → reminders fire once (no duplicates).

