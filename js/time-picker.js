/**
 * Coffee Illy — Apple iOS Liquid Glass Scroll-Wheel 24h Time Picker (v97.15.3)
 * Точный выбор времени до минуты (00–23 ч, 00–59 мин) пролистыванием барабанов,
 * тапом по значению, колёсиком мыши или клавиатурой (Esc / Enter).
 */
(function (global) {
  'use strict';

  function pad2(n) {
    return String(Math.max(0, Math.min(59, Number(n) || 0))).padStart(2, '0');
  }

  function parseHHMM(val) {
    var m = String(val || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: 8, m: 30 };
    return {
      h: Math.max(0, Math.min(23, Number(m[1]) || 0)),
      m: Math.max(0, Math.min(59, Number(m[2]) || 0))
    };
  }

  var activeOverlay = null;

  function open(opts) {
    opts = opts || {};
    if (activeOverlay && activeOverlay.parentNode) {
      activeOverlay.parentNode.removeChild(activeOverlay);
    }
    var parsed = parseHHMM(opts.value || '08:30');
    var hour = parsed.h;
    var minute = parsed.m;
    var ITEM_H = 42;

    var overlay = document.createElement('div');
    overlay.className = 'm3-tp-overlay ios-tp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    activeOverlay = overlay;

    function close() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (activeOverlay === overlay) activeOverlay = null;
    }

    function commit() {
      var res = pad2(hour) + ':' + pad2(minute);
      close();
      if (typeof opts.onSelect === 'function') opts.onSelect(res);
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') commit();
    }
    document.addEventListener('keydown', onKey);

    var hItems = '';
    for (var h = 0; h < 24; h++) {
      hItems += '<div class="ios-tp-item' + (h === hour ? ' active' : '') + '" data-v="' + h + '">' + pad2(h) + '</div>';
    }
    var mItems = '';
    for (var mn = 0; mn < 60; mn++) {
      mItems += '<div class="ios-tp-item' + (mn === minute ? ' active' : '') + '" data-v="' + mn + '">' + pad2(mn) + '</div>';
    }

    overlay.innerHTML =
      '<div class="m3-tp-dialog ios-tp-sheet">' +
        '<div class="m3-sel-handle"></div>' +
        '<div class="ios-tp-head">' +
          '<button type="button" class="m3-tp-btn" data-act="cancel">Отмена</button>' +
          '<div class="ios-tp-title">' + (opts.title || 'Выбор времени') + '</div>' +
          '<button type="button" class="m3-tp-btn primary" data-act="ok">Готово</button>' +
        '</div>' +
        '<div class="ios-tp-live"><span data-live-h>' + pad2(hour) + '</span><span class="ios-tp-sep">:</span><span data-live-m>' + pad2(minute) + '</span></div>' +
        '<div class="ios-tp-wheels">' +
          '<div class="ios-tp-lens" aria-hidden="true"></div>' +
          '<div class="ios-tp-col">' +
            '<div class="ios-tp-col-lbl">Часы</div>' +
            '<div class="ios-tp-wheel" data-wheel="hour">' +
              '<div class="ios-tp-spacer"></div>' + hItems + '<div class="ios-tp-spacer"></div>' +
            '</div>' +
          '</div>' +
          '<div class="ios-tp-colon" aria-hidden="true">:</div>' +
          '<div class="ios-tp-col">' +
            '<div class="ios-tp-col-lbl">Минуты</div>' +
            '<div class="ios-tp-wheel" data-wheel="minute">' +
              '<div class="ios-tp-spacer"></div>' + mItems + '<div class="ios-tp-spacer"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var hWheel = overlay.querySelector('[data-wheel="hour"]');
    var mWheel = overlay.querySelector('[data-wheel="minute"]');
    var liveH = overlay.querySelector('[data-live-h]');
    var liveM = overlay.querySelector('[data-live-m]');

    function markActive(wheel, val) {
      var nodes = wheel.querySelectorAll('.ios-tp-item');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle('active', i === val);
      }
    }

    function scrollWheelTo(wheel, val, smooth) {
      if (!wheel) return;
      if (smooth && wheel.scrollTo) {
        wheel.scrollTo({ top: val * ITEM_H, behavior: 'smooth' });
      } else {
        wheel.scrollTop = val * ITEM_H;
      }
      markActive(wheel, val);
    }

    function wireWheel(wheel, maxVal, onChange) {
      var snapTimer = null;
      wheel.addEventListener('scroll', function () {
        var idx = Math.max(0, Math.min(maxVal, Math.round(wheel.scrollTop / ITEM_H)));
        onChange(idx);
        clearTimeout(snapTimer);
        snapTimer = setTimeout(function () {
          var finalIdx = Math.max(0, Math.min(maxVal, Math.round(wheel.scrollTop / ITEM_H)));
          if (Math.abs(wheel.scrollTop - finalIdx * ITEM_H) > 1) {
            scrollWheelTo(wheel, finalIdx, true);
          }
        }, 90);
      }, { passive: true });

      wheel.addEventListener('click', function (e) {
        var it = e.target && e.target.closest ? e.target.closest('.ios-tp-item') : null;
        if (!it) return;
        var v = Number(it.getAttribute('data-v'));
        if (!isNaN(v)) {
          onChange(v);
          scrollWheelTo(wheel, v, true);
        }
      });
    }

    wireWheel(hWheel, 23, function (v) {
      if (v !== hour) {
        hour = v;
        if (liveH) liveH.textContent = pad2(hour);
        markActive(hWheel, hour);
        if (global && global.CoffeeHaptic && global.CoffeeHaptic.select) global.CoffeeHaptic.select();
      }
    });

    wireWheel(mWheel, 59, function (v) {
      if (v !== minute) {
        minute = v;
        if (liveM) liveM.textContent = pad2(minute);
        markActive(mWheel, minute);
        if (global && global.CoffeeHaptic && global.CoffeeHaptic.select) global.CoffeeHaptic.select();
      }
    });

    overlay.querySelector('[data-act="cancel"]').onclick = close;
    overlay.querySelector('[data-act="ok"]').onclick = commit;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      scrollWheelTo(hWheel, hour, false);
      scrollWheelTo(mWheel, minute, false);
    });
  }

  function bindInput(inp) {
    if (!inp || inp._iosTpBound) return;
    inp._iosTpBound = true;
    inp.addEventListener('click', function (e) {
      if (inp.disabled) return;
      e.preventDefault();
      var title = inp.getAttribute('aria-label') || 'Выбор времени';
      var fld = inp.closest ? inp.closest('.field') : null;
      if (fld) {
        var lbl = fld.querySelector('label');
        if (lbl && lbl.textContent) title = lbl.textContent.trim();
      }
      open({
        title: title,
        value: inp.value || '08:00',
        onSelect: function (val) {
          inp.value = val;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  }

  function bindAll(root) {
    if (typeof document === 'undefined') return;
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('input[data-time-picker="1"]');
    for (var i = 0; i < list.length; i++) bindInput(list[i]);
  }

  if (typeof document !== 'undefined') {
    var boot = function () {
      bindAll(document);
      if (typeof MutationObserver !== 'undefined' && document.body) {
        new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var added = muts[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              var n = added[j];
              if (n && n.nodeType === 1) {
                if (n.matches && n.matches('input[data-time-picker="1"]')) bindInput(n);
                else if (n.querySelectorAll) bindAll(n);
              }
            }
          }
        }).observe(document.body, { childList: true, subtree: true });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  var api = { open: open, parseHHMM: parseHHMM, pad2: pad2, bindAll: bindAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.CoffeeTimePicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
