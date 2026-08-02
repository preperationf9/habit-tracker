/* =====================================================================
   spatial-effects.js — Spatial Glass 3D visual interactions (ADDITIVE)
   ---------------------------------------------------------------------
   This file ONLY enhances visuals / pointer interactions.
   It NEVER touches app logic, state, storage, DOM content or business
   rules. It never calls preventDefault/stopPropagation on app elements.

   Features:
   • Subtle 3D card tilt (only on cards that are safe to transform)
   • Magnetic glass buttons
   • Pointer-driven spotlight + ambient lighting shift
   • Spatial modal close animation (visual only)
   • Respects prefers-reduced-motion
   • Pauses while the page is hidden
   • Disables expensive effects on touch / low-end devices
   ===================================================================== */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var touchDevice =
    'ontouchstart' in window || (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0);
  var lowEnd =
    typeof navigator.hardwareConcurrency === 'number' &&
    navigator.hardwareConcurrency > 0 &&
    navigator.hardwareConcurrency <= 2;

  // Only run live pointer effects on capable devices.
  var interactive = finePointer && !touchDevice && !lowEnd && !reducedMotion;

  var root = document.documentElement;

  // Neutral defaults (also used by CSS fallbacks).
  root.style.setProperty('--px', '0.5');
  root.style.setProperty('--py', '0.5');

  var raf = null;
  var hidden = document.hidden;
  var lastX = window.innerWidth / 2;
  var lastY = window.innerHeight / 2;
  var curMagnetic = null;
  var curCard = null;

  // Elements allowed to move toward the pointer (magnetic).
  var MAGNETIC_SELECTOR =
    '.glow-btn, .ghost-btn, .danger-btn, .check-btn, .delete-btn, .icon-btn, .nav-item, .alarm-bell-btn, .month-nav-btn, .hamburger';

  // Cards safe to tilt: #card-habits is EXCLUDED because it hosts the
  // viewport-anchored alarm popover and must never create a containing block.
  var TILT_SELECTOR =
    '.card:not(#card-habits), .modal-card, .auth-overlay-card, .streak-card, .analytics .metric';

  var spotlight = document.querySelector('.spatial-spotlight');

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function schedule() {
    if (raf !== null) return;
    raf = requestAnimationFrame(update);
  }

  function update() {
    raf = null;
    if (hidden) return;

    var w = window.innerWidth;
    var h = window.innerHeight;
    var px = clamp(lastX / w, 0, 1);
    var py = clamp(lastY / h, 0, 1);

    root.style.setProperty('--px', px.toFixed(4));
    root.style.setProperty('--py', py.toFixed(4));

    if (spotlight) {
      var sx = px * w;
      var sy = py * h;
      spotlight.style.transform =
        'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0) translate(-50%,-50%)';
    }

    if (curMagnetic) {
      var r = curMagnetic.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      curMagnetic.style.setProperty('--mx', clamp(lastX - cx, -5, 5).toFixed(2));
      curMagnetic.style.setProperty('--my', clamp(lastY - cy, -5, 5).toFixed(2));
    }

    if (curCard) {
      var rc = curCard.getBoundingClientRect();
      if (rc.width > 0 && rc.height > 0) {
        var nx = clamp(((lastX - rc.left) / rc.width) * 2 - 1, -1, 1);
        var ny = clamp(((lastY - rc.top) / rc.height) * 2 - 1, -1, 1);
        curCard.style.setProperty('--htx', (-ny * 1.4).toFixed(3) + 'deg');
        curCard.style.setProperty('--hty', (nx * 1.8).toFixed(3) + 'deg');
      }
    }
  }

  function resetCardVars(el) {
    if (!el) return;
    el.style.setProperty('--htx', '0deg');
    el.style.setProperty('--hty', '0deg');
  }

  function resetMagneticVars(el) {
    if (!el) return;
    el.style.setProperty('--mx', '0');
    el.style.setProperty('--my', '0');
  }

  if (interactive) {
    document.addEventListener(
      'pointermove',
      function (e) {
        if (hidden) return;
        lastX = e.clientX;
        lastY = e.clientY;

        var t = e.target;
        var m = t && t.closest ? t.closest(MAGNETIC_SELECTOR) : null;
        if (m !== curMagnetic) {
          resetMagneticVars(curMagnetic);
          curMagnetic = m;
        }

        var c = t && t.closest ? t.closest(TILT_SELECTOR) : null;
        if (c !== curCard) {
          resetCardVars(curCard);
          curCard = c;
        }

        schedule();
      },
      { passive: true },
    );

    window.addEventListener(
      'pointerout',
      function (e) {
        if (e.relatedTarget) return;
        resetMagneticVars(curMagnetic);
        resetCardVars(curCard);
        curMagnetic = null;
        curCard = null;
        schedule();
      },
    );

    document.addEventListener('visibilitychange', function () {
      hidden = document.hidden;
      if (!hidden) schedule();
    });

    // Initial placement (center).
    schedule();
  }

  // ------------------------------------------------------------------
  // Spatial modal close animation (visual only).
  // Adds a temporary .is-closing class when a .modal loses .is-open,
  // letting CSS play a reverse depth transition before hiding.
  // ------------------------------------------------------------------
  var CLOSE_MS = 260;
  var modals = Array.prototype.slice.call(document.querySelectorAll('.modal'));
  modals.forEach(function (modal) {
    if (!modal || modal.__spatialModalBound) return;
    modal.__spatialModalBound = true;

    var mo = new MutationObserver(function () {
      if (modal.classList.contains('is-open')) {
        if (modal.classList.contains('is-closing')) {
          modal.classList.remove('is-closing');
          delete modal.dataset.spatialClosing;
        }
        return;
      }
      if (modal.dataset.spatialClosing) return;
      modal.dataset.spatialClosing = '1';
      modal.classList.add('is-closing');
      setTimeout(function () {
        modal.classList.remove('is-closing');
        delete modal.dataset.spatialClosing;
      }, CLOSE_MS);
    });

    mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
})();

