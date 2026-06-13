# BlackboxAI Alarm Runtime Patch Plan

## Goal
Make sure the persisted alarm field `habit.alarmTime` always conforms to the invariant used by both:
- UI rendering gate (`renderDashboard`)
- alarm scheduler (`startAlarmScheduler`)

Invariant (alarmTime invariant):
- `habit.alarmTime` is either a canonical `HH:MM` string in 24h time
- or `null` (for missing/invalid)

## Current status from repo inspection
- UI gate already checks `typeof alarmTime === 'string' && /^
{2}:\n{2}$/`.
- Scheduler assumes `habit.alarmTime.split(':')` and uses numeric hh/mm.
- `parseTimeFromUIToHHMM(...)` already returns `null` on invalid input.
- `load()` now calls `validateAndNormalizeAllHabitsAlarmTime()` but the function is **not present** in the file.

## Step-by-step implementation
1. Add function `validateAndNormalizeAllHabitsAlarmTime()` in `script.js`.
2. Function behavior:
   - iterate `state.habits`
   - normalize/validate each habit’s `alarmTime` using existing `normalizeAlarmTimeToHHMM(...)`
   - handle legacy values if `habit.alarmTime` contains 12h or other strings
   - set invalid/empty to `null`
   - ensure `alarmWeekdaysSelected` exists (already handled during migration, but do a minimal guard if missing)
3. Call `validateAndNormalizeAllHabitsAlarmTime()` after migration in `load()` (already inserted).
4. Call it additionally after adding a habit (optional but safe) and before scheduler starts.

## Testing checklist
- Add a habit with reminder enabled and verify alarm icon renders.
- Add a habit with reminder enabled but invalid hour/minute inputs (if possible) and verify scheduler does not crash.
- Manually corrupt localStorage alarmTime entries and reload:
  - UI should show no reminder indicator
  - scheduler should not trigger

## Files to edit
- `script.js`

## Expected outcome
- No `undefined` / invalid `alarmTime` values reach UI or alarm scheduler.
- Scheduler and UI remain consistent.

