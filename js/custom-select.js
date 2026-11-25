/* ==========================================================================
   Coffee Illy ERP & Checklist — Custom Select Bottom-Sheet / Dialog (v97.18.0)
   Replaces ugly native Android/OS <select> popups with a theme-matched
   bottom sheet (phones) / dialog (tablet & desktop) while keeping 100%
   compatibility with underlying <select>.value and change events.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var activeOverlay = null;
  var escBound = false;

  function closeSheet() {
    if (activeOverlay && activeOverlay.parentNode) {
      activeOverlay.parentNode.removeChild(activeOverlay);
    }
    activeOverlay = null;
  }

  function getSelectLabel(sel) {
    if (sel.getAttribute('aria-label')) return sel.getAttribute('aria-label');
    if (sel.dataset && sel.dataset.title) return sel.dataset.title;
    var field = sel.closest ? sel.closest('.field') : null;
    if (field) {
      var lbl = field.querySelector('label');
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    return 'Выберите вариант';
  }

  function syncTrigger(sel, btn) {
    if (!sel || !btn) return;
    var opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    var labelSpan = btn.querySelector('.m3-sel-val');
    if (labelSpan) {
      labelSpan.textContent = opt ? opt.textContent : '—';
    }
    btn.disabled = !!sel.disabled;
    btn.setAttribute('aria-disabled', sel.disabled ? 'true' : 'false');
    if (sel.style && sel.style.display === 'none') {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
  }

  function openSheet(sel, btn) {
    if (sel.disabled) return;
    closeSheet();

    var overlay = document.createElement('div');
    overlay.className = 'm3-sel-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var sheet = document.createElement('div');
    sheet.className = 'm3-sel-sheet';

    var handle = document.createElement('div');
    handle.className = 'm3-sel-handle';
    sheet.appendChild(handle);

    var head = document.createElement('div');
    head.className = 'm3-sel-head';
    var title = document.createElement('div');
    title.className = 'm3-sel-title';
    title.textContent = getSelectLabel(sel);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'm3-sel-close';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.textContent = '✕';
    closeBtn.onclick = closeSheet;
    head.appendChild(title);
    head.appendChild(closeBtn);
    sheet.appendChild(head);

    var list = document.createElement('div');
    list.className = 'm3-sel-list';

    var opts = Array.prototype.slice.call(sel.options || []);
    var selectedEl = null;
    opts.forEach(function (opt, idx) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'm3-sel-opt' + (idx === sel.selectedIndex ? ' active' : '');
      item.disabled = !!opt.disabled;

      var txt = document.createElement('span');
      txt.className = 'm3-sel-opt-txt';
      txt.textContent = opt.textContent;
      item.appendChild(txt);

      var chk = document.createElement('span');
      chk.className = 'm3-sel-opt-chk';
      chk.textContent = idx === sel.selectedIndex ? '✓' : '';
      item.appendChild(chk);

      if (idx === sel.selectedIndex) selectedEl = item;

      item.onclick = function () {
        if (opt.disabled) return;
        var changed = sel.selectedIndex !== idx;
        sel.selectedIndex = idx;
        sel.value = opt.value;
        syncTrigger(sel, btn);
        closeSheet();
        if (changed) {
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        try { btn.focus(); } catch (_) {}
      };
      list.appendChild(item);
    });

    sheet.appendChild(list);
    overlay.appendChild(sheet);
    overlay.onclick = function (e) {
      if (e.target === overlay) closeSheet();
    };

    document.body.appendChild(overlay);
    activeOverlay = overlay;

    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && activeOverlay) {
          closeSheet();
        }
      });
    }

    if (selectedEl && selectedEl.scrollIntoView) {
      try { selectedEl.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }
  }

  function enhanceSelect(sel) {
    if (!sel || sel.tagName !== 'SELECT') return;
    if (sel.multiple || sel.size > 1) return;
    if (sel.hasAttribute('data-native-select')) return;
    if (sel._m3SelectBtn && sel._m3SelectBtn.isConnected) {
      syncTrigger(sel, sel._m3SelectBtn);
      return;
    }

    sel.classList.add('m3-select-native');
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm3-select-trigger';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.innerHTML =
      '<span class="m3-sel-val"></span>' +
      '<svg class="m3-sel-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    if (sel.parentNode) {
      sel.parentNode.insertBefore(btn, sel.nextSibling);
    }
    sel._m3SelectBtn = btn;
    syncTrigger(sel, btn);

    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      openSheet(sel, btn);
    };

    sel.addEventListener('change', function () { syncTrigger(sel, btn); });
  }

  function enhanceAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('select');
    for (var i = 0; i < list.length; i++) {
      enhanceSelect(list[i]);
    }
  }

  function init() {
    enhanceAll(document);
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var obs = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'childList') {
            if (m.target && m.target.tagName === 'SELECT') {
              syncTrigger(m.target, m.target._m3SelectBtn);
            }
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n && n.nodeType === 1) {
                if (n.tagName === 'SELECT') enhanceSelect(n);
                else if (n.querySelectorAll) enhanceAll(n);
              }
            }
          } else if (m.type === 'attributes' && m.target && m.target.tagName === 'SELECT') {
            syncTrigger(m.target, m.target._m3SelectBtn);
          }
        }
      });
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'style']
      });
    }
  }

  window.CoffeeCustomSelect = { enhanceAll: enhanceAll, close: closeSheet };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ==========================================================================
   Coffee Illy ERP — Native Telegram HapticFeedback Engine (v97.18.0)
   Zero-dependency, silent fallback outside Telegram Mini App
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  function getHf() {
    try { return window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback; }
    catch (_) { return null; }
  }
  var Haptic = {
    tap: function (style) {
      var hf = getHf();
      if (hf && hf.impactOccurred) try { hf.impactOccurred(style || 'light'); } catch (_) {}
    },
    select: function () {
      var hf = getHf();
      if (hf && hf.selectionChanged) try { hf.selectionChanged(); } catch (_) {}
    },
    success: function () {
      var hf = getHf();
      if (hf && hf.notificationOccurred) try { hf.notificationOccurred('success'); } catch (_) {}
    },
    error: function () {
      var hf = getHf();
      if (hf && hf.notificationOccurred) try { hf.notificationOccurred('error'); } catch (_) {}
    },
    warn: function () {
      var hf = getHf();
      if (hf && hf.notificationOccurred) try { hf.notificationOccurred('warning'); } catch (_) {}
    }
  };
  window.CoffeeHaptic = Haptic;

  document.addEventListener('pointerdown', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.bnav button, .admin-nav button, .date-pill, .pin-key, .btn-lg, .chip-btn, .cat-card, .m3-sel-opt, .m3-select-trigger') : null;
    if (!t || t.disabled) return;
    if (t.matches('.bnav button, .admin-nav button, .date-pill, .m3-sel-opt')) {
      Haptic.select();
    } else {
      Haptic.tap('light');
    }
  }, { passive: true });
})();
