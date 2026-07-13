# HabitTracker — Passkey Registration Integration TODO

- [ ] Update `index.html` to load a working `@simplewebauthn/browser` bundle so `startRegistration()` is available in `script.js`.
- [ ] Update only the existing passkey click handler (`authPasskeyBtn` in `script.js`) to:
  - [ ] Verify passkey API availability and show proper error states.
  - [ ] Require signed-in Firebase user (reject Guest).
  - [ ] Fetch `/api/passkey/register-options` (Authorization: Bearer <idToken>).
  - [ ] Convert/ensure options are compatible with `@simplewebauthn/browser`.
  - [ ] Call `startRegistration(options)`.
  - [ ] POST `/api/passkey/register-verify` with the returned `credential` and `sessionId`.
  - [ ] Show success state and close overlay / enable cloud as the app already does.
  - [ ] On failure, show a user-friendly message and keep app state unchanged.
- [ ] Quick local runtime sanity check (syntax check) for modified files.

