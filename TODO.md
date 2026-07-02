# TODO - Firebase/Auth reset (compat-only)

- [ ] Inspect `script.js` auth-related blocks to ensure we can delete them safely
- [ ] Permanently delete all old Firebase/Auth code in `script.js` related to:
  - ensureFirebaseCompatReady, FIREBASE_READY, window.auth
  - firebase.initializeApp, firebase.auth(), firebase.firestore()
  - GoogleAuthProvider, signInWithPopup, signOut
  - onAuthStateChanged
  - auth controller, renderAuthUi, setButtonState
  - accountSignInBtn, accountLogoutBtn, authGoogleBtn
  - auth overlay Google handlers
- [ ] Add fresh compat-only Firebase bootstrap in exactly one init block
- [ ] Add exactly one auth state controller using auth.onAuthStateChanged
- [ ] Add exactly one document-level capturing click handler for sign-in/sign-out
- [ ] Implement strict single UI renderer with required states and “reset then apply” rule
- [ ] Ensure validation invariants in runtime:
  - firebase.apps.length === 1
  - window.FIREBASE_READY === true
  - window.auth exists
- [ ] Run manual console smoke tests:
  - Sign-in → Logout repeated 3 times
  - Verify no “initializeApp is not defined” and no max call stack errors
- [ ] Produce exact final report (deleted blocks, added blocks, remaining occurrences, manual console checks)

