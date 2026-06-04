# Analytics Fix Plan (Weekly/Monthly auto-update)

## Information Gathered
- `index.html` me Analytics ke IDs موجود hain: 
  - `analyticsTotalCompleted`, `analyticsMissedHabits`, `analyticsBestHabit`, `analyticsCompletionPct`
  - `completionPill`, `weeklyBars`
- `script.js` me currently `renderAnalytics()` function aur analytics DOM bindings missing hain (repo rollback ke baad).
- Weekly analytics ko `habit.history[dateKey]` se read karna chahiye.
- Monthly analytics ko `meta.monthlyByMonthKey` se read karna chahiye.

## Plan
### Step 1: `renderAnalytics(els)` implement
- `renderAnalytics(els)` add karein `script.js` me.
- Weekly window (last 7 days) generate using `weekKeys()`.
- For each habit:
  - For each day key in window:
    - `habit.history?.[dateKey] === 'done'` => completed count
    - `habit.history?.[dateKey] === 'not_done'` => missed count
- Compute:
  - `totalCompleted` = doneCells
  - `missedHabits` = not_done cells (consistent with UI label)
  - `completionPct` = doneCells/totalExplicitCells * 100 (explicit cells only)
  - `bestHabit` = highest per-habit completionPct across explicit cells
- Update UI:
  - `analyticsTotalCompleted`, `analyticsMissedHabits`, `analyticsBestHabit`, `analyticsCompletionPct`
  - `completionPill`
  - `weeklyBars` (per-day % done across habits with explicit statuses)

### Step 2: `init()` me analytics DOM node bindings
- `init()` ke `els` object me add karein:
  - `analyticsTotalCompletedEl` etc.
  - `completionPillEl`, `weeklyBarsEl`

### Step 3: `renderDashboard(els)` me auto-update
- `renderDashboard(els)` ke end par `renderAnalytics(els)` call.

### Step 4: Rerender trigger on status change
- `setStatus` action handler ke andar:
  - dashboard/weekly view me rerender already hota hai.
  - Ensure dashboard rerender also triggers analytics (via Step 3).

## Dependent Files to Edit
- `script.js`

## Followup Steps
- App open karke:
  - 2+ weeks history hone par Analytics values populated honi chahiye.
  - Quick check: localStorage me habit.history keys match karte hain.


