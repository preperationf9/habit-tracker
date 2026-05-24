(() => {
  const STORAGE_KEY = 'habitTracker.v1';

  /**
   * @typedef {'done'|'not_done'} HabitStatus
   * @typedef {{ [dateKey: string]: HabitStatus }} HabitHistory
   * @typedef {{habits: Array<{id:string,name:string,targetDays:number,createdAt:number,history: HabitHistory}>}} BaseState
   */

  /** @type {BaseState & {xp?: { total:number, awarded?: Record<string, Record<string, boolean>> }, streak?: { current:number, best:number, history?: Array<{dateKey:string, streak:number}> }} } */
  let state = { habits: [] };


  const $ = (id) => document.getElementById(id);

  const els = {
    // nav
    navItems: Array.from(document.querySelectorAll('.nav-item')),

    mobileNav: $('mobileNav'),
    menuBtn: $('menuBtn'),

    // views
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

    // modal
    habitModal: $('habitModal'),
    habitForm: $('habitForm'),
    habitNameInput: $('habitNameInput'),
    habitTargetInput: $('habitTargetInput'),
    closeModalBtn: $('closeModalBtn'),
    cancelModalBtn: $('cancelModalBtn'),
    newHabitBtn: $('newHabitBtn'),
  };

  function todayKey(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function weekKeys(end = new Date()) {
    // last 7 days including end
    const keys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      keys.push(todayKey(d));
    }
    return keys;
  }

  function isValidLoadedState(s) {
    if (!s || typeof s !== 'object') return false;
    if (!Array.isArray(s.habits)) return false;
    return true;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (isValidLoadedState(parsed)) {
        // Backward compatible: older storage only had {habits}
        state = {
          habits: parsed.habits,
          xp: parsed.xp || { total: 0, awarded: {} },
          streak: parsed.streak || { current: 0, best: 0, history: [] },
        };
      }
    } catch {
      // ignore corrupted storage
      state = { habits: [], xp: { total: 0, awarded: {} }, streak: { current: 0, best: 0, history: [] } };
    }
  }


  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // if storage is full/blocked, silently fail rather than breaking UI
    }
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


  function openModal() {
    els.habitModal.classList.add('is-open');
    els.habitModal.setAttribute('aria-hidden', 'false');
    els.habitNameInput.focus();
  }

  function closeModal() {
    els.habitModal.classList.remove('is-open');
    els.habitModal.setAttribute('aria-hidden', 'true');
    els.habitForm.reset();
    els.habitTargetInput.value = 7;
  }

  function showView(view) {
    // Only toggle views that actually exist in the DOM
    const map = {
      dashboard: els.viewDashboard,
      weekly: els.viewWeekly,
      monthly: els.viewMonthly,
      settings: els.viewSettings,
      // NOTE: life-goals intentionally omitted because it's not in index.html right now
    };

    for (const [k, el] of Object.entries(map)) {
      if (!el) continue;
      el.classList.toggle('is-hidden', k !== view);
    }

    els.navItems.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.view === view);
    });

    if (view === 'weekly') renderWeekly();
  }


  function deleteHabitById(habitId) {
    state.habits = state.habits.filter((h) => h.id !== habitId);
    save();
  }

  function getDayDoneCount(dateKey) {
    let done = 0;
    for (const habit of state.habits) {
      if (habit.history?.[dateKey] === 'done') done++;
    }
    return done;
  }

  function computeCurrentStreak() {
    if (!state.habits.length) return 0;

    const end = new Date();
    // compute up to 365 days back to avoid infinite
    for (let i = 0; i < 365; i++) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const k = todayKey(d);
      if (getDayDoneCount(k) === 0) {
        return i;
      }
    }
    return 365;
  }

  function computeBestStreak() {
    if (!state.habits.length) return 0;

    // Best streak across the last 365 days.
    let best = 0;
    let current = 0;

    const end = new Date();
    for (let back = 365; back >= 0; back--) {
      const d = new Date(end);
      d.setDate(d.getDate() - back);
      const k = todayKey(d);
      if (getDayDoneCount(k) > 0) {
        current++;
        if (current > best) best = current;
      } else {
        current = 0;
      }
    }
    return best;
  }

  function syncStreakToState() {
    const current = computeCurrentStreak();
    const best = computeBestStreak();
    state.streak = state.streak || { current: 0, best: 0, history: [] };
    state.streak.current = current;
    state.streak.best = Math.max(state.streak.best || 0, best);
  }

  function ensureXpState() {
    // XP is derived from *today* habit statuses, so we keep xp.total for display only.
    state.xp = state.xp || { total: 0, awarded: {} };
    state.xp.awarded = state.xp.awarded || {};
  }

  const XP_PER_DONE = 10;
  const LEVELS = [
    { name: 'Beginner', minXp: 0, nextXp: 200 },
    { name: 'Focus Master', minXp: 200, nextXp: 500 },
    { name: 'Discipline King', minXp: 500, nextXp: 1000 },
  ];

  function getLevelFromXp(totalXp) {
    const x = Math.max(0, Number(totalXp) || 0);
    if (x >= LEVELS[2].minXp) return { ...LEVELS[2], progressStart: LEVELS[2].minXp };
    if (x >= LEVELS[1].minXp) return { ...LEVELS[1], progressStart: LEVELS[1].minXp };
    return { ...LEVELS[0], progressStart: LEVELS[0].minXp };
  }

  function awardXpForHabitOnDay(habitId, dateKey, statusBefore, statusAfter) {
    // Deprecated by derived today-only XP; kept only to optionally animate.
    // XP total itself is recomputed from today's habit statuses each render.
    ensureXpState();

    const xpGain = document.getElementById('xpGain');
    if (!xpGain) return;

    if (statusAfter === 'done' && statusBefore !== 'done') {
      xpGain.textContent = `+${XP_PER_DONE} XP`;
      xpGain.classList.add('is-show');
      requestAnimationFrame(() => {
        xpGain.classList.remove('is-show');
        requestAnimationFrame(() => xpGain.classList.add('is-show'));
      });
    }

    // Deduction is visual only; real deduction is handled by derived computeXpTotalForToday().
    if (statusAfter !== 'done' && statusBefore === 'done') {
      xpGain.textContent = `-${XP_PER_DONE} XP`;
      xpGain.classList.add('is-show');
      requestAnimationFrame(() => {
        xpGain.classList.remove('is-show');
        requestAnimationFrame(() => xpGain.classList.add('is-show'));
      });
    }
  }

  function computeXpTotalForToday() {
    const tKey = todayKey();
    let doneCount = 0;
    for (const habit of state.habits) {
      if (habit.history?.[tKey] === 'done') doneCount += 1;
    }
    return doneCount * XP_PER_DONE;
  }

  function renderXpUi() {
    ensureXpState();

    // Today-only derived XP (real-time). XP = 10 * number of habits marked done today.
    const total = computeXpTotalForToday();
    state.xp.total = total;

    const xpTotalEl = document.getElementById('xpTotal');
    const xpFillEl = document.getElementById('xpProgressFill');
    const xpPctEl = document.getElementById('xpProgressPct');
    const xpNextLabelEl = document.getElementById('xpNextLabel');
    const levelBadgeEl = document.getElementById('levelBadge');

    if (xpTotalEl) xpTotalEl.textContent = String(total);

    const lvl = getLevelFromXp(total);
    const nextXp = lvl.nextXp;
    const startXp = lvl.progressStart;
    const denom = Math.max(1, nextXp - startXp);
    const progress = Math.max(0, Math.min(1, (total - startXp) / denom));
    const pct = Math.round(progress * 100);

    if (levelBadgeEl) levelBadgeEl.textContent = lvl.name;
    if (xpFillEl) xpFillEl.style.width = `${pct}%`;
    if (xpPctEl) xpPctEl.textContent = `${pct}%`;
    if (xpNextLabelEl) xpNextLabelEl.textContent = `${total < nextXp ? total : nextXp} / ${nextXp}`;
  }



  function renderDashboard() {
    els.todayLabel.textContent = formatToday();
    els.motivationQuote.textContent = pickMotivation();

    const tKey = todayKey();
    const habits = state.habits;

    els.habitList.innerHTML = '';

    let doneCount = 0;
    let totalCount = 0;

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

      const ndBtn = document.createElement('button');
      ndBtn.type = 'button';
      ndBtn.className = 'check-btn';
      ndBtn.textContent = '✕';
      ndBtn.title = 'Not done';
      if (status === 'not_done') ndBtn.classList.add('is-nd');

      doneBtn.addEventListener('click', () => {
        habit.history = habit.history || {};
        const before = habit.history?.[tKey];
        const after = 'done';

        habit.history[tKey] = after;
        // +10 only for done transition; XP total is derived from today's statuses.
        if (before !== 'done') awardXpForHabitOnDay(habit.id, tKey, before, after);
        save();
        renderAll();
      });

      ndBtn.addEventListener('click', () => {
        habit.history = habit.history || {};
        habit.history[tKey] = 'not_done';
        save();
        renderAll();
      });


      actions.appendChild(doneBtn);
      actions.appendChild(ndBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'delete-btn';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Delete habit';

      delBtn.addEventListener('click', () => {
        const ok = confirm(`Delete habit: ${habit.name}?`);
        if (!ok) return;
        deleteHabitById(habit.id);
        renderAll();
      });

      actions.appendChild(delBtn);

      item.appendChild(left);
      item.appendChild(actions);

      els.habitList.appendChild(item);
    }

    els.emptyState.classList.toggle('is-hidden', habits.length !== 0);

    const pct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
    els.progressMeta.textContent = `${pct}% completed`;
    els.progressFill.style.width = `${pct}%`;
    els.progressPct.textContent = `${pct}%`;
    els.progressCounts.textContent = `${doneCount} / ${totalCount}`;


    syncStreakToState();

    // Topbar streak (existing)
    els.streakCount.textContent = String(state.streak?.current ?? 0);

    // XP UI
    renderXpUi();

    // Dashboard streak cards (new)
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

  function formatMonthDayNumber(key) {
    // key: YYYY-MM-DD
    const parts = key.split('-');
    const dd = parts[2] || '01';
    return String(Number(dd)).padStart(2, '0');
  }


  function getMonthLabel(anchor = new Date()) {
    return anchor.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  }

  function renderMonthly() {


    // Runtime guards: this view must never break the whole UI.
    if (!els.monthlyTable || !els.monthRangePill) {
      // eslint-disable-next-line no-console
      console.warn('Monthly UI elements missing:', {
        monthlyTable: !!els.monthlyTable,
        monthRangePill: !!els.monthRangePill,
      });
      return;
    }

    const anchor = new Date();
    const keys = monthKeys(anchor);
    els.monthRangePill.textContent = getMonthLabel(anchor);

    const habits = state.habits || [];

    if (!habits.length) {
      els.monthlyTable.innerHTML =
        '<div class="empty"><div class="empty-ic">★</div><div class="empty-title">No data yet</div><div class="empty-sub">Add a habit to see monthly tracking.</div></div>';
      return;
    }

    // Always wipe and rebuild to avoid partially rendered/blank states.
    els.monthlyTable.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'monthly-table-wrapper';
    // Horizontal scrolling for day-columns. Avoid vertical overflow quirks on mobile.
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
    // Ensure the table is wide enough so the wrapper scrolls instead of collapsing.
    t.style.minWidth = '600px';

    // Header: day numbers across the top.
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
      // Bright text for visibility on dark background.
      th.style.color = 'rgba(255,255,255,.92)';
      th.style.textAlign = 'center';
      trh.appendChild(th);
    }

    thead.appendChild(trh);
    t.appendChild(thead);

    // Body: one row per habit, cells with ✓ / ✕ / —.
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

  function clearMonth() {
    const keys = monthKeys();
    for (const habit of state.habits) {
      if (!habit.history) habit.history = {};
      for (const k of keys) delete habit.history[k];
    }
    save();
    renderAll();
  }

  function renderWeekly() {
    const keys = weekKeys();

    if (els.weekRangePill) {
      els.weekRangePill.textContent = `${keys[0].slice(5).replace('-', '/')} - ${keys[keys.length - 1].slice(5).replace('-', '/')}`;
    }

    const habits = state.habits;
    const wrapper = document.createElement('div');
    wrapper.className = 'weekly-table';

    if (!habits.length) {
      els.weeklyTable.innerHTML = '<div class="empty"><div class="empty-ic">☆</div><div class="empty-title">No data yet</div><div class="empty-sub">Add a habit to see weekly tracking.</div></div>';
      return;
    }

    // Create a fresh table every render to avoid layout/cell mismatch.
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
      const th = document.createElement('th');
      const d = new Date(k + 'T00:00:00');
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



  function renderSettings() {
    // no-op (static UI)
  }

  function renderAll() {
    renderDashboard();
    if (els.viewWeekly && !els.viewWeekly.classList.contains('is-hidden')) renderWeekly();
    if (els.viewMonthly && !els.viewMonthly.classList.contains('is-hidden')) renderMonthly();
    if (els.viewSettings && !els.viewSettings.classList.contains('is-hidden')) renderSettings();
  }

  function addHabit({ name, targetDays }) {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    state.habits.unshift({ id, name, targetDays, createdAt: Date.now(), history: {} });
    save();
  }

  function clearWeek() {
    const keys = weekKeys();
    for (const habit of state.habits) {
      if (!habit.history) habit.history = {};
      for (const k of keys) delete habit.history[k];
    }
    save();
    renderAll();
  }

  function clearAll() {
    state = {
      habits: [],
      xp: { total: 0, awarded: {} },
      streak: { current: 0, best: 0, history: [] },
    };
    save();
    renderAll();
    renderWeekly();
  }



  function bindEvents() {
    // Desktop nav (aside) + Mobile nav buttons (header)
    els.navItems.forEach((b) => {
      b.addEventListener('click', () => {
        showView(b.dataset.view);
        if (b.dataset.view === 'weekly') renderWeekly();
        if (b.dataset.view === 'monthly') renderMonthly();

        // close mobile menu
        if (els.mobileNav && els.mobileNav.classList.contains('is-open')) {
          els.mobileNav.classList.remove('is-open');
        }
      });
    });

    if (els.menuBtn && els.mobileNav) {
      els.menuBtn.addEventListener('click', () => {
        els.mobileNav.classList.toggle('is-open');
      });
    }

    els.newHabitBtn.addEventListener('click', () => {
      openModal();
    });

    els.closeModalBtn.addEventListener('click', closeModal);
    els.cancelModalBtn.addEventListener('click', closeModal);

    els.habitModal.addEventListener('click', (e) => {
      if (e.target === els.habitModal) closeModal();
    });

    els.habitForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = els.habitNameInput.value.trim();
      const targetDays = Number(els.habitTargetInput.value || 7);
      if (!name) return;

      addHabit({ name, targetDays: Math.max(1, Math.min(7, targetDays)) });
      closeModal();
      renderAll();
    });

    els.clearWeekBtn.addEventListener('click', () => {
      clearWeek();
    });

    if (els.clearMonthBtn) {
      els.clearMonthBtn.addEventListener('click', () => {
        clearMonth();
        renderAll();
      });
    }

    els.clearAllBtn.addEventListener('click', () => {
      const ok = confirm('Delete all habits and history stored in this browser?');
      if (!ok) return;
      clearAll();
      showView('dashboard');
    });

    // keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.habitModal.classList.contains('is-open')) closeModal();
    });
  }

  // init
  load();
  bindEvents();
  showView('dashboard');
  renderAll();
})();

