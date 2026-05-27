# HabitTracker feature upgrades

## XP & Levels
- [x] Add XP/Level UI elements to `index.html` (cards + progress bar + level badge + XP gain container)
- [x] Extend persisted `state` in `script.js` for XP and awarded-per-day tracking
- [x] Implement +10 XP awarding only on done transition (avoid duplicate awards)
- [x] Add animated “+10 / -10 XP” gain effect and instant dashboard update
- [ ] Implement level thresholds + glowing level badge + progress to next level

## Streak System
- [x] Fix JS runtime issue blocking habit add/render (undefined motivation index)
- [ ] Add streak visuals/rules if needed
- [ ] Persist streak history/best and rule updates
- [ ] Add streak glow animation and ensure mobile responsive

## Dashboard Analytics
- [ ] Populate analytics metrics + weekly bars + monthly chart from stored history
- [ ] Compute: best habit, missed habits, total completed, completion %
- [ ] Ensure analytics auto-update after each completion toggle

## General UI Improvements (Premium Mobile)
- [ ] Add/replace mobile layout with one-hand fixed **bottom nav**: Home / Habits / Stats / Profile
- [ ] Make typography mobile-first (16px+), increase spacing/padding, ensure touch targets >=44px
- [ ] Add glassmorphism + neon glow borders + soft shadows + smooth transitions
- [ ] Add hero/landing WOW section (mobile-first) with animated glow CTA + smooth scroll
- [ ] Upgrade empty state (illustration, motivational line, animated CTA)
- [ ] Add skeleton loading + fade transitions

## Bugfix
- [x] pickMotivation() runtime error resolved so habit adding works

## Validation
- [ ] Manual test: habit add shows instantly and persists
- [ ] Manual test: streak/XP/analytics update on toggle
- [ ] Manual test: mobile bottom nav doesn't overlap and stays thumb-friendly

## Monthly tracking (new)
- [x] Add Monthly nav button (desktop sidebar + mobile nav)
- [x] Add `view-monthly` section with month pill + monthly table + Reset month button
- [x] Wire `script.js` monthly bindings + render on open
- [x] Add confirmation popup on Reset month, only then clear monthly data
- [ ] Manual test: Reset month clears only current month cells, updates UI immediately



