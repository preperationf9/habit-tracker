# TODO (HabitTracker)

- [ ] Fix hamburger (☰) click non-responsive on mobile nav.
  - [ ] Add robust element lookup for `#menuBtn` + `#mobileNav`.
  - [ ] Add null-check guard so toggle code runs only when elements exist.
  - [ ] Add minimal debug logs: log click + current class state.
  - [ ] Ensure mobileNav closes after selecting a nav item (optional quality).
- [ ] Test manually: responsive width <= 820px, click ☰, verify mobile menu opens.

