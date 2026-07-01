


(() => {
  'use strict';

  const STORAGE_KEY = 'habitTracker.v1';
  const STORAGE_MIGRATION_VERSION = 3;

  const XP = { completeHabit: 10 };

  // --- Firebase compat ensure (TOP LEVEL, before app boot) ---
  // Compat-only Firebase bootstrap. Never use modular initializeApp/getAuth/getFirestore here.
  function ensureFirebaseCompatReady() {
    try {
      const fb = window.firebase;
      const cfg = window.firebaseConfig || window.FIREBASE_CONFIG || window.firebaseCfg;

      if (!fb || typeof fb.initializeApp !== 'function' || !cfg) {
        window.FIREBASE_READY = false;
        return false;
      }

      if (!Array.isArray(fb.apps)) fb.apps = [];
      if (fb.apps.length === 0) fb.initializeApp(cfg);

      window.auth = typeof fb.auth === 'function' ? fb.auth() : null;
      window.db = typeof fb.firestore === 'function' ? fb.firestore() : null;
      window.FIREBASE_READY = fb.apps.length > 0;

      return window.FIREBASE_READY;
    } catch (err) {
      window.FIREBASE_READY = false;
      try {
        console.warn('[firebase compat] init failed:', err);
      } catch {}
      return false;
    }
  }

  window.ensureFirebaseCompatReady = ensureFirebaseCompatReady;
  ensureFirebaseCompatReady();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureFirebaseCompatReady, { once: true });
  } else {
    ensureFirebaseCompatReady();
  }
  window.addEventListener?.('load', ensureFirebaseCompatReady, { once: true });

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

  // --- Auth overlay helpers (single global source of truth) ---
  function getAuthOverlay() {
    return document.getElementById('authOverlay');
  }

  function openAuthOverlay() {
    const overlayEl = getAuthOverlay();
    if (!overlayEl) return;

    overlayEl.hidden = false;
    overlayEl.style.display = '';
    overlayEl.classList.remove('hidden');
    overlayEl.classList.add('is-open');
    overlayEl.setAttribute('aria-hidden', 'false');

    const backdropEl = document.getElementById('authOverlayBackdrop');
    if (backdropEl) backdropEl.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      const first = overlayEl.querySelector(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
      );
      if (first && typeof first.focus === 'function') {
        try {
          first.focus({ preventScroll: true });
        } catch {
          first.focus();
        }
      }
    }, 0);
  }

  function closeAuthOverlay() {
    const overlayEl = getAuthOverlay();
    if (!overlayEl) return;

    if (overlayEl.contains(document.activeElement)) {
      try {
        document.activeElement.blur();
      } catch {}
    }

    overlayEl.classList.remove('is-open');
    overlayEl.classList.add('hidden');
    overlayEl.setAttribute('aria-hidden', 'true');

    const backdropEl = document.getElementById('authOverlayBackdrop');
    if (backdropEl) backdropEl.setAttribute('aria-hidden', 'true');
  }

  window.getAuthOverlay = getAuthOverlay;
  window.openAuthOverlay = openAuthOverlay;
  window.closeAuthOverlay = closeAuthOverlay;
  window.openOverlay = openAuthOverlay;
  window.closeOverlay = closeAuthOverlay;
  const openOverlay = openAuthOverlay;
  const closeOverlay = closeAuthOverlay;

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
        // Persisted per-habit STOP dismissal state for “today”
        // habitAlarmDismissals[habitId] = YYYY-MM-DD
        habitAlarmDismissals: {},
      },
      _dirtyViews: { weekly: true, monthly: true, trash: true },
    };
  }

  function normalizeAlarmTimeToHHMM(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;

    // HH:MM 24h
    const m24 = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (m24) return `${String(Number(m24[1])).padStart(2, '0')}:${m24[2]}`;

    // 12h with AM/PM like 02:00 PM
    const m12 = s.match(/^(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM)$/i);
    if (m12) {
      const hh12 = safeNumber(m12[1], NaN);
      const mm = safeNumber(m12[2], NaN);
      if (!Number.isFinite(hh12) || !Number.isFinite(mm)) return null;
      const ampm = String(m12[3]).toUpperCase();
      let hh24 = hh12 % 12;
      if (ampm === 'PM') hh24 += 12;
      return `${String(hh24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    return null;
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
      const normalizedAlarmTime = normalizeAlarmTimeToHHMM(legacyTime);
      out.alarmTime = normalizedAlarmTime;

      const legacySound = out.alarmSound ?? out.reminderSound ?? out.alarmSound ?? 1;
      const v = Number.isFinite(Number(legacySound)) ? Number(legacySound) : 1;
      out.alarmSound = Math.max(1, Math.min(4, v));

      // alarmEnabled migration:
      // - if existing valid alarmTime => alarmEnabled = true
      // - if no alarmTime => alarmEnabled = false
      if (typeof out.alarmEnabled !== 'boolean') {
        out.alarmEnabled = normalizedAlarmTime ? true : false;
      } else {
        out.alarmEnabled = out.alarmEnabled;
      }

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

      // Normalize persisted alarms on every load to enforce invariants:
      // - valid => HH:MM string
      // - no reminder => null
      // - alarmEnabled always boolean
      for (const habit of state.habits || []) {
        if (!habit || typeof habit !== 'object') continue;
        const normalized = normalizeAlarmTimeToHHMM(habit.alarmTime);
        habit.alarmTime = normalized;
        if (typeof habit.alarmEnabled !== 'boolean') {
          habit.alarmEnabled = normalized ? true : false;
        }
        if (!normalized) habit.alarmEnabled = false;
      }


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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

        // Reminder indicator (UI-only)
        // Show only when habit has a *valid* alarmTime saved as HH:MM (24h).
        // If alarmEnabled is ON => 🔔 time, OFF => 🔕 time.
        const alarmTime = habit?.alarmTime;
        const isAlarmEnabled = habit?.alarmEnabled === true;

        if (typeof alarmTime === 'string' && alarmTime.trim() && /^\d{2}:\d{2}$/.test(alarmTime)) {

          const alarmEl = document.createElement('div');

          alarmEl.style.marginTop = '2px';
          alarmEl.style.fontSize = '12px';
          alarmEl.style.color = 'rgba(232,238,252,.85)';
          alarmEl.style.fontWeight = '900';

          const [hhStr, mmStr] = alarmTime.split(':');
          const hh = Number(hhStr);
          const mm = Number(mmStr);
          const ampm = hh >= 12 ? 'PM' : 'AM';
          const hh12 = ((hh % 12) || 12);
          const mm2 = String(mm).padStart(2, '0');

          alarmEl.textContent = `${habit?.alarmEnabled === true ? '🔔' : '🔕'} ${hh12}:${mm2} ${ampm}`;

          left.appendChild(alarmEl);
        }

        // Reminder Box + Floating menu (ONE compact reminder element per card)
        // ====== Mobile/target alarm UI: circular bell + popover (bell-only controls) ======
        const alarmTimeValid = typeof habit.alarmTime === 'string' && /^\d{2}:\d{2}$/.test(habit.alarmTime);
        const alarmEnabled = habit?.alarmEnabled === true;

        const parseAlarm12h = (hhmm) => {
          if (!hhmm || typeof hhmm !== 'string') return { timeLabel: '', hh24: 0, mm: 0 };
          const [hhStr, mmStr] = hhmm.split(':');
          const hh24 = Number(hhStr);
          const mm = Number(mmStr);
          if (!Number.isFinite(hh24) || !Number.isFinite(mm)) return { timeLabel: '', hh24: 0, mm: 0 };
          const ampm = hh24 >= 12 ? 'PM' : 'AM';
          const hh12 = (hh24 % 12) || 12;
          const mm2 = String(mm).padStart(2, '0');
          return { timeLabel: `${hh12}:${mm2} ${ampm}`, hh24, mm };
        };

        const alarm12 = parseAlarm12h(habit.alarmTime);

        // Move habit name + meta under left time row
        left.appendChild(name);
        left.appendChild(meta);


        // Right actions: bell, ✓, ✕, 🗑 (no popovers except bell)
        const actionsRight = document.createElement('div');
        actionsRight.className = 'habit-actions';
        actionsRight.style.gap = '8px';
        actionsRight.style.display = 'flex';
        actionsRight.style.alignItems = 'center';
        actionsRight.style.flexDirection = 'row';

        // Bell
        const bellBtn = document.createElement('button');
        bellBtn.type = 'button';
        bellBtn.className = 'alarm-bell-btn';
        bellBtn.dataset.action = 'toggleAlarmPopover';
        bellBtn.dataset.habitId = habit.id;

        const bellIcon = document.createElement('div');
        bellIcon.className = 'alarm-bell-icon';
        bellIcon.textContent = alarmTimeValid ? (alarmEnabled ? '🔔' : '🔕') : '+';
        bellBtn.appendChild(bellIcon);

        const bellTime = document.createElement('div');
        bellTime.className = 'alarm-bell-time';
        bellTime.textContent = alarmTimeValid ? alarm12.timeLabel : '';
        bellBtn.appendChild(bellTime);

        if (alarmEnabled) bellBtn.classList.add('is-enabled');
        else if (alarmTimeValid) bellBtn.classList.add('is-disabled');

        // Popover
        const pop = document.createElement('div');
        pop.className = 'alarm-bell-popover';
        pop.style.display = 'none';
        pop.dataset.habitId = habit.id;

        const ensureTimePickerDefaults = () => {
          const now = new Date();
          let hh24 = now.getHours();
          let mm = now.getMinutes();
          const ampm = hh24 >= 12 ? 'PM' : 'AM';
          const hh12 = (hh24 % 12) || 12;
          return { hh12, mm2: String(mm).padStart(2, '0'), ampm };
        };

        const initialPicker = (() => {
          if (!alarmTimeValid) return ensureTimePickerDefaults();
          const { hh24, mm } = parseAlarm12h(habit.alarmTime);
          const ampm = hh24 >= 12 ? 'PM' : 'AM';
          const hh12 = (hh24 % 12) || 12;
          return { hh12, mm2: String(mm).padStart(2, '0'), ampm };
        })();

        let pickerHourVal = String(initialPicker.hh12).padStart(2, '0');
        let pickerMinuteVal = String(initialPicker.mm2).padStart(2, '0');
        let pickerAmPmVal = initialPicker.ampm;

        const popContentHead = document.createElement('div');
        popContentHead.className = 'alarm-bell-popover-head';
        popContentHead.textContent = 'Alarm';
        pop.appendChild(popContentHead);

        const mkRowBtn = (label, onClick) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'alarm-bell-rowbtn';
          b.textContent = label;
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onClick();
          });
          return b;
        };

        let pickerExpanded = false;
        const setPickerVisible = (v) => {
          pickerExpanded = v;
          pickerWrap.classList.toggle('is-hidden', !v);
        };

        const onActivate = () => {
          habit.alarmEnabled = true;
          save();
          renderDashboard(els);
          // keep popover open per requirement
        };

        const onMute = () => {
          habit.alarmEnabled = false;
          save();
          renderDashboard(els);
          // keep popover open per requirement
        };

        const onEditTime = () => {
          setPickerVisible(true);
        };

        const onSave = () => {
          const hNum = Number(pickerHourSelect.value);
          const mNum = Number(pickerMinuteSelect.value);
          const ampm = pickerAmPmSelect.value;
          let hh24 = (hNum % 12);
          if (ampm === 'PM') hh24 += 12;
          const hhmm = `${String(hh24).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`;

          habit.alarmTime = hhmm;
          habit.alarmEnabled = true;
          save();
          // close popover
          hideBellPopover();
          scheduleNextExactAlarm(els);
          renderDashboard(els);
        };

        pop.appendChild(mkRowBtn('🟢 ON', onActivate));
        pop.appendChild(mkRowBtn('🔴 MUTE', onMute));

        const divider1 = document.createElement('div');

        divider1.className = 'alarm-bell-divider';
        pop.appendChild(divider1);

        pop.appendChild(mkRowBtn('✏️ RESCHEDULE', onEditTime));
        pop.appendChild(mkRowBtn('💾 SAVE CHANGES', onSave));

        const pickerWrap = document.createElement('div');
        pickerWrap.className = 'alarm-bell-picker is-hidden';

        const pickerGrid = document.createElement('div');
        pickerGrid.className = 'alarm-bell-timepicker-grid';

        const hourLabel = document.createElement('label');
        hourLabel.textContent = 'Hour';

        const pickerHourSelect = document.createElement('select');
        pickerHourSelect.className = 'alarm-bell-select alarm-bell-hour';
        for (let i = 1; i <= 12; i++) {
          const opt = document.createElement('option');
          opt.value = String(i).padStart(2, '0');
          opt.textContent = String(i).padStart(2, '0');
          pickerHourSelect.appendChild(opt);
        }
        pickerHourSelect.value = pickerHourVal;

        const minuteLabel = document.createElement('label');
        minuteLabel.textContent = 'Minute';

        const pickerMinuteSelect = document.createElement('select');
        pickerMinuteSelect.className = 'alarm-bell-select alarm-bell-minute';
        for (let i = 0; i <= 59; i++) {
          const opt = document.createElement('option');
          opt.value = String(i).padStart(2, '0');
          opt.textContent = String(i).padStart(2, '0');
          pickerMinuteSelect.appendChild(opt);
        }
        pickerMinuteSelect.value = pickerMinuteVal;

        pickerGrid.appendChild(hourLabel);
        pickerGrid.appendChild(pickerHourSelect);
        pickerGrid.appendChild(minuteLabel);
        pickerGrid.appendChild(pickerMinuteSelect);

        const ampmRow = document.createElement('div');
        ampmRow.className = 'alarm-bell-ampm';

        const pickerAmPmSelect = document.createElement('input');
        pickerAmPmSelect.type = 'hidden';
        pickerAmPmSelect.value = pickerAmPmVal;

        const amBtn = document.createElement('button');
        amBtn.type = 'button';
        amBtn.textContent = 'AM';
        amBtn.className = 'is-on';
        const pmBtn = document.createElement('button');
        pmBtn.type = 'button';
        pmBtn.textContent = 'PM';

        const syncAmpmBtns = () => {
          const v = pickerAmPmSelect.value;
          amBtn.classList.toggle('is-on', v === 'AM');
          pmBtn.classList.toggle('is-on', v === 'PM');
        };
        amBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          pickerAmPmSelect.value = 'AM';
          syncAmpmBtns();
        });
        pmBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          pickerAmPmSelect.value = 'PM';
          syncAmpmBtns();
        });

        syncAmpmBtns();

        ampmRow.appendChild(amBtn);
        ampmRow.appendChild(pmBtn);
        pickerWrap.appendChild(pickerGrid);
        pickerWrap.appendChild(ampmRow);

        pop.appendChild(pickerWrap);

        // external handlers for popover open/close
        function hideBellPopover() {
          if (state?.meta?.alarmRuntime) {
            state.meta.alarmRuntime._openBellPopoverEl = null;
          }
          pop.style.display = 'none';
        }

        function showBellPopover() {
          // close any other open
          const other = state?.meta?.alarmRuntime?._openBellPopoverEl;
          if (other && other !== pop) {
            other.style.display = 'none';
          }
          if (state?.meta?.alarmRuntime) state.meta.alarmRuntime._openBellPopoverEl = pop;
          pop.style.display = 'block';

          // position anchored to bell button
          const rect = bellBtn.getBoundingClientRect();
          const vw = window.innerWidth;
          const popW = Math.min(320, vw - 24);
          const left = Math.max(8, Math.min(vw - popW - 8, rect.left + rect.width / 2 - popW / 2));
          const top = rect.bottom + 8;

          // prefer bottom-center; if not enough space, flip above
          const neededBottom = top + 260;
          const maxY = window.innerHeight - 8;
          const finalTop = neededBottom > maxY ? rect.top - 8 : top;

          pop.style.left = `${left}px`;
          pop.style.top = `${finalTop}px`;
        }

        // Click bell toggles popover
        bellBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const isOpen = pop.style.display === 'block';
          if (isOpen) {
            hideBellPopover();
            return;
          }
          showBellPopover();
        });

        // Outside/ESC close
        const outsideClose = (ev) => {
          const target = ev.target;
          if (pop.contains(target) || bellBtn.contains(target)) return;
          hideBellPopover();
        };

        const escClose = (ev) => {
          if (ev.key !== 'Escape') return;
          hideBellPopover();
        };

        // Attach only once per popover lifetime; store marker on pop element
        if (!pop.__outsideCloseBound) {
          pop.__outsideCloseBound = true;
          document.addEventListener('pointerdown', outsideClose, { passive: true });
          document.addEventListener('keydown', escClose);
        }

        actionsRight.appendChild(bellBtn);

      // ✓ / ✕ / 🗑 (do NOT open popover)
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'check-btn';
        doneBtn.textContent = '✓';
        if (status === 'done') doneBtn.classList.add('is-done');
        doneBtn.dataset.action = 'setStatus';
        doneBtn.dataset.status = 'done';

        const ndBtn = document.createElement('button');
        ndBtn.type = 'button';
        ndBtn.className = 'check-btn';
        ndBtn.textContent = '✕';
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

        actionsRight.appendChild(doneBtn);
        actionsRight.appendChild(ndBtn);
        actionsRight.appendChild(delBtn);

        item.appendChild(left);
        item.appendChild(actionsRight);
        item.appendChild(pop);

        frag.appendChild(item);

        // Skip old actions rendering below
        continue;

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

  function computeActiveHabitsAnalytics() {
    // Single source of truth: ONLY currently active habits in state.habits
    const keys = weekKeys();
    const habits = state.habits || [];

    // Weekly chart series
    const dayCompleted = keys.map(() => 0);
    const dayNotDone = keys.map(() => 0);
    const dayExplicitCounts = keys.map(() => 0); // done + not_done

    let bestHabit = null;

    // Today-based totals for the dashboard analytics cards
    const tKey = todayKey();
    let totalDone = 0;
    let totalNotDone = 0;

    for (const habit of habits) {
      // Today totals
      const todayStatus = habit.history?.[tKey];
      if (todayStatus === 'done') totalDone++;
      else if (todayStatus === 'not_done') totalNotDone++;

      // Weekly chart aggregation + best habit based on explicit tracked days (existing behavior)
      let habitDone = 0;
      let habitExplicit = 0;

      for (let i = 0; i < keys.length; i++) {
        const dateKey = keys[i];
        const status = habit.history?.[dateKey];

        if (status === 'done') {
          dayCompleted[i]++;
          dayExplicitCounts[i]++;
          habitDone++;
          habitExplicit++;
        } else if (status === 'not_done') {
          dayNotDone[i]++;
          dayExplicitCounts[i]++;
          habitExplicit++;
        }
      }

      if (habitExplicit > 0) {
        const pct = habitDone / habitExplicit;
        if (
          !bestHabit ||
          pct > bestHabit.pct ||
          (pct === bestHabit.pct && habitDone > bestHabit.done)
        ) {
          bestHabit = { name: habit.name, pct, done: habitDone };
        }
      }
    }

    const totalHabitCount = habits.length;

    // “Missed” (yellow): for analytics cards, missed means *today* has no explicit status.
    const totalMissed = Math.max(0, totalHabitCount - (totalDone + totalNotDone));

    // Weekly chart missed bars keep the existing semantics (only compute if day has explicit activity)
    const dayHasExplicitActivity = dayExplicitCounts.map((v) => v > 0);
    const dayMissed = dayExplicitCounts.map((explicit, i) => {
      if (!dayHasExplicitActivity[i]) return 0;
      return Math.max(0, totalHabitCount - explicit);
    });

    // Completion percentage for analytics cards: done / total habits (today-based)
    const completionPct = totalHabitCount ? Math.round((totalDone / totalHabitCount) * 100) : 0;

    const hasAnyWeeklyData =
      dayCompleted.some((v) => v > 0) ||
      dayNotDone.some((v) => v > 0) ||
      dayMissed.some((v) => v > 0);

    return {
      keys,
      totalDone,
      totalNotDone,
      totalMissed,
      bestHabitName: bestHabit ? bestHabit.name : '—',
      completionPct,
      dayCompleted,
      dayNotDone,
      dayMissed,
      hasAnyWeeklyData,
    };
  }


  function refreshDashboardAnalyticsIfVisible(els) {
    // Ensure no cached/stale analytics: always recompute.
    if (!els || els.currentView !== 'dashboard') return;
    renderAnalytics(els);
  }

  function renderAnalytics(els) {
    if (
      !els.analyticsTotalCompletedEl ||
      !els.analyticsMissedHabitsEl ||
      !els.analyticsBestHabitEl ||
      !els.analyticsCompletionPctEl ||
      !els.completionPillEl ||
      !els.weeklyBarsEl
    )
      return;


    const data = computeActiveHabitsAnalytics();

    els.analyticsTotalCompletedEl.textContent = String(data.totalDone);
    // Your “Missed habits” metric should count only the yellow “no explicit status” category.
    els.analyticsMissedHabitsEl.textContent = String(data.totalMissed);
    // “Not completed” should be explicit not_done across the week.
    // Keep “Not completed” aligned with explicit not_done across the week.
    if (els.analyticsNotCompletedHabitsEl) els.analyticsNotCompletedHabitsEl.textContent = String(data.totalNotDone);


    els.analyticsBestHabitEl.textContent = data.bestHabitName;

    els.analyticsCompletionPctEl.textContent = `${data.completionPct}%`;

    els.completionPillEl.textContent = `${data.completionPct}% completion`;


    const keys = data.keys;
    const dayCompleted = data.dayCompleted;
    const dayNotDone = data.dayNotDone;
    const dayMissed = data.dayMissed;

    els.weeklyBarsEl.innerHTML = '';

    if (!data.hasAnyWeeklyData) {
      const empty = document.createElement('div');
      empty.className = 'weekly-chart-empty';
      empty.textContent = 'No weekly data available';
      els.weeklyBarsEl.appendChild(empty);
      return;
    }

    // Build plot + legend as separate vertical blocks to prevent overlap and layout squashing.
    const plotEl = document.createElement('div');
    plotEl.style.width = '100%';
    plotEl.style.flex = '1 1 auto';
    const legendHost = document.createElement('div');
    legendHost.style.width = '100%';

    els.weeklyBarsEl.appendChild(plotEl);
    els.weeklyBarsEl.appendChild(legendHost);

    const width = 640;
    const height = 260;

    const pad = { l: 44, r: 16, t: 18, b: 44 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;

    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const maxCount = Math.max(1, ...keys.map((_, i) => dayCompleted[i] + dayNotDone[i] + dayMissed[i]));

    // Isometric faux-3D geometry (SVG only)
    const groupW = plotW / 7;

    // Tile footprint sizes tuned for mobile legibility
    const tileW = Math.max(30, Math.min(58, groupW * 0.76));
    const tileH = Math.max(14, Math.min(28, groupW * 0.30));

    // Isometric projection: horizontal skew and vertical lift
    const isoDx = tileW * 0.32;
    const isoDy = tileH * 0.42;

    const baseY = pad.t + plotH;

    const colors = {
      done: 'rgba(34,197,94,.95)',
      notDone: 'rgba(239,68,68,.95)',
      missed: 'rgba(234,179,8,.95)',
      grid: 'rgba(255,255,255,.10)',
      // Face shadings (slight variation to imply depth while keeping category meaning)
      faceLeftAlpha: 0.92,
      faceRightAlpha: 0.86,
    };

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'weekly-progress-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Weekly progress bar chart');

    const wrap = document.createElement('div');
    wrap.className = 'weekly-chart-wrap';
    wrap.appendChild(svg);
    plotEl.appendChild(wrap);

    // Subtle grid for context (kept minimal to prevent 3D clutter)
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const gridSteps = 4;
    for (let s = 0; s <= gridSteps; s++) {
      const val = Math.round((maxCount * s) / gridSteps);
      const y = pad.t + (plotH * (maxCount - val)) / maxCount;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', pad.l);
      line.setAttribute('x2', pad.l + plotW);
      line.setAttribute('y1', y.toFixed(2));
      line.setAttribute('y2', y.toFixed(2));
      line.setAttribute('stroke', colors.grid);
      line.setAttribute('stroke-width', '1');
      gridGroup.appendChild(line);

      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', pad.l - 10);
      t.setAttribute('y', (y + 4).toFixed(2));
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('fill', 'rgba(232,238,252,.52)');
      t.setAttribute('font-size', '11');
      t.textContent = String(val);
      gridGroup.appendChild(t);
    }
    svg.appendChild(gridGroup);

    // Day labels under each tile (keeps existing comprehension anchors)
    for (let i = 0; i < 7; i++) {
      const cx = pad.l + groupW * i + groupW / 2;
      const lab = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lab.setAttribute('x', cx.toFixed(2));
      lab.setAttribute('y', (baseY + 26).toFixed(2));
      lab.setAttribute('text-anchor', 'middle');
      lab.setAttribute('fill', 'rgba(232,238,252,.75)');
      lab.setAttribute('font-size', '12');
      lab.textContent = dayLabels[i];
      svg.appendChild(lab);
    }

    function rgbaWithAlpha(rgba, alpha) {
      // expects rgba(r,g,b,a) form; fallback to original
      const m = rgba.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
      if (!m) return rgba;
      return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
    }

    function point(x, y) {
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }

    // Draw isometric stacked blocks per day
    for (let i = 0; i < 7; i++) {
      const completedVal = dayCompleted[i];
      const notDoneVal = dayNotDone[i];
      const missedVal = dayMissed[i];

      if (completedVal === 0 && notDoneVal === 0 && missedVal === 0) continue;

      // Tile center
      const cx = pad.l + groupW * i + groupW / 2;

      // Top/front plane anchor (bottom of isometric stack sits on baseY)
      // Convert values to vertical stack heights in SVG space
      const hDone = (plotH * completedVal) / maxCount;
      const hNotDone = (plotH * notDoneVal) / maxCount;
      const hMissed = (plotH * missedVal) / maxCount;

      // Minimum visible segment height to keep tiny values discoverable
      const minSeg = 1.5;
      const segDone = completedVal > 0 ? Math.max(minSeg, hDone) : 0;
      const segNotDone = notDoneVal > 0 ? Math.max(minSeg, hNotDone) : 0;
      const segMissed = missedVal > 0 ? Math.max(minSeg, hMissed) : 0;

      const totalSeg = segDone + segNotDone + segMissed;
      const yTop = baseY - totalSeg;

      // Isometric base footprint (a parallelogram)
      const leftBaseX = cx - tileW / 2;
      const rightBaseX = cx + tileW / 2;
      const frontBaseY = baseY;
      const backBaseY = baseY - isoDy;

      // We will render each segment as a block from current y cursor to next y cursor
      let cursorY = baseY;

      const segments = [
        { key: 'done', val: completedVal, color: colors.done, h: segDone },
        { key: 'notDone', val: notDoneVal, color: colors.notDone, h: segNotDone },
        { key: 'missed', val: missedVal, color: colors.missed, h: segMissed },
      ];

      for (const seg of segments) {
        if (seg.val <= 0) continue;

        const h = seg.h;
        const segBottomY = cursorY;
        const segTopY = cursorY - h;

        // Project top plane points for this layer
        const leftTopX = leftBaseX;
        const rightTopX = rightBaseX;

        const frontTopY = segTopY;
        const backTopY = segTopY - isoDy;

        // Top face polygon
        const topPoly = [
          point(cx - tileW / 2, segTopY),
          point(cx, segTopY - isoDy),
          point(cx + tileW / 2, segTopY),
          point(cx, segTopY + isoDy),
        ];

        // Left face polygon (a trapezoid)
        const leftPoly = [
          point(cx - tileW / 2, segBottomY),
          point(cx, segBottomY - isoDy),
          point(cx, frontTopY),
          point(cx - tileW / 2, frontTopY),
        ];

        // Right face polygon (mirror)
        const rightPoly = [
          point(cx, segBottomY - isoDy),
          point(cx + tileW / 2, segBottomY),
          point(cx + tileW / 2, frontTopY),
          point(cx, frontTopY),
        ];

        // Top highlight slightly lighter
        const topFill = seg.color;
        const leftFill = rgbaWithAlpha(seg.color, colors.faceLeftAlpha);
        const rightFill = rgbaWithAlpha(seg.color, colors.faceRightAlpha);

        // Top face (rendered as a polygon to avoid per-face occlusion)
        const topFace = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        topFace.setAttribute('points', topPoly.join(' '));
        topFace.setAttribute('fill', topFill);
        topFace.setAttribute('opacity', '0.92');
        topFace.setAttribute('stroke', 'rgba(255,255,255,.14)');
        topFace.setAttribute('stroke-width', '0.8');
        topFace.setAttribute('role', 'img');
        topFace.setAttribute(
          'aria-label',
          `${dayLabels[i]} ${seg.key === 'done' ? 'completed' : seg.key === 'notDone' ? 'not done' : 'missed'}: ${seg.val}`
        );
        svg.appendChild(topFace);

        const leftFace = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        leftFace.setAttribute('points', leftPoly.join(' '));
        leftFace.setAttribute('fill', leftFill);
        leftFace.setAttribute('opacity', '0.95');
        leftFace.setAttribute('stroke', 'rgba(255,255,255,.12)');
        leftFace.setAttribute('stroke-width', '0.8');
        leftFace.setAttribute('role', 'img');
        leftFace.setAttribute(
          'aria-label',
          `${dayLabels[i]} ${seg.key === 'done' ? 'completed' : seg.key === 'notDone' ? 'not done' : 'missed'}: ${seg.val}`
        );
        svg.appendChild(leftFace);

        const rightFace = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        rightFace.setAttribute('points', rightPoly.join(' '));
        rightFace.setAttribute('fill', rightFill);
        rightFace.setAttribute('opacity', '0.95');
        rightFace.setAttribute('stroke', 'rgba(255,255,255,.12)');
        rightFace.setAttribute('stroke-width', '0.8');
        rightFace.setAttribute('role', 'img');
        rightFace.setAttribute(
          'aria-label',
          `${dayLabels[i]} ${seg.key === 'done' ? 'completed' : seg.key === 'notDone' ? 'not done' : 'missed'}: ${seg.val}`
        );
        svg.appendChild(rightFace);

        cursorY = segTopY;
      }
    }


    const legend = document.createElement('div');
    legend.className = 'weekly-chart-legend';
    legend.style.display = 'flex';
    legend.style.gap = '14px';
    legend.style.marginTop = '2px';
    legend.style.flexWrap = 'wrap';
    legend.style.justifyContent = 'space-between';
    legend.style.alignItems = 'center';
    legend.style.padding = '0 6px';
    legend.innerHTML = `
      <span style="display:flex;align-items:center;gap:8px;color:rgba(232,238,252,.9);font-weight:900;font-size:12px;white-space:nowrap;">
        <span style="width:10px;height:10px;border-radius:3px;background:${colors.done};display:inline-block;"></span> 🟢 Completed
      </span>
      <span style="display:flex;align-items:center;gap:8px;color:rgba(232,238,252,.9);font-weight:900;font-size:12px;white-space:nowrap;">
        <span style="width:10px;height:10px;border-radius:3px;background:${colors.notDone};display:inline-block;"></span> 🔴 Not Done
      </span>
      <span style="display:flex;align-items:center;gap:8px;color:rgba(232,238,252,.9);font-weight:900;font-size:12px;white-space:nowrap;">
        <span style="width:10px;height:10px;border-radius:3px;background:${colors.missed};display:inline-block;"></span> 🟡 Missed
      </span>
    `;

    legendHost.appendChild(legend);
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

  function renderSettings() {
    renderAccountAuthUi();
  }


  // =============================
  // Account (UI-only)
  // =============================

  function renderAccountAuthUi() {
    try {
      const uid = (() => {
        try {
          return localStorage.getItem('habitTracker.auth.uid');
        } catch {
          return null;
        }
      })();

      const displayName = (() => {
        try {
          return localStorage.getItem('habitTracker.auth.displayName');
        } catch {
          return null;
        }
      })();

      const email = (() => {
        try {
          return localStorage.getItem('habitTracker.auth.email');
        } catch {
          return null;
        }
      })();

      const accountSection = document.getElementById('accountSection');
      const nameEl = document.getElementById('accountUserName');
      const emailEl = document.getElementById('accountUserEmail');
      const signInBtn = document.getElementById('accountSignInBtn');
      const logoutBtn = document.getElementById('accountLogoutBtn');

      if (!accountSection || !nameEl || !emailEl || !signInBtn || !logoutBtn) return;

      const isGuest = !uid;

      nameEl.textContent = displayName || '—';
      emailEl.textContent = email || '—';

      // Guest mode: show Sign In, hide Logout
      // Google logged-in: show Name/Email, hide Sign In, show Logout
      // Requirement: logout button UI-only. Click does nothing (no overlay, no signOut).
      if (isGuest) {
        signInBtn.style.display = '';
        logoutBtn.style.display = 'none';
        document.getElementById('accountGuestHint')?.classList.remove('is-hidden');
      } else {
        signInBtn.style.display = 'none';
        logoutBtn.style.display = '';
        document.getElementById('accountGuestHint')?.classList.add('is-hidden');
      }

      // Auth button click handlers are controlled by the single global capturing handler.
      // (See auth-final document click handler near the end of this file.)

    } catch {}
  }

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

  // Minute-accurate scheduler (WebView timers can drift)
  const ALARM_SNOOZE_MINUTES = 5;

  // Forecasted scheduler tick while app is foregrounded.
  // Exact firing uses setTimeout; this scan helps recover from background throttling.
  const ALARM_SAFETY_SCAN_MS = 5000;

  // Missed-alarm recovery window (ms)
  const ALARM_MISSED_RECOVERY_GRACE_MS = 10 * 60 * 1000;

  // debug flag (keep false in prod; set true to trace alarm reliability)
  const ALARM_DEBUG = false;

  // Audio unlock attempt window
  const ALARM_AUDIO_PRELOAD_TRY_MS = 1200;

  // Prevent unbounded console spam
  const ALARM_HEARTBEAT_EVERY = 6;

  // Scheduler scan interval (ms).
  // NOTE: Older alarm variants referenced ALARM_CHECK_MS; keep compatibility so startAlarmScheduler cannot crash.
  const ALARM_CHECK_MS = ALARM_SAFETY_SCAN_MS;

  function hhmmNow(now) {

    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function stopAlarmSound() {
    try {
      // clear any replay timers/intervals if present
      if (state?.meta?.alarmRuntime?._alarmReplayIntervalHandle) {
        clearInterval(state.meta.alarmRuntime._alarmReplayIntervalHandle);
        state.meta.alarmRuntime._alarmReplayIntervalHandle = null;
      }
      if (state?.meta?.alarmRuntime?._alarmReplayTimeoutHandle) {
        clearTimeout(state.meta.alarmRuntime._alarmReplayTimeoutHandle);
        state.meta.alarmRuntime._alarmReplayTimeoutHandle = null;
      }

      const runtime = state?.meta?.alarmRuntime;
      if (runtime) {
        // hard gate: prevent any immediate re-play from tick/trigger paths
        runtime._stopEpoch = (runtime._stopEpoch || 0) + 1;
      }

      const candidates = [];

      // main active reference
      const a = runtime?._activeAudio;
      if (a) candidates.push(a);

      // preloaded instances
      const preloaded = runtime?._preloadedAlarmAudio;
      if (preloaded && typeof preloaded === 'object') {
        for (const val of Object.values(preloaded)) {
          if (val) candidates.push(val);
        }
      }

      // stop/pause ALL known alarm audio objects
      for (const c of candidates) {
        try {
          if (typeof c.pause === 'function') c.pause();
        } catch {}
        try {
          c.currentTime = 0;
        } catch {}
        try {
          c.loop = false;
        } catch {}
      }

      // remove potential handlers that might re-trigger
      for (const c of candidates) {
        try {
          if (typeof c.onended !== 'undefined') c.onended = null;
        } catch {}
      }

      // reset active reference
      if (runtime) runtime._activeAudio = null;

      try {
        console.log('[audio-stop-complete]');
      } catch {}
    } catch {}
  }


  // Backward-compatible alias (existing code calls stopAlarmAudio)
  function stopAlarmAudio() {
    stopAlarmSound();
  }


function playAlarmAudio(url) {
    stopAlarmAudio();

    if (state?.meta?.settings && state.meta.settings.sound === false) return;

    try {
      const pre = state?.meta?.alarmRuntime?._preloadedAlarmAudio?.[url];
      const a = pre || new Audio(url);

      // Store active audio reference
      state.meta.alarmRuntime._activeAudio = a;
      a.loop = true;
      a.volume = 1;

      try {
        a.currentTime = 0;
      } catch {}

      // Always remember the pending url so unlock flow can retry.
      state.meta.alarmRuntime._pendingAlarmAudioUrl = url;

      // Attempt to play only if we believe sound is unlocked.
      if (!window.__alarmAudioUnlocked) {
        showTapToEnableMessage();
        return;
      }

      const attemptPlay = () => {
        try {
          const p = a.play();
          if (p && typeof p.then === 'function') {
            p.then(() => {}).catch(() => {
              // If play() rejects even after unlock, show fallback button.
              showTapToEnableMessage();
            });
          }
        } catch {
          showTapToEnableMessage();
        }
      };

      attemptPlay();
      setTimeout(attemptPlay, 250);
    } catch {
      // ignore
    }
  }



  function showTapToEnableMessage() {
    try {
      const modal = $('alarmModal') || document.getElementById('alarmModal');
      if (!modal) return;

      const inline = document.getElementById('alarmHabitNameInline');
      if (inline) inline.textContent = 'Tap popup to enable sound';

      // Show a lightweight fallback message even if the inline element is missing.
      const fallback = document.getElementById('alarmTapToEnableFallback');
      if (!fallback && typeof document.createElement === 'function') {
        const el = document.createElement('div');
        el.id = 'alarmTapToEnableFallback';
        el.style.marginTop = '10px';
        el.style.fontWeight = '900';
        el.style.color = 'rgba(232,238,252,.95)';
        el.textContent = 'Tap popup to enable sound';
        modal.appendChild(el);
      }

      // Attach one-time listener to modal so the user gesture triggers unlock + retry.
      if (modal && !modal.__tapToEnableBound) {
        modal.__tapToEnableBound = true;

        const retryOnGesture = () => {
          try {
            const pendingUrl = state?.meta?.alarmRuntime?._pendingAlarmAudioUrl;
            // Remove message + listener first to avoid loops.
            hideTapToEnableMessage();

            if (!pendingUrl) return;
            // Unlock (may no-op if already unlocked)
            unlockAlarmAudio();
            // Retry play after unlock attempt
            setTimeout(() => {
              try {
                playAlarmAudio(pendingUrl);
              } catch {}
            }, 0);
          } catch {}
        };

        // Use { once:true } so repeated taps don't keep stacking handlers.
        modal.addEventListener('pointerdown', retryOnGesture, { once: true, passive: true });
        modal.addEventListener('click', retryOnGesture, { once: true, passive: true });
      }

      state.meta.alarmRuntime._showTapToEnableEl = true;
    } catch {
      // ignore
    }
  }

  function hideTapToEnableMessage() {
    try {
      const fallback = document.getElementById('alarmTapToEnableFallback');
      if (fallback) fallback.remove();
      // also clear inline text if it exists
      const inline = document.getElementById('alarmHabitNameInline');
      if (inline && inline.textContent && inline.textContent.toLowerCase().includes('tap popup to enable sound')) {
        // restore will be handled by next openAlarmModal(els, habit)
        // leave as-is to avoid relying on hidden app state
      }
    } catch {}
  }






  function alarmSoundUrlForHabit(habit) {
    const n = Math.max(1, Math.min(4, Number(habit?.alarmSound) || 1));
    return `sounds/alarm${n}.mp3`;
  }

  function blurIfFocusInside(el) {
    if (!el) return;
    const active = document.activeElement;
    if (active && el.contains(active) && typeof active.blur === 'function') {
      try {
        active.blur();
      } catch {
        // ignore
      }
    }
  }

  function hideModalSafely(el) {
    if (!el) return;
    blurIfFocusInside(el);
    el.setAttribute('aria-hidden', 'true');
    try {
      el.inert = true;
    } catch {
      // ignore
    }
    el.classList.remove('is-open', 'open', 'show', 'active');
  }

  function showModalSafely(el, focusTarget) {
    if (!el) return;
    try {
      el.inert = false;
    } catch {
      // ignore
    }
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');

    requestAnimationFrame(() => {
      const target = focusTarget || el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (target && typeof target.focus === 'function') {
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      }
    });
  }

  function openAlarmModal(els, habit) {
    const hName = habit?.name || '—';
    const t = habit?.alarmTime || '—';
    const sN = Math.max(1, Math.min(4, Number(habit?.alarmSound) || 1));
    const sLabel = `Alarm ${sN}`;

    els.alarmHabitName && (els.alarmHabitName.textContent = hName);
    els.alarmHabitNameInline && (els.alarmHabitNameInline.textContent = `${t} • ${sLabel}`);

    showModalSafely(els.alarmModal);
  }


  function closeAlarmModal(els) {
    try {
      stopAlarmSound();
    } catch {}

    // Always repair runtime flags
    if (state?.meta?.alarmRuntime) {
      state.meta.alarmRuntime._modalOpen = false;
      state.meta.alarmRuntime.activeHabitId = null;
    }

    hideModalSafely(els.alarmModal);

    try {
      const a = els.alarmModal;
      if (a) {
        // remove any inert/blocking flags
        try {
          a.inert = false;
        } catch {}
        a.style.display = 'none';
        a.classList.remove('is-open', 'open', 'show', 'active');
        a.setAttribute('aria-hidden', 'true');
      }

      // remove aria/inert blocking if your modal implementation also uses wrapper/body
      // (keep this DOM-only and never touch any persistence logic)
      if (els.alarmModal) {
        try {
          els.alarmModal.removeAttribute('inert');
        } catch {}
      }
    } catch {}

    try {
      console.log('[modal-close]');
    } catch {}
  }





  function stopAlarmOccurrence(els) {
    const runtime = state?.meta?.alarmRuntime;
    const activeHabitId = runtime?.activeHabitId;

    try {
      console.log('[modal-stop]');
    } catch {}

    // Stop sound immediately (before/while closing).
    stopAlarmSound();
    console.log('[audio-stop]');

    closeAlarmModal(els);

    if (activeHabitId) {
      ensureStateShape();

      const habit = state.habits.find((h) => h.id === activeHabitId);
      const alarmTimeHHMM = habit?.alarmTime;

      // Required occurrence dismissal key: YYYY-MM-DD:HH:MM
      const tKey = todayKey();
      const dismissalKey = `${tKey}:${alarmTimeHHMM}`;

      // Migrate old dismissals: if stored value is only YYYY-MM-DD, remove it (avoid mixed formats)
      const dismissals = state.meta.habitAlarmDismissals = state.meta.habitAlarmDismissals || {};
      const stored = dismissals[activeHabitId];
      if (typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
        try {
          delete dismissals[activeHabitId];
        } catch {}
      }

      dismissals[activeHabitId] = dismissalKey;

      // Add fired occurrence storage so scheduler can never retrigger this same occurrence.
      // Required: persist exact STOP dismissal and mark the exact occurrence as fired.
      // occurrenceKey = habitId|YYYY-MM-DD|HH:MM
      if (runtime) {
        runtime._firedOccurrences = runtime._firedOccurrences || {};
        const occurrenceKey = `${activeHabitId}|${tKey}|${alarmTimeHHMM}`;
        runtime._firedOccurrences[occurrenceKey] = true;
      }

      // Required: write STOP dismissal to localStorage immediately.
      // (save() is called once per STOP; do not defer until after modal close.)
      save();


      try {
        console.log('[alarm-dismissed]', { habitId: activeHabitId, dismissalKey });
      } catch {}

      try {
        save();
      } catch {
        // ignore persistence failures
      }
    }

    // Clear modal/scheduler runtime flags so it can't immediately re-trigger.
    if (state?.meta?.alarmRuntime) {
      state.meta.alarmRuntime.activeHabitId = null;
      state.meta.alarmRuntime._snoozeOverride = null;
      state.meta.alarmRuntime._modalOpen = false;
    }
  }





  function snoozeAlarmOccurrence(els) {
    const activeHabitId = state?.meta?.alarmRuntime?.activeHabitId;
    if (!activeHabitId) {
      stopAlarmOccurrence(els);
      return;
    }

    // IMPORTANT: snooze should NOT dismiss for the rest of the day.
    // It only defers triggering for this habit.
    stopAlarmAudio();
    closeAlarmModal(els);


    const habit = state.habits.find((h) => h.id === activeHabitId);
    if (!habit?.alarmTime) return;

    const now = new Date();
    const snoozeAt = new Date(now);
    snoozeAt.setMinutes(snoozeAt.getMinutes() + ALARM_SNOOZE_MINUTES);

    const snoozeHHMM = hhmmNow(snoozeAt);

    // Store snooze target in runtime only; scheduler will match HH:MM.
    // Also store an absolute triggerAtMs using device local time so snooze fires reliably.
    state.meta.alarmRuntime._snoozeOverride = {
      habitId: activeHabitId,
      hhmm: snoozeHHMM,
      triggerAtMs: snoozeAt.getTime(),
    };
  }

  function weekdayNameForDate(d) {
    // JS getDay(): 0=Sunday ... 6=Saturday
    const map = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return map[d.getDay()];
  }

  function shouldTriggerAlarm(habit, now) {
    // Required: return exact false reasons via minimal console logging.
    // Keep logic unchanged except for defaulting to DAILY when no specific days are selected.

    const habitId = habit?.id;
    const alarmTime = habit?.alarmTime;
    const enabled = habit?.alarmEnabled === true;
    const tKey = todayKey(now);

    // Gate: deleted/trashed habit should never ring.
    if (habitId && state?.meta?.habitTrash && Array.isArray(state.meta.habitTrash)) {
      const isTrashed = state.meta.habitTrash.some((t) => t?.habit?.id === habitId);
      if (isTrashed) {
        console.log('[alarm][shouldTriggerAlarm-false]', { habitId, reason: 'deleted/trashed' });
        return false;
      }
    }

    if (!enabled) {
      console.log('[alarm][shouldTriggerAlarm-false]', { habitId, reason: 'alarmEnabled false' });
      return false;
    }

    if (!alarmTime) {
      console.log('[alarm][shouldTriggerAlarm-false]', { habitId, reason: 'missing alarmTime' });
      return false;
    }

    // Validate HH:MM format early
    const alarmTimeStr = String(alarmTime);
    if (!/^\d{2}:\d{2}$/.test(alarmTimeStr)) {
      console.log('[alarm][shouldTriggerAlarm-false]', { habitId, reason: 'invalid alarmTime format', alarmTime: alarmTimeStr });
      return false;
    }

    // Per-habit STOP dismissal: skip ONLY the exact STOP occurrence (YYYY-MM-DD:HH:MM).
    // Legacy formats that store only the day key must NOT block rescheduled alarms.
    const dismissals = state?.meta?.habitAlarmDismissals;
    const expectedDismissalKey = `${tKey}:${alarmTimeStr}`;
    const storedDismissal = habitId && dismissals ? dismissals[habitId] : undefined;

    console.log('[alarm][dismissal-check]', {
      habitId,
      storedDismissal,
      expectedDismissalKey,
      alarmTime: alarmTimeStr,
    });

    if (habitId && dismissals && storedDismissal === expectedDismissalKey) {
      console.log('[alarm][shouldTriggerAlarm-false]', { habitId, reason: 'stop-dismissal for this occurrence' });
      return false;
    }


    // never trigger while modal is open
    if (state?.meta?.alarmRuntime?._modalOpen) {
      console.log('[alarm][shouldTriggerAlarm-false]', { habitId, reason: 'modalOpen' });
      return false;
    }

    // Weekday gating (Specific Days)
    const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Important: If habit has no selected specific days => treat as DAILY.
    const hasSpecificSelection = Array.isArray(habit.alarmWeekdaysSelected) && habit.alarmWeekdaysSelected.length > 0;
    const selected = hasSpecificSelection ? habit.alarmWeekdaysSelected : allWeekdays;

    const todayName = weekdayNameForDate(now);
    if (!selected.includes(todayName)) {
      console.log('[alarm][shouldTriggerAlarm-false]', {
        habitId,
        reason: 'selectedDays/specificDays mismatch',
        todayName,
        selected,
      });
      return false;
    }

    // NOTE: scheduler tick handles time-match + grace/catch-up.
    // shouldTriggerAlarm must ONLY decide whether firing is allowed.
    console.log('[alarm][shouldTriggerAlarm-true]', {
      habitId,
      alarmTime: alarmTimeStr,
      currentHHMM: hhmmNow(now),
      today: tKey,
    });
    return true;
  }




  let alarmTimerHandle = null;
  let alarmExactTimeoutHandle = null;

  // De-dupe for a single occurrence key (habitId|dayKey|HH:MM|occurrenceType)
  // Stored in runtime only.
  function getAlarmOccurrenceKey({ habitId, dayKey, alarmTimeHHMM, occurrenceType }) {
    return `${habitId}|${dayKey}|${alarmTimeHHMM}|${occurrenceType}`;
  }

  function getHabitScheduledLocalMs(habit, now) {
    try {
      if (!habit?.alarmTime) return null;
      if (!/^[0-2]\d:[0-5]\d$/.test(String(habit.alarmTime))) return null;

      const [hhStr, mmStr] = String(habit.alarmTime).split(':');
      const hh = Number(hhStr);
      const mm = Number(mmStr);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

      // Device local time only.
      const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      return scheduled.getTime();
    } catch {
      return null;
    }
  }

  function findNextDueAlarm(now) {
    ensureStateShape();

    const dayKey = todayKey(now);
    const occurrenceByHabit = [];

    // STOP dismissal blocks NORMAL for the day.
    const dismissedMap = state?.meta?.habitAlarmDismissals || {};

    for (const habit of state.habits || []) {
      if (!habit?.id) continue;
      if (!habit?.alarmTime) continue;

      // Weekday gating (Specific Days)
      if (!shouldTriggerAlarm(habit, now)) continue;

      // STOP blocks NORMAL reminder for this habit today ONLY if it matches an exact occurrence key.
      // We keep legacy “day-only” formats from blocking reschedules.
      if (dismissedMap && typeof dismissedMap[habit.id] === 'string') {
        if (dismissedMap[habit.id] === dayKey || dismissedMap[habit.id] === `${dayKey}:${habit.alarmTime}`) {
          const stored = dismissedMap[habit.id];
          if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) {
            // legacy day-only dismissal: ignore here so rescheduled HH:MM can fire
          } else if (stored === `${dayKey}:${habit.alarmTime}`) {
            continue;
          }
        }
      }


      const scheduledMs = getHabitScheduledLocalMs(habit, now);
      if (scheduledMs == null) continue;

      // Only consider future (or present) occurrences. Missed recovery is handled separately.
      if (scheduledMs < now.getTime()) continue;

      occurrenceByHabit.push({ habit, scheduledMs });
    }

    if (!occurrenceByHabit.length) return null;

    occurrenceByHabit.sort((a, b) => a.scheduledMs - b.scheduledMs);
    return occurrenceByHabit[0];
  }

  function triggerDueAlarms(now, reason, els) {
    try {
      ensureStateShape();

      const dayKey = todayKey(now);
      const occurrenceSeen = state?.meta?.alarmRuntime?._occurrenceSeen || {};
      state.meta.alarmRuntime._occurrenceSeen = occurrenceSeen;

      console.log('[alarm-time] triggerDueAlarms-enter-ms', {
        nowMs: now.getTime(),
        reason,
        dayKey,
      });

      const graceMs = ALARM_MISSED_RECOVERY_GRACE_MS;


      // Snooze override: treat as its own HH:MM occurrenceType.
      const override = state?.meta?.alarmRuntime?._snoozeOverride;
      if (override && typeof override.triggerAtMs === 'number') {
        const shouldNow = now.getTime() >= override.triggerAtMs;
        if (shouldNow) {
          const habit = state.habits.find((h) => h.id === override.habitId);
          if (habit && shouldTriggerAlarm(habit, now)) {
            // snooze should ignore STOP dismissal for NORMAL only; existing behavior blocks by modal open gate.
            // Keep semantics: STOP blocks normal reminders; snooze uses its own override.
            const alarmTimeHHMM = override.hhmm || habit.alarmTime;
            const key = getAlarmOccurrenceKey({ habitId: habit.id, dayKey, alarmTimeHHMM, occurrenceType: 'snooze' });
            if (!occurrenceSeen[key]) {
              occurrenceSeen[key] = true;
              state.meta.alarmRuntime._occurrenceSeen = occurrenceSeen;

              console.log('[alarm-time] trigger', { habitId: habit.id, alarmTime: alarmTimeHHMM, reason, delayMs: now.getTime() - override.triggerAtMs });

              state.meta.alarmRuntime._modalOpen = true;
              state.meta.alarmRuntime.activeHabitId = habit.id;
              state.meta.alarmRuntime._modalOpenAtMs = Date.now();


              stopAlarmAudio();
              playAlarmAudio(alarmSoundUrlForHabit(habit));
              openAlarmModal(els, habit);

              override._used = true;
              state.meta.alarmRuntime._snoozeOverride = null;
            }
          }
        }
      }

      // Normal due alarms.
      const dismissedMap = state?.meta?.habitAlarmDismissals || {};

      for (const habit of state.habits || []) {
        if (!habit?.id) continue;
        if (!habit?.alarmTime) continue;
        // (required trace)
        console.log('[alarm-check]', {
          habitName: habit.name,
          habitId: habit.id,
          alarmTime: habit.alarmTime,
          currentHHMM: hhmmNow(now),
          enabled: habit.alarmEnabled === true,
        });

        if (!shouldTriggerAlarm(habit, now)) {
          console.log('[alarm-skip]', { habitId: habit.id, reason: 'shouldTriggerAlarm-false' });
          continue;
        }

        // STOP dismissal blocks NORMAL reminder only for the exact HH:MM.
        // (Note: this uses exact HH:MM key we store on STOP.)
        const dismissalKey = `${dayKey}:${habit.alarmTime}`;
        if (dismissedMap && dismissedMap[habit.id] === dismissalKey) {
          console.log('[alarm-skip]', {
            habitId: habit.id,
            reason: 'stopped-exact-time',
            dayKey,
            alarmTime: habit.alarmTime,
          });
          continue;
        }

        const scheduledMs = getHabitScheduledLocalMs(habit, now);
        if (scheduledMs == null) {
          console.log('[alarm-skip]', { habitId: habit.id, reason: 'invalid-alarmTime-format' });
          continue;
        }


        const lateMs = now.getTime() - scheduledMs;
        if (lateMs < 0) continue;

        // Recovery: if we're late but still within grace, trigger.
        if (lateMs > graceMs) continue;

        const key = getAlarmOccurrenceKey({ habitId: habit.id, dayKey, alarmTimeHHMM: habit.alarmTime, occurrenceType: 'normal' });
        if (occurrenceSeen[key]) {
          console.log('[alarm-time] skipped', { habitId: habit.id, reason: 'dedupe' });
          continue;
        }

        occurrenceSeen[key] = true;
        state.meta.alarmRuntime._occurrenceSeen = occurrenceSeen;

        console.log('[alarm-time] trigger', { habitId: habit.id, alarmTime: habit.alarmTime, reason, delayMs: lateMs });

        state.meta.alarmRuntime._modalOpen = true;
        state.meta.alarmRuntime.activeHabitId = habit.id;

        stopAlarmAudio();
        playAlarmAudio(alarmSoundUrlForHabit(habit));
        openAlarmModal(els, habit);

        // Optional Web Notification path remains unchanged.
        try {
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              kind: 'ALARM_NOTIFICATION',
              payload: {
                title: 'Habit reminder',
                body: habit.name,
                tag: `habit-alarm:${habit.id}`,
                icon: './icon.png',
              },
            });
          } else if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Habit reminder', { body: habit.name, tag: `habit-alarm:${habit.id}`, icon: './icon.png' });
          }
        } catch {}

        break; // preserve one modal at a time
      }
    } catch (e) {
      console.log('[alarm-time] triggerDueAlarms error', { error: e && e.message ? e.message : String(e) });
    }
  }

  function scheduleNextExactAlarm(els) {
    try {
      ensureStateShape();

      // Clear previous exact timeout
      if (alarmExactTimeoutHandle) {
        clearTimeout(alarmExactTimeoutHandle);
        alarmExactTimeoutHandle = null;
      }

      // If modal open, do not schedule new normal alarms until it closes.
      if (state?.meta?.alarmRuntime?._modalOpen) return;

      // Snooze: if snooze override exists, schedule exact wake.
      const override = state?.meta?.alarmRuntime?._snoozeOverride;
      if (override && typeof override.triggerAtMs === 'number') {
        const delayMs = Math.max(0, override.triggerAtMs - Date.now());
        console.log('[alarm-time] next exact scheduled', { habitId: override.habitId, alarmTime: override.hhmm, scheduledAt: new Date(override.triggerAtMs).toISOString(), delayMs, reason: 'snooze' });
        alarmExactTimeoutHandle = setTimeout(() => {
          triggerDueAlarms(new Date(), 'exact-timeout', els);
          scheduleNextExactAlarm(els);
        }, delayMs);
        return;
      }

      const next = findNextDueAlarm(new Date());
      if (!next) return;

      const { habit, scheduledMs } = next;
      const delayMs = Math.max(0, scheduledMs - Date.now());

      console.log('[alarm-time] next exact scheduled', {
        habitId: habit.id,
        alarmTime: habit.alarmTime,
        scheduledAt: new Date(scheduledMs).toISOString(),
        delayMs,
        reason: 'normal',
      });

      alarmExactTimeoutHandle = setTimeout(() => {
        const firedAt = new Date();
        const actualDelay = firedAt.getTime() - scheduledMs;
        console.log('[alarm-time] timeout-fired-ms', { habitId: habit.id, alarmTime: habit.alarmTime, scheduledMs, timeoutDelayMs: actualDelay, timeoutFiredAtMs: firedAt.getTime() });

        triggerDueAlarms(firedAt, 'exact-timeout', els);
        scheduleNextExactAlarm(els);
      }, delayMs);
    } catch (e) {
      console.log('[alarm-time] scheduleNextExactAlarm error', { error: e && e.message ? e.message : String(e) });
    }
  }

  function startAlarmScheduler(els) {
    if (alarmTimerHandle) return;

    console.log('[alarm-init]');

    // initialize runtime flags
    ensureStateShape();
    state.meta.alarmRuntime._modalOpen = false;

    console.log('[alarm-scheduler-started]');


    state.meta.alarmRuntime._lastFiredMinute = state.meta.alarmRuntime._lastFiredMinute || {}; // habitId -> 'YYYY-MM-DD:HH:MM'
    state.meta.alarmRuntime._lastFiredDayByHabit = state.meta.alarmRuntime._lastFiredDayByHabit || {}; // habitId -> 'YYYY-MM-DD'
    state.meta.alarmRuntime._snoozeOverride = state.meta.alarmRuntime._snoozeOverride || null;

    // Persisted missed-alarm tracking so we can recover after refresh/reopen.
    // This stays in localStorage to survive page reload.
    state.meta.habitAlarmSnoozes = state.meta.habitAlarmSnoozes || {};
    state.meta.habitAlarmLastDue = state.meta.habitAlarmLastDue || {};

    // Missed-alarm recovery (runs once per scheduler start)
    // If app was backgrounded/refreshed and missed a due time within grace window, we trigger immediately.
    // NOTE: timers cannot run when fully closed; we can only recover on next open/refresh.
    const recoverMissed = () => {
      try {
        const now = new Date();
        const nowMs = now.getTime();
        const graceMs = ALARM_MISSED_RECOVERY_GRACE_MS;
        const tNowDayKey = todayKey(now);

        // snooze override recovery (if snooze persisted)
        const activeOverride = state.meta.alarmRuntime._snoozeOverride;
        if (activeOverride && typeof activeOverride.triggerAtMs === 'number' && nowMs >= activeOverride.triggerAtMs) {
          // Let the normal tick handle it.
          return;
        }

        for (const habit of state.habits || []) {
          if (!habit?.alarmTime) continue;
          if (!habit?.id) continue;

          const dismissedToday = state?.meta?.habitAlarmDismissals?.[habit.id] === tNowDayKey;
          if (dismissedToday) continue;

          // Compute the scheduled time for today (in local time)
          const [hhStr, mmStr] = String(habit.alarmTime).split(':');
          const hh = Number(hhStr);
          const mm = Number(mmStr);
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;

          const scheduled = new Date(now);
          scheduled.setHours(hh, mm, 0, 0);
          const lateMs = nowMs - scheduled.getTime();

          // If we are late but still within grace, and we haven't fired due for this habit today, trigger.
          if (lateMs >= 0 && lateMs <= graceMs) {
            const alreadyDueForDay = state.meta.habitAlarmLastDue[habit.id] === tNowDayKey;
            const alreadyFiredRuntimeDay = state.meta.alarmRuntime._lastFiredDayByHabit[habit.id] === tNowDayKey;
            if (alreadyDueForDay || alreadyFiredRuntimeDay) continue;

            // Also enforce shouldTriggerAlarm rules (weekday + modal gate)
            if (!shouldTriggerAlarm(habit, now)) continue;

            state.meta.alarmRuntime._lastFiredDayByHabit[habit.id] = tNowDayKey;
            state.meta.alarmRuntime._lastFiredMinute[habit.id] = `${tNowDayKey}:${hhmmNow(now)}`;
            state.meta.alarmRuntime.activeHabitId = habit.id;
            state.meta.alarmRuntime._modalOpen = true;
            state.meta.habitAlarmLastDue[habit.id] = tNowDayKey;

            console.log('[alarm] recovered missed alarm', {
              habitId: habit.id,
              habitName: habit.name,
              lateMs,
            });

            stopAlarmAudio();
            playAlarmAudio(alarmSoundUrlForHabit(habit));
            openAlarmModal(els, habit);
            // Optional Web Notification via Service Worker
            try {
              if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                  kind: 'ALARM_NOTIFICATION',
                  payload: {
                    title: 'Habit reminder',
                    body: habit.name,
                    tag: `habit-alarm:${habit.id}`,
                    icon: './icon.png',
                  },
                });
              } else if ('Notification' in window && Notification.permission === 'granted') {
                // Fallback: direct notification when SW isn't controlled
                new Notification('Habit reminder', { body: habit.name, tag: `habit-alarm:${habit.id}`, icon: './icon.png' });
              }
            } catch {}
            break;
          }

        }
      } catch {
        // ignore
      }
    };

    recoverMissed();

    const tick = () => {
      try {
        console.log('[alarm-tick]', new Date().toISOString());
        // heartbeat (throttle logging)
        const now = new Date();
        const nowMs = now.getTime();
        state.meta.alarmRuntime._hbCount = (state.meta.alarmRuntime._hbCount || 0) + 1;
        if (ALARM_DEBUG || (state.meta.alarmRuntime._hbCount % ALARM_HEARTBEAT_EVERY === 0)) {
          // console.log removed to keep prod logs minimal

        }


        // snooze override: temporarily fire based on override timestamp
        const override = state.meta.alarmRuntime._snoozeOverride;
        if (override && typeof override.triggerAtMs === 'number') {
          const shouldNow = nowMs >= override.triggerAtMs;
          if (shouldNow) {
            const habit = state.habits.find((h) => h.id === override.habitId);
            console.log('[alarm] snooze scan', {
              habitId: override.habitId,
              nowMs,
              triggerAtMs: override.triggerAtMs,
              shouldTrigger: shouldNow,
            });
            if (habit && shouldTriggerAlarm(habit, now)) {
              // de-dupe per habit per day using stop-dismissal + lastFiredDayByHabit
              const dayKeyForFired = todayKey(now);
              const lastDay = state.meta.alarmRuntime._lastFiredDayByHabit[habit.id];
              const alreadyFired = lastDay === dayKeyForFired;
              if (!alreadyFired) {
                state.meta.alarmRuntime._lastFiredDayByHabit[habit.id] = dayKeyForFired;
                state.meta.alarmRuntime._lastFiredMinute[habit.id] = `${dayKeyForFired}:${hhmmNow(now)}`;
                state.meta.alarmRuntime.activeHabitId = habit.id;

                state.meta.alarmRuntime._modalOpen = true;
                console.log('[alarm] triggered (snooze)', { habitName: habit.name });
                stopAlarmAudio();
                playAlarmAudio(alarmSoundUrlForHabit(habit));
                openAlarmModal(els, habit);

                // mark snooze used so it won't retrigger
                override._used = true;
                state.meta.alarmRuntime._snoozeOverride = null;
              } else {
                console.log('[alarm] snooze skipped (already fired today)');
              }
            } else {
              console.log('[alarm] snooze skipped (shouldTriggerAlarm false or habit missing)');
            }
          }
          return;
        }

        // normal triggers: timestamp-based comparisons with recovery
        const tNowDayKey = todayKey(now);

        // per load missed-alarm recovery (fire once if alarm time already passed)
        // guarded by lastFiredDayByHabit + STOP dismissal.
        const graceMs = 10 * 60 * 1000;

        for (const habit of state.habits || []) {
          if (!habit?.alarmTime) continue;

          const habitId = habit.id;
          if (!habitId) continue;

          const dismissals = state?.meta?.habitAlarmDismissals;
          // STOP dismissal is stored as an exact occurrence key: YYYY-MM-DD:HH:MM
          const dismissalKey = `${tNowDayKey}:${habit.alarmTime}`;
          const dismissedToday = dismissals && dismissals[habitId] === dismissalKey;


          console.log('[alarm] scan habit', {
            habitId,
            habitName: habit.name,
            nowIso: now.toISOString(),
            dismissedToday,
          });

          if (dismissedToday) {
            console.log('[alarm] skipped (dismissed today)');
            continue;
          }

          if (!shouldTriggerAlarm(habit, now)) {
            console.log('[alarm] skipped (shouldTriggerAlarm false)');
            continue;
          }

          const [hhStr, mmStr] = habit.alarmTime.split(':');
          const hh = Number(hhStr);
          const mm = Number(mmStr);
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
            console.log('[alarm] skipped (invalid alarmTime)', { alarmTime: habit.alarmTime });
            continue;
          }

          // scheduled time for today
          const scheduled = new Date(now);
          scheduled.setHours(hh, mm, 0, 0);
          const scheduledMs = scheduled.getTime();

          const timeUntil = scheduledMs - nowMs; // negative if late          // Strict comparison with tolerance:
          // - trigger if now >= scheduledMs
          // - but avoid triggering for very old times (>graceMs late)
          const isDue = nowMs >= scheduledMs;
          const isNotTooLate = nowMs - scheduledMs <= graceMs;

          if (!isDue) {
            console.log('[alarm] skipped (not due yet)', { timeUntilMs: timeUntil });
            continue;
          }
          if (!isNotTooLate) {
            console.log('[alarm] skipped (too late beyond grace)', { lateMs: nowMs - scheduledMs });
            continue;
          }

          // De-dupe must be occurrence-based; day-only blocks break reschedule.
          // Remove day-only gate so rescheduled HH:MM can still fire.


          // Prevent firing right after add: require at least 60s elapsed since creation.
          const createdAt = safeNumber(habit.createdAt, 0);
          if (createdAt && nowMs - createdAt < 60 * 1000) {
            console.log('[alarm] skipped (just created)');
            continue;
          }

          // Missed-alarm recovery: if we're within grace window, we trigger once immediately.
          // This is naturally handled by isDue/isNotTooLate + lastFiredDayByHabit.
          state.meta.alarmRuntime._lastFiredDayByHabit[habitId] = tNowDayKey;
          state.meta.alarmRuntime._lastFiredMinute[habitId] = `${tNowDayKey}:${hhmmNow(now)}`;
          state.meta.alarmRuntime.activeHabitId = habitId;

          state.meta.alarmRuntime._modalOpen = true;
          console.log('[alarm] triggered', {
            habitName: habit.name,
            scheduledIso: scheduled.toISOString(),
            firedAtIso: now.toISOString(),
            lateMs: nowMs - scheduledMs,
          });

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

  function addHabit({ name, targetDays, alarmTimeHHMM, alarmSound, alarmWeekdaysSelected, alarmEnabled }) {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    const aSound = Math.max(1, Math.min(4, Number(alarmSound) || 1));
    const normalizedTime = normalizeAlarmTimeToHHMM(alarmTimeHHMM);
    const enabled = typeof alarmEnabled === 'boolean' ? alarmEnabled : !!normalizedTime;


    const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const picked = Array.isArray(alarmWeekdaysSelected) ? alarmWeekdaysSelected : null;
    const alarmWeekdays = picked && picked.length ? picked.filter((d) => allWeekdays.includes(d)) : allWeekdays;

    state.habits.unshift({
      id,
      name,
      targetDays,
      createdAt: Date.now(),
      history: {},
      alarmTime: normalizedTime,
      alarmEnabled: enabled && !!normalizedTime,
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

    // streak depends on persisted completion dates, so rebuild immediately for correct UI
    rebuildStreakHistoryFromHabitHistory();

    save();
    state._dirtyViews.weekly = true;
    renderWeekly(els);

    // also refresh dashboard meta if user is currently there
    if (els.currentView === 'dashboard') {
      renderDashboard(els);
      renderXpUi(els);
    } else if (els.currentView === 'weekly') {
      // ensure streak cards update when user stays on weekly
      resolveDailyStreakAndMissedDays(els);
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

    els.clearMonthBtn?.addEventListener('click', () => {
      const anchor = getSelectedMonthAnchor();
      const keys = monthKeys(anchor);

      for (const habit of state.habits) {
        if (!habit.history) habit.history = {};
        for (const k of keys) {
          delete habit.history[k];
        }
      }

      rebuildStreakHistoryFromHabitHistory();
      save();

      state._dirtyViews.monthly = true;
      renderMonthly(els);

      // If user currently on dashboard, update streak/xp immediately.
      if (els.currentView === 'dashboard') {
        renderDashboard(els);
        renderXpUi(els);
      } else if (els.currentView === 'monthly') {
        resolveDailyStreakAndMissedDays(els);
      }
    });


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

      // Reminder must be OFF by default; only save alarm fields if user explicitly enabled it.
      const reminderTypeSpecificChecked = !!(els.habitReminderTypeSpecificInput && els.habitReminderTypeSpecificInput.checked);
      const reminderTypeDailyChecked = !!(els.habitReminderTypeDailyInput && els.habitReminderTypeDailyInput.checked);
      const reminderEnabled = reminderTypeSpecificChecked || reminderTypeDailyChecked;

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

      const alarmTimeHHMM = reminderEnabled
        ? parseTimeFromUIToHHMM({ hVal: h, mVal: m, ampmVal: ampm })
        : '';

      // Only persist alarmSound when reminder is enabled.
      const alarmSound = reminderEnabled
        ? (
            els.alarmSound1Input && els.alarmSound1Input.checked
              ? 1
              : els.alarmSound2Input && els.alarmSound2Input.checked
                ? 2
                : els.alarmSound3Input && els.alarmSound3Input.checked
                  ? 3
                  : els.alarmSound4Input && els.alarmSound4Input.checked
                    ? 4
                    : 1
          )
        : 0;

      // Only persist selected weekdays when reminder is enabled.
      const alarmWeekdaysSelected = (() => {
        if (!reminderEnabled) return [];

        // Persist weekdays for Specific Days.
        // If specific: selected cbs, fallback -> all days.
        if (reminderTypeSpecificChecked) {
          const picked = getSelectedWeekdaysFromUi();
          return picked.length ? picked : allWeekdays;
        }

        // Daily reminder => all days.
        return allWeekdays;
      })();

      addHabit({
        name,
        targetDays: Math.max(1, Math.min(7, targetDays)),
        alarmTimeHHMM,
        alarmSound,
        alarmWeekdaysSelected,
        alarmEnabled: reminderEnabled,
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

      if (action === 'toggleAlarmEnabled') {
        const habit = state.habits.find((h) => h.id === habitId);
        if (!habit) return;
        const v = btn.value === 'true';
        habit.alarmEnabled = v === true;
        // If turning on but time is missing, keep it OFF to satisfy invariants.
        if (habit.alarmEnabled === true && !(typeof habit.alarmTime === 'string' && /^\d{2}:\d{2}$/.test(habit.alarmTime))) {
          habit.alarmEnabled = false;
        }
        save();
        scheduleNextExactAlarm(els);
        renderDashboard(els);
        return;
      }

      if (action === 'editAlarmTime') {
        const habit = state.habits.find((h) => h.id === habitId);
        if (!habit) return;

        const runtimeState = state?.meta?.alarmRuntime;
        const oldTime = habit.alarmTime;


        const rawInput = btn.value;
        // Accept formats:
        // - HH:MM (24h)
        // - H:MM AM/PM
        // - HH:MM AM/PM
        // NOTE: Do NOT silently convert invalid inputs.
        const parsed12h = (() => {
          if (typeof rawInput !== 'string') return null;
          const s = rawInput.trim();
          if (!s) return null;
          // Allow optional space before AM/PM, and both H or HH.
          const m = s.match(/^([01]?\d|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
          if (!m) return null;
          const hh12 = safeNumber(m[1], NaN);
          const mm = safeNumber(m[2], NaN);
          if (!Number.isFinite(hh12) || !Number.isFinite(mm)) return null;
          const ampm = String(m[3]).toUpperCase();
          let hh24 = hh12 % 12;
          if (ampm === 'PM') hh24 += 12;
          return `${String(hh24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        })();

        let normalized = null;
        if (typeof rawInput === 'string' && /^\d{1,2}:\d{2}$/.test(rawInput.trim())) {
          // If it's 1-digit hour, normalize as 24h time.
          const s = rawInput.trim();
          const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
          if (m) {
            normalized = `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
          }
        } else {
          normalized = normalizeAlarmTimeToHHMM(rawInput);
          if (!normalized && parsed12h) normalized = parsed12h;
        }

        // Required log
        console.log('[reschedule-time-parse]', { rawInput, parsedHHMM: parsed12h, oldTime, newTime: normalized });

        // If invalid, do not save/reschedule.
        if (!normalized) {
          try {
            alert('Invalid time format. Use HH:MM, H:MM AM/PM, or HH:MM AM/PM.');
          } catch {}
          return;
        }


        // Required: reschedule must clear every runtime gating key for this habit
        // so the new HH:MM behaves like a brand-new alarm occurrence.
        const runtime = state?.meta?.alarmRuntime;
        if (runtime && habit?.id) {
          const tKey = todayKey();

          // Clear de-dupe keys + STOP dismissal for this habit.
          if (runtime._lastFiredDayByHabit && runtime._lastFiredDayByHabit[habit.id]) {
            delete runtime._lastFiredDayByHabit[habit.id];
          }
          if (runtime._lastFiredMinute && runtime._lastFiredMinute[habit.id]) {
            delete runtime._lastFiredMinute[habit.id];
          }

          if (state?.meta?.habitAlarmDismissals && state.meta.habitAlarmDismissals[habit.id]) {
            // STOP dismissal is stored as YYYY-MM-DD:HH:MM (exact occurrence), but we can safely delete.
            delete state.meta.habitAlarmDismissals[habit.id];
          }

          // Clear any snooze override for this habit.
          if (runtime._snoozeOverride && runtime._snoozeOverride.habitId === habit.id) {
            runtime._snoozeOverride = null;
          }

          // Clear modal/active flags only if they were for this habit.
          if (runtime.activeHabitId === habit.id) {
            runtime.activeHabitId = null;
            runtime._modalOpen = false;
          }

          // Also clear any persisted missed-alarm markers to avoid stale recovery.
          if (state?.meta?.habitAlarmLastDue && state.meta.habitAlarmLastDue[habit.id] === tKey) {
            delete state.meta.habitAlarmLastDue[habit.id];
          }
        }

        // Apply new schedule.
        habit.alarmTime = normalized;
        habit.alarmEnabled = normalized ? true : false;

        // If time is valid, ensure it is treated as a fresh enable.
        if (normalized && habit?.id) {
          if (state?.meta?.alarmRuntime && state.meta.alarmRuntime._lastFiredDayByHabit) {
            delete state.meta.alarmRuntime._lastFiredDayByHabit[habit.id];
          }
          if (state?.meta?.alarmRuntime && state.meta.alarmRuntime._lastFiredMinute) {
            delete state.meta.alarmRuntime._lastFiredMinute[habit.id];
          }
          if (state?.meta?.habitAlarmDismissals && state.meta.habitAlarmDismissals[habit.id]) {
            delete state.meta.habitAlarmDismissals[habit.id];
          }
        }

        save();
        renderDashboard(els);
        scheduleNextExactAlarm(els);
        return;
      }


      if (action === 'removeReminder') {
        const habit = state.habits.find((h) => h.id === habitId);
        if (!habit) return;
        habit.alarmTime = null;
        habit.alarmEnabled = false;
        save();
        scheduleNextExactAlarm(els);
        renderDashboard(els);
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

    // Reminder OFF by default (no bell/time saved unless user explicitly enables it).
    // Required UI reset for both reminder modes.
    if (els.habitReminderTypeDailyInput) els.habitReminderTypeDailyInput.checked = false;
    if (els.habitReminderTypeSpecificInput) els.habitReminderTypeSpecificInput.checked = false;

    if (els.habitReminderDaysWrap) {
      // Hide days picker when reminder is OFF.
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

  function initAlarmAudioUnlock() {
    if (window.__alarmAudioUnlockInit) return;
    window.__alarmAudioUnlockInit = true;

    const gestureHandler = () => {
      // Unlock must happen on a real user gesture.
      unlockAlarmAudio();
    };

    // Keep listeners active until unlocked successfully.
    window.addEventListener('pointerdown', gestureHandler, { once: false, passive: true });
    window.addEventListener('touchstart', gestureHandler, { once: false, passive: true });
    window.addEventListener('click', gestureHandler, { once: false, passive: true });
    window.addEventListener('keydown', gestureHandler, { once: false });
  }

  async function unlockAlarmAudio() {
    if (window.__alarmAudioUnlocked) return;
    if (!state?.meta?.settings || state.meta.settings.sound === false) return;

    try {
      console.log('[alarm-audio] unlock attempt');

      // Preload/reuse a single audio instance per unlock.
      state.meta.alarmRuntime = state.meta.alarmRuntime || {};
      state.meta.alarmRuntime._preloadedAlarmAudio = state.meta.alarmRuntime._preloadedAlarmAudio || {};

      const knownUrls = ['sounds/alarm1.mp3', 'sounds/alarm2.mp3', 'sounds/alarm3.mp3', 'sounds/alarm4.mp3'];
      for (const url of knownUrls) {
        if (!state.meta.alarmRuntime._preloadedAlarmAudio[url]) {
          state.meta.alarmRuntime._preloadedAlarmAudio[url] = new Audio(url);
        }
      }

      // Use currently pending URL if available, otherwise default alarm1.
      const urlToUnlock = state?.meta?.alarmRuntime?._pendingAlarmAudioUrl || 'sounds/alarm1.mp3';
      const audio = state.meta.alarmRuntime._preloadedAlarmAudio[urlToUnlock] || new Audio(urlToUnlock);

      // Unlock technique: play/pause muted then unmute.
      audio.loop = true;
      audio.currentTime = 0;
      audio.muted = true;
      audio.volume = 0;

      const p = audio.play();
      if (p && typeof p.then === 'function') {
        await p;
      }

      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = 1;

      window.__alarmAudioUnlocked = true;
      console.log('[alarm-audio] unlock success');

      // Retry pending play if any.
      if (state?.meta?.alarmRuntime?._pendingAlarmAudioUrl) {
        const pendingUrl = state.meta.alarmRuntime._pendingAlarmAudioUrl;
        state.meta.alarmRuntime._pendingAlarmAudioUrl = pendingUrl;
        playAlarmAudio(pendingUrl);
      }
    } catch (e) {
      console.log('[alarm-audio] unlock failed', { error: e && e.message ? e.message : String(e) });
      // keep listeners active; will retry on next gesture.
    }
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
      analyticsNotCompletedHabitsEl: $('analyticsNotCompletedHabits') || null,

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

    // Alarm sound reliability: unlock audio on first user gesture.
    // Required because browsers (especially Android WebView) often block autoplay.
    // This is safe and does not affect timers/CRUD.
    try {
      initAlarmAudioUnlock();
    } catch {}


    load();
    ensureStateShape();

    // STEP 2C (UI ONLY): Auth state badge (Guest remains default; no habit/cloud logic)
    try {
      const badge = document.getElementById('authStateBadge');
      const badgeText = document.getElementById('authStateBadgeText');
      if (badge) {
        const uid = localStorage.getItem('habitTracker.auth.uid');
        badge.style.display = 'flex';
        if (uid) {
          badgeText && (badgeText.textContent = 'Signed in');
          const dot = badge.querySelector('.auth-badge-dot');
          if (dot) dot.style.background = 'rgba(34,197,94,.95)';
        } else {
          badgeText && (badgeText.textContent = 'Guest');
          const dot = badge.querySelector('.auth-badge-dot');
          if (dot) dot.style.background = 'rgba(124,92,255,.95)';
        }
      }
    } catch {}

    // Default the reminder picker visibility on load/open.
    syncReminderTypeUi(els);


    showView('dashboard', els);

    renderDashboard(els);

    // Midnight rollover re-render so the weekly chart updates without refresh.
    // Does not modify any completion/streak/history logic; only triggers re-render.
    let lastDayKey = todayKey();
    setInterval(() => {
      const cur = todayKey();
      if (cur !== lastDayKey) {
        lastDayKey = cur;
        // Re-render current view (analytics is on dashboard).
        if (els.currentView === 'dashboard') {
          renderDashboard(els);
          renderXpUi(els);
        } else if (els.currentView === 'weekly') {
          renderWeekly(els);
        } else if (els.currentView === 'monthly') {
          renderMonthly(els);
        }
      }
    }, 30000);

    startAlarmScheduler(els);
  }

  // ensureFirebaseReady + redundant compat init paths removed.
  // Firebase initialization is handled exactly once at the top of this file.

  function boot() {
    // IMPORTANT: App must always call init()/boot() first.
    // Phase 1 part-2: controller wiring only (UI overlay + click handlers).

    init();

    // Firebase initialization is handled exactly once at the top of this file.

    // Service Worker + Notification permission (alarm-related; optional, non-fatal)
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {});
      }
    } catch {}

    try {
      if ('Notification' in window && typeof Notification.requestPermission === 'function') {
        // Request once; if user denies, don't spam.
        const already = (() => {
          try {
            return localStorage.getItem('habitTracker.notifications.permissionRequested') === 'true';
          } catch {
            return false;
          }
        })();

        if (!already && Notification.permission !== 'granted') {
          Notification.requestPermission().then((p) => {
            try {
              localStorage.setItem('habitTracker.notifications.permissionRequested', 'true');
            } catch {}
            console.log('[alarm] notification permission status', { status: p });
          });
        }
      }
    } catch {}

    // Phase 3 Step 1 removed: Firebase initialization is handled exactly once at the top of this file (compat).

    // Overlay controller wiring (UI-only placeholders; no Firebase yet).

    // This must never alter habit/analytics/alarm/offline logic.
    try {
      const overlay = document.getElementById('authOverlay');
      if (!overlay) return;

      const backdrop = document.getElementById('authOverlayBackdrop');
      const closeBtn = document.getElementById('authOverlayCloseBtn');

      const googleBtn = document.getElementById('authGoogleBtn');
      const phoneBtn = document.getElementById('authPhoneBtn');
      const guestBtn = document.getElementById('authGuestBtn');
      const enableCloudBtn = document.getElementById('authEnableCloudBtn');

      const statusEl = document.getElementById('authStatus');

      function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg;
      }

      // Auth overlay helpers are global; local duplicate definitions removed.

      function bindFreshAuthOverlay() {
        if (window.__FRESH_AUTH_OVERLAY_BOUND__) return;
        window.__FRESH_AUTH_OVERLAY_BOUND__ = true;

        const openBtn = document.getElementById('openAuthBtn');
        const closeBtn = document.getElementById('authOverlayCloseBtn');
        const guestBtn = document.getElementById('authGuestBtn');

        if (openBtn) {
          openBtn.addEventListener('click', function (e) {
            e.preventDefault();
            openAuthOverlay();
          });
        }

        if (closeBtn) {
          closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            closeAuthOverlay();
          });
        }

        if (guestBtn) {
          guestBtn.addEventListener('click', function (e) {
            e.preventDefault();
            try {
              localStorage.setItem('habitTracker.auth.mode', 'guest');
            } catch (_) {}
            closeAuthOverlay();
          });
        }

        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') closeAuthOverlay();
        });

        backdrop?.addEventListener('click', () => closeAuthOverlay());
      }

      bindFreshAuthOverlay();


      // Auth screen visibility (startup only)
      // Requirement: show overlay on first app open unless user is already logged in
      // or previously chose Guest. Guest must not repeatedly block.
      const shouldShowAuthOverlay = (() => {
        try {
          const decided = localStorage.getItem('habitTracker.auth.decided') === 'true';
          const uid = localStorage.getItem('habitTracker.auth.uid');
          if (uid) return false;
          return !decided;
        } catch {
          return true;
        }
      })();

      // Mark that the decision was made at least once.
      try {
        localStorage.setItem('habitTracker.auth.decided', 'true');
      } catch {}

      if (shouldShowAuthOverlay) {
        setStatus('Choose a login method to continue.');
        openAuthOverlay();
      } else {
        closeAuthOverlay();
      }


      // Firebase auth wiring is handled by the single document-level capturing
      // click handler near the end of this file. No per-button handlers here.

      // (Intentionally removed: getFirebaseAuthSafe(), setAuthStatusIfUnavailable(),
      // and googleBtn click Firebase sign-in handler.)

      // Keep phone/guest/cloud UI handlers below (UI-only, no auth execution).


      const otpSection = document.getElementById('authOtpSection');
      const phoneOtpStatusEl = document.getElementById('phoneOtpStatus');
      function setOtpStatus(msg) {
        if (phoneOtpStatusEl) phoneOtpStatusEl.textContent = msg;
      }


      phoneBtn?.addEventListener('click', () => {
        // STEP 2B: show OTP section. No auth execution here.
        setStatus('');
        if (otpSection) {
          otpSection.style.display = 'block';
          otpSection.setAttribute('aria-hidden', 'false');
        }
        setOtpStatus('Enter phone number and OTP.');
      });

      // Phone OTP UI ONLY (no Firebase phone auth yet)
      const sendOtpBtn = document.getElementById('sendOtpBtn');

      const verifyOtpBtn = document.getElementById('verifyOtpBtn');
      const phoneNumberInput = document.getElementById('phoneNumberInput');
      const otpCodeInput = document.getElementById('otpCodeInput');

      const sanitizePhone = (s) => (s || '').toString().trim();
      const sanitizeOtp = (s) => (s || '').toString().replace(/\D/g, '');

      // UI-only state: whether user pressed “Send OTP” successfully.
      let otpUiSent = false;

      // Basic UI validation: allow +, digits, spaces, dashes, parentheses.
      const phoneAllowedRe = /^[+()\d\s-]+$/;

      sendOtpBtn?.addEventListener('click', () => {
        const phoneRaw = sanitizePhone(phoneNumberInput?.value);

        if (!phoneRaw) {
          setOtpStatus('Enter a phone number to send OTP.');
          phoneNumberInput?.focus();
          otpUiSent = false;
          return;
        }

        if (!phoneAllowedRe.test(phoneRaw)) {
          setOtpStatus('Phone number format looks invalid (UI test).');
          phoneNumberInput?.focus();
          otpUiSent = false;
          return;
        }

        // UI-only: emulate OTP sent
        otpUiSent = true;
        setOtpStatus('OTP sent (UI test). Enter the 6-digit code to verify.');

        // Enable verify button
        if (verifyOtpBtn) verifyOtpBtn.disabled = false;
        otpCodeInput?.focus();
        setStatus('');
      });

      verifyOtpBtn?.addEventListener('click', () => {
        if (!otpUiSent) {
          setOtpStatus('Send OTP first.');
          sendOtpBtn?.focus();
          return;
        }

        const otp = sanitizeOtp(otpCodeInput?.value);

        if (!otp) {
          setOtpStatus('Enter the OTP code to verify.');
          otpCodeInput?.focus();
          return;
        }

        if (!/^\d{6}$/.test(otp)) {
          setOtpStatus('OTP must be exactly 6 digits (UI test).');
          otpCodeInput?.focus();
          return;
        }

        // UI-only success (no auth)
        setOtpStatus('OTP verified (UI test). No Firebase phone auth yet.');
        setStatus('');

        // Keep overlay open or close? Keep it simple: close like a “successful sign-in UI”.
        // But do NOT set any uid/auth mode based on Firebase.
        closeAuthOverlay();
        renderAccountAuthUi();
      });




      guestBtn?.addEventListener('click', () => {
        // Guest continue: closes overlay only.
        setStatus('');
        closeAuthOverlay();
      });




      enableCloudBtn?.addEventListener('click', async () => {
        // STEP 2D (write-only backup + queue enable): enable flag only here.
        // Queue processor is triggered only via explicit queue flag.
        try {
          localStorage.setItem('habitTracker.cloud.enabled', 'true');
          setStatus('Cloud backup enabled. Sync will process pending queued changes when online.');
        } catch {
          setStatus('Cloud backup could not be enabled.');
        }
      });

      // =============================
      // Restore from Cloud (single read + safe merge)
      // =============================

      function showRestoreConfirm(els) {
        els.restoreConfirmModal?.classList.add('is-open');
        els.restoreConfirmModal?.setAttribute('aria-hidden', 'false');
      }

      function hideRestoreConfirm(els) {
        els.restoreConfirmModal?.classList.remove('is-open');
        els.restoreConfirmModal?.setAttribute('aria-hidden', 'true');
      }

      function isValidHHMM(hhmm) {
        return typeof hhmm === 'string' && /^\d{2}:\d{2}$/.test(hhmm);
      }

      function validateAndCoerceSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        const snap = snapshot.snapshot && typeof snapshot.snapshot === 'object' ? snapshot.snapshot : snapshot;

        const habits = Array.isArray(snap.habits) ? snap.habits : null;
        if (!habits) return null;

        const xp = snap.xp && typeof snap.xp === 'object' ? snap.xp : null;
        const streak = snap.streak && typeof snap.streak === 'object' ? snap.streak : null;

        const out = {
          habits,
          xp,
          streak,
          meta: snap.meta && typeof snap.meta === 'object' ? snap.meta : {},
          achievements: snap.achievements && typeof snap.achievements === 'object' ? snap.achievements : { unlocked: {} },
        };

        return out;
      }

      function mergeSnapshotIntoLocalState(cloudSnap) {
        ensureStateShape();

        const localHabits = Array.isArray(state.habits) ? state.habits : [];
        const localById = new Map(localHabits.map((h) => [h && h.id ? h.id : null, h]));

        const allCloudHabits = Array.isArray(cloudSnap.habits) ? cloudSnap.habits : [];

        // Validate+coerce cloud habits; never replace local habit with empty/invalid values.
        const cloudById = new Map();
        for (const ch of allCloudHabits) {
          if (!ch || typeof ch !== 'object') continue;
          const id = typeof ch.id === 'string' ? ch.id : null;
          if (!id) continue;

          const name = typeof ch.name === 'string' ? ch.name : '';
          const targetDays = safeNumber(ch.targetDays, 7);
          const createdAt = safeNumber(ch.createdAt, Date.now());
          const history = ch.history && typeof ch.history === 'object' ? ch.history : {};
          const alarmTime = normalizeAlarmTimeToHHMM(ch.alarmTime);
          const alarmSound = Math.max(1, Math.min(4, Number.isFinite(Number(ch.alarmSound)) ? Number(ch.alarmSound) : 1));
          const alarmWeekdaysSelected = Array.isArray(ch.alarmWeekdaysSelected) ? ch.alarmWeekdaysSelected : null;

          cloudById.set(id, {
            id,
            name,
            targetDays,
            createdAt,
            history,
            alarmTime,
            alarmSound,
            alarmWeekdaysSelected,
          });
        }

        // Merge habits by habit.id:
        // - if local habit exists and cloud habit has *valid non-empty* name/history, merge fields shallowly
        // - if local habit exists but cloud fields are empty/invalid, keep local
        // - if local habit missing, import cloud habit

        const mergedHabits = [];
        const usedCloudIds = new Set();

        for (const lh of localHabits) {
          if (!lh || typeof lh !== 'object' || !lh.id) continue;
          const id = lh.id;
          const cloudH = cloudById.get(id);

          if (!cloudH) {
            mergedHabits.push(lh);
            continue;
          }

          usedCloudIds.add(id);

          const nameToUse = typeof cloudH.name === 'string' && cloudH.name.trim() ? cloudH.name : lh.name;
          const targetDaysToUse = Number.isFinite(Number(cloudH.targetDays)) && cloudH.targetDays >= 1 && cloudH.targetDays <= 7 ? cloudH.targetDays : lh.targetDays;
          const createdAtToUse = Number.isFinite(Number(cloudH.createdAt)) ? cloudH.createdAt : lh.createdAt;

          // History: only take cloud history if it is an object with at least one valid dateKey entry.
          let historyToUse = lh.history;
          if (cloudH.history && typeof cloudH.history === 'object') {
            const hasAnyValid = Object.entries(cloudH.history).some(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && (v === 'done' || v === 'not_done'));
            if (hasAnyValid) historyToUse = cloudH.history;
          }

          // Alarm fields: only update if cloud provides a valid alarmTime.
          const alarmTimeToUse = isValidHHMM(cloudH.alarmTime) ? cloudH.alarmTime : lh.alarmTime;
          const alarmSoundToUse = cloudH.alarmSound ? cloudH.alarmSound : lh.alarmSound;

          // Weekdays: update only if cloud provides a non-empty array.
          const allWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          let alarmWeekdaysSelectedToUse = lh.alarmWeekdaysSelected;
          if (Array.isArray(cloudH.alarmWeekdaysSelected) && cloudH.alarmWeekdaysSelected.length) {
            const filtered = cloudH.alarmWeekdaysSelected.filter((d) => allWeekdays.includes(d));
            if (filtered.length) alarmWeekdaysSelectedToUse = filtered;
          }

          mergedHabits.push({
            ...lh,
            name: nameToUse,
            targetDays: targetDaysToUse,
            createdAt: createdAtToUse,
            history: historyToUse,
            alarmTime: alarmTimeToUse,
            alarmSound: alarmSoundToUse,
            alarmWeekdaysSelected: alarmWeekdaysSelectedToUse,
          });
        }

        // Import cloud-only habits.
        for (const [id, cloudH] of cloudById.entries()) {
          if (usedCloudIds.has(id)) continue;
          // If cloud habit is too empty/invalid, skip.
          if (!cloudH.name || !cloudH.name.trim()) continue;

          // Ensure invariants.
          mergedHabits.unshift({
            id,
            name: cloudH.name,
            targetDays: cloudH.targetDays,
            createdAt: cloudH.createdAt,
            history: cloudH.history && typeof cloudH.history === 'object' ? cloudH.history : {},
            alarmTime: normalizeAlarmTimeToHHMM(cloudH.alarmTime),
            alarmSound: Math.max(1, Math.min(4, Number(cloudH.alarmSound) || 1)),
            alarmWeekdaysSelected: Array.isArray(cloudH.alarmWeekdaysSelected) && cloudH.alarmWeekdaysSelected.length
              ? cloudH.alarmWeekdaysSelected.filter((d) => allWeekdays.includes(d))
              : allWeekdays,
          });
        }

        state.habits = mergedHabits;

        // Resolve derived/stored sections using existing application logic.
        // - streak history: based on persisted completion records in habit.history
        rebuildStreakHistoryFromHabitHistory();

        // - XP totals: derived; also seed ledger stub.
        seedXpLedgerFromHistory();

        // - analytics UI depends on state.habits/history so no extra recompute needed beyond renderAnalytics().

        // Ensure persisted alarmTime invariant for safety.
        for (const habit of state.habits || []) {
          if (!habit || typeof habit !== 'object') continue;
          habit.alarmTime = normalizeAlarmTimeToHHMM(habit.alarmTime);
        }

        // Mark views dirty so UI refresh is correct.
        state._dirtyViews.weekly = true;
        state._dirtyViews.monthly = true;
        state._dirtyViews.trash = true;

        return true;
      }

      async function restoreFromCloudOnce(els) {
        // Cloud restore is disabled in this build to enforce Firebase COMPAT ONLY.
        // Do not call modular APIs (getFirestore/doc/getDoc/setDoc/etc.).
        hideRestoreConfirm(els);
        setStatus('Cloud restore unavailable in this build.');
      }

      // Connect existing restore confirmation button.
      try {
        const restoreBtn = document.getElementById('authRestoreFromCloudBtn');
        const restoreConfirmRestoreBtn = document.getElementById('restoreConfirmRestoreBtn');
        const restoreConfirmCancelBtn = document.getElementById('restoreConfirmCancelBtn');
        const restoreConfirmCloseBtn = document.getElementById('restoreConfirmCloseBtn');
        const restoreConfirmModalEl = document.getElementById('restoreConfirmModal');

        if (restoreBtn && restoreConfirmModalEl && restoreConfirmRestoreBtn) {
          restoreBtn.addEventListener('click', () => {
            showRestoreConfirm({ restoreConfirmModal: restoreConfirmModalEl });
          });

          restoreConfirmCancelBtn?.addEventListener('click', () => {
            hideRestoreConfirm({ restoreConfirmModal: restoreConfirmModalEl });
          });

          restoreConfirmCloseBtn?.addEventListener('click', () => {
            hideRestoreConfirm({ restoreConfirmModal: restoreConfirmModalEl });
          });

          restoreConfirmRestoreBtn.addEventListener('click', () => {
            restoreFromCloudOnce({
              restoreConfirmModal: restoreConfirmModalEl,
              currentView: els.currentView,
            });
          });
        }
      } catch {
        // never break auth overlay / restore / queue engine
      }

      // =============================
      // Sync Engine (local queue -> batched Firestore write)
      // =============================
      // Constraints from task:
      // - localStorage remains source of truth
      // - Firestore passive backup
      // - queue processes only when authenticated AND cloudBackupExplicitlyEnabled
      // - no automatic restore
      // - no direct sync execution without queue trigger flag
      // - never overwrite valid local data with empty cloud payloads (we only upload local snapshot)
      // - must not block UI thread


      const CLOUD_QUEUE_KEY = 'habitTracker.cloud.queue.v1';
      const CLOUD_QUEUE_TRIG_KEY = 'habitTracker.cloud.queue.trigger';

      function getCloudUid() {
        try {
          return localStorage.getItem('habitTracker.auth.uid');
        } catch {
          return null;
        }
      }

      function isCloudEnabled() {
        try {
          return localStorage.getItem('habitTracker.cloud.enabled') === 'true';
        } catch {
          return false;
        }
      }

      function isQueueTriggerEnabled() {
        try {
          return localStorage.getItem(CLOUD_QUEUE_TRIG_KEY) === 'true';
        } catch {
          return false;
        }
      }

      function setQueueTriggerEnabled(v) {
        try {
          localStorage.setItem(CLOUD_QUEUE_TRIG_KEY, v ? 'true' : 'false');
        } catch {}
      }

      function readQueue() {
        try {
          const raw = localStorage.getItem(CLOUD_QUEUE_KEY);
          if (!raw) return [];
          const q = JSON.parse(raw);
          return Array.isArray(q) ? q : [];
        } catch {
          return [];
        }
      }

      function writeQueue(q) {
        try {
          localStorage.setItem(CLOUD_QUEUE_KEY, JSON.stringify(q));
        } catch {}
      }

      // Enqueue only; never sync here.
      function enqueueCloudBackup(reason) {
        try {
          const uid = getCloudUid();
          if (!uid) return;
          if (!isCloudEnabled()) return;

          // Throttle: if last queued item is very recent and identical-ish, keep queue small.
          const q = readQueue();
          const nowMs = Date.now();
          const last = q[0];
          if (last && typeof last === 'object' && last.kind === 'state' && nowMs - (last.queuedAtMs || 0) < 15000) {
            // Replace payload timestamp only; keep queue length stable.
            q[0] = { ...last, queuedAtMs: nowMs, reason: reason || last.reason };
            writeQueue(q);
            return;
          }

          const payload = {
            kind: 'state',
            queuedAtMs: nowMs,
            reason: reason || 'local-change',
            // capture only a validation-friendly subset for backup
            state: {
              habits: state && Array.isArray(state.habits) ? cloneData(state.habits) : [],
              meta: state && state.meta && typeof state.meta === 'object' ? {
                settings: state.meta.settings,
                dailyQuests: state.meta.dailyQuests,
                monthlySelected: state.meta.monthlySelected,
                habitTrash: state.meta.habitTrash,
                monthlyByMonthKey: state.meta.monthlyByMonthKey,
                streakHistory: state.meta.streakHistory,
                habitAlarmDismissals: state.meta.habitAlarmDismissals,
              } : {},
              xp: state && state.xp && typeof state.xp === 'object' ? cloneData(state.xp) : { total: 0, ledger: {} },
              streak: state && state.streak && typeof state.streak === 'object' ? cloneData(state.streak) : { current: 0, best: 0 },
              achievements: state && state.achievements && typeof state.achievements === 'object' ? cloneData(state.achievements) : { unlocked: {} },
            },
          };

          q.unshift(payload);
          // Cap queue size
          const capped = q.slice(0, 25);
          writeQueue(capped);

          // queue trigger flag enables processor (per task constraint)
          setQueueTriggerEnabled(true);
        } catch {}
      }

      let cloudProcessInFlight = false;
      let cloudProcessTimerHandle = null;

      const CLOUD_QUEUE_RETRY_MAX = 5;
      const CLOUD_QUEUE_RETRY_BASE_MS = 1500;
      const CLOUD_QUEUE_RETRY_MAX_MS = 60 * 1000;

      function shouldProcessQueueNow() {
        try {
          // STRICT execution gate: all conditions must be true
          const uid = getCloudUid();
          const cloudEnabled = isCloudEnabled();
          const queueTrigger = isQueueTriggerEnabled();
          const online = navigator.onLine === true;
          return !!(uid && cloudEnabled && queueTrigger && online);
        } catch {
          return false;
        }
      }

      function getRetryCountForLatestItemId(queue) {
        // We keep retry counters on each queue item (crash-safe because stored in localStorage).
        // The latest item to attempt is always index 0 (newest).
        const latest = queue && queue[0];
        const n = latest && typeof latest.retryCount === 'number' ? latest.retryCount : 0;
        return Math.max(0, Math.floor(n));
      }

      function scheduleProcessQueue(reason) {
        // Debounce + no duplicate timers.
        if (cloudProcessInFlight) return;
        if (!shouldProcessQueueNow()) return;

        if (cloudProcessTimerHandle) return;

        // Quick coalescing delay; multiple triggers in a burst still schedule once.
        cloudProcessTimerHandle = setTimeout(() => {
          cloudProcessTimerHandle = null;
          processQueue(reason).catch(() => {});
        }, 250);
      }

      async function processQueue(reason) {
        if (cloudProcessInFlight) return;
        cloudProcessInFlight = true;

        try {
          // Strict execution gate: exit immediately if any condition fails.
          if (!shouldProcessQueueNow()) return;

          const uid = getCloudUid();
          if (!uid) return;

          const q = readQueue();
          if (!q.length) {
            setQueueTriggerEnabled(false);
            return;
          }

          // Firebase cloud sync is disabled in this build to enforce Firebase COMPAT ONLY.
          // Do not call modular SDK functions (getFirestore/doc/setDoc/etc.).
          setStatus('Cloud sync unavailable in this build.');
          return;


          // Firebase cloud sync is disabled in this build to enforce Firebase COMPAT ONLY.
          // Modular SDK calls removed. Keep queue mechanism in place (local-only enqueue).
          // No-op to preserve offline stability.
          return;
        } finally {
          cloudProcessInFlight = false;
        }
      }



      // Trigger queue processor only when explicitly allowed (flag) and online.
      window.addEventListener('online', () => {
        // Strict idle requirement: do nothing unless ALL conditions are true.
        if (!shouldProcessQueueNow()) return;
        scheduleProcessQueue('online');
      });


      // NOTE: Intentionally DO NOT patch/override `save()`.
      // Queueing is triggered by explicit user actions and offline queue creation only.

      // initial scheduling if queue already exists (queue-only processor)
      try {
        if (readQueue().length && isCloudEnabled() && isQueueTriggerEnabled() && navigator.onLine) scheduleProcessQueue('init-queue');
      } catch {}




    } catch {
      // Never break app if auth overlay elements are missing.
    }
  }



  // =============================
  // Single global auth click handler (CAPTURING)
  // =============================
  // Disabled by FINAL auth click fix block at EOF.
  // (Keeps codebase unchanged for other behaviors.)
  window.__HABITTRACKER_AUTH_CAPTURE_HANDLER_BOUND__ = true;


  // Global auth helpers (required by external UI/debug buttons).
  // They must be available regardless of whether this file's internal overlay wiring has run.
  window.showHabitLogin = function showHabitLogin() {
    try {
      localStorage.removeItem('habitTracker.auth.decided');
      localStorage.removeItem('habitTracker.auth.mode');
      localStorage.removeItem('habitTracker.auth.uid');
    } catch {}

    openAuthOverlay();

    try {
      console.log('[auth] login overlay requested');
    } catch {}
  };

  window.logoutHabitTracker = async function logoutHabitTracker() {
    // Deprecated external hook: keep UI-only to avoid duplicate auth execution.
    try {
      if (typeof renderAccountAuthUi === 'function') renderAccountAuthUi();
      openAuthOverlay();
    } catch {}
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

// ==============================
// FINAL: Google Sign In / Logout click handling
// Must be LAST in file and outside the main IIFE.
// ==============================
;(() => {
  console.log("[final-auth] block loaded");

  document.addEventListener("click", async function (e) {
    const t = e.target;
    console.log('[auth-debug] click event target:', t && (t.id || t.tagName));
    const signInBtn = t && t.closest ? t.closest("#accountSignInBtn, #authGoogleBtn") : null;
    const logoutBtn = t && t.closest ? t.closest("#accountLogoutBtn") : null; 
    console.log('[auth-debug] matched buttons:', { signIn: !!signInBtn, logout: !!logoutBtn });

    if (!signInBtn && !logoutBtn) return;

    console.log("[signin clicked]");
    if (logoutBtn) console.log("[logout clicked]");
    console.log("[final-auth] click captured", {
      signIn: !!signInBtn,
      logout: !!logoutBtn,
      id: e.target && e.target.id,
    });

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    try {
      if (!window.firebase || !window.firebaseConfig) {
        alert("Firebase not loaded");
        return;
      }

      // Firebase is initialized (compat) in the main file; avoid re-initialization here.
      // const auth = firebase.auth();

      const auth = window.auth || firebase.auth();


      if (signInBtn) {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        const user = result.user || auth.currentUser;

        if (user) {
          localStorage.setItem("habitTracker.auth.uid", user.uid);
          localStorage.setItem("habitTracker.auth.mode", "google");
          localStorage.setItem("habitTracker.auth.decided", "true");
        }

        location.reload();
        return;
      }

      if (logoutBtn) {
        await auth.signOut();

        localStorage.removeItem("habitTracker.auth.uid");
        localStorage.setItem("habitTracker.auth.mode", "guest");
        localStorage.setItem("habitTracker.auth.decided", "true");

        location.reload();
        return;
      }
    } catch (err) {
      console.error("[final-auth] failed", err);
      alert("Auth failed: " + (err && err.message ? err.message : err));
    }
  }, true);
})();




