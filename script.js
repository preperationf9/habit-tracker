(() => {
  'use strict';

  const STORAGE_KEY = 'habitTracker.v1';
  const STORAGE_MIGRATION_VERSION = 3;

  const XP = { completeHabit: 10 };

  // Streak is calculated from persistent activity history (dates where user completed at least one habit).
  // IMPORTANT: streak must NOT depend on current habit checkbox state.


  /**
   * @typedef {'done'|'not_done'} HabitStatus
   * @typedef {{ [dateKey: string]: HabitStatus }} HabitHistory
   * @typedef {{
   *   id:string,
   *   name:string,
   *   targetDays:number,
   *   createdAt:number,
   *   history: HabitHistory,
   *   alarmTime?: string,   // HH:MM (24h) single internal format
   *   alarmSound?: number   // 1..4
   * }} Habit
   */

  /** @typedef {{
   *   habits: Habit[],
   *   xp: { total:number, ledger?: any },
   *   streak: { current:number, best:number, lastResolvedKey?: string|null, freezeCount?: number, missedDays?: string[] },
   *   achievements: { unlocked?: Record<string, boolean> },
   *   meta: any,
   *   _dirtyViews?: Record<string, boolean>
   * }} AppState */

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
    for (let d = 1; d <= daysInMonth; d++) keys.push(todayKey(new Date(y, m, d)));
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

    if (Array.isArray(base) || Array.isArray(incoming)) return Array.isArray(incoming) ? incoming : base;
    if (typeof base !== 'object' || typeof incoming !== 'object') return incoming;

    const out = { ...base };
    for (const [k, v] of Object.entries(incoming)) {
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        base &&
        typeof base[k] === 'object' &&
        !Array.isArray(base[k])
      ) {
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

  function ensureStateShape() {
    state = state || { habits: [] };

    state.meta = state.meta || {};

    state.meta.streakHistory = Array.isArray(state.meta.streakHistory) ? state.meta.streakHistory : [];


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
    state.achievements.unlocked =
      state.achievements.unlocked && typeof state.achievements.unlocked === 'object' ? state.achievements.unlocked : {};

    state.meta = state.meta || {};
    state.meta.settings =
      state.meta.settings && typeof state.meta.settings === 'object' ? state.meta.settings : { reducedMotion: false, sound: true };
    state.meta.dailyQuests =
      state.meta.dailyQuests && typeof state.meta.dailyQuests === 'object' ? state.meta.dailyQuests : { dateKey: null, completed: {} };
    state.meta.monthlySelected = state.meta.monthlySelected ?? null;

    state.meta.habitTrash = normalizeTrashEntries(state.meta.habitTrash);
    state.meta.monthlyByMonthKey =
      state.meta.monthlyByMonthKey && typeof state.meta.monthlyByMonthKey === 'object' ? state.meta.monthlyByMonthKey : {};

    // Alarm runtime state (NOT persisted)
    state.meta.alarmRuntime = state.meta.alarmRuntime || {
      activeHabitId: null,
      activeAudio: null,
    };

    state._dirtyViews = state._dirtyViews || { weekly: true, monthly: true, trash: true };
    console.log('Final state', state);
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
        habitTrash: [],
        monthlyByMonthKey: {},
        alarmRuntime: { activeHabitId: null, activeAudio: null },
      },
      _dirtyViews: { weekly: true, monthly: true, trash: true },
    };
  }

  function normalizeAlarmTimeToHHMM(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (!s) return '';

    // HH:MM 24h
    const m24 = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (m24) return `${String(Number(m24[1])).padStart(2, '0')}:${m24[2]}`;

    // 12h with AM/PM like 02:00 PM
    const m12 = s.match(/^(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM)$/i);
    if (m12) {
      const hh12 = safeNumber(m12[1], NaN);
      const mm = safeNumber(m12[2], NaN);
      if (!Number.isFinite(hh12) || !Number.isFinite(mm)) return '';
      const ampm = String(m12[3]).toUpperCase();
      let hh24 = hh12 % 12;
      if (ampm === 'PM') hh24 += 12;
      return `${String(hh24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    return '';
  }

  function parseTimeFromUIToHHMM({ hVal, mVal, ampmVal }) {
    const h = safeNumber(hVal, NaN);
    const m = safeNumber(mVal, NaN);
    let ampm = (ampmVal || '').toString().trim().toUpperCase();
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    if (ampm !== 'AM' && ampm !== 'PM') ampm = 'AM';

    // UI hour is 1..12
    const hh12 = Math.max(1, Math.min(12, h));
    const mm = Math.max(0, Math.min(59, m));

    let hh24 = hh12 % 12;
    if (ampm === 'PM') hh24 += 12;

    return `${String(hh24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function migrateAndMergeState(parsed) {
    const base = getDefaultState();
    if (!parsed || typeof parsed !== 'object') return base;

    const merged = deepMerge(base, parsed);

    merged.habits = Array.isArray(parsed.habits) ? parsed.habits : base.habits;
    merged.habits = (merged.habits || []).map((h) => {
      const out = { ...(h && typeof h === 'object' ? h : {}) };
      out.id = out.id ?? String(Date.now()) + Math.random().toString(16).slice(2);
      out.name = typeof out.name === 'string' ? out.name : '';
      out.targetDays = safeNumber(out.targetDays, 7);
      out.createdAt = safeNumber(out.createdAt, Date.now());
      out.history = out.history && typeof out.history === 'object' ? out.history : {};

      // Convert any legacy fields to single internal alarmTime + alarmSound.
      const legacyTime =
        (typeof out.alarmTime === 'string' ? out.alarmTime : '') ||
        (typeof out.reminderTime === 'string' ? out.reminderTime : '') ||
        (typeof out.reminder?.time === 'string' ? out.reminder.time : '');
      out.alarmTime = normalizeAlarmTimeToHHMM(legacyTime);

      const legacySound = out.alarmSound ?? out.reminderSound ?? out.alarmSound ?? 1;
      const v = Number.isFinite(Number(legacySound)) ? Number(legacySound) : 1;
      out.alarmSound = Math.max(1, Math.min(4, v));

      // Weekday recurrence (Specific Days)
      // If missing, default to all days (Daily behavior).
      const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      if (!Array.isArray(out.alarmWeekdaysSelected) || !out.alarmWeekdaysSelected.length) {
        out.alarmWeekdaysSelected = allWeekdays;
      } else {
        out.alarmWeekdaysSelected = out.alarmWeekdaysSelected.filter((d) => allWeekdays.includes(d));
        if (!out.alarmWeekdaysSelected.length) out.alarmWeekdaysSelected = allWeekdays;
      }

      return out;
    });


    merged.meta = merged.meta && typeof merged.meta === 'object' ? merged.meta : base.meta;
    merged.meta.settings = merged.meta.settings && typeof merged.meta.settings === 'object' ? merged.meta.settings : base.meta.settings;
    merged.meta.dailyQuests =
      merged.meta.dailyQuests && typeof merged.meta.dailyQuests === 'object' ? merged.meta.dailyQuests : base.meta.dailyQuests;
    merged.meta.monthlySelected = merged.meta.monthlySelected ?? null;

    const savedTrash = Array.isArray(merged.meta.habitTrash)
      ? merged.meta.habitTrash
      : Array.isArray(parsed.trash)
        ? parsed.trash
        : Array.isArray(parsed.meta?.trash)
          ? parsed.meta.trash
          : base.meta.habitTrash;
    merged.meta.habitTrash = normalizeTrashEntries(savedTrash);

    merged.meta.monthlyByMonthKey =
      merged.meta.monthlyByMonthKey && typeof merged.meta.monthlyByMonthKey === 'object' ? merged.meta.monthlyByMonthKey : {};

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

    merged.meta._storageMigration = { v: STORAGE_MIGRATION_VERSION, migratedAt: Date.now() };

    // Alarm runtime keys should not come from storage
    merged.meta.alarmRuntime = base.meta.alarmRuntime;

    merged._dirtyViews = base._dirtyViews;

    return merged;
  }

  function rebuildStreakHistoryFromHabitHistory() {
    ensureStateShape();

    // IMPORTANT: streak history is based on completion records only.
    // Any habit toggles/unchecked/delete must not affect what days are considered active.
    const doneDaysSet = new Set();

    for (const habit of state.habits || []) {
      const history = habit?.history;
      if (!history || typeof history !== 'object') continue;

      for (const [dateKey, status] of Object.entries(history)) {
        if (status === 'done' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          doneDaysSet.add(dateKey);
        }
      }
    }

    state.meta.streakHistory = Array.from(doneDaysSet).sort();
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = getDefaultState();
        return;
      }
      console.log('Loaded state', JSON.parse(raw));
      const parsed = JSON.parse(raw);
      console.log('Migrated state', migrateAndMergeState(parsed));
      state = migrateAndMergeState(parsed);

      // Requirement: on app load, recalculate streak from historical completion records.
      rebuildStreakHistoryFromHabitHistory();


      seedXpLedgerFromHistory();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        try {
          console.error('alarm scheduler tick error', {
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
          });
        } catch {
          // ignore logging failures
        }
      }

    } catch {
      state = getDefaultState();
    }
  }


  function save() {
    try {
      console.log('Saving state', state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      console.log('Saved to localStorage');
    } catch {
      // ignore
    }
  }


  // XP is derived (no ledger source-of-truth).
  function seedXpLedgerFromHistory() {
    // keep for backward compatibility with old localStorage shape
    ensureStateShape();
    state.xp.total = 0;
  }


  // =============================
  // Streak logic (activity-date based)
  // =============================

  function isAnyHabitDoneOnDate(dateKey) {
    for (const habit of state.habits || []) {
      if (habit?.history?.[dateKey] === 'done') return true;
    }
    return false;
  }


  function activityDateHistorySync() {
    // IMPORTANT: streak must be based only on persisted activity dates,
    // and must NOT change when habits are unchecked/deleted.
    // So we only normalize/validate the stored date keys.
    ensureStateShape();

    const unique = Array.from(new Set(state.meta.streakHistory || []));
    const filtered = unique
      .filter((k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort();

    state.meta.streakHistory = filtered;
  }


  function computeCurrentStreakFromHistory() {
    // IMPORTANT: streak must be based only on persisted activity dates,
    // not on current checklist state.
    activityDateHistorySync();

    const hist = (state.meta.streakHistory || []).slice();
    if (!hist.length) return 0;

    // Current streak = consecutive active days ending at the latest active day.
    const set = new Set(hist);
    const latest = hist[hist.length - 1];

    let streak = 0;
    let cursor = latest;
    while (set.has(cursor)) {
      streak++;
      const d = new Date(cursor + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      cursor = todayKey(d);
    }

    return streak;
  }


  function computeBestStreakFromHistory() {
    activityDateHistorySync();

    const hist = (state.meta.streakHistory || []).slice();
    if (!hist.length) return 0;

    const set = new Set(hist);
    let best = 0;

    for (const start of hist) {
      // start is potential beginning of a run if previous day is not active
      const d = new Date(start + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      const prev = todayKey(d);
      if (set.has(prev)) continue;

      let cur = 0;
      let cursor = start;
      while (set.has(cursor)) {
        cur++;
        const d2 = new Date(cursor + 'T00:00:00');
        d2.setDate(d2.getDate() + 1);
        cursor = todayKey(d2);
      }
      best = Math.max(best, cur);

    }

    return best;
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

    // Current/best streak must be based on persisted activity dates,
    // not on current checklist checkbox state.
    const current = computeCurrentStreakFromHistory();
    const best = computeBestStreakFromHistory();

    state.streak.current = current;
    state.streak.best = Math.max(state.streak.best || 0, best);

    if (els && els.missedWarningEl) els.missedWarningEl.classList.remove('is-show');
  }


  function getLevelFromXp(totalXp) {
    const x = Math.max(0, Number(totalXp) || 0);
    if (x >= 200) return { name: 'Master', minXp: 200, nextXp: 200, progressStart: 200 };
    if (x >= 100) return { name: 'Advanced', minXp: 100, nextXp: 200, progressStart: 100 };
    if (x >= 50) return { name: 'Intermediate', minXp: 50, nextXp: 100, progressStart: 50 };
    return { name: 'Beginner', minXp: 0, nextXp: 50, progressStart: 0 };
  }

  function computeXpTotalForToday() {
    // XP derived from active & completed habits.
    ensureStateShape();
    const tKey = todayKey();
    let completedCount = 0;
    for (const habit of state.habits || []) {
      if (habit?.history?.[tKey] === 'done') completedCount++;
    }
    return completedCount * XP.completeHabit;
  }


  function renderXpUi(els) {
    if (!els.xpTotalEl || !els.xpFillEl || !els.xpPctEl || !els.xpNextLabelEl || !els.levelBadgeEl) return;

    ensureStateShape();
    const total = computeXpTotalForToday();

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
    const map = {
      dashboard: els.viewDashboard,
      weekly: els.viewWeekly,
      monthly: els.viewMonthly,
      settings: els.viewSettings,
      trash: els.viewTrash,
    };

    for (const [k, el] of Object.entries(map)) {
      if (!el) continue;
      el.classList.toggle('is-hidden', k !== view);
    }

    if (els.navItems) els.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));

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
    els.habitList && (els.habitList.innerHTML = '');

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

    els.emptyState && els.emptyState.classList.toggle('is-hidden', habits.length !== 0);

    const pct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
    els.progressMeta && (els.progressMeta.textContent = `${pct}% completed`);
    els.progressFill && (els.progressFill.style.width = `${pct}%`);
    els.progressPct && (els.progressPct.textContent = `${pct}%`);
    els.progressCounts && (els.progressCounts.textContent = `${doneCount} / ${totalCount}`);

    els.streakCount && (els.streakCount.textContent = String(state.streak?.current ?? 0));

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
      for (let i = 0; i < keys.length; i++) {
        const dateKey = keys[i];
        const status = habit.history?.[dateKey];
        if (status === 'done') {
          totalDone++;
          dayDoneCounts[i]++;
          dayExplicitCounts[i]++;
        } else if (status === 'not_done') {
          totalMissed++;
          dayExplicitCounts[i]++;
        }

        // Best habit pct based on explicit data.
      }

      let habitDone = 0;
      let habitExplicit = 0;
      keys.forEach((dateKey) => {
        const status = habit.history?.[dateKey];
        if (status === 'done') {
          habitDone++;
          habitExplicit++;
        } else if (status === 'not_done') {
          habitExplicit++;
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

        const status = habit.history?.[k];
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

  // =============================
  // Trash
  // =============================

  function openTrashConfirmModal(els, habitId, habitName) {
    ensureStateShape();
    state._pendingTrashDelete = {
      habitId,
      habitName: habitName || (state.habits.find((h) => h.id === habitId)?.name || ''),
      snapshot: null,
    };

    const habit = state.habits.find((h) => h.id === habitId);
    if (habit) state._pendingTrashDelete.snapshot = cloneData(habit);

    els.trashConfirmModal?.classList.add('is-open');
    els.trashConfirmModal?.setAttribute('aria-hidden', 'false');
  }

  function closeTrashConfirmModal(els) {
    els.trashConfirmModal?.classList.remove('is-open');
    els.trashConfirmModal?.setAttribute('aria-hidden', 'true');
    state._pendingTrashDelete = null;
  }

  function openTrashPermanentModal(els, habitId) {
    load();
    ensureStateShape();

    const trashEntry = state.meta.habitTrash.find((t) => t.habit?.id === habitId);
    const habitName = trashEntry?.habit?.name || '';

    state._pendingTrashPermanent = { habitId, habitName };

    els.trashPermanentModal?.classList.add('is-open');
    els.trashPermanentModal?.setAttribute('aria-hidden', 'false');
  }

  function closeTrashPermanentModal(els) {
    els.trashPermanentModal?.classList.remove('is-open');
    els.trashPermanentModal?.setAttribute('aria-hidden', 'true');
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

    // If the habit was marked done today, remove its awarded XP before deleting.
    const tKey = todayKey();
    if (state.habits?.length) {
      const habitInLiveList = state.habits.find((h) => h.id === habitId);
      // If habit is already in trash (not in live list), it won't be found here.
      // In that case, check the snapshot inside habitTrash below.
      // XP derived from habit history; deleting will automatically remove today's XP.
      void habitInLiveList;
      void tKey;

    }

    // Also handle the common case: habit is already removed from state.habits
    // and only exists as a trash snapshot.
    void tKey;
    // XP derived from habit history; no ledger updates needed when deleting.
    void habitId;



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
      restoreBtn.dataset.action = 'restoreHabit';
      restoreBtn.dataset.habitId = habit.id;
      restoreBtn.setAttribute('aria-label', `Restore ${habit.name}`);

      const permBtn = document.createElement('button');
      permBtn.type = 'button';
      permBtn.className = 'danger-btn';
      permBtn.textContent = 'Permanent Delete';
      permBtn.dataset.action = 'permDeleteHabit';
      permBtn.dataset.habitId = habit.id;
      permBtn.setAttribute('aria-label', `Permanently delete ${habit.name}`);

      actions.appendChild(restoreBtn);
      actions.appendChild(permBtn);

      item.appendChild(left);
      item.appendChild(actions);
      frag.appendChild(item);
    }

    els.trashList.appendChild(frag);
  }

  // =============================
  // NEW Alarm (clean, single system)
  // =============================

  const ALARM_CHECK_MS = 1000; // scheduler every second
  const ALARM_SNOOZE_MINUTES = 5;

  function hhmmNow(now) {
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function stopAlarmAudio() {
    try {
      const a = state?.meta?.alarmRuntime?._activeAudio;
      if (a && typeof a.pause === 'function') {
        a.pause();
        a.currentTime = 0;
      }
    } catch {
      // ignore
    }
    if (state?.meta?.alarmRuntime) state.meta.alarmRuntime._activeAudio = null;
  }

  function playAlarmAudio(url) {
    stopAlarmAudio();
    if (state?.meta?.settings && state.meta.settings.sound === false) { console.log('sound failed', { reason: 'sound disabled' }); return; }

    try {
      const a = new Audio(url);
      a.loop = true;
      a.volume = 1;
      state.meta.alarmRuntime._activeAudio = a;

      // Browsers may block autoplay; a second attempt helps when user interacts.
      const attemptPlay = () => {
        try {
          a.play().then(()=>{console.log('sound started');}).catch((e)=>{console.log('sound failed', { reason: 'play rejected', error: e && e.message ? e.message : String(e) });});
      } catch (err) {
        // ignore, but log in case something breaks the scheduler
        try {
          console.error('alarm scheduler tick error', {
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
          });
        } catch {
          // ignore logging failures
        }
      }
    };


      attemptPlay();
      setTimeout(attemptPlay, 250);
    } catch {
      // ignore
    }
  }


  function alarmSoundUrlForHabit(habit) {
    const n = Math.max(1, Math.min(4, Number(habit?.alarmSound) || 1));
    return `sounds/alarm${n}.mp3`;
  }

  function openAlarmModal(els, habit) {
    const hName = habit?.name || '—';
    const t = habit?.alarmTime || '—';
    const sN = Math.max(1, Math.min(4, Number(habit?.alarmSound) || 1));
    const sLabel = `Alarm ${sN}`;

    els.alarmHabitName && (els.alarmHabitName.textContent = hName);
    els.alarmHabitNameInline && (els.alarmHabitNameInline.textContent = `${t} • ${sLabel}`);

    els.alarmModal?.classList.add('is-open');
    els.alarmModal?.setAttribute('aria-hidden', 'false');
  }


  function closeAlarmModal(els) {
    els.alarmModal?.classList.remove('is-open');
    els.alarmModal?.setAttribute('aria-hidden', 'true');
  }

  function stopAlarmOccurrence(els) {
    stopAlarmAudio();
    closeAlarmModal(els);
    if (state?.meta?.alarmRuntime) state.meta.alarmRuntime.activeHabitId = null;
  }

  function snoozeAlarmOccurrence(els) {
    const activeHabitId = state?.meta?.alarmRuntime?.activeHabitId;
    if (!activeHabitId) {
      stopAlarmOccurrence(els);
      return;
    }

    stopAlarmAudio();
    closeAlarmModal(els);

    const habit = state.habits.find((h) => h.id === activeHabitId);
    if (!habit?.alarmTime) return;

    const now = new Date();
    const snoozeAt = new Date(now);
    snoozeAt.setMinutes(snoozeAt.getMinutes() + ALARM_SNOOZE_MINUTES);

    const snoozeHHMM = hhmmNow(snoozeAt);

    // Store snooze target in runtime only; scheduler will match HH:MM.
    state.meta.alarmRuntime._snoozeOverride = {
      habitId: activeHabitId,
      hhmm: snoozeHHMM,
    };
  }

  function weekdayNameForDate(d) {
    // JS getDay(): 0=Sunday ... 6=Saturday
    const map = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return map[d.getDay()];
  }

  function shouldTriggerAlarm(habit, now) {
    if (!habit?.alarmTime) return false;

    // never trigger while modal is open; STOP/SNOOZE/X controls audio.
    if (state?.meta?.alarmRuntime?._modalOpen) return false;

    // Weekday gating (Specific Days)
    const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const selected =
      Array.isArray(habit.alarmWeekdaysSelected) && habit.alarmWeekdaysSelected.length ? habit.alarmWeekdaysSelected : allWeekdays;
    const todayName = weekdayNameForDate(now);
    if (!selected.includes(todayName)) return false;

    // NOTE: scheduler tick handles time-match + grace/catch-up.
    // shouldTriggerAlarm must ONLY decide whether firing is allowed.
    return true;
  }



  let alarmTimerHandle = null;

  function startAlarmScheduler(els) {
    if (alarmTimerHandle) return;

    // initialize runtime flags
    ensureStateShape();
    state.meta.alarmRuntime._modalOpen = false;

    state.meta.alarmRuntime._lastFiredMinute = state.meta.alarmRuntime._lastFiredMinute || {}; // habitId -> 'YYYY-MM-DD:HH:MM'
    state.meta.alarmRuntime._lastFiredDayByHabit = state.meta.alarmRuntime._lastFiredDayByHabit || {}; // habitId -> 'YYYY-MM-DD'
    state.meta.alarmRuntime._snoozeOverride = state.meta.alarmRuntime._snoozeOverride || null;

    const tick = () => {
      try {
        const now = new Date();
        const curHHMM = hhmmNow(now);
        const minuteKey = `${todayKey(now)}:${curHHMM}`; // stable key (YYYY-MM-DD:HH:MM)




        // snooze override: temporarily fire based on override hhmm
        const override = state.meta.alarmRuntime._snoozeOverride;
        if (override && override.hhmm === curHHMM) {
          const habit = state.habits.find((h) => h.id === override.habitId);
          if (habit && shouldTriggerAlarm(habit, now)) {
            // de-dupe same minute per habit
            const last = state.meta.alarmRuntime._lastFiredMinute[habit.id];
            if (last !== minuteKey) {
              state.meta.alarmRuntime._lastFiredMinute[habit.id] = minuteKey;
              state.meta.alarmRuntime.activeHabitId = habit.id;
              console.log('reminder matched', { habitName: habit.name, curHHMM });

              state.meta.alarmRuntime._modalOpen = true;
              stopAlarmAudio();
              playAlarmAudio(alarmSoundUrlForHabit(habit));
              openAlarmModal(els, habit);
              override._used = true;
            }
          }
          return;
        }

        // normal triggers
        for (const habit of state.habits || []) {
          if (!habit?.alarmTime) continue;

        // catch-up trigger with grace window (allow up to 10 minutes late)
          const [hhStr, mmStr] = habit.alarmTime.split(':');
          const hh = Number(hhStr);
          const mm = Number(mmStr);
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;

          const scheduled = new Date(now);
          scheduled.setHours(hh, mm, 0, 0);

          const lateMs = now.getTime() - scheduled.getTime();
          const graceMs = 10 * 60 * 1000;

          // only trigger after scheduled time, up to grace window
          if (!(lateMs >= 0 && lateMs <= graceMs)) continue;

          const dayKeyForFired = todayKey(now);
          const lastDay = state.meta.alarmRuntime._lastFiredDayByHabit[habit.id];
          if (lastDay === dayKeyForFired) continue;

          const last = state.meta.alarmRuntime._lastFiredMinute[habit.id];
          if (last === minuteKey) continue;


          // Prevent firing right after add: require at least 60s elapsed since creation.
          const createdAt = safeNumber(habit.createdAt, 0);
          if (createdAt && now.getTime() - createdAt < 60 * 1000) continue;

          state.meta.alarmRuntime._lastFiredMinute[habit.id] = minuteKey;
          state.meta.alarmRuntime.activeHabitId = habit.id;

          state.meta.alarmRuntime._modalOpen = true;
          stopAlarmAudio();
          playAlarmAudio(alarmSoundUrlForHabit(habit));
          openAlarmModal(els, habit);
          break;
        }
      } catch {
        // ignore
      }
    };

    tick();
    alarmTimerHandle = setInterval(tick, ALARM_CHECK_MS);
  }

  function bindAlarmButtons(els) {
    els.alarmStopBtn?.addEventListener('click', () => {
      stopAlarmOccurrence(els);
    });

    els.alarmSnoozeBtn?.addEventListener('click', () => {
      snoozeAlarmOccurrence(els);
      state.meta.alarmRuntime._modalOpen = false;
    });

    const xBtn = $('alarmModalCloseBtn') || els.alarmModal?.querySelector('#alarmModalCloseBtn');
    xBtn?.addEventListener('click', () => {
      state.meta.alarmRuntime._snoozeOverride = null;
      state.meta.alarmRuntime._modalOpen = false;
      stopAlarmOccurrence(els);
    });

    // when modal is closed by any means, allow triggers again
    if (els.alarmModal) {
      const mo = new MutationObserver(() => {
        if (!els.alarmModal.classList.contains('is-open')) {
          state.meta.alarmRuntime._modalOpen = false;
        }
      });
      mo.observe(els.alarmModal, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (els.alarmModal && els.alarmModal.classList.contains('is-open')) {
        state.meta.alarmRuntime._snoozeOverride = null;
        state.meta.alarmRuntime._modalOpen = false;
        stopAlarmOccurrence(els);
      }
    });
  }

  // =============================
  // Habits create/update
  // =============================

  function addHabit({ name, targetDays, alarmTimeHHMM, alarmSound, alarmWeekdaysSelected }) {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    const aSound = Math.max(1, Math.min(4, Number(alarmSound) || 1));

    const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const picked = Array.isArray(alarmWeekdaysSelected) ? alarmWeekdaysSelected : null;
    const alarmWeekdays = picked && picked.length ? picked.filter((d) => allWeekdays.includes(d)) : allWeekdays;

    state.habits.unshift({
      id,
      name,
      targetDays,
      createdAt: Date.now(),
      history: {},
      alarmTime: normalizeAlarmTimeToHHMM(alarmTimeHHMM),
      alarmSound: aSound,
      alarmWeekdaysSelected: alarmWeekdays,
    });

    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
    save();
  }


  function clearWeek(els) {
    const keys = weekKeys();
    for (const habit of state.habits) {
      if (!habit.history) habit.history = {};
      for (const k of keys) {
        // XP is derived from habit history, so week/month resets don't need special XP adjustments.
        delete habit.history[k];

      }
    }
    save();
    state._dirtyViews.weekly = true;
    renderWeekly(els);
    // also refresh dashboard meta if user is currently there
    if (els.currentView === 'dashboard') {
      renderDashboard(els);
      renderXpUi(els);
    }
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

  function setStatusForMonthUI(habitId, dateKey, status) {
    setStatusForMonth(habitId, dateKey, status);
  }

  // =============================
  // XP / Levels helpers (non-alarm)
  // =============================

  // Legacy ledger-based XP functions (kept as no-ops to avoid runtime errors).
  function ensureXpLedgerEntry() {}
  function recomputeXpTotalFromLedger() {}
  function syncXpForStatusChange() {}
  function removeXpForStatus() {}



  function resolveLevelUiFromXp(els) {
    // renderXpUi already updates both XP bar and level badge
    renderXpUi(els);
  }

  // =============================
  // Wiring
  // =============================


  function bindEvents(els) {
    // navigation
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

    els.menuBtn?.addEventListener('click', () => {
      if (!els.mobileNav) return;
      const isOpen = els.mobileNav.classList.toggle('is-open');
      els.menuBtn?.setAttribute('aria-expanded', String(isOpen));
    });

    els.newHabitBtn?.addEventListener('click', () => openModal(els));
    els.closeModalBtn?.addEventListener('click', () => closeModal(els));
    els.cancelModalBtn?.addEventListener('click', () => closeModal(els));
    els.habitModal?.addEventListener('click', (e) => {
      if (e.target === els.habitModal) closeModal(els);
    });

    els.openTrashBtn?.addEventListener('click', () => {
      state._dirtyViews = state._dirtyViews || {};
      state._dirtyViews.trash = true;
      load();
      showView('trash', els);
      renderTrash(els);
    });

    els.clearWeekBtn?.addEventListener('click', () => clearWeek(els));

    els.monthPrevBtn?.addEventListener('click', () => {
      const anchor = getSelectedMonthAnchor();
      setSelectedMonthByAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
      state._dirtyViews.monthly = true;
      renderMonthly(els);
    });

    els.monthNextBtn?.addEventListener('click', () => {
      const anchor = getSelectedMonthAnchor();
      setSelectedMonthByAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
      state._dirtyViews.monthly = true;
      renderMonthly(els);
    });

    els.clearAllBtn?.addEventListener('click', () => {
      if (!confirm('Delete all habits and history stored in this browser?')) return;
      state = getDefaultState();
      save();
      showView('dashboard', els);
      renderDashboard(els);
    });

    // Add habit submit
    els.habitForm?.addEventListener('submit', (e) => {
      e.preventDefault();

      const readSelectValue = (el) => (el && typeof el.value !== 'undefined' ? String(el.value) : '');

      const h = readSelectValue(els.habitReminderHourInput);
      const m = readSelectValue(els.habitReminderMinuteInput);
      const ampm = readSelectValue(els.habitReminderAmPmInput);

      const name = els.habitNameInput ? els.habitNameInput.value.trim() : '';
      const targetDays = safeNumber(els.habitTargetInput?.value, 7);
      if (!name) return;

      const alarmTimeHHMM = parseTimeFromUIToHHMM({ hVal: h, mVal: m, ampmVal: ampm });
      const alarmSound =
        els.alarmSound1Input && els.alarmSound1Input.checked
          ? 1
          : els.alarmSound2Input && els.alarmSound2Input.checked
            ? 2
            : els.alarmSound3Input && els.alarmSound3Input.checked
              ? 3
              : els.alarmSound4Input && els.alarmSound4Input.checked
                ? 4
                : 1;

      const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const getSelectedWeekdaysFromUi = () => {
        if (!els.habitReminderDaysWrap) return [];
        const cbs = els.habitReminderDaysWrap.querySelectorAll('input[type="checkbox"][data-day]');
        const out = [];
        cbs.forEach((cb) => {
          if (!cb.checked) return;
          const dn = cb.getAttribute('data-day');
          if (dn && allWeekdays.includes(dn)) out.push(dn);
        });
        return out;
      };

      // Persist weekdays for Specific Days.
      // Default for missing/empty selections = all days (Daily behavior).
      const alarmWeekdaysSelected = (() => {
        const typeSpecific = els.habitReminderTypeSpecificInput && els.habitReminderTypeSpecificInput.checked;
        if (!typeSpecific) return allWeekdays;

        const picked = getSelectedWeekdaysFromUi();
        return picked.length ? picked : allWeekdays;
      })();

      addHabit({
        name,
        targetDays: Math.max(1, Math.min(7, targetDays)),
        alarmTimeHHMM,
        alarmSound,
        alarmWeekdaysSelected,
      });


      closeModal(els);
      renderDashboard(els);
    });


    // main list actions
    els.habitList?.addEventListener('click', (e) => {
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
          setStatusForMonthUI(habitId, tKey, status);
        } else {
          habit.history = habit.history || {};
          const previous = habit.history[tKey];
          habit.history[tKey] = status;

          // Streak is based only on activity dates (at least one habit marked done).
          // Unchecking must NOT remove a date from streak history.
          if (status === 'done' && previous !== 'done') {
            ensureStateShape();
            const dk = todayKey();
            const list = Array.isArray(state.meta.streakHistory) ? state.meta.streakHistory : [];
            if (!list.includes(dk)) {
              list.push(dk);
              list.sort();
              state.meta.streakHistory = list;
            }
          }

          // XP derived from habit history; no ledger updates needed.
          void previous;
          save();

        }


        if (view === 'dashboard') renderDashboard(els);
        else if (view === 'weekly') renderWeekly(els);
        else if (view === 'monthly') renderMonthly(els);

        renderXpUi(els);
      }
    });

    // trash actions
    els.trashConfirmCloseBtn?.addEventListener('click', () => closeTrashConfirmModal(els));
    els.trashConfirmCancelBtn?.addEventListener('click', () => closeTrashConfirmModal(els));

    els.trashConfirmMoveBtn?.addEventListener('click', () => {
      const pending = state._pendingTrashDelete;
      closeTrashConfirmModal(els);
      if (!pending?.habitId) return;
      moveHabitToTrash(pending.habitId);
      renderDashboard(els);
      renderTrash(els);
    });

    els.trashPermanentCloseBtn?.addEventListener('click', () => closeTrashPermanentModal(els));
    els.trashPermanentCancelBtn?.addEventListener('click', () => closeTrashPermanentModal(els));

    els.trashPermanentDeleteBtn?.addEventListener('click', () => {
      const pending = state._pendingTrashPermanent;
      closeTrashPermanentModal(els);
      if (!pending?.habitId) return;
      deleteHabitPermanently(pending.habitId);
      renderTrash(els);
    });

    els.trashList?.addEventListener('click', (e) => {
      const btn = e.target;
      const action = btn?.dataset?.action;
      const habitId = btn?.dataset?.habitId;
      if (!action || !habitId) return;

      if (action === 'restoreHabit') {
        restoreHabitFromTrash(habitId);
        renderDashboard(els);
        renderTrash(els);
      }

      if (action === 'permDeleteHabit') {
        openTrashPermanentModal(els, habitId);
      }
    });

    // Alarm buttons
    bindAlarmButtons(els);
  }

  function openModal(els) {
    if (!els.habitModal) return;
    els.habitModal.classList.add('is-open');
    els.habitModal.setAttribute('aria-hidden', 'false');
    els.habitNameInput?.focus();
  }

  function closeModal(els) {
    if (!els.habitModal) return;
    els.habitModal.classList.remove('is-open');
    els.habitModal.setAttribute('aria-hidden', 'true');

    els.habitForm?.reset();
    if (els.habitTargetInput) els.habitTargetInput.value = 7;

    if (els.habitReminderTypeDailyInput) els.habitReminderTypeDailyInput.checked = true;
    if (els.habitReminderDaysWrap) {
      els.habitReminderDaysWrap.style.display = 'none';
      const cbs = els.habitReminderDaysWrap.querySelectorAll('input[type="checkbox"]');
      cbs.forEach((cb) => (cb.checked = false));
    }
  }

  function syncReminderTypeUi(els) {

    if (!els.habitReminderDaysWrap) return;
    const typeSpecific = els.habitReminderTypeSpecificInput && els.habitReminderTypeSpecificInput.checked;
    els.habitReminderDaysWrap.style.display = typeSpecific ? 'block' : 'none';
  }


  function bindReminderTypeUi(els) {
    els.habitReminderTypeDailyInput?.addEventListener('change', () => {
      syncReminderTypeUi(els);
    });
    els.habitReminderTypeSpecificInput?.addEventListener('change', () => {
      syncReminderTypeUi(els);
    });
  }

  function init() {

    // Ensure weekday picker matches current default (Specific Days => visible)
    // after modal open/reset.

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
      monthlyTable: $('monthlyTable'),
      monthPrevBtn: $('monthPrevBtn'),
      monthNextBtn: $('monthNextBtn'),
      clearMonthBtn: $('clearMonthBtn'),

      clearAllBtn: $('clearAllBtn'),

      habitModal: $('habitModal'),
      habitForm: $('habitForm'),
      habitNameInput: $('habitNameInput'),
      habitTargetInput: $('habitTargetInput'),
      habitReminderHourInput: $('habitReminderHourInput'),
      habitReminderMinuteInput: $('habitReminderMinuteInput'),
      habitReminderAmPmInput: $('habitReminderAmPmInput'),
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
      openTrashBtn: $('openTrashBtn'),

      trashConfirmModal: $('trashConfirmModal'),
      trashConfirmCloseBtn: $('trashConfirmCloseBtn'),
      trashConfirmCancelBtn: $('trashConfirmCancelBtn'),
      trashConfirmMoveBtn: $('trashConfirmMoveBtn'),

      trashPermanentModal: $('trashPermanentModal'),
      trashPermanentCloseBtn: $('trashPermanentCloseBtn'),
      trashPermanentCancelBtn: $('trashPermanentCancelBtn'),
      trashPermanentDeleteBtn: $('trashPermanentDeleteBtn'),

      fatalErrorEl: null,

      alarmModal: $('alarmModal'),
      alarmHabitName: $('alarmHabitName'),
      alarmHabitNameInline: $('alarmHabitNameInline'),
      alarmStopBtn: $('alarmStopBtn'),
      alarmSnoozeBtn: $('alarmSnoozeBtn'),

      missedWarningEl: $('missedWarning'),
      currentView: 'dashboard',
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
    bindReminderTypeUi(els);

    load();
    ensureStateShape();

    // Default the reminder picker visibility on load/open.
    syncReminderTypeUi(els);


    showView('dashboard', els);
    renderDashboard(els);

    startAlarmScheduler(els);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

