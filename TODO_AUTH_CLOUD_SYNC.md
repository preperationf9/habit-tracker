# Auth + Cloud Backup (Additive) — Implementation Tracking

## Guardrails
- [ ] Preserve all existing habit-tracking / analytics / XP / levels / streak / history / reminders / alarms / notifications / offline-first / PWA/UI logic.
- [ ] Guest mode continues to use `localStorage['habitTracker.v1']` with identical behavior.
- [ ] Cloud sync is additive and only active for authenticated users.
- [ ] No destructive edits to existing logic; only additive modules + hooks.

## Work Items
### 1) Login Gate UI
- [ ] Add premium login screen to `index_fixed.html` (Google, Phone OTP, Guest)
- [ ] Add Guest Mode warning modal text exactly as specified
- [ ] Add OTP input flow UI and error/status areas
- [ ] Add responsive styling in `style.css`

### 2) Firebase Integration (client-side)
- [ ] Add Firebase Auth + Firestore client initialization (behind feature flag)
- [ ] Implement Google sign-in
- [ ] Implement Phone OTP sign-in

### 3) Cloud Snapshot Model + Validation
- [ ] Define Firestore document structure for user backup
- [ ] Implement validation/normalization of cloud snapshot
- [ ] Implement conflict-safe merge rules
- [ ] Implement “never overwrite good data with empty data”

### 4) Offline-first Sync Queue
- [ ] Add new local queue key (separate from `habitTracker.v1`)
- [ ] After local `save()`, enqueue cloud sync for logged-in users
- [ ] Process queue when online
- [ ] Prevent sync storms (debounce/batch)

### 5) Auto-restore on login/reinstall
- [ ] On successful login: download snapshot
- [ ] Merge into local state safely
- [ ] Save locally and render UI

### 6) UX + Safety
- [ ] Ensure Guest mode never calls cloud APIs
- [ ] Ensure app does not break if Firebase is misconfigured (fallback to Guest/device)

### 7) Privacy Policy Update
- [ ] Add additive note about cloud backup for authenticated users to `privacy.html`

## Testing Checklist
- [ ] Guest mode, offline: add/update habits; verify no errors
- [ ] Guest mode, online: verify no cloud calls
- [ ] Google login, offline initial add: verify queue created, UI works
- [ ] Google login, online after: verify sync flush + restore
- [ ] Phone OTP login: same as Google
- [ ] Data safety test: cloud empty snapshot should not wipe local


