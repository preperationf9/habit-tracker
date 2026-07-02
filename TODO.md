# HabitTracker change tracker

- [ ] Inspect current `script.js` end-of-file auth controller code existence
- [ ] Restore the compat-only auth state controller + single capturing click handler for Google sign-in/sign-out
- [ ] Ensure globals: `__GOOGLE_SIGNIN_IN_PROGRESS__`, `__GOOGLE_SIGNOUT_IN_PROGRESS__`, and `window.__HABITTRACKER_AUTH_CAPTURE_HANDLER_BOUND__` usage
- [ ] Ensure controller updates only UI (enable/disable + text) and never mutates habit/alarms
- [ ] Verify no duplicate click handlers/bindings; only one binding per page
- [ ] Quick runtime syntax check (node parse) and manual smoke test steps

