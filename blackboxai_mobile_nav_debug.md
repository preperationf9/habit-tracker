# Mobile nav debug checklist (for HabitTracker)

## What to do on phone
1. Open app (mobile).
2. Open DevTools console (or remote inspect) and verify these logs:
   - `mobileNav debug: menuBtn exists?`
   - `mobileNav debug: pointerup fired`
   - `mobileNav debug: mobileNav toggled to ...`
3. If logs not appearing, it means `script.js` is not loading on mobile.

## Quick visual tests
- Menu opens: `mobileNav` panel should expand (CSS `#mobileNav.is-open`).
- Then tap Dashboard/Weekly/Monthly/Settings: panel must close and view should switch.

## If menu opens but view doesn’t change
- Ensure `data-view` values exist on mobile nav buttons.
- Ensure `switchView()` is being called.

## If nothing opens
- Verify `index.html` includes:
  - `<script type="module" src="script.js"></script>`
  - button id is exactly `menuBtn`
  - nav id is exactly `mobileNav`


