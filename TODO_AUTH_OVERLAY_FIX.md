# Auth overlay fix - checklist

- [ ] Remove duplicate open/close overlay code paths (openAuthOverlay/closeAuthOverlay) and unify through single helpers.
- [ ] Ensure #authOverlay never has both `hidden` and `is-open` at the same time.
- [ ] Guarantee aria-hidden stays consistent with the visible state.
- [ ] Update global showHabitLogin helper (window.showHabitLogin) to use the same unified helpers.
- [ ] Quick sanity check: search for any remaining `openAuthOverlay`/`closeAuthOverlay` duplicates and any other toggles affecting #authOverlay.

