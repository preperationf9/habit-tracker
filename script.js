 (() => {
  'use strict';

  const STORAGE_KEY = 'habitTracker.v1';
  const STORAGE_MIGRATION_VERSION = 3;


  const XP = { completeHabit: 10 };

  /**
   * @typedef {'done'|'not_done'} HabitStatus
   * @typedef {{ [dateKey: string]: HabitStatus }} HabitHistory
   * @typedef {'daily'|'specific'} ReminderType
   * @typedef {{id:string,name:string,targetDays:number,createdAt:number,history: HabitHistory, reminderTime?: string, reminderType?: ReminderType, reminderDays?: string[]}} Habit
   */


  /**
   * @typedef {{
   *   habits: Habit[],
   *   xp: { total:number, ledger?: any },
   *   streak: { current:number, best:number, lastResolvedKey?: string|null, freezeCount?: number, missedDays?: string[] },
   *   achievements: { unlocked?: Record<string, boolean> },
   *   meta: any,
   *   _dirtyViews?: Record<string, boolean>
   * }} AppState
   */

  let state = /** @type {AppState} */ ({ habits: [] });
  let renderScheduled = false;

  const $ = (id) => document.getElementById(id);

  function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function todayKey(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function weekKeys(end = new Date()) {
    const keys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      keys.push(todayKey(d));
    }
    return keys;
  }

  function monthKeys(anchor = new Date()) {
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const keys = [];
    for (let d = 1; d <= daysInMonth; d++) {
      keys.push(todayKey(new Date(y, m, d)));
    }
    return keys;
  }

  function formatToday() {
    const d = new Date();
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function pickMotivation() {
    const quotes = [
      'Small steps every day.',
      'Consistency beats intensity.',
      'Do it now. Make it a habit.',
      'Your future self will thank you.',
      'Focus on progress, not perfection.',
    ];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  function deepMerge(base, incoming) {
    if (incoming === undefined) return base;
    if (incoming === null) return incoming;

    if (Array.isArray(base) || Array.isArray(incoming)) {
      return Array.isArray(incoming) ? incoming : base;
    }

    if (typeof base !== 'object' || typeof incoming !== 'object') {
      return incoming;
    }

    const out = { ...base };
    for (const [k, v] of Object.entries(incoming)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v === undefined ? base[k] : v;
      }
    }
    return out;
  }

  function cloneData(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeTrashEntries(value) {
    if (!Array.isArray(value)) return [];

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;

        const habit = entry.habit && typeof entry.habit === 'object' ? entry.habit : entry;
        if (!habit || typeof habit !== 'object' || !habit.id) return null;

        return {
          habit: {
            ...habit,
            name: typeof habit.name === 'string' ? habit.name : '',
            targetDays: safeNumber(habit.targetDays, 7),
            createdAt: safeNumber(habit.createdAt, Date.now()),
            history: habit.history && typeof habit.history === 'object' ? habit.history : {},
          },
          deletedAt: safeNumber(entry.deletedAt, Date.now()),
        };
      })
      .filter(Boolean);
  }

  function getXpLedgerKey(habitId, dateKey) {
    return `${dateKey}:${habitId}`;
  }

  function syncXpForStatusChange(habitId, dateKey, previousStatus, nextStatus) {
    ensureStateShape();
    const key = getXpLedgerKey(habitId, dateKey);
    const existing = state.xp.ledger[key];

    if (nextStatus === 'done') {
      if (!existing) {
        state.xp.ledger[key] = { amount: XP.completeHabit, reason: 'completeHabit', at: Date.now() };
        state.xp.total = safeNumber(state.xp.total, 0) + XP.completeHabit;
      }
      return;
    }

    if (previousStatus === 'done' && existing) {
      state.xp.total = Math.max(0, safeNumber(state.xp.total, 0) - safeNumber(existing.amount, XP.completeHabit));
      delete state.xp.ledger[key];
    }
  }

  function removeXpForStatus(habitId, dateKey) {
    ensureStateShape();
    const key = getXpLedgerKey(habitId, dateKey);
    const existing = state.xp.ledger[key];
    if (!existing) return;
    state.xp.total = Math.max(0, safeNumber(state.xp.total, 0) - safeNumber(existing.amount, XP.completeHabit));
    delete state.xp.ledger[key];
  }

  function seedXpLedgerFromHistory() {
    ensureStateShape();
    const existingLedger = Object.values(state.xp.ledger || {});
    if (existingLedger.length) {
      state.xp.total = existingLedger.reduce((sum, entry) => sum + safeNumber(entry?.amount, XP.completeHabit), 0);
      return;
    }

    let total = 0;
    for (const habit of state.habits) {
      for (const [dateKey, status] of Object.entries(habit.history || {})) {
        if (status !== 'done') continue;
        state.xp.ledger[getXpLedgerKey(habit.id, dateKey)] = { amount: XP.completeHabit, reason: 'completeHabit', at: habit.createdAt || Date.now() };
        total += XP.completeHabit;
      }
    }
    state.xp.total = total;
  }

  function getDefaultState() {
    return {
      habits: [],
      xp: { total: 0, ledger: {} },
      streak: { current: 0, best: 0, lastResolvedKey: null, freezeCount: 1, missedDays: [] },
      achievements: { unlocked: {} },
      meta: {
        settings: { reducedMotion: false, sound: true },
        dailyQuests: { dateKey: null, completed: {} },
        monthlySelected: null,
        habitTrash: [], // [{habit: HabitSnapshot, deletedAt:number}]
      },
      _dirtyViews: { weekly: true, monthly: true },
    };
  }

  function migrateAndMergeState(parsed) {
    const base = getDefaultState();
    if (!parsed || typeof parsed !== 'object') return base;

    const habits = Array.isArray(parsed.habits) ? parsed.habits : base.habits;

    const merged = deepMerge(base, parsed);
    merged.habits = habits;

    merged.habits = (merged.habits || []).map((h) => {
      const out = { ...(h && typeof h === 'object' ? h : {}) };
      out.id = out.id ?? String(Date.now()) + Math.random().toString(16).slice(2);
      out.name = typeof out.name === 'string' ? out.name : '';
      out.targetDays = safeNumber(out.targetDays, 7);
      out.createdAt = safeNumber(out.createdAt, Date.now());
      out.history = out.history && typeof out.history === 'object' ? out.history : {};

      // Optional reminder fields (additive, non-destructive defaults for old habits)
      out.reminderTime = typeof out.reminderTime === 'string' ? out.reminderTime : '';
      out.reminderType = out.reminderType === 'specific' ? 'specific' : 'daily';
      out.reminderDays = Array.isArray(out.reminderDays) ? out.reminderDays : [];
      if (!Array.isArray(out.reminderDays)) out.reminderDays = [];
      // Keep only known weekday labels for safety
      const allowed = new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
      out.reminderDays = out.reminderDays.filter((d) => typeof d === 'string' && allowed.has(d));

      return out;

    });

    merged.meta = merged.meta && typeof merged.meta === 'object' ? merged.meta : base.meta;
    merged.meta.settings = merged.meta.settings && typeof merged.meta.settings === 'object' ? merged.meta.settings : base.meta.settings;
    merged.meta.dailyQuests = merged.meta.dailyQuests && typeof merged.meta.dailyQuests === 'object' ? merged.meta.dailyQuests : base.meta.dailyQuests;
    merged.meta.monthlySelected = merged.meta.monthlySelected ?? null;
    const savedTrash = Array.isArray(merged.meta.habitTrash)
      ? merged.meta.habitTrash
      : Array.isArray(parsed.trash)
        ? parsed.trash
        : Array.isArray(parsed.meta?.trash)
          ? parsed.meta.trash
          : base.meta.habitTrash;
    merged.meta.habitTrash = normalizeTrashEntries(savedTrash);

    merged.meta.monthlyByMonthKey = merged.meta.monthlyByMonthKey && typeof merged.meta.monthlyByMonthKey === 'object' ? merged.meta.monthlyByMonthKey : {};

    merged.xp = merged.xp && typeof merged.xp === 'object' ? merged.xp : base.xp;
    merged.xp.total = safeNumber(merged.xp.total, 0);
    merged.xp.ledger = merged.xp.ledger && typeof merged.xp.ledger === 'object' ? merged.xp.ledger : {};

    merged.streak = merged.streak && typeof merged.streak === 'object' ? merged.streak : base.streak;
    merged.streak.current = safeNumber(merged.streak.current, 0);
    merged.streak.best = safeNumber(merged.streak.best, 0);
    merged.streak.lastResolvedKey = merged.streak.lastResolvedKey ?? null;
    merged.streak.freezeCount = safeNumber(merged.streak.freezeCount, 1);
    merged.streak.missedDays = Array.isArray(merged.streak.missedDays) ? merged.streak.missedDays : [];

    merged.achievements = merged.achievements && typeof merged.achievements === 'object' ? merged.achievements : base.achievements;
    merged.achievements.unlocked = merged.achievements.unlocked && typeof merged.achievements.unlocked === 'object' ? merged.achievements.unlocked : {};

    merged._dirtyViews = base._dirtyViews;

    merged.meta._storageMigration = { v: STORAGE_MIGRATION_VERSION, migratedAt: Date.now() };

    return merged;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = getDefaultState();
        return;
      }

      const parsed = JSON.parse(raw);

      if (parsed && typeof parsed === 'object') {
        state = migrateAndMergeState(parsed);
      } else {
        state = getDefaultState();
      }
      seedXpLedgerFromHistory();

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // ignore
      }
    } catch {
      state = getDefaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  function ensureStateShape() {
    state = state || { habits: [] };
    state.xp = state.xp || { total: 0, ledger: {} };
    state.xp.total = safeNumber(state.xp.total, 0);
    state.xp.ledger = state.xp.ledger && typeof state.xp.ledger === 'object' ? state.xp.ledger : {};

    state.streak = state.streak || { current: 0, best: 0, lastResolvedKey: null };
    state.streak.current = safeNumber(state.streak.current, 0);
    state.streak.best = safeNumber(state.streak.best, 0);
    state.streak.lastResolvedKey = state.streak.lastResolvedKey ?? null;
    state.streak.freezeCount = safeNumber(state.streak.freezeCount, 1);
    state.streak.missedDays = Array.isArray(state.streak.missedDays) ? state.streak.missedDays : [];

    state.achievements = state.achievements || { unlocked: {} };
    state.achievements.unlocked = state.achievements.unlocked && typeof state.achievements.unlocked === 'object' ? state.achievements.unlocked : {};

    state.meta = state.meta || {};
    state.meta.settings = state.meta.settings && typeof state.meta.settings === 'object' ? state.meta.settings : { reducedMotion: false, sound: true };
    state.meta.dailyQuests = state.meta.dailyQuests && typeof state.meta.dailyQuests === 'object' ? state.meta.dailyQuests : { dateKey: null, completed: {} };
    state.meta.monthlySelected = state.meta.monthlySelected ?? null;
    state.meta.habitTrash = normalizeTrashEntries(state.meta.habitTrash);
    state.meta.monthlyByMonthKey = state.meta.monthlyByMonthKey && typeof state.meta.monthlyByMonthKey === 'object' ? state.meta.monthlyByMonthKey : {};

    state._dirtyViews = state._dirtyViews || { weekly: true, monthly: true };
  }

  function isHabitDayComplete(dateKey) {
    // Streak is earned when the required condition is met for that day.
    // Current app setup implies:
    // - If there are multiple habits, user expects streak only when EVERY habit is marked done
    //   (see requirement text: "(or all required habits, depending on the current setup)").
    // - However, we should NOT require explicit 'not_done' entries; only treat missing/undefined
    //   history as not completed.
    if (!state.habits.length) return false;

    // Every habit must be marked 'done' for that date.
    for (const habit of state.habits) {
      const h = habit?.history;
      if (!h || h[dateKey] !== 'done') return false;
    }
    return true;
  }



  function computeStreakUpTo(dateKeyInclusive) {
    let streak = 0;
    for (let i = 0; i < 730; i++) {
      const d = new Date(dateKeyInclusive + 'T00:00:00');
      d.setDate(d.getDate() - i);
      const k = todayKey(d);
      if (isHabitDayComplete(k)) streak++;
      else break;
    }
    return streak;
  }

  function computeBestStreak() {
    if (!state.habits.length) return 0;
    let best = 0;
    let cur = 0;
    for (let back = 729; back >= 0; back--) {
      const d = new Date();
      d.setDate(d.getDate() - back);
      const k = todayKey(d);
      if (isHabitDayComplete(k)) {
        cur++;
        best = Math.max(best, cur);
      } else {
        cur = 0;
      }
    }
    return best;
  }

  function resolveDailyStreakAndMissedDays(els) {
    ensureStateShape();
    const today = todayKey(new Date());
    const current = isHabitDayComplete(today) ? computeStreakUpTo(today) : 0;
    const best = computeBestStreak();
    state.streak.current = current;
    state.streak.best = Math.max(state.streak.best || 0, best);

    if (els && els.missedWarningEl) {
      els.missedWarningEl.classList.remove('is-show');
    }
  }

  function getLevelFromXp(totalXp) {
    const x = Math.max(0, Number(totalXp) || 0);
    if (x >= 200) return { name: 'Master', minXp: 200, nextXp: 200, progressStart: 200 };
    if (x >= 100) return { name: 'Advanced', minXp: 100, nextXp: 200, progressStart: 100 };
    if (x >= 50) return { name: 'Intermediate', minXp: 50, nextXp: 100, progressStart: 50 };
    return { name: 'Beginner', minXp: 0, nextXp: 50, progressStart: 0 };
  }

  function computeXpTotalForToday() {
    ensureStateShape();
    return state.xp.total || 0;
  }

  function renderXpUi(els) {
    if (!els.xpTotalEl || !els.xpFillEl || !els.xpPctEl || !els.xpNextLabelEl || !els.levelBadgeEl) return;

    ensureStateShape();
    const total = computeXpTotalForToday();
    state.xp.total = total;

    els.xpTotalEl.textContent = String(total);

    const lvl = getLevelFromXp(total);
    const startXp = lvl.progressStart ?? lvl.minXp ?? 0;
    const denom = Math.max(1, lvl.nextXp - startXp);
    const progress = Math.max(0, Math.min(1, (total - startXp) / denom));
    const pct = Math.round(progress * 100);

    els.levelBadgeEl.textContent = lvl.name;
    els.xpFillEl.style.width = `${pct}%`;
    els.xpPctEl.textContent = `${pct}%`;
    els.xpProgressBar && els.xpProgressBar.setAttribute('aria-valuenow', String(pct));

    const inBandCurrent = Math.max(0, total - startXp);
    const inBandTotal = Math.max(1, lvl.nextXp - startXp);
    els.xpNextLabelEl.textContent = `${inBandCurrent} / ${inBandTotal} XP`;
  }

  function showView(view, els) {
    els.currentView = view;
    const map = { dashboard: els.viewDashboard, weekly: els.viewWeekly, monthly: els.viewMonthly, settings: els.viewSettings, trash: els.viewTrash };
    for (const [k, el] of Object.entries(map)) {
      if (!el) continue;
      el.classList.toggle('is-hidden', k !== view);
    }

    if (els.navItems) {
      els.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    }

    if (els.mobileNav && els.mobileNav.classList.contains('is-open')) {
      els.mobileNav.classList.remove('is-open');
      els.menuBtn && els.menuBtn.setAttribute('aria-expanded', 'false');
    }

    if (view === 'weekly') state._dirtyViews.weekly = true;
    if (view === 'monthly') state._dirtyViews.monthly = true;
    if (view === 'trash') state._dirtyViews.trash = true;

    scheduleRender(els, view);
  }

  function scheduleRender(els, view) {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      try {
        if (view === 'dashboard') renderDashboard(els);
        else if (view === 'weekly') renderWeekly(els);
        else if (view === 'monthly') renderMonthly(els);
        else if (view === 'settings') renderSettings(els);
        else if (view === 'trash') renderTrash(els);
        else renderDashboard(els);
      } catch (e) {
        showFatalError(els, e);
      }
    });
  }

  function showFatalError(els, err) {
    if (!els.fatalErrorEl) return;
    const msg = err && err.message ? err.message : 'Unexpected error';
    els.fatalErrorEl.textContent = `Could not load Habit Tracker: ${msg}`;
    els.fatalErrorEl.style.display = 'block';
  }

  function renderDashboard(els) {
    if (!els.viewDashboard) return;
    if (typeof renderAnalytics === 'function') renderAnalytics(els);

    els.todayLabel && (els.todayLabel.textContent = formatToday());
    els.motivationQuote && (els.motivationQuote.textContent = pickMotivation());

    resolveDailyStreakAndMissedDays(els);

    const tKey = todayKey();
    const habits = state.habits;
    if (els.habitList) els.habitList.innerHTML = '';

    let doneCount = 0;
    let totalCount = 0;

    if (els.habitList) {
      const frag = document.createDocumentFragment();
      for (const habit of habits) {
        totalCount++;
        const status = habit.history?.[tKey];
        if (status === 'done') doneCount++;

        const item = document.createElement('div');
        item.className = 'habit-item';
        item.dataset.habitId = habit.id;

        const left = document.createElement('div');
        left.className = 'habit-left';

        const name = document.createElement('div');
        name.className = 'habit-name';
        name.textContent = habit.name;

        const meta = document.createElement('div');
        meta.className = 'habit-meta';
        meta.textContent = `${habit.targetDays} days/week`;

        left.appendChild(name);
        left.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'habit-actions';

        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'check-btn';
        doneBtn.textContent = '✓';
        doneBtn.title = 'Done';
        doneBtn.setAttribute('aria-label', `Mark ${habit.name} done`);
        if (status === 'done') doneBtn.classList.add('is-done');
        doneBtn.dataset.action = 'setStatus';
        doneBtn.dataset.status = 'done';

        const ndBtn = document.createElement('button');
        ndBtn.type = 'button';
        ndBtn.className = 'check-btn';
        ndBtn.textContent = '✕';
        ndBtn.title = 'Not done';
        ndBtn.setAttribute('aria-label', `Mark ${habit.name} not done`);
        if (status === 'not_done') ndBtn.classList.add('is-nd');
        ndBtn.dataset.action = 'setStatus';
        ndBtn.dataset.status = 'not_done';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'delete-btn';
        delBtn.textContent = '🗑️';
        delBtn.title = 'Delete habit';
        delBtn.setAttribute('aria-label', `Move ${habit.name} to Recycle Bin`);
        delBtn.dataset.action = 'deleteHabit';

        actions.appendChild(doneBtn);
        actions.appendChild(ndBtn);
        actions.appendChild(delBtn);

        item.appendChild(left);
        item.appendChild(actions);
        frag.appendChild(item);
      }
      els.habitList.appendChild(frag);
    }

    if (els.emptyState) els.emptyState.classList.toggle('is-hidden', habits.length !== 0);

    const pct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
    els.progressMeta && (els.progressMeta.textContent = `${pct}% completed`);
    els.progressFill && (els.progressFill.style.width = `${pct}%`);
    els.progressPct && (els.progressPct.textContent = `${pct}%`);
    els.progressCounts && (els.progressCounts.textContent = `${doneCount} / ${totalCount}`);
    els.progressBar && els.progressBar.setAttribute('aria-valuenow', String(pct));

    if (els.streakCount) els.streakCount.textContent = String(state.streak?.current ?? 0);

    renderXpUi(els);

    const streakCurrentEl = document.getElementById('streakCurrent');
    const streakBestEl = document.getElementById('streakBest');
    if (streakCurrentEl) {
      const v = state.streak?.current ?? 0;
      streakCurrentEl.textContent = `${v} Day${v === 1 ? '' : 's'}`;
    }
    if (streakBestEl) {
      const v = state.streak?.best ?? 0;
      streakBestEl.textContent = `${v} Day${v === 1 ? '' : 's'}`;
    }
  }

  function renderAnalytics(els) {
    if (!els.analyticsTotalCompletedEl || !els.analyticsMissedHabitsEl || !els.analyticsBestHabitEl || !els.analyticsCompletionPctEl || !els.completionPillEl || !els.weeklyBarsEl) return;

    const keys = weekKeys();
    const habits = state.habits || [];
    let totalDone = 0;
    let totalMissed = 0;
    let bestHabit = null;

    const dayDoneCounts = keys.map(() => 0);
    const dayExplicitCounts = keys.map(() => 0);

    for (const habit of habits) {
      let habitDone = 0;
      let habitExplicit = 0;

      keys.forEach((dateKey, index) => {
        const status = habit.history?.[dateKey];
        if (status === 'done') {
          totalDone++;
          habitDone++;
          habitExplicit++;
          dayDoneCounts[index]++;
          dayExplicitCounts[index]++;
        } else if (status === 'not_done') {
          totalMissed++;
          habitExplicit++;
          dayExplicitCounts[index]++;
        }
      });

      if (habitExplicit > 0) {
        const pct = habitDone / habitExplicit;
        if (!bestHabit || pct > bestHabit.pct || (pct === bestHabit.pct && habitDone > bestHabit.done)) {
          bestHabit = { name: habit.name, pct, done: habitDone };
        }
      }
    }

    const explicitTotal = totalDone + totalMissed;
    const completionPct = explicitTotal ? Math.round((totalDone / explicitTotal) * 100) : 0;

    els.analyticsTotalCompletedEl.textContent = String(totalDone);
    els.analyticsMissedHabitsEl.textContent = String(totalMissed);
    els.analyticsBestHabitEl.textContent = bestHabit ? bestHabit.name : '—';
    els.analyticsCompletionPctEl.textContent = `${completionPct}%`;
    els.completionPillEl.textContent = `${completionPct}% completion`;

    els.weeklyBarsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    keys.forEach((dateKey, index) => {
      const pct = dayExplicitCounts[index] ? Math.round((dayDoneCounts[index] / dayExplicitCounts[index]) * 100) : 0;
      const d = new Date(dateKey + 'T00:00:00');
      const label = d.toLocaleDateString(undefined, { weekday: 'short' });
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${Math.max(8, pct)}%`;
      bar.title = `${label}: ${pct}%`;
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${label} completion ${pct}%`);
      frag.appendChild(bar);
    });
    els.weeklyBarsEl.appendChild(frag);
  }

  function renderWeekly(els) {
    if (!els.weekRangePill || !els.weeklyTable) return;

    const keys = weekKeys();
    els.weekRangePill.textContent = `${keys[0].slice(5).replace('-', '/')} - ${keys[keys.length - 1].slice(5).replace('-', '/')}`;

    const habits = state.habits;
    if (!habits.length) {
      els.weeklyTable.innerHTML = '<div class="empty"><div class="empty-ic">☆</div><div class="empty-title">No data yet</div><div class="empty-sub">Add a habit to see weekly tracking.</div></div>';
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'weekly-table';

    const t = document.createElement('table');
    t.style.width = '100%';
    t.style.borderCollapse = 'collapse';
    t.style.tableLayout = 'fixed';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');

    const th0 = document.createElement('th');
    th0.textContent = 'Habit';
    th0.style.textAlign = 'left';
    th0.style.padding = '10px';
    th0.style.color = 'rgba(232,238,252,.8)';
    th0.style.width = '160px';
    trh.appendChild(th0);

    for (const k of keys) {
      const d = new Date(k + 'T00:00:00');
      const th = document.createElement('th');
      th.textContent = d.toLocaleDateString(undefined, { weekday: 'short' });
      th.style.padding = '10px 6px';
      th.style.color = 'rgba(232,238,252,.75)';
      th.style.fontSize = '12px';
      th.style.whiteSpace = 'nowrap';
      trh.appendChild(th);
    }

    thead.appendChild(trh);
    t.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const habit of habits) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = habit.name;
      tdName.style.padding = '10px';
      tdName.style.borderTop = '1px solid rgba(255,255,255,.08)';
      tdName.style.fontWeight = '800';
      tdName.style.overflow = 'hidden';
      tdName.style.textOverflow = 'ellipsis';
      tdName.style.whiteSpace = 'nowrap';
      tr.appendChild(tdName);

      for (const k of keys) {
        const td = document.createElement('td');
        td.style.padding = '10px';
        td.style.borderTop = '1px solid rgba(255,255,255,.08)';
        td.style.textAlign = 'center';

        const status = habit.history?.[k];
        let symbol = '—';
        let color = 'rgba(232,238,252,.55)';
        if (status === 'done') {
          symbol = '✓';
          color = 'rgba(34,197,94,.95)';
        }
        if (status === 'not_done') {
          symbol = '✕';
          color = 'rgba(239,68,68,.95)';
        }

        td.textContent = symbol;
        td.style.color = color;
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    t.appendChild(tbody);
    wrapper.appendChild(t);

    els.weeklyTable.innerHTML = '';
    els.weeklyTable.appendChild(wrapper);
  }

  function getSelectedMonthAnchor() {
    const ms = state?.meta?.monthlySelected;
    if (ms && typeof ms === 'object' && Number.isFinite(ms.y) && Number.isFinite(ms.m)) {
      return new Date(ms.y, ms.m, 1);
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }

  function setSelectedMonth(y, mi) {
    ensureStateShape();
    state.meta.monthlySelected = { y: Number(y), m: Number(mi) };
    save();
  }

  function setSelectedMonthByAnchor(dateObj) {
    setSelectedMonth(dateObj.getFullYear(), dateObj.getMonth());
  }

  function monthKeyForStorage(anchor) {
    return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
  }

  function loadMonthMap(monthKey) {
    ensureStateShape();
    state.meta.monthlyByMonthKey = state.meta.monthlyByMonthKey || {};
    state.meta.monthlyByMonthKey[monthKey] = state.meta.monthlyByMonthKey[monthKey] || {};
    return state.meta.monthlyByMonthKey[monthKey];
  }

  function getStatusForMonth(habitId, dateKey) {
    const habit = state.habits.find((h) => h.id === habitId);
    return habit?.history?.[dateKey];
  }

  function setStatusForMonth(habitId, dateKey, status) {
    const habit = state.habits.find((h) => h.id === habitId);
    if (!habit) return;
    habit.history = habit.history || {};
    const previous = habit.history[dateKey];
    habit.history[dateKey] = status;
    syncXpForStatusChange(habitId, dateKey, previous, status);
    save();
  }

  function clearMonth(els) {
    const anchor = getSelectedMonthAnchor();
    const mKey = monthKeyForStorage(anchor);
    const keys = monthKeys(anchor);
    const monthMap = loadMonthMap(mKey);

    for (const habit of state.habits) {
      if (habit.history) {
        for (const k of keys) {
          if (habit.history[k] === 'done') removeXpForStatus(habit.id, k);
          delete habit.history[k];
        }
      }

      if (monthMap[habit.id]) {
        for (const k of keys) delete monthMap[habit.id][k];
      }
    }

    save();
    state._dirtyViews.monthly = true;
    renderMonthly(els);
  }

  function renderMonthly(els) {
    if (!els.monthlyTable || !els.monthRangePill) return;

    const anchor = getSelectedMonthAnchor();
    const keys = monthKeys(anchor);
    els.monthRangePill.textContent = anchor.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });

    const habits = state.habits || [];
    if (!habits.length) {
      els.monthlyTable.innerHTML = '<div class="empty"><div class="empty-ic">★</div><div class="empty-title">No data yet</div><div class="empty-sub">Add a habit to see monthly tracking.</div></div>';
      return;
    }

    els.monthlyTable.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'monthly-table-wrapper';
    wrapper.style.overflowX = 'auto';
    wrapper.style.overflowY = 'visible';
    wrapper.style.webkitOverflowScrolling = 'touch';
    wrapper.style.width = '100%';
    wrapper.style.maxWidth = '100%';

    const t = document.createElement('table');
    t.className = 'monthly-grid';
    t.style.width = '100%';
    t.style.borderCollapse = 'collapse';
    t.style.tableLayout = 'fixed';
    t.style.minWidth = '600px';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');

    const th0 = document.createElement('th');
    th0.textContent = 'Habit';
    th0.style.textAlign = 'left';
    th0.style.padding = '10px';
    th0.style.color = 'rgba(232,238,252,.8)';
    trh.appendChild(th0);

    for (const k of keys) {
      const [, , dd] = k.split('-');
      const label = String(dd).padStart(2, '0');
      const th = document.createElement('th');
      th.textContent = label;
      th.style.padding = '10px';
      th.style.color = 'rgba(255,255,255,.92)';
      th.style.textAlign = 'center';
      trh.appendChild(th);
    }

    thead.appendChild(trh);
    t.appendChild(thead);

    const tbody = document.createElement('tbody');

    for (const habit of habits) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = habit.name;
      tdName.style.padding = '10px';
      tdName.style.borderTop = '1px solid rgba(255,255,255,.08)';
      tdName.style.fontWeight = '800';
      tr.appendChild(tdName);

      for (const k of keys) {
        const td = document.createElement('td');
        td.style.padding = '10px';
        td.style.borderTop = '1px solid rgba(255,255,255,.08)';
        td.style.textAlign = 'center';
        td.style.whiteSpace = 'nowrap';
        td.style.fontWeight = '800';

        const status = getStatusForMonth(habit.id, k);
        let symbol = '—';
        let color = 'rgba(232,238,252,.55)';
        if (status === 'done') {
          symbol = '✓';
          color = 'rgba(34,197,94,.95)';
        } else if (status === 'not_done') {
          symbol = '✕';
          color = 'rgba(239,68,68,.95)';
        }

        td.textContent = symbol;
        td.style.color = color;
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    t.appendChild(tbody);
    wrapper.appendChild(t);
    els.monthlyTable.appendChild(wrapper);
  }

  function renderSettings() {}

  // ==============================
  // Alarm Reminder (additive)
  // ==============================

  const ALARM_DEFAULT_SOUND = 1;
  const ALARM_SNOOZE_MINUTES = 5;
  // Check frequently enough to catch the minute boundary even with interval drift.
  const ALARM_CHECK_MS = 1000;


  function allowedReminderDayLabels() {
    return new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  }

  function getHabitReminderDays(habit) {
    const allowed = allowedReminderDayLabels();
    if (!habit || habit.reminderType !== 'specific') return [];
    if (!Array.isArray(habit.reminderDays)) return [];
    return habit.reminderDays.filter((d) => typeof d === 'string' && allowed.has(d));
  }

  function dayLabelForDate(dateObj) {
    const labels = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return labels[dateObj.getDay()];
  }

  function parseReminderTimeToTodayDate(reminderTime, ampm) {
    // reminderTime is typically stored as "HH:MM" in 24h format.
    if (typeof reminderTime !== 'string' || !reminderTime.includes(':')) return null;

    const [hRaw, mRaw] = reminderTime.split(':');
    const h = safeNumber(hRaw, NaN);
    const m = safeNumber(mRaw, NaN);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

    // If ampm is not provided, treat the value as 24h.
    let hour = Math.max(0, Math.min(23, h));

    if (ampm === 'AM' || ampm === 'PM') {
      // Convert 12h -> 24h. Input hour comes from UI 1..12.
      const isPM = ampm === 'PM';
      hour = Math.max(1, Math.min(12, hour));
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
    }

    const now = new Date();
    now.setHours(hour, m, 0, 0);
    return now;
  }


  function getAlarmSoundForHabit(habit) {
    const v = Number(habit?.alarmSound ?? habit?.reminderSound ?? ALARM_DEFAULT_SOUND);
    const n = Number.isFinite(v) ? v : ALARM_DEFAULT_SOUND;
    return Math.max(1, Math.min(4, n));
  }

  function getSelectedAlarmSoundUrl(habit) {
    const n = getAlarmSoundForHabit(habit);
    return `sounds/alarm${n}.mp3`;
  }

  function formatAlarmMessage(habit) {
    const name = habit?.name || 'your habit';
    return `Time to complete your habit: ${name}`;
  }

  function ensureAlarmState() {
    ensureStateShape();
    state.meta.alarm = state.meta.alarm && typeof state.meta.alarm === 'object' ? state.meta.alarm : {};
    state.meta.alarm.silencedUntilByHabit = state.meta.alarm.silencedUntilByHabit && typeof state.meta.alarm.silencedUntilByHabit === 'object' ? state.meta.alarm.silencedUntilByHabit : {};
    state.meta.alarm.lastTriggeredAtByHabit = state.meta.alarm.lastTriggeredAtByHabit && typeof state.meta.alarm.lastTriggeredAtByHabit === 'object' ? state.meta.alarm.lastTriggeredAtByHabit : {};
  }

  function unlockAudioIfNeeded() {
    // Best-effort unlock for mobile/Android WebView.
    return new Promise((resolve) => {
      try {
        const a = new Audio();
        const t = setTimeout(() => resolve(false), 1200);
        const onAny = () => {
          clearTimeout(t);
          resolve(true);
        };
        a.muted = true;
        a.volume = 0;
        a.play().then(onAny).catch(() => {
          clearTimeout(t);
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  function playReminderSound(url, { loop = true } = {}) {
    try {
      // Respect settings toggle
      if (state?.meta?.settings && state.meta.settings.sound === false) return;

      // Stop old audio (same instance control path for STOP/SNOOZE)
      stopReminderSound();

      unlockAudioIfNeeded().catch(() => {});

      const a = new Audio(url);
      a.loop = loop;
      a.volume = 1;
      a.muted = false;

      // Always store before play to ensure STOP/SNOOZE always targets the correct instance
      state.meta.alarm = state.meta.alarm || {};
      state.meta.alarm._activeAudio = a;

      // Autoplay restrictions: attempt play from user gesture when possible.
      a.play().catch(() => {});
    } catch {
      // ignore
    }
  }




  function stopReminderSound() {
    try {
      const a = state?.meta?.alarm?._activeAudio;
      if (a && typeof a.pause === 'function') {
        a.pause();
        a.currentTime = 0;
      }
    } catch {
      // ignore
    }
    if (state?.meta?.alarm) state.meta.alarm._activeAudio = null;
  }

  function isHabitScheduledToday(habit, now) {
    if (!habit?.reminderTime) return false;
    // reminderType controls whether specific days are active.
    if (habit.reminderType !== 'specific') return true;
    const label = dayLabelForDate(now);
    const days = getHabitReminderDays(habit);
    return days.includes(label);
  }

  function computeHabitReminderDateTime(habit) {
    // Scheduler compatibility: support multiple legacy reminderTime shapes.
    // Primary expected format: "HH:MM" (24h) string.
    // Also try to parse numbers like 1230/1245 and strings like "12:45 AM".

    const raw = habit?.reminderTime;
    if (raw === undefined || raw === null) return null;

    // If reminderTime is numeric (e.g., 1245)
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const n = Math.floor(raw);
      const hh = Math.floor(n / 100);
      const mm = n % 100;
      const reminderDate = new Date();
      reminderDate.setHours(Math.max(0, Math.min(23, hh)), Math.max(0, Math.min(59, mm)), 0, 0);
      if (!isHabitScheduledToday(habit, reminderDate)) return null;
      reminderDate.setSeconds(0, 0);
      return reminderDate;
    }

    const reminderTime = String(raw).trim();
    if (!reminderTime) return null;

    // Try: "HH:MM AM" / "HH:MM PM"
    const ampmMatch = reminderTime.match(/^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*(AM|PM)\s*$/i);
    if (ampmMatch) {
      const hh = safeNumber(ampmMatch[1], NaN);
      const mm = safeNumber(ampmMatch[2], NaN);
      const ampm = ampmMatch[3].toUpperCase();
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const reminderDate = new Date();
        // reuse existing parser logic by providing AM/PM
        const parsed = parseReminderTimeToTodayDate(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`, ampm);
        if (!parsed) return null;
        if (!isHabitScheduledToday(habit, parsed)) return null;
        parsed.setSeconds(0, 0);
        return parsed;
      }
    }

    // Try: "HH:MM" (24h) with or without leading zeros
    const hhmmMatch = reminderTime.match(/^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/);
    if (hhmmMatch) {
      const reminderDate = parseReminderTimeToTodayDate(`${String(hhmmMatch[1]).padStart(2,'0')}:${String(hhmmMatch[2]).padStart(2,'0')}`, null);
      if (!reminderDate || !Number.isFinite(reminderDate.getTime())) return null;
      if (!isHabitScheduledToday(habit, reminderDate)) return null;
      reminderDate.setSeconds(0, 0);
      return reminderDate;
    }

    // Unknown legacy format
    return null;
  }






  function getSilencedUntilForHabit(habitId) {
    ensureAlarmState();
    return state.meta.alarm.silencedUntilByHabit[habitId] || 0;
  }

  function setSilencedUntilForHabit(habitId, ts) {
    ensureAlarmState();
    state.meta.alarm.silencedUntilByHabit[habitId] = ts;
    save();
  }

  function setLastTriggeredForHabit(habitId, ts) {
    ensureAlarmState();
    state.meta.alarm.lastTriggeredAtByHabit[habitId] = ts;
    save();
  }

  function shouldTriggerHabitNow(habit, now) {
    const reminderDate = computeHabitReminderDateTime(habit);
    if (!reminderDate) return false;

    const silencedUntil = getSilencedUntilForHabit(habit.id);
    if (now.getTime() < silencedUntil) return false;

    const createdAt = safeNumber(habit?.createdAt, 0);
    if (createdAt && now.getTime() - createdAt < 60 * 1000) return false;

    // Minute-locked trigger: exact HH:MM match beats drifting interval.
    const curY = now.getFullYear();
    const curM = now.getMonth();
    const curD = now.getDate();
    const remY = reminderDate.getFullYear();
    const remM = reminderDate.getMonth();
    const remD = reminderDate.getDate();

    if (curY !== remY || curM !== remM || curD !== remD) return false;
    if (now.getHours() !== reminderDate.getHours()) return false;
    if (now.getMinutes() !== reminderDate.getMinutes()) return false;

    // Slight tolerance for seconds (0..59) but window is minute-based already.
    const secDiff = Math.abs(now.getSeconds() - reminderDate.getSeconds());
    if (secDiff > 10) return false;

    return true;
  }







  function getAlarmSoundLabel(n) {
    return `Alarm ${n}`;
  }

  function showAlarmModal(els, habit) {
    if (!els.alarmModal) return;

    const habitName = habit?.name || '—';
    const soundN = getAlarmSoundForHabit(habit);

    // modal-sub should show only habit name (not a sentence)
    els.alarmHabitName && (els.alarmHabitName.textContent = habitName);

    // inline should show the habit name
    els.alarmHabitNameInline && (els.alarmHabitNameInline.textContent = habitName);

    // Optional: set modal title to include selected sound (no HTML change needed)
    if (els.alarmModal) {
      const titleEl = els.alarmModal.querySelector('.modal-title');
      if (titleEl) titleEl.textContent = `Reminder (${getAlarmSoundLabel(soundN)})`;
    }

    els.alarmModal.classList.add('is-open');
    els.alarmModal.setAttribute('aria-hidden', 'false');
  }


  function closeAlarmModal(els) {
    if (!els.alarmModal) return;
    els.alarmModal.classList.remove('is-open');
    els.alarmModal.setAttribute('aria-hidden', 'true');
  }

  function stopAlarmForCurrentOccurrence() {
    // Only best-effort: stop audio, keep modal state in sync, and silence indefinitely for this habit.
    try {
      stopReminderSound();
    } catch {
      // ignore
    }

    try {
      // clear active habit silencing only when we know which habit is active.
      if (state?.meta?.alarm?.activeHabitId) {
        const habitId = state.meta.alarm.activeHabitId;
        // set silencedUntil far future to prevent immediate retrigger until next reload.
        setSilencedUntilForHabit(habitId, Date.now() + 1000 * 60 * 60 * 24);
        state.meta.alarm.activeHabitId = null;
      }
    } catch {
      // ignore
    }

    try {
      // Update modal state if it exists
      // (actual button wiring is handled in bindEvents)
    } catch {
      // ignore
    }
  }

  function snoozeAlarmForCurrentOccurrence(minutes = ALARM_SNOOZE_MINUTES) {
    try {
      stopReminderSound();
    } catch {
      // ignore
    }

    try {
      if (state?.meta?.alarm?.activeHabitId) {
        const habitId = state.meta.alarm.activeHabitId;
        setSilencedUntilForHabit(habitId, Date.now() + safeNumber(minutes, ALARM_SNOOZE_MINUTES) * 60 * 1000);
      }
    } catch {
      // ignore
    }
  }

  function requestNotificationPermissionOnce() {
    return new Promise((resolve) => {
      try {
        if (!('Notification' in window)) return resolve(false);
        const meta = state?.meta?.settings;
        if (meta?.notificationPermissionAsked) {
          resolve(true);
          return;
        }
        if (meta) meta.notificationPermissionAsked = true;
        save();
        if (Notification.permission === 'granted') return resolve(true);
        if (Notification.permission === 'denied') return resolve(false);
        Notification.requestPermission().then((p) => resolve(p === 'granted')).catch(() => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  function showNotificationForHabit(habit) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      const title = 'Habit Reminder';
      const body = formatAlarmMessage(habit);
      new Notification(title, { body });
    } catch {
      // ignore
    }
  }

  function startAlarmScheduler(els) {
    if (state?.meta?.alarm?._schedulerStarted) return;
    if (!state.meta) state.meta = {};
    state.meta.alarm = state.meta.alarm || {};
    state.meta.alarm._schedulerStarted = true;

    // Run immediately once after load.
    if (typeof requestNotificationPermissionOnce === 'function') {
      requestNotificationPermissionOnce().catch(() => {});
    }

    const run = () => {

      try {
        const now = new Date();
        for (const habit of (state.habits || [])) {
          if (!habit?.reminderTime) continue;
          if (!isHabitScheduledToday(habit, now)) continue;
          if (!shouldTriggerHabitNow(habit, now)) continue;

          // Avoid retriggering multiple times for same habit+scheduled minute.
          ensureAlarmState();
          const last = state.meta.alarm.lastTriggeredAtByHabit[habit.id];
          const curMinuteKey = `${todayKey(now)}:${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
          if (last && last === curMinuteKey) continue;

          // Trigger
          state.meta.alarm.activeHabitId = habit.id;

          stopReminderSound();
          playReminderSound(getSelectedAlarmSoundUrl(habit));
          showAlarmModal(els, habit);
          showNotificationForHabit(habit);
          setLastTriggeredForHabit(habit.id, now.getTime());

          // Only one active reminder at a time (minimum change)
          break;
        }
      } catch {
        // ignore
      }
    };

    run();
    setInterval(run, ALARM_CHECK_MS);
  }

  // Reminder/Alarm feature (audio & notifications)



  function openTrashConfirmModal(els, habitId, habitName) {


    ensureStateShape();
    state._pendingTrashDelete = { habitId, habitName: habitName || (state.habits.find((h) => h.id === habitId)?.name || ''), snapshot: null };

    // snapshot the habit right away, so it survives refresh even if user closes in-between
    const habit = state.habits.find((h) => h.id === habitId);
    if (habit) {
      state._pendingTrashDelete.snapshot = cloneData(habit);
    }

    if (!els.trashConfirmModal) return;
    els.trashConfirmModal.classList.add('is-open');
    els.trashConfirmModal.setAttribute('aria-hidden', 'false');
  }

  function closeTrashConfirmModal(els) {
    if (!els.trashConfirmModal) return;
    els.trashConfirmModal.classList.remove('is-open');
    els.trashConfirmModal.setAttribute('aria-hidden', 'true');
    state._pendingTrashDelete = null;
  }

  function openTrashPermanentModal(els, habitId) {
    load();
    ensureStateShape();
    const trashEntry = state.meta.habitTrash.find((t) => t.habit?.id === habitId);
    const habitName = trashEntry?.habit?.name || '';

    state._pendingTrashPermanent = { habitId, habitName };

    if (!els.trashPermanentModal) return;
    els.trashPermanentModal.classList.add('is-open');
    els.trashPermanentModal.setAttribute('aria-hidden', 'false');
  }

  function closeTrashPermanentModal(els) {
    if (!els.trashPermanentModal) return;
    els.trashPermanentModal.classList.remove('is-open');
    els.trashPermanentModal.setAttribute('aria-hidden', 'true');
    state._pendingTrashPermanent = null;
  }

  function moveHabitToTrash(habitId) {
    load();
    ensureStateShape();
    const habit = state.habits.find((h) => h.id === habitId);
    if (!habit) return;

    const snapshot = cloneData(habit);

    state.meta.habitTrash = normalizeTrashEntries(state.meta.habitTrash);
    state.meta.habitTrash = state.meta.habitTrash.filter((entry) => entry.habit?.id !== habitId);
    state.meta.habitTrash.unshift({ habit: snapshot, deletedAt: Date.now() });

    state.habits = state.habits.filter((h) => h.id !== habitId);

    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
    state._dirtyViews.trash = true;
    save();

  }



  function deleteHabitPermanently(habitId) {
    load();
    ensureStateShape();
    state.meta.habitTrash = (state.meta.habitTrash || []).filter((t) => t.habit?.id !== habitId);
    save();
    state._dirtyViews.trash = true;
  }

  function restoreHabitFromTrash(habitId) {
    load();
    ensureStateShape();
    const idx = (state.meta.habitTrash || []).findIndex((t) => t.habit?.id === habitId);
    if (idx === -1) return;

    const snapshot = state.meta.habitTrash[idx]?.habit;
    state.meta.habitTrash.splice(idx, 1);

    if (snapshot && !state.habits.some((h) => h.id === habitId)) {
      state.habits.unshift(cloneData(snapshot));
    }

    save();
    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
    state._dirtyViews.trash = true;
  }

  function renderTrash(els) {
    if (!els.viewTrash || !els.trashList) return;

    // Always re-load persisted storage before rendering to avoid stale in-memory state
    load();
    ensureStateShape();

    const trash = normalizeTrashEntries(state.meta.habitTrash);
    state.meta.habitTrash = trash;
    if (els.trashList) els.trashList.innerHTML = '';
    if (els.trashEmptyState) els.trashEmptyState.classList.toggle('is-hidden', trash.length !== 0);

    if (!trash.length) return;

    const frag = document.createDocumentFragment();

    for (const entry of trash) {
      const habit = entry.habit;
      if (!habit) continue;
      const item = document.createElement('div');
      item.className = 'habit-item';

      const left = document.createElement('div');
      left.className = 'habit-left';

      const name = document.createElement('div');
      name.className = 'habit-name';
      name.textContent = habit.name;

      left.appendChild(name);

      const actions = document.createElement('div');
      actions.className = 'habit-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'ghost-btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.setAttribute('aria-label', `Restore ${habit.name}`);
      restoreBtn.dataset.action = 'restoreHabit';
      restoreBtn.dataset.habitId = habit.id;

      const permBtn = document.createElement('button');
      permBtn.type = 'button';
      permBtn.className = 'danger-btn';
      permBtn.textContent = 'Permanent Delete';
      permBtn.setAttribute('aria-label', `Permanently delete ${habit.name}`);
      permBtn.dataset.action = 'permDeleteHabit';
      permBtn.dataset.habitId = habit.id;

      actions.appendChild(restoreBtn);
      actions.appendChild(permBtn);

      item.appendChild(left);
      item.appendChild(actions);

      frag.appendChild(item);
    }

    els.trashList.appendChild(frag);
  }


  function addHabit({ name, targetDays, reminderTime, reminderType, reminderDays, alarmSound }) {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    const aSound = Number.isFinite(Number(alarmSound)) ? Number(alarmSound) : 1;

    state.habits.unshift({
      id,
      name,
      targetDays,
      createdAt: Date.now(),
      history: {},
      reminderTime: typeof reminderTime === 'string' ? reminderTime : '',
      reminderType: reminderType === 'specific' ? 'specific' : 'daily',
      reminderDays: Array.isArray(reminderDays) ? reminderDays : [],
      // store both keys for backward compatibility with scheduler/audio helper
      alarmSound: Math.max(1, Math.min(4, aSound)),
      reminderSound: Math.max(1, Math.min(4, aSound)),
    });




    state.xp = state.xp || {};
    if (typeof state.xp.total !== 'number') state.xp.total = 0;

    save();
    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
  }

  function deleteHabitById(habitId) {
    state.habits = state.habits.filter((h) => h.id !== habitId);
    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
    save();
  }

  function clearWeek(els) {
    const keys = weekKeys();
    for (const habit of state.habits) {
      if (!habit.history) habit.history = {};
      for (const k of keys) {
        if (habit.history[k] === 'done') removeXpForStatus(habit.id, k);
        delete habit.history[k];
      }
    }
    save();
    state._dirtyViews.weekly = true;
    renderWeekly(els);
  }

  function clearAll(els) {
    state = {
      habits: [],
      xp: { total: 0, ledger: {} },
      streak: { current: 0, best: 0, lastResolvedKey: null, freezeCount: 1, missedDays: [] },
      achievements: { unlocked: {} },
      meta: { settings: { reducedMotion: false, sound: true }, dailyQuests: { dateKey: null, completed: {} }, habitTrash: [] },
      _dirtyViews: { weekly: true, monthly: true },
    };
    save();
    renderDashboard(els);
  }

  function bindEvents(els) {
    // Notification permission only once (safe flag)
    // Reminder Sound Test wiring
    els.testReminderSoundBtn && els.testReminderSoundBtn.addEventListener('click', () => {
      console.log('[ReminderSound] Test button clicked');
      try {
        if (state?.meta?.settings?.sound === false) {
          console.log('[ReminderSound] sound disabled in settings');
          return;
        }
        const t = getSelectedReminderSound();
        console.log('[ReminderSound] Test selected sound:', t);
        unlockAudioIfNeeded()
          .then((unlocked) => {
            console.log('[ReminderSound] Test unlockAudioIfNeeded result:', unlocked);
            if (!unlocked) console.log('[ReminderSound] Test audio unlock failed; still attempting play');
            playReminderSound(t);
          })
          .catch((e) => {
            console.log('[ReminderSound] Test unlockAudioIfNeeded threw', e);
            playReminderSound(t);
          });
      } catch (e) {
        console.log('[ReminderSound] Test sound error', e);
      }
    });

    try {
      ensureStateShape();
      const settings = state.meta.settings || (state.meta.settings = { reducedMotion: false, sound: true });
      if (!settings.notificationPermissionAsked) {
        settings.notificationPermissionAsked = true;
        requestNotificationPermissionOnce().catch(() => {
          // ignore
        });
        save();
      }
    } catch {
      // ignore
    }


    els.openTrashBtn && els.openTrashBtn.addEventListener('click', () => {
      state._dirtyViews = state._dirtyViews || {};
      state._dirtyViews.trash = true;

      // Ensure we display the latest persisted trash immediately
      load();

      // Show view (scheduleRender will call renderTrash)
      showView('trash', els);

      // Also render right away to avoid any timing/state issues
      renderTrash(els);

    });


    if (els.monthSelect) {
      // keep as in original (month options function not present in current codebase)
    }


    if (els.navItems && els.navItems.length) {
      els.navItems.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const view = btn.dataset.view;
          if (!view) return;
          showView(view, els);
        });
      });
    }

    els.menuBtn &&
      els.mobileNav &&
      els.menuBtn.addEventListener('click', () => {
        const isOpen = els.mobileNav.classList.toggle('is-open');
        els.menuBtn.setAttribute('aria-expanded', String(isOpen));
      });

    els.newHabitBtn && els.newHabitBtn.addEventListener('click', () => openModal(els));

    els.closeModalBtn && els.closeModalBtn.addEventListener('click', () => closeModal(els));
    els.cancelModalBtn && els.cancelModalBtn.addEventListener('click', () => closeModal(els));

    els.habitModal &&
      els.habitModal.addEventListener('click', (e) => {
        if (e.target === els.habitModal) closeModal(els);
      });

    // Alarm sound selection: radio click should start selected alarm immediately (looping).
    const bindAlarmSoundRadio = (radioEl, n) => {
      if (!radioEl) return;
      radioEl.addEventListener('change', () => {
        try {
          const settings = state?.meta?.settings;
          if (settings && settings.sound === false) return;

          stopReminderSound();
          state.meta = state.meta || {};
          state.meta.alarm = state.meta.alarm || {};
          state.meta.alarm.activeHabitId = null;

          const url = `sounds/alarm${n}.mp3`;
          // Start a loop while user is selecting; scheduler will handle the real alarm at the configured time.
          playReminderSound(url, { loop: true });

        } catch {
          // ignore
        }
      });
    };

    bindAlarmSoundRadio(els.alarmSound1Input, 1);
    bindAlarmSoundRadio(els.alarmSound2Input, 2);
    bindAlarmSoundRadio(els.alarmSound3Input, 3);
    bindAlarmSoundRadio(els.alarmSound4Input, 4);


    els.habitForm &&
      els.habitForm.addEventListener('submit', (e) => {
        e.preventDefault();

        // Force-close native <select> dropdown UI before hiding modal.
        // Some browsers keep the select popover alive unless focus/disabled is toggled.
        try {
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }

          const selectsToNudge = [els.habitReminderHourInput, els.habitReminderMinuteInput, els.habitReminderAmPmInput].filter(Boolean);
          selectsToNudge.forEach((sel) => {
            sel.disabled = true;
          });

          setTimeout(() => {
            selectsToNudge.forEach((sel) => {
              sel.disabled = false;
            });
          }, 0);
        } catch {
          // ignore
        }

        const name = els.habitNameInput ? els.habitNameInput.value.trim() : '';

        const targetDays = safeNumber(els.habitTargetInput?.value, 7);
        if (!name) return;

        // Build reminder time from existing Hour/Minute/AM-PM UI
        const h = els.habitReminderHourInput ? String(els.habitReminderHourInput.value || '').trim() : '';
        const m = els.habitReminderMinuteInput ? String(els.habitReminderMinuteInput.value || '').trim() : '';
        const ampm = els.habitReminderAmPmInput ? String(els.habitReminderAmPmInput.value || '').trim() : '';
        let reminderTime = '';
        if (h !== '' && m !== '' && ampm !== '') {
          // Keep as "H:MM AM/PM" for parsing: convert to HH:MM 24h here
          const hour12 = safeNumber(h, NaN);
          const minute = safeNumber(m, NaN);
          if (Number.isFinite(hour12) && Number.isFinite(minute)) {
            let hour24 = Math.max(0, Math.min(23, hour12));
            if (ampm === 'PM' && hour24 !== 12) hour24 += 12;
            if (ampm === 'AM' && hour24 === 12) hour24 = 0;
            reminderTime = `${String(hour24).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
          }
        }

        const reminderType = els.habitReminderTypeSpecificInput && els.habitReminderTypeSpecificInput.checked ? 'specific' : 'daily';

        // Keep the active reminder working schedule consistent with the STOP/SNOOZE modal.
        // This is additive and does not alter existing habit tracking logic.
        // (Scheduler uses habit.reminderTime + reminderType/reminderDays.)


        let reminderDays = [];
        if (reminderType === 'specific' && els.habitReminderDaysWrap) {
          reminderDays = Array.from(els.habitReminderDaysWrap.querySelectorAll('input[type="checkbox"]'))
            .filter((cb) => cb.checked)
            .map((cb) => cb.dataset.day)
            .filter(Boolean);
        }

        const alarmSound = els.alarmSound1Input && els.alarmSound1Input.checked ? 1 : els.alarmSound2Input && els.alarmSound2Input.checked ? 2 : els.alarmSound3Input && els.alarmSound3Input.checked ? 3 : els.alarmSound4Input && els.alarmSound4Input.checked ? 4 : 1;

        addHabit({
          name,
          targetDays: Math.max(1, Math.min(7, targetDays)),
          reminderTime,
          reminderType,
          reminderDays,
          alarmSound,
        });


        closeModal(els);
        renderDashboard(els);
      });

    // Reminder UI show/hide (Specific Days)
    els.habitReminderTypeDailyInput &&
      els.habitReminderTypeDailyInput.addEventListener('change', () => {
        if (!els.habitReminderDaysWrap) return;
        els.habitReminderDaysWrap.style.display = 'none';
      });

    els.habitReminderTypeSpecificInput &&
      els.habitReminderTypeSpecificInput.addEventListener('change', () => {
        if (!els.habitReminderDaysWrap) return;
        els.habitReminderDaysWrap.style.display = 'block';
      });


    els.clearWeekBtn && els.clearWeekBtn.addEventListener('click', () => clearWeek(els));

    els.clearMonthBtn &&
      els.clearMonthBtn.addEventListener('click', () => {
        if (!confirm('Reset monthly tracking for this month? This cannot be undone.')) return;
        clearMonth(els);
      });

    els.monthPrevBtn &&
      els.monthPrevBtn.addEventListener('click', () => {
        const anchor = getSelectedMonthAnchor();
        setSelectedMonthByAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
        state._dirtyViews.monthly = true;
        renderMonthly(els);
      });

    els.monthNextBtn &&
      els.monthNextBtn.addEventListener('click', () => {
        const anchor = getSelectedMonthAnchor();
        setSelectedMonthByAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
        state._dirtyViews.monthly = true;
        renderMonthly(els);
      });

    els.clearAllBtn &&
      els.clearAllBtn.addEventListener('click', () => {
        if (!confirm('Delete all habits and history stored in this browser?')) return;
        clearAll(els);
        showView('dashboard', els);
      });

    // Trash modal: Delete Habit? (OK/Cancel)
    els.trashConfirmCloseBtn && els.trashConfirmCloseBtn.addEventListener('click', () => closeTrashConfirmModal(els));
    els.trashConfirmCancelBtn && els.trashConfirmCancelBtn.addEventListener('click', () => closeTrashConfirmModal(els));
    els.trashConfirmMoveBtn &&
      els.trashConfirmMoveBtn.addEventListener('click', () => {
        const pending = state._pendingTrashDelete;
        closeTrashConfirmModal(els);
        if (!pending?.habitId) return;
        moveHabitToTrash(pending.habitId);
        renderDashboard(els);
        renderTrash(els);
        // If currently on trash view, keep it; else just update.
      });

    // Trash modal: Permanent Delete (Cancel/OK)
    els.trashPermanentCloseBtn && els.trashPermanentCloseBtn.addEventListener('click', () => closeTrashPermanentModal(els));
      els.trashPermanentCancelBtn && els.trashPermanentCancelBtn.addEventListener('click', () => closeTrashPermanentModal(els));
      els.trashPermanentDeleteBtn &&
        els.trashPermanentDeleteBtn.addEventListener('click', () => {

        const pending = state._pendingTrashPermanent;
        closeTrashPermanentModal(els);
        if (!pending?.habitId) return;
        deleteHabitPermanently(pending.habitId);
        renderTrash(els);
      });


    // Main list actions
    els.habitList &&
      els.habitList.addEventListener('click', (e) => {
        const btn = e.target;
        const item = btn && btn.closest ? btn.closest('.habit-item') : null;
        if (!item) return;
        const habitId = item.dataset.habitId;
        const action = btn?.dataset?.action;
        if (!habitId || !action) return;

        const tKey = todayKey();
        if (action === 'deleteHabit') {
          openTrashConfirmModal(els, habitId);
          return;
        }

        if (action === 'setStatus') {
          const status = btn.dataset.status;
          const habit = state.habits.find((h) => h.id === habitId);
          if (!habit) return;

          const view = els.currentView || 'dashboard';
          if (view === 'monthly') {
            setStatusForMonth(habitId, tKey, status);
          } else {
            habit.history = habit.history || {};
            const previous = habit.history[tKey];
            habit.history[tKey] = status;
            syncXpForStatusChange(habitId, tKey, previous, status);
            save();
          }

          if (view === 'dashboard') renderDashboard(els);
          else if (view === 'weekly') renderWeekly(els);
          else if (view === 'monthly') renderMonthly(els);
          renderXpUi(els);
        }
      });

    // Trash list actions
    els.trashList &&
      els.trashList.addEventListener('click', (e) => {
        const btn = e.target;
        const action = btn?.dataset?.action;
        const habitId = btn?.dataset?.habitId;
        if (!action || !habitId) return;

        if (action === 'restoreHabit') {
          restoreHabitFromTrash(habitId);
          renderDashboard(els);
          renderTrash(els);
          return;
        }

        if (action === 'permDeleteHabit') {
          openTrashPermanentModal(els, habitId);
          return;
        }
      });

    // Alarm modal buttons (STOP / SNOOZE / X close)
    els.alarmStopBtn && els.alarmStopBtn.addEventListener('click', () => {
      stopAlarmForCurrentOccurrence();
      closeAlarmModal(els);
    });
    els.alarmSnoozeBtn && els.alarmSnoozeBtn.addEventListener('click', () => {
      snoozeAlarmForCurrentOccurrence(ALARM_SNOOZE_MINUTES);
      closeAlarmModal(els);
    });
    // Robust X close binding (works even if modal DOM changes)
    const alarmXBtn = $('alarmModalCloseBtn') || (els.alarmModal ? els.alarmModal.querySelector('#alarmModalCloseBtn') : null);
    alarmXBtn && alarmXBtn.addEventListener('click', () => {
      stopAlarmForCurrentOccurrence();
      closeAlarmModal(els);
    });




    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {

        if (els.habitModal && els.habitModal.classList.contains('is-open')) closeModal(els);
        if (els.trashConfirmModal && els.trashConfirmModal.classList.contains('is-open')) closeTrashConfirmModal(els);
        if (els.trashPermanentModal && els.trashPermanentModal.classList.contains('is-open')) closeTrashPermanentModal(els);
      }
    });
  }

  function openModal(els) {
    if (!els.habitModal || !els.habitNameInput) return;
    els.habitModal.classList.add('is-open');
    els.habitModal.setAttribute('aria-hidden', 'false');
    els.habitNameInput.focus();
  }

  function closeModal(els) {
    if (!els.habitModal) return;

    // Stop any alarm preview/background audio when modal closes.
    try {
      stopReminderSound();
    } catch {
      // ignore
    }

    els.habitModal.classList.remove('is-open');
    els.habitModal.setAttribute('aria-hidden', 'true');
    if (els.habitForm) els.habitForm.reset();
    if (els.habitTargetInput) els.habitTargetInput.value = 7;

    // Reset reminder inputs (best-effort)
    if (els.habitReminderTimeInput) els.habitReminderTimeInput.value = '';
    if (els.habitReminderTypeDailyInput) els.habitReminderTypeDailyInput.checked = true;
    if (els.habitReminderDaysWrap) {
      const cbs = els.habitReminderDaysWrap.querySelectorAll('input[type="checkbox"]');
      cbs.forEach((cb) => (cb.checked = false));
      els.habitReminderDaysWrap.style.display = 'none';
    }

    // Also clear any active reminder linkage.
    if (state?.meta?.alarm) {
      state.meta.alarm.activeHabitId = null;
    }
  }



  function init() {
    const els = {
      navItems: Array.from(document.querySelectorAll('.nav-item')),



      mobileNav: $('mobileNav'),
      menuBtn: $('menuBtn'),

      viewDashboard: $('view-dashboard'),
      viewWeekly: $('view-weekly'),
      viewMonthly: $('view-monthly'),
      viewSettings: $('view-settings'),
      viewTrash: $('view-trash'),

      todayLabel: $('todayLabel'),
      motivationQuote: $('motivationQuote'),
      habitList: $('habitList'),
      emptyState: $('emptyState'),

      progressMeta: $('progressMeta'),
      progressFill: $('progressFill'),
      progressBar: document.querySelector('#view-dashboard .progress:not(.xp-progress) .progress-bar'),
      progressPct: $('progressPct'),
      progressCounts: $('progressCounts'),
      streakCount: $('streakCount'),

      weekRangePill: $('weekRangePill'),
      weeklyTable: $('weeklyTable'),
      clearWeekBtn: $('clearWeekBtn'),

      monthRangePill: $('monthRangePill'),
      monthSelect: $('monthSelect'),
      monthPrevBtn: $('monthPrevBtn'),
      monthNextBtn: $('monthNextBtn'),
      monthlyTable: $('monthlyTable'),
      clearMonthBtn: $('clearMonthBtn'),

      clearAllBtn: $('clearAllBtn'),

      habitModal: $('habitModal'),
      habitForm: $('habitForm'),
      habitNameInput: $('habitNameInput'),
      habitTargetInput: $('habitTargetInput'),
      habitReminderTimeInput: $('habitReminderTimeInput'),
      habitReminderTypeDailyInput: $('habitReminderTypeDailyInput'),
      habitReminderTypeSpecificInput: $('habitReminderTypeSpecificInput'),
      habitReminderDaysWrap: $('habitReminderDaysWrap'),
      alarmSound1Input: $('habitAlarmSound1'),

      alarmSound2Input: $('habitAlarmSound2'),
      alarmSound3Input: $('habitAlarmSound3'),
      alarmSound4Input: $('habitAlarmSound4'),
      closeModalBtn: $('closeModalBtn'),

      cancelModalBtn: $('cancelModalBtn'),
      newHabitBtn: $('newHabitBtn'),

      xpTotalEl: $('xpTotal'),
      xpFillEl: $('xpProgressFill'),
      xpProgressBar: document.querySelector('.xp-progress .progress-bar'),
      xpPctEl: $('xpProgressPct'),
      xpNextLabelEl: $('xpNextLabel'),
      levelBadgeEl: $('levelBadge'),

      analyticsTotalCompletedEl: $('analyticsTotalCompleted'),
      analyticsMissedHabitsEl: $('analyticsMissedHabits'),
      analyticsBestHabitEl: $('analyticsBestHabit'),
      analyticsCompletionPctEl: $('analyticsCompletionPct'),
      completionPillEl: $('completionPill'),
      weeklyBarsEl: $('weeklyBars'),

      trashList: $('trashList'),
      trashEmptyState: $('trashEmptyState'),

      trashConfirmModal: $('trashConfirmModal'),
      trashConfirmCloseBtn: $('trashConfirmCloseBtn'),
      trashConfirmCancelBtn: $('trashConfirmCancelBtn'),
      trashConfirmMoveBtn: $('trashConfirmMoveBtn'),

      trashPermanentModal: $('trashPermanentModal'),
      trashPermanentCloseBtn: $('trashPermanentCloseBtn'),
      trashPermanentCancelBtn: $('trashPermanentCancelBtn'),
      trashPermanentDeleteBtn: $('trashPermanentDeleteBtn'),

      fatalErrorEl: null,
      currentView: 'dashboard',

      alarmModal: $('alarmModal'),
      alarmHabitName: $('alarmHabitName'),
      alarmHabitNameInline: $('alarmHabitNameInline'),
      alarmStopBtn: $('alarmStopBtn'),
      alarmSnoozeBtn: $('alarmSnoozeBtn'),

      missedWarningEl: $('missedWarning'),
    };


    const existing = document.getElementById('fatalError');
    if (existing) els.fatalErrorEl = existing;
    else {
      const d = document.createElement('div');
      d.id = 'fatalError';
      d.style.display = 'none';
      d.style.margin = '14px';
      d.style.padding = '12px 14px';
      d.style.border = '1px solid rgba(239,68,68,.45)';
      d.style.borderRadius = '16px';
      d.style.background = 'rgba(239,68,68,.10)';
      d.style.color = 'rgba(255,255,255,.95)';
      d.style.fontWeight = '800';
      els.viewDashboard && els.viewDashboard.prepend(d);
      els.fatalErrorEl = d;
    }

    bindEvents(els);
    state._dirtyViews = state._dirtyViews || { weekly: true, monthly: true, trash: true };

    load();

    // Start alarm reminder scheduler (additive; does not alter existing habit logic)
    startAlarmScheduler(els);

    els.currentView = 'dashboard';
    showView('dashboard', els);
    renderDashboard(els);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

