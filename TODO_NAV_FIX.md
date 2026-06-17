# Navigation Fix TODO (script.js)

- [ ] Add `switchView(viewName)` router function (logs `[nav] switchView -> ...`).
- [ ] Ensure `switchView` hides all `.view` and shows only `#view-${view}`; sync `.nav-item[data-view]` active state for both sidebar + mobile.
- [ ] Store `appEls` reference so `switchView` can call existing render logic safely.
- [ ] Rebind nav click listeners to:
  - [ ] Sidebar: `.nav-item[data-view]`
  - [ ] Mobile: `.mobile-nav .nav-item[data-view]`
  - [ ] Each click must call `switchView(viewName)`.
- [ ] Fix hamburger ☰ binding:
  - [ ] Toggle `#mobileNav.is-open`
  - [ ] Set `aria-expanded` on `#menuBtn`
  - [ ] Add debug log `[nav] mobile menu toggled`
- [ ] Keep all other systems untouched (alarm/reminders/habits/xp/analytics/firebase/storage).

