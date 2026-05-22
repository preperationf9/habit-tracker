# TODO - HabitTracker feature upgrades

## XP & Levels
- [ ] Add XP/Level UI elements to `index.html` (cards + progress bar + level badge + XP gain container)
- [ ] Extend persisted `state` in `script.js` for XP and awarded-per-day tracking
- [ ] Implement +10 XP awarding only on done transition (avoid duplicate awards)
- [ ] Add animated “+10 XP” gain effect and instant dashboard update
- [ ] Implement level thresholds + glowing level badge + progress to next level

## Streak System
- [ ] Add streak card (current + best) to `index.html`
- [ ] Implement streak rules: increment if >=1 habit done for the day; reset if 0 done
- [ ] Track and persist streak history/best in `script.js`
- [ ] Add streak glow animation and ensure mobile responsive

## Habit Status Colors
- [ ] Add yellow pending status logic and visual style
- [ ] Enhance checkbox interactions (glow/transition/active animations)
- [ ] Ensure weekly/monthly symbols follow green/red and pending where applicable

## Dashboard Analytics
- [ ] Add analytics card containers to `index.html`
- [ ] Compute weekly + monthly progress metrics in `script.js`
- [ ] Implement modern dark charts (canvas-based) for monthly graph
- [ ] Compute and display: best habit, missed habits, total completed, completion %
- [ ] Ensure analytics auto-update after each completion toggle

## General UI Improvements
- [ ] Add neon glassmorphism styling in `style.css` for new components
- [ ] Verify responsiveness on <=768px

## Validation
- [ ] Manual test: XP increments once per (habit, day) when marked done
- [ ] Manual test: streak resets when user misses all habits for a day
- [ ] Manual test: clearing all data resets XP + streak
- [ ] Manual test: charts render without errors on refresh

