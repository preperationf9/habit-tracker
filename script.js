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

  // Reminder/Alarm feature removed (audio & notifications disabled)

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


  function addHabit({ name, targetDays, reminderTime, reminderType, reminderDays }) {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    state.habits.unshift({
      id,
      name,
      targetDays,
      createdAt: Date.now(),
      history: {},
      reminderTime: typeof reminderTime === 'string' ? reminderTime : '',
      reminderType: reminderType === 'specific' ? 'specific' : 'daily',
      reminderDays: Array.isArray(reminderDays) ? reminderDays : [],
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

    els.habitForm &&
      els.habitForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = els.habitNameInput ? els.habitNameInput.value.trim() : '';
        const targetDays = safeNumber(els.habitTargetInput?.value, 7);
        if (!name) return;

        const reminderTime = els.habitReminderTimeInput ? String(els.habitReminderTimeInput.value || '').trim() : '';
        const reminderType = els.habitReminderTypeSpecificInput && els.habitReminderTypeSpecificInput.checked ? 'specific' : 'daily';

        let reminderDays = [];
        if (reminderType === 'specific' && els.habitReminderDaysWrap) {
          reminderDays = Array.from(els.habitReminderDaysWrap.querySelectorAll('input[type="checkbox"]'))
            .filter((cb) => cb.checked)
            .map((cb) => cb.dataset.day)
            .filter(Boolean);
        }

        addHabit({
          name,
          targetDays: Math.max(1, Math.min(7, targetDays)),
          reminderTime,
          reminderType,
          reminderDays,
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

