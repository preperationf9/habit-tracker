# TODO — Queue Restore then Production QA

## Queue Restore (no queue engine code changes)
- [ ] Restore `script.js` from `backups/script.js.bak_pre_auth_fix_20260614_000000`.
- [ ] Verify app boots (no JS runtime errors on load).
- [ ] Verify core habit CRUD + checklist rendering still work.

## Production QA (post-restore)
- [ ] Verify alarm reminder UI renders only when `habit.alarmTime` is a valid `HH:MM`.
- [ ] Verify alarm scheduler doesn’t crash with malformed localStorage data.
- [ ] Verify streak/weekly/monthly analytics are consistent.
- [ ] Verify Trash: move to trash, restore, permanent delete.
- [ ] Verify cloud/auth overlay still behaves as expected (may be non-functional but must not crash).

