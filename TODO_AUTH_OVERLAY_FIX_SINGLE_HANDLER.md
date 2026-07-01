# TODO_AUTH_OVERLAY_FIX_SINGLE_HANDLER.md

- [ ] Remove/disable duplicate/conflicting auth click handlers for Google sign-in and logout inside `script.js`.
- [ ] Ensure Firebase compat-only usage remains: `firebase.initializeApp(window.firebaseConfig)`, `firebase.auth()`, `new firebase.auth.GoogleAuthProvider()`, and `firebase.auth().signOut()`.
- [ ] Ensure `openAuthOverlay`, `closeAuthOverlay`, and `bindFreshAuthOverlay` are not duplicated (keep at most one copy each).
- [ ] Add/ensure the single final stable click handler exists exactly once (capture, stopPropagation, stopImmediatePropagation, true), using the provided handler code.
- [ ] Remove old/duplicate sign-in and sign-out event listeners bound to `#authGoogleBtn`, `#accountSignInBtn`, `#accountLogoutBtn`.
- [ ] Verify `node -c script.js` passes.
- [ ] Verify expected runtime behavior: Google Sign In works; Logout works; no `initializeApp is not defined`; no `closeOverlay is not defined`.

