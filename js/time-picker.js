/**
 * Coffee Illy — Google Pixel Material 3 Circular 24h Time Picker (v97.0.0)
 * Работает на Android, iOS, macOS и Windows (touch + mouse + keyboard Esc/Enter).
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

  function open(opts) {
    opts = opts || {};
    var parsed = parseHHMM(opts.value || '08:30');
    var hour = parsed.h;
    var minute = parsed.m;
    var mode = 'hour'; // 'hour' | 'minute'

    var overlay = document.createElement('div');
    overlay.className = 'm3-tp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    function close() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
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

    function render() {
      var isHour = mode === 'hour';
      var angle = isHour ? ((hour % 12) * 30) : (minute * 6);
      var handLen = isHour ? (hour >= 12 || hour === 0 ? 64 : 94) : 94;

      var itemsHtml = '';
      if (isHour) {
        // Внешний круг: 1..12 (12 сверху), внутренний круг: 13..23 + 00
        for (var i = 1; i <= 12; i++) {
          var rad = ((i % 12) * 30 - 90) * Math.PI / 180;
          var x = 122 + 94 * Math.cos(rad);
          var y = 122 + 94 * Math.sin(rad);
          var valOut = i === 12 ? 12 : i;
          var selOut = hour === valOut;
          itemsHtml += '<div class="m3-tp-num' + (selOut ? ' selected' : '') + '" data-v="' + valOut + '" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px">' + pad2(valOut) + '</div>';
        }
        for (var j = 13; j <= 24; j++) {
          var valIn = j === 24 ? 0 : j;
          var radIn = ((valIn % 12) * 30 - 90) * Math.PI / 180;
          var xi = 122 + 64 * Math.cos(radIn);
          var yi = 122 + 64 * Math.sin(radIn);
          var selIn = hour === valIn;
          itemsHtml += '<div class="m3-tp-num inner' + (selIn ? ' selected' : '') + '" data-v="' + valIn + '" style="left:' + xi.toFixed(1) + 'px;top:' + yi.toFixed(1) + 'px">' + pad2(valIn) + '</div>';
        }
      } else {
        for (var k = 0; k < 60; k += 5) {
          var radM = (k * 6 - 90) * Math.PI / 180;
          var xm = 122 + 94 * Math.cos(radM);
          var ym = 122 + 94 * Math.sin(radM);
          var selM = Math.round(minute / 5) * 5 % 60 === k;
          itemsHtml += '<div class="m3-tp-num' + (selM ? ' selected' : '') + '" data-v="' + k + '" style="left:' + xm.toFixed(1) + 'px;top:' + ym.toFixed(1) + 'px">' + pad2(k) + '</div>';
        }
      }

      overlay.innerHTML =
        '<div class="m3-tp-dialog">' +
          '<div class="m3-tp-title">' + (opts.title || 'Выберите время') + '</div>' +
          '<div class="m3-tp-readout">' +
            '<button type="button" class="m3-tp-seg' + (isHour ? ' active' : '') + '" data-seg="hour">' + pad2(hour) + '</button>' +
            '<span class="m3-tp-colon">:</span>' +
            '<button type="button" class="m3-tp-seg' + (!isHour ? ' active' : '') + '" data-seg="minute">' + pad2(minute) + '</button>' +
          '</div>' +
          '<div class="m3-tp-dial">' +
            '<div class="m3-tp-hand" style="height:' + handLen + 'px;transform:translate(-50%,-100%) rotate(' + angle + 'deg)"></div>' +
            '<div class="m3-tp-center"></div>' +
            itemsHtml +
          '</div>' +
          '<div class="m3-tp-actions">' +
            '<button type="button" class="m3-tp-btn" data-act="cancel">Отмена</button>' +
            '<button type="button" class="m3-tp-btn primary" data-act="ok">Готово</button>' +
          '</div>' +
        '</div>';

      overlay.querySelector('[data-seg="hour"]').onclick = function () { mode = 'hour'; render(); };
      overlay.querySelector('[data-seg="minute"]').onclick = function () { mode = 'minute'; render(); };
      overlay.querySelector('[data-act="cancel"]').onclick = close;
      overlay.querySelector('[data-act="ok"]').onclick = commit;

      overlay.querySelectorAll('.m3-tp-num').forEach(function (el) {
        el.onclick = function () {
          var v = Number(el.getAttribute('data-v'));
          if (mode === 'hour') {
            hour = v;
            mode = 'minute';
          } else {
            minute = v;
          }
          render();
        };
      });
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    render();
    document.body.appendChild(overlay);
  }

  var api = { open: open, parseHHMM: parseHHMM, pad2: pad2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.CoffeeTimePicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
