/**
 * Coffee Illy — Apple Liquid Retina 24h Time Picker (v97.18.0)
 * Двойной режим: мгновенный ручной ввод с клавиатуры (ПК Windows/macOS, авто-формат ЧЧ:ММ,
 * стрелки ↑/↓, авто-переход Часы → Минуты, Enter) + плавные барабаны Apple (00–23 / 00–59)
 * с точностью до минуты для сенсорных экранов.
 */
(function (global) {
  'use strict';

  function pad2(n) {
    return String(Math.max(0, Math.min(59, Number(n) || 0))).padStart(2, '0');
  }

  function parseHHMM(val) {
    var raw = String(val || '').trim();
    var m = raw.match(/^(\d{1,2})\s*[:.,-]\s*(\d{1,2})$/);
    if (m) {
      return {
        h: Math.max(0, Math.min(23, Number(m[1]) || 0)),
        m: Math.max(0, Math.min(59, Number(m[2]) || 0))
      };
    }
    var digits = raw.replace(/\D/g, '');
    if (digits.length >= 3) {
      var hPart = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
      var mPart = digits.length === 3 ? digits.slice(1, 3) : digits.slice(2, 4);
      return {
        h: Math.max(0, Math.min(23, Number(hPart) || 0)),
        m: Math.max(0, Math.min(59, Number(mPart) || 0))
      };
    }
    if (digits.length > 0 && digits.length <= 2) {
      return {
        h: Math.max(0, Math.min(23, Number(digits) || 0)),
        m: 0
      };
    }
    return { h: 8, m: 30 };
  }

  function formatTimeInput(val) {
    var p = parseHHMM(val);
    return pad2(p.h) + ':' + pad2(p.m);
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

    function syncFromInputs() {
      if (liveH) {
        var hv = Number(String(liveH.value || '').replace(/\D/g, ''));
        if (!isNaN(hv)) hour = Math.max(0, Math.min(23, hv));
      }
      if (liveM) {
        var mv = Number(String(liveM.value || '').replace(/\D/g, ''));
        if (!isNaN(mv)) minute = Math.max(0, Math.min(59, mv));
      }
    }

    function commit() {
      syncFromInputs();
      var res = pad2(hour) + ':' + pad2(minute);
      close();
      if (typeof opts.onSelect === 'function') opts.onSelect(res);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
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
        '<div class="ios-tp-manual" aria-label="Ручной ввод времени">' +
          '<input type="text" inputmode="numeric" maxlength="2" autocomplete="off" class="ios-tp-num-in" data-live-h value="' + pad2(hour) + '" aria-label="Часы">' +
          '<span class="ios-tp-sep">:</span>' +
          '<input type="text" inputmode="numeric" maxlength="2" autocomplete="off" class="ios-tp-num-in" data-live-m value="' + pad2(minute) + '" aria-label="Минуты">' +
        '</div>' +
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
    var isSyncingWheel = false;

    function markActive(wheel, val) {
      var nodes = wheel.querySelectorAll('.ios-tp-item');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle('active', i === val);
      }
    }

    function scrollWheelTo(wheel, val, smooth) {
      if (!wheel) return;
      isSyncingWheel = true;
      if (smooth && wheel.scrollTo) {
        wheel.scrollTo({ top: val * ITEM_H, behavior: 'smooth' });
      } else {
        wheel.scrollTop = val * ITEM_H;
      }
      markActive(wheel, val);
      setTimeout(function () { isSyncingWheel = false; }, 160);
    }

    function setHour(v, fromInput) {
      var clamped = ((Number(v) || 0) % 24 + 24) % 24;
      hour = clamped;
      if (!fromInput && liveH) liveH.value = pad2(hour);
      markActive(hWheel, hour);
      if (fromInput) scrollWheelTo(hWheel, hour, true);
    }

    function setMinute(v, fromInput) {
      var clamped = ((Number(v) || 0) % 60 + 60) % 60;
      minute = clamped;
      if (!fromInput && liveM) liveM.value = pad2(minute);
      markActive(mWheel, minute);
      if (fromInput) scrollWheelTo(mWheel, minute, true);
    }

    function wireManualInput(inp, maxVal, setter, nextInp) {
      if (!inp) return;
      inp.addEventListener('focus', function () {
        setTimeout(function () { if (inp.select) inp.select(); }, 0);
      });
      inp.addEventListener('input', function () {
        var digits = String(inp.value || '').replace(/\D/g, '').slice(0, 2);
        inp.value = digits;
        if (!digits) return;
        var num = Number(digits);
        if (num > maxVal) {
          num = maxVal;
          inp.value = pad2(num);
        }
        setter(num, true);
        if (digits.length === 2 && nextInp) {
          nextInp.focus();
          if (nextInp.select) nextInp.select();
        }
      });
      inp.addEventListener('blur', function () {
        var digits = String(inp.value || '').replace(/\D/g, '');
        var num = digits === '' ? (maxVal === 23 ? hour : minute) : Math.max(0, Math.min(maxVal, Number(digits)));
        setter(num, true);
        inp.value = pad2(num);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          var curUp = maxVal === 23 ? hour : minute;
          setter(curUp + 1, true);
          inp.value = pad2(maxVal === 23 ? hour : minute);
          if (inp.select) inp.select();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          var curDn = maxVal === 23 ? hour : minute;
          setter(curDn - 1, true);
          inp.value = pad2(maxVal === 23 ? hour : minute);
          if (inp.select) inp.select();
        } else if (e.key === ':' && nextInp) {
          e.preventDefault();
          nextInp.focus();
          if (nextInp.select) nextInp.select();
        }
      });
    }

    wireManualInput(liveH, 23, setHour, liveM);
    wireManualInput(liveM, 59, setMinute, null);

    function wireWheel(wheel, maxVal, onChange) {
      var snapTimer = null;
      wheel.addEventListener('scroll', function () {
        if (isSyncingWheel) return;
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
        setHour(v, false);
        if (global && global.CoffeeHaptic && global.CoffeeHaptic.select) global.CoffeeHaptic.select();
      }
    });

    wireWheel(mWheel, 59, function (v) {
      if (v !== minute) {
        setMinute(v, false);
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
      var isDesktopPointer = global && global.matchMedia && global.matchMedia('(pointer: fine)').matches;
      if (isDesktopPointer && liveH) {
        liveH.focus();
        if (liveH.select) liveH.select();
      }
    });
  }

  function bindInput(inp) {
    if (!inp || inp._iosTpBound) return;
    inp._iosTpBound = true;
    inp.removeAttribute('readonly');
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('maxlength', '5');
    inp.setAttribute('autocomplete', 'off');
    if (!inp.getAttribute('placeholder')) inp.setAttribute('placeholder', 'ЧЧ:ММ');

    function getFieldTitle() {
      var title = inp.getAttribute('aria-label') || 'Выбор времени';
      var fld = inp.closest ? inp.closest('.field') : null;
      if (fld) {
        var lbl = fld.querySelector('label');
        if (lbl && lbl.textContent) title = lbl.textContent.trim();
      }
      return title;
    }

    function openPickerForInput() {
      if (inp.disabled) return;
      open({
        title: getFieldTitle(),
        value: inp.value || '08:00',
        onSelect: function (val) {
          inp.value = val;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }

    // Wrap input with a sleek Liquid Glass clock trigger button
    if (inp.parentNode && !(inp.parentNode.classList && inp.parentNode.classList.contains('ios-tp-field-wrap'))) {
      var wrap = document.createElement('div');
      wrap.className = 'ios-tp-field-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      var trig = document.createElement('button');
      trig.type = 'button';
      trig.className = 'ios-tp-trigger';
      trig.setAttribute('aria-label', 'Выбрать время из списка');
      trig.setAttribute('title', 'Открыть выбор времени');
      trig.innerHTML = '<svg class="ui-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
      trig.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPickerForInput();
      });
      wrap.appendChild(trig);
    }

    // Direct keyboard typing with smart HH:MM formatting
    inp.addEventListener('focus', function () {
      var isCoarse = global && global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
      if (!isCoarse && inp.select) {
        setTimeout(function () { inp.select(); }, 0);
      }
    });

    inp.addEventListener('input', function () {
      var raw = String(inp.value || '');
      var cleaned = raw.replace(/[^\d:]/g, '');
      if (cleaned.indexOf(':') === -1 && cleaned.length >= 3) {
        cleaned = cleaned.slice(0, 2) + ':' + cleaned.slice(2, 4);
      }
      if (cleaned.length > 5) cleaned = cleaned.slice(0, 5);
      if (cleaned !== raw) inp.value = cleaned;
    });

    inp.addEventListener('blur', function () {
      if (!String(inp.value || '').trim()) return;
      var formatted = formatTimeInput(inp.value);
      if (inp.value !== formatted) {
        inp.value = formatted;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        var p = parseHHMM(inp.value || '08:00');
        var total = p.h * 60 + p.m + (e.key === 'ArrowUp' ? 1 : -1);
        total = ((total % 1440) + 1440) % 1440;
        inp.value = pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
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

  var api = { open: open, parseHHMM: parseHHMM, formatTimeInput: formatTimeInput, pad2: pad2, bindAll: bindAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.CoffeeTimePicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
