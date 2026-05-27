# TODO — Ultra Premium Habit Tracker Upgrade (Cleanup Run)

## Step 1: Premium removal scope confirmed
- [x] User chose option 2: remove all premium feature code (keep UI)

## Step 2: Identify premium code paths
- [x] Located premium streak freeze/missed-day recovery + XP ledger scaffolding in script.js
- [x] Found XP_PER_DONE undefined reference risk

## Step 3: Implement simplified engine (no premium)
- [ ] Replace dynamic XP ledger with stable static XP logic
- [ ] Replace streak logic with basic consecutive streak (no freeze/missed recovery)
- [ ] Remove achievements/quests/dailyQuests scaffolding

## Step 4: UI safety
- [ ] Stop updating missed-warning UI (hide or ignore)
- [ ] Ensure all buttons (add/delete/reset) work without crashes

## Step 5: Quick smoke test checklist
- [ ] Add habit + mark done → XP increments
- [ ] Toggle not done → XP adjusts safely
- [ ] Streak increases across consecutive complete days
- [ ] Reset week/month + clear all do not crash

