/* =========================================================================
   COFFEE ILLY — ЕДИНЫЙ ДВИЖОК И КОМПОНЕНТЫ MATERIAL DESIGN 3 (M3 v83)
   Реализация по ТЗ: https://chatgpt.com/s/t_6afa4da27e348191b27f463f0ffe9be7
   ========================================================================= */
(function initCoffeeMaterialDesign3() {
  if (typeof window === 'undefined') return;
  if (window.CoffeeMaterialDesign3 && window.CoffeeMaterialDesign3.version === 'M3-v84') return;

  const SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    warning: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    sync: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    camera: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
    inbox: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>'
  };

  const SYNC_STATES = {
    local_saved: { code: 'local_saved', label: 'Сохранено на устройстве', icon: 'sync', role: 'warning' },
    sending: { code: 'sending', label: 'Отправляется', icon: 'sync', role: 'info' },
    server_confirmed: { code: 'server_confirmed', label: 'Подтверждено сервером', icon: 'check', role: 'success' },
    send_error: { code: 'send_error', label: 'Ошибка отправки', icon: 'error', role: 'error' }
  };

  function prefersReducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function attachRipple(e) {
    if (prefersReducedMotion()) return;
    if (typeof document === 'undefined') return;
    const target = e.target && e.target.closest && e.target.closest('button, .btn, .md3-btn, .tab, .bnav-btn, [role="button"]');
    if (!target || target.disabled) return;
    try {
      const rect = target.getBoundingClientRect();
      if (!rect || !rect.width) return;
      const computedPos = window.getComputedStyle(target).position;
      if (computedPos === 'static') target.style.position = 'relative';
      target.style.overflow = 'hidden';

      const prevWaves = target.querySelectorAll('.md-ripple-wave');
      if (prevWaves.length > 2) prevWaves[0].remove();

      const wave = document.createElement('span');
      wave.className = 'md-ripple-wave';
      const size = Math.max(rect.width, rect.height);
      wave.style.width = wave.style.height = size + 'px';
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : (e.clientX || (rect.left + rect.width / 2));
      const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : (e.clientY || (rect.top + rect.height / 2));
      wave.style.left = (clientX - rect.left - size / 2) + 'px';
      wave.style.top = (clientY - rect.top - size / 2) + 'px';
      target.appendChild(wave);
      setTimeout(() => { try { wave.remove(); } catch (_) {} }, 420);
    } catch (_) {}
  }

  // Часть 3: Автоматическое применение классов Material Design 3 к реальным DOM-элементам (статическим и динамическим)
  function upgradeDomToM3(rootOpt) {
    if (typeof document === 'undefined') return 0;
    const root = rootOpt || document;
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    let upgradedCount = 0;

    // 1. Top App Bar
    root.querySelectorAll('header').forEach((el) => {
      if (!el.classList.contains('md3-top-app-bar')) {
        el.classList.add('md3-top-app-bar');
        upgradedCount++;
      }
    });

    // 2. Navigation Bar & Navigation Drawer / Rail
    root.querySelectorAll('#baristaBottomNav').forEach((el) => {
      el.classList.add('md3-navigation-bar');
    });
    root.querySelectorAll('#baristaBottomNav .bnav-btn').forEach((el) => {
      el.classList.add('md3-nav-item');
    });
    root.querySelectorAll('#wsRoleShellHeader, #admin11TabsBar, #owner9TabsBar').forEach((el) => {
      el.classList.add('md3-navigation-drawer');
    });

    // 3. Buttons (Filled, Tonal, Outlined, Icon)
    root.querySelectorAll('button.p, .btn.primary, #btnOk, #btnCameraOnboardingAllow, #quickSubmitPaperCashBtn').forEach((el) => {
      el.classList.add('md3-btn', 'md3-btn-filled');
      upgradedCount++;
    });
    root.querySelectorAll('button.b, .btn.small, #btnInc, #backBtn, #nextBtn').forEach((el) => {
      if (!el.classList.contains('md3-btn-filled')) {
        el.classList.add('md3-btn', 'md3-btn-tonal');
        upgradedCount++;
      }
    });
    root.querySelectorAll('#btnCameraOnboardingLater, #btnCameraRecoveryClose').forEach((el) => {
      el.classList.add('md3-btn', 'md3-btn-outlined');
    });
    root.querySelectorAll('.theme-btn').forEach((el) => {
      el.classList.add('md3-icon-btn');
    });

    // 4. Cards & Surface Hierarchy (Hero vs Standard Container)
    root.querySelectorAll('#card, #cashHeaderCard, #adminExceptionCenterCard').forEach((el) => {
      el.classList.add('md3-card', 'md3-card-hero', 'md3-surface-high');
      upgradedCount++;
    });
    root.querySelectorAll('.card, .panel, .kpi-card, .ws-card, .adm-card, .rep-card, .kanban-col').forEach((el) => {
      el.classList.add('md3-card', 'md3-surface-container');
      upgradedCount++;
    });

    // 5. Outlined Text Fields
    root.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), select, textarea').forEach((el) => {
      el.classList.add('md3-text-field');
      upgradedCount++;
    });

    // 6. Chips & Filters
    root.querySelectorAll('#tabs .tab, .ttk-cat-btn, [data-ttkchip], #repCategoryTabs button, [data-orp]').forEach((el) => {
      el.classList.add('md3-chip');
      upgradedCount++;
    });

    // 7. Dialogs & Mobile Bottom Sheets (with drag handle)
    root.querySelectorAll('dialog:not(#cam)').forEach((dlg) => {
      dlg.classList.add('md3-dialog', 'md3-bottom-sheet');
      if (!dlg.querySelector('.md3-sheet-handle')) {
        const handle = document.createElement('div');
        handle.className = 'md3-sheet-handle';
        handle.setAttribute('aria-hidden', 'true');
        dlg.insertBefore(handle, dlg.firstChild);
      }
      upgradedCount++;
    });

    // 8. Data Tables, Progress Bars & Status Badges
    root.querySelectorAll('table').forEach((el) => {
      el.classList.add('md3-data-table');
      upgradedCount++;
    });
    root.querySelectorAll('.pbar, #progressBar').forEach((el) => {
      el.classList.add('md3-linear-progress');
    });
    root.querySelectorAll('.net-pill, .tag, .pill').forEach((el) => {
      el.classList.add('md3-status-badge');
    });

    return upgradedCount;
  }

  function openBottomSheet(dlgOrId) {
    if (typeof document === 'undefined') return;
    const dlg = typeof dlgOrId === 'string' ? document.getElementById(dlgOrId) : dlgOrId;
    if (!dlg) return;
    dlg.classList.add('md3-dialog', 'md3-bottom-sheet');
    try {
      if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
      else { dlg.setAttribute('open', ''); dlg.hidden = false; }
    } catch (_) {
      dlg.setAttribute('open', '');
      dlg.hidden = false;
    }
  }

  function closeBottomSheet(dlgOrId) {
    if (typeof document === 'undefined') return;
    const dlg = typeof dlgOrId === 'string' ? document.getElementById(dlgOrId) : dlgOrId;
    if (!dlg) return;
    try {
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
    } catch (_) {}
    dlg.removeAttribute('open');
    dlg.hidden = true;
  }

  function icon(name) {
    return SVG_ICONS[name] || SVG_ICONS.check;
  }

  function getSyncStatusMeta(stateKey) {
    return SYNC_STATES[stateKey] || SYNC_STATES.local_saved;
  }

  function renderEmptyState(title, subtitle, actionHtmlOpt) {
    return (
      '<div class="md3-empty-state" role="status">' +
        '<div class="md3-empty-icon">' + icon('inbox') + '</div>' +
        '<div class="md3-empty-title">' + String(title || 'Нет данных') + '</div>' +
        (subtitle ? '<div class="md3-empty-sub">' + String(subtitle) + '</div>' : '') +
        (actionHtmlOpt ? '<div class="md3-empty-actions">' + actionHtmlOpt + '</div>' : '') +
      '</div>'
    );
  }

  function renderSkeleton(linesOpt) {
    const count = Math.max(1, Number(linesOpt) || 3);
    let html = '<div class="md3-skeleton-wrap" aria-busy="true" aria-label="Загрузка данных">';
    for (let i = 0; i < count; i++) {
      html += '<div class="md3-skeleton-line" style="width:' + (i === count - 1 ? '68%' : '100%') + '"></div>';
    }
    html += '</div>';
    return html;
  }

  function showSnackbar(message, isErrorOpt) {
    if (typeof document === 'undefined') return;
    const t = document.getElementById('toast');
    if (t) {
      t.textContent = String(message || '');
      t.className = 'toast md3-snackbar show' + (isErrorOpt ? ' bad' : '');
      setTimeout(() => { try { t.classList.remove('show'); } catch (_) {} }, 2800);
    }
  }

  if (typeof document !== 'undefined') {
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('pointerdown', attachRipple, { passive: true });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => upgradeDomToM3(document));
      } else {
        upgradeDomToM3(document);
      }
    }
    if (document.documentElement) {
      document.documentElement.setAttribute('data-design-system', 'material-3');
    }
    if (typeof MutationObserver === 'function' && document.body) {
      let rafPending = false;
      const obs = new MutationObserver(() => {
        if (rafPending) return;
        rafPending = true;
        setTimeout(() => {
          rafPending = false;
          upgradeDomToM3(document);
        }, 60);
      });
      try { obs.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    }
  }

  
  function syncThemeColorMeta() {
    try {
      if (typeof document === "undefined") return;
      const t = document.documentElement.getAttribute("data-theme") || "light";
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta && document.head) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      if (meta) {
        meta.setAttribute("content", t === "dark" ? "#18120E" : "#FFFBF8");
      }
    } catch (_) {}
  }
  try {
    syncThemeColorMeta();
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.documentElement) {
      new MutationObserver(syncThemeColorMeta).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
  } catch (_) {}

  window.CoffeeMaterialDesign3 = {
    syncThemeColorMeta,
    version: 'M3-v86',
    isEnabled: () => true,
    prefersReducedMotion,
    attachRipple,
    upgradeDomToM3,
    openBottomSheet,
    closeBottomSheet,
    icon,
    SYNC_STATES,
    getSyncStatusMeta,
    renderEmptyState,
    renderSkeleton,
    showSnackbar
  };
})();
