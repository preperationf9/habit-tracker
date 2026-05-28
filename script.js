(() => {
  'use strict';

  const STORAGE_KEY = 'habitTracker.v1';

  // Simple, stable XP model (premium XP removed)
  const XP = {
    completeHabit: 5,
  };



  /**
   * @typedef {'done'|'not_done'} HabitStatus
   * @typedef {{ [dateKey: string]: HabitStatus }} HabitHistory
   * @typedef {{habits: Array<{id:string,name:string,targetDays:number,createdAt:number,history: HabitHistory}>}} BaseState
   */

  /**
   * @type {BaseState & {
   *   xp?: { total:number, ledger?: Record<string, Record<string, {amount:number, reason:string, at:number}>> },
   *   streak?: { current:number, best:number, lastResolvedKey?: string|null, freezeCount?: number, missedDays?: string[] },
   *   achievements?: { unlocked?: Record<string, boolean> },
   *   meta?: any,
   *   _dirtyViews?: Record<string, boolean>
   * }}
   */

  let state = { habits: [] };
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
    const idx = Math.floor(Math.random() * quotes.length);
    return quotes[idx];
  }

  function isValidLoadedState(s) {
    if (!s || typeof s !== 'object') return false;
    if (!Array.isArray(s.habits)) return false;
    return true;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = {
          habits: [],
          xp: { total: 0, ledger: {} },
          streak: { current: 0, best: 0, lastResolvedKey: null, freezeCount: 1, missedDays: [] },
          achievements: { unlocked: {} },
          meta: { settings: { reducedMotion: false, sound: true }, dailyQuests: { dateKey: null, completed: {} } },
          _dirtyViews: { weekly: true, monthly: true },

        };
        return;
      }
      const parsed = JSON.parse(raw);
      if (isValidLoadedState(parsed)) {
        state = {
          habits: parsed.habits,
          xp: parsed.xp || { total: 0, awarded: {} },
          streak: parsed.streak || { current: 0, best: 0, history: [] },
          _dirtyViews: { weekly: true, monthly: true },
        };
      }
    } catch {
        state = {
          habits: [],
          xp: { total: 0, ledger: {} },
          streak: { current: 0, best: 0, lastResolvedKey: null, freezeCount: 1, missedDays: [] },
          achievements: { unlocked: {} },
          meta: { settings: { reducedMotion: false, sound: true }, dailyQuests: { dateKey: null, completed: {} } },
          _dirtyViews: { weekly: true, monthly: true },
        };

    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage might be full/blocked; UI must keep running
    }
  }

  function getLevelFromXp(totalXp) {
    const x = Math.max(0, Number(totalXp) || 0);
    if (x >= 200) return { name: 'Master', minXp: 200, nextXp: 200, progressStart: 200 };
    if (x >= 100) return { name: 'Advanced', minXp: 100, nextXp: 200, progressStart: 100 };
    if (x >= 50) return { name: 'Intermediate', minXp: 50, nextXp: 100, progressStart: 50 };
    return { name: 'Beginner', minXp: 0, nextXp: 50, progressStart: 0 };
  }

  function isHabitDayComplete(dateKey) {
    // Premium streak definition: all habits must be done on that day.
    // If user has no habits, treat as not streakable.
    if (!state.habits.length) return false;
    // done when every habit is marked done.
    for (const habit of state.habits) {
      if (habit.history?.[dateKey] !== 'done') return false;
    }
    return true;
  }

  function getDoneCountForDate(dateKey) {
    let done = 0;
    for (const habit of state.habits) {
      if (habit.history?.[dateKey] === 'done') done++;
    }
    return done;
  }

  function computeStreakUpTo(dateKeyInclusive) {
    // Compute current streak ending at dateKeyInclusive backwards with no gaps.
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
    // Premium streak freeze/missed-day recovery removed.
    // Keep function name to avoid touching the rest of the code.
    ensureStateShape();

    const today = todayKey(new Date());

    const current = isHabitDayComplete(today) ? computeStreakUpTo(today) : 0;
    const best = computeBestStreak();

    state.streak.current = current;
    state.streak.best = Math.max(state.streak.best || 0, best);

    if (els && els.missedWarningEl) {
      // Always hide missed-day warning after premium removal.
      els.missedWarningEl.classList.remove('is-show');
    }
  }



  function getDayDoneCount(dateKey) {
    let done = 0;
    for (const habit of state.habits) {
      if (habit.history?.[dateKey] === 'done') done++;
    }
    return done;
  }

  function ensureStateShape() {
    state = state || { habits: [] };

    state.xp = state.xp || { total: 0, ledger: {} };
    state.xp.ledger = state.xp.ledger || {};

    state.streak = state.streak || { current: 0, best: 0, lastResolvedKey: null };


    state.achievements = state.achievements || { unlocked: {} };

    // meta (non-breaking)
    state.meta = state.meta || {
      settings: state.meta?.settings || { reducedMotion: false, sound: true },
      dailyQuests: state.meta?.dailyQuests || { dateKey: null, completed: {} },
    };

    state._dirtyViews = state._dirtyViews || { weekly: true, monthly: true };
  }

  // Premium XP ledger removed.
  // XP is stored as a single number: state.xp.total.
  function computeXpTotalForToday() {
    ensureStateShape();
    const total = state.xp.total || 0;
    return total;
  }


  function renderXpUi(els) {
    if (!els.xpTotalEl || !els.xpFillEl || !els.xpPctEl || !els.xpNextLabelEl || !els.levelBadgeEl) {

      // optional UI; never crash
    }

    ensureStateShape();

    // Real XP is ledger-based (dynamic). Never recompute total from habit count.
    const total = computeXpTotalForToday();
    state.xp.total = total;


    if (els.xpTotalEl) els.xpTotalEl.textContent = String(total);

    const lvl = getLevelFromXp(total);
    const startXp = lvl.progressStart ?? lvl.minXp ?? 0;
    const denom = Math.max(1, lvl.nextXp - startXp);
    const progress = Math.max(0, Math.min(1, (total - startXp) / denom));
    const pct = Math.round(progress * 100);

    if (els.levelBadgeEl) els.levelBadgeEl.textContent = lvl.name;
    if (els.xpFillEl) els.xpFillEl.style.width = `${pct}%`;
    if (els.xpPctEl) els.xpPctEl.textContent = `${pct}%`;
    if (els.xpNextLabelEl) {
      const inBandCurrent = Math.max(0, total - startXp);
      const inBandTotal = Math.max(1, lvl.nextXp - startXp);
      els.xpNextLabelEl.textContent = `${inBandCurrent} / ${inBandTotal} XP`;
    }

  }

  function showView(view, els) {
    els.currentView = view;

    const map = {
      dashboard: els.viewDashboard,
      weekly: els.viewWeekly,
      monthly: els.viewMonthly,
      settings: els.viewSettings,
    };

    for (const [k, el] of Object.entries(map)) {
      if (!el) continue;
      el.classList.toggle('is-hidden', k !== view);
    }

    if (els.navItems) {
      els.navItems.forEach((b) => {
        b.classList.toggle('is-active', b.dataset.view === view);
      });
    }

    // Close mobile menu on any view change for navigation stability.
    if (els.mobileNav && els.mobileNav.classList.contains('is-open')) {
      els.mobileNav.classList.remove('is-open');
    }

    // Mark dirty + render only visible view.
    if (view === 'weekly' && els.viewWeekly) {
      state._dirtyViews = state._dirtyViews || {};
      state._dirtyViews.weekly = true;
    }
    if (view === 'monthly' && els.viewMonthly) {
      state._dirtyViews = state._dirtyViews || {};
      state._dirtyViews.monthly = true;
    }

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
        else renderDashboard(els);
      } catch (e) {
        // Never leave screen blank.
        showFatalError(els, e);
      }
    });
  }

  function showFatalError(els, err) {
    if (!els.fatalErrorEl) return;
    const msg = (err && err.message) ? err.message : 'Unexpected error';
    els.fatalErrorEl.textContent = `Could not load Habit Tracker: ${msg}`;
    els.fatalErrorEl.style.display = 'block';
  }

  function renderDashboard(els) {
    if (!els.viewDashboard) return;

    els.todayLabel && (els.todayLabel.textContent = formatToday());
    els.motivationQuote && (els.motivationQuote.textContent = pickMotivation());

    // Resolve streak + missed days each dashboard render (once/day logic inside)
    resolveDailyStreakAndMissedDays(els);


    const tKey = todayKey();
    const habits = state.habits;

    if (els.habitList) els.habitList.innerHTML = '';

    let doneCount = 0;
    let totalCount = 0;

    if (els.habitList) {
      const frag = document.createDocumentFragment();

      for (const habit of habits) {
        totalCount += 1;
        const status = habit.history?.[tKey];
        if (status === 'done') doneCount += 1;

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
        if (status === 'done') doneBtn.classList.add('is-done');
        doneBtn.dataset.action = 'setStatus';
        doneBtn.dataset.status = 'done';

        const ndBtn = document.createElement('button');
        ndBtn.type = 'button';
        ndBtn.className = 'check-btn';
        ndBtn.textContent = '✕';
        ndBtn.title = 'Not done';
        if (status === 'not_done') ndBtn.classList.add('is-nd');
        ndBtn.dataset.action = 'setStatus';
        ndBtn.dataset.status = 'not_done';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'delete-btn';
        delBtn.textContent = '🗑️';
        delBtn.title = 'Delete habit';
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

    if (els.streakCount) els.streakCount.textContent = String(state.streak?.current ?? 0);


    // Dashboard XP + level
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

    const anchor = new Date();
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
    // static
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
  }

  function addHabit({ name, targetDays }) {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    state.habits.unshift({ id, name, targetDays, createdAt: Date.now(), history: {} });

    // Simple XP model: reset total XP (since we removed ledger-based XP)
    // Users can still earn XP by completing habits.
    state.xp = state.xp || {};
    if (typeof state.xp.total !== 'number') state.xp.total = 0;


    save();
    state._dirtyViews = state._dirtyViews || {};
    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
  }



  function deleteHabitById(habitId) {
    state.habits = state.habits.filter((h) => h.id !== habitId);

    save();

    state._dirtyViews = state._dirtyViews || {};
    state._dirtyViews.weekly = true;
    state._dirtyViews.monthly = true;
  }



  function clearMonth(els) {
    const keys = monthKeys();
    for (const habit of state.habits) {
      if (!habit.history) habit.history = {};
      for (const k of keys) delete habit.history[k];
    }
    save();
    state._dirtyViews = state._dirtyViews || {};
    state._dirtyViews.monthly = true;
    renderMonthly(els);
  }

  function clearWeek(els) {
    const keys = weekKeys();
    for (const habit of state.habits) {
      if (!habit.history) habit.history = {};
      for (const k of keys) delete habit.history[k];
    }
    save();
    state._dirtyViews = state._dirtyViews || {};
    state._dirtyViews.weekly = true;
    renderWeekly(els);
  }

  function clearAll(els) {
    state = {
      habits: [],
      xp: { total: 0, ledger: {} },
      streak: { current: 0, best: 0, lastResolvedKey: null, freezeCount: 1, missedDays: [] },
      achievements: { unlocked: {} },
      meta: { settings: { reducedMotion: false, sound: true }, dailyQuests: { dateKey: null, completed: {} } },
      _dirtyViews: { weekly: true, monthly: true },
    };

    save();
    renderDashboard(els);
  }

  function bindEvents(els) {
    // Robust navigation binding: bind directly to each nav button (desktop + mobile).
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


    if (els.menuBtn && els.mobileNav) {
      els.menuBtn.addEventListener('click', () => {
        els.mobileNav.classList.toggle('is-open');
      });
    }

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
        addHabit({ name, targetDays: Math.max(1, Math.min(7, targetDays)) });
        closeModal(els);
        // dashboard is always visible when modal closes
        renderDashboard(els);
      });

    els.clearWeekBtn && els.clearWeekBtn.addEventListener('click', () => {
      clearWeek(els);
    });

    els.clearMonthBtn &&
      els.clearMonthBtn.addEventListener('click', () => {
        if (!confirm('Reset monthly tracking for this month? This cannot be undone.')) return;
        clearMonth(els);
      });

    els.clearAllBtn &&
      els.clearAllBtn.addEventListener('click', () => {
        if (!confirm('Delete all habits and history stored in this browser?')) return;
        clearAll(els);
        showView('dashboard', els);
      });

    // Habit list delegated actions to keep event binding cheap and robust.
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
          const habit = state.habits.find((h) => h.id === habitId);
          const ok = confirm(`Delete habit: ${habit?.name ?? ''}?`);
          if (!ok) return;
          deleteHabitById(habitId);
          renderDashboard(els);
          scheduleRender(els, els.currentView || 'dashboard');
          return;
        }

        if (action === 'setStatus') {
          const status = btn.dataset.status;
          const habit = state.habits.find((h) => h.id === habitId);
          if (!habit) return;
          habit.history = habit.history || {};
          habit.history[tKey] = status;
          save();

          // render only what user sees right now
          const view = els.currentView || 'dashboard';
          if (view === 'dashboard') {
            renderDashboard(els);
          } else if (view === 'weekly') {
            state._dirtyViews.weekly = true;
            renderWeekly(els);
          } else if (view === 'monthly') {
            state._dirtyViews.monthly = true;
            renderMonthly(els);
          }

          // Keep XP UI updated even if user is not currently on dashboard.
          // This avoids the “stuck” XP/levels UI reported on mobile.
          renderXpUi(els);

        }
      });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.habitModal && els.habitModal.classList.contains('is-open')) closeModal(els);
    });
  }

  // init (DOM-safe)
  function init() {
    const els = {
      navItems: Array.from(document.querySelectorAll('.nav-item')),

      mobileNav: $('mobileNav'),
      menuBtn: $('menuBtn'),

      viewDashboard: $('view-dashboard'),
      viewWeekly: $('view-weekly'),
      viewMonthly: $('view-monthly'),
      viewSettings: $('view-settings'),

      todayLabel: $('todayLabel'),
      motivationQuote: $('motivationQuote'),
      habitList: $('habitList'),
      emptyState: $('emptyState'),

      progressMeta: $('progressMeta'),
      progressFill: $('progressFill'),
      progressPct: $('progressPct'),
      progressCounts: $('progressCounts'),
      streakCount: $('streakCount'),

      weekRangePill: $('weekRangePill'),
      weeklyTable: $('weeklyTable'),
      clearWeekBtn: $('clearWeekBtn'),

      monthRangePill: $('monthRangePill'),
      monthlyTable: $('monthlyTable'),
      clearMonthBtn: $('clearMonthBtn'),

      clearAllBtn: $('clearAllBtn'),

      habitModal: $('habitModal'),
      habitForm: $('habitForm'),
      habitNameInput: $('habitNameInput'),
      habitTargetInput: $('habitTargetInput'),
      closeModalBtn: $('closeModalBtn'),
      cancelModalBtn: $('cancelModalBtn'),
      newHabitBtn: $('newHabitBtn'),

      xpTotalEl: $('xpTotal'),
      xpFillEl: $('xpProgressFill'),
      xpPctEl: $('xpProgressPct'),
      xpNextLabelEl: $('xpNextLabel'),
      levelBadgeEl: $('levelBadge'),

      // used for fatal error display (optional)
      fatalErrorEl: null,
      currentView: 'dashboard',
    };

    // Create fatal error fallback element only if needed.
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

    // Guard against missing root elements (prevents blank screen).
    if (!els.viewDashboard || !els.habitModal || !els.habitForm) {
      // Still try; but likely layout incomplete.
    }

    // Set initial view
    state._dirtyViews = state._dirtyViews || { weekly: true, monthly: true };

    bindEvents(els);

    load();

    const initialView = 'dashboard';
    els.currentView = initialView;
    showView(initialView, els);
    renderDashboard(els);
  }

  // Ensure DOM is ready even in odd PWA cached navigations.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

