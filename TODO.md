# TODO — Month tracking picker fix

## Step 1: Add Month Picker UI
- [ ] Update `index.html` monthly view header area to include:
  - Month dropdown (`#monthSelect`)
  - Prev/Next buttons (optional but planned)

## Step 2: Persist selected month
- [ ] Update `script.js` state/meta to store selected month (year + monthIndex)
- [ ] Generate month options for last 24 months by default

## Step 3: Render monthly based on selected month
- [ ] Update `renderMonthly()` to use selected month anchor instead of `new Date()`

## Step 4: Reset month uses selected month
- [ ] Update `clearMonth()` to clear history only for selected month

## Step 5: Wire events
- [ ] Bind `monthSelect` change and Prev/Next click to update selected month and rerender

## Step 6: Styling
- [ ] Add minimal CSS for month picker alignment/spacing if needed

## Step 7: Smoke test
- [ ] Switch to Monthly view and select April/May/June
- [ ] Verify correct day columns for selected month
- [ ] Mark a habit for a day in selected month, confirm it appears
- [ ] Click Reset month and confirm only that selected month clears

