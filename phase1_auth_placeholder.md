# Phase 1 Auth/Overlay Placeholder Notes

Goals (approved):
- Add a hidden login overlay UI to `index_fixed.html`.
- Add styling in `style.css`.
- Add an auth overlay controller + opt-in click handler in `script.js`.

Hard constraints (must follow):
- Core habit/analytics/xp/streak/reminders/alarms/offline/PWA/localStorage logic must not change.
- Cloud sync must NOT start automatically.
- No background sync or restore/migration without explicit user click on "Enable cloud backup".
- Firebase Auth may be initialized but must remain idle until user action.

Phase 1 scope in code:
- Create UI overlay that does not block core UI.
- Controller reads `localStorage['habitTracker.auth.mode']` and shows overlay only if google/phone.
- "Enable cloud backup" sets a local flag `habitTracker.cloud.optIn=true` and hands off to Phase 2 (actual Firestore sync/restore) which is not implemented yet.

