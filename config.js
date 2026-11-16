/* =========================================================================
   ЯДРО КООРДИНАЦИИ И ЗАГРУЗЧИК МОДУЛЕЙ (config.js — v21 Enterprise Edition)
   Архитектура разделена на независимые кэшируемые модули:
   - js/defaults.js   : Стартовый каталог задач, ТТК, таймлайн, планы Пн–Вс, SHA-256 хеши PIN
   - js/security.js   : SHA-256, защита от перебора (5 попыток / 15 мин), токены сессии (coffeeAuth), XSS-фильтр
   - js/storage.js    : IndexedDB-движок (CoffeeIDB) с выгрузкой фотографий из localStorage
   - js/analytics.js  : Контроль таймлайна, планы по дням недели, детектор «Красных флагов» робота, P&L
   - js/sync.js       : Поэлементная дельта-синхронизация (delta_sync по id + updatedAt + Set-Union)
   - js/telegram.js   : Серверная отправка уведомлений через Google Apps Script (UrlFetchApp)
   ========================================================================= */

window.coffeeBus = (function () {
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('coffee_system_sync') : null;
  const listeners = [];
  if (ch) {
    ch.onmessage = (e) => {
      if (e && e.data) listeners.forEach((fn) => { try { fn(e.data); } catch (_) {} });
    };
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'coffee_sync_signal' && e.newValue) {
        try {
          const d = JSON.parse(e.newValue);
          listeners.forEach((fn) => { try { fn(d); } catch (_) {} });
        } catch (_) {}
      }
    });
  }
  return {
    emit(type, detail) {
      const msg = { type, detail: detail || {}, ts: Date.now() };
      if (ch) { try { ch.postMessage(msg); } catch (_) {} }
      try { localStorage.setItem('coffee_sync_signal', JSON.stringify(msg)); } catch (_) {}
      listeners.forEach((fn) => { try { fn(msg); } catch (_) {} });
    },
    on(fn) {
      if (typeof fn === 'function') listeners.push(fn);
    }
  };
})();

function _iso(d) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function _isoToday() { return _iso(new Date()); }
function _shiftIso(s, n) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return _iso(d);
}

function normalizeSettingKey(rawKey) {
  const k = String(rawKey || '').trim();
  const low = k.toLowerCase();
  if (k === 'LOCATION' || /назван|точк|кофейн|локац/.test(low)) return 'LOCATION';
  if (k === 'PLAN' || /^план выручки|^план на день|^цель/.test(low)) return 'PLAN';
  if (k === 'OPEN_START' || /начал.*открыт/.test(low)) return 'OPEN_START';
  if (k === 'DEADLINE' || /дедлайн.*открыт|дедлайн смен/.test(low)) return 'DEADLINE';
  if (k === 'DAY_START' || /начал.*дн/.test(low)) return 'DAY_START';
  if (k === 'DAY_DEADLINE' || /дедлайн.*дн/.test(low)) return 'DAY_DEADLINE';
  if (k === 'CLOSE_START' || /начал.*закрыт/.test(low)) return 'CLOSE_START';
  if (k === 'CLOSE_DEADLINE' || /дедлайн.*закрыт/.test(low)) return 'CLOSE_DEADLINE';
  if (k === 'WO_NORM' || /норм.*списан/.test(low)) return 'WO_NORM';
  if (k === 'MIN_AVG_CHECK' || /средн.*чек/.test(low)) return 'MIN_AVG_CHECK';
  if (k === 'PLAN_CHECKS' || /план.*чек/.test(low)) return 'PLAN_CHECKS';
  if (k === 'PHOTO_ALL' || /фото.*шаг|обязат.*фото/.test(low)) return 'PHOTO_ALL';
  if (k === 'INIT_COUNTER' || /счетчик|счётчик/.test(low)) return 'INIT_COUNTER';
  if (k === 'COFFEE_DELTA_NORM' || /дельта.*кофе|погрешност.*счётчик/.test(low)) return 'COFFEE_DELTA_NORM';
  if (k === 'CATEGORIES' || /статьи|категор/.test(low)) return 'CATEGORIES';
  if (k === 'TG_TOKEN' || /tg.*token|токен.*бот/.test(low)) return 'TG_TOKEN';
  if (k === 'TG_CHAT' || /tg.*chat|чат.*админ/.test(low)) return 'TG_CHAT';
  if (k === 'ADMIN_PIN' || /код доступ|пин|pin|парол/.test(low)) return 'ADMIN_PIN';
  return k;
}

window._iso = _iso;
window._isoToday = _isoToday;
window._shiftIso = _shiftIso;
window.normalizeSettingKey = normalizeSettingKey;

window.coffeeCache = {
  get(k) {
    try {
      const o = JSON.parse(localStorage.getItem('cc:' + k) || 'null');
      if (!o || !o.v) return null;
      const act = k.indexOf('dash:') === 0 ? 'dashboard' : k.indexOf('rep:') === 0 ? 'report' : k;
      return typeof enforceSettingsOnResponse === 'function' ? enforceSettingsOnResponse(act, o.v) : o.v;
    } catch (e) { return null; }
  },
  set(k, v) {
    try {
      localStorage.setItem('cc:' + k, JSON.stringify({ t: Date.now(), v }));
    } catch (e) {}
  },
  invalidate(prefix) {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.indexOf('cc:') === 0 && (!prefix || prefix === 'all' || k.indexOf('cc:' + prefix) === 0)) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
  }
};

window.coffeeRuErr = function (e) {
  const m = String((e && e.message) || e || '');
  if (/RATE_LIMIT/i.test(m)) return m.replace(/^RATE_LIMIT:\s*/i, '');
  if (/PIN_REQUIRED|FORBIDDEN/i.test(m)) return 'Сессия истекла или код доступа неверный. Войдите заново.';
  if (/AbortError|timeout/i.test(m)) return 'Сервер отвечает дольше обычного — показаны сохранённые данные';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Работаем в автономном режиме (очередь дельта-синхронизации активна)';
  return 'Ошибка обмена: ' + m;
};

window.coffeeCleanTime = function (v) {
  if (!v) return '';
  const s = String(v).trim();
  if (!s) return '';
  // Если строка содержит дату + время 1899 из Google Sheets (например "2026-11-13 Sat Dec 30 1899 12:20:00 GMT+0155...")
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})\s+/.exec(s);
  const tmMatch = /(\d{1,2}:\d{2})(?::\d{2})?/.exec(isoPrefix ? s.slice(isoPrefix[0].length) : s);
  if (tmMatch && (s.indexOf('1899') >= 0 || s.indexOf('GMT') >= 0 || /^\d{1,2}:\d{2}(:\d{2})?$/.test(s))) {
    const p = tmMatch[1].split(':');
    const hhmm = ('0' + p[0]).slice(-2) + ':' + p[1];
    return isoPrefix ? (isoPrefix[1] + ' ' + hhmm) : hhmm;
  }
  return s;
};

window.coffeeMediaHtml = function (url, label) {
  const resolved = window.CoffeeIDB ? window.CoffeeIDB.getPhotoSync(url) : url;
  const u = String(resolved || '').trim();
  const safeLabel = window.escapeAttr ? window.escapeAttr(label || 'Фото') : 'Фото';
  if (!u || /^(нет|no|false|—|-|null|undefined)$/i.test(u)) return '';
  if (/^idb:\/\/photo\//i.test(u)) {
    const safeRef = window.escapeAttr ? window.escapeAttr(u) : u;
    return '<div class="idb-lazy-photo" data-idb-ref="' + safeRef + '" data-idb-label="' + safeLabel + '" style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;border:1px solid var(--line,#2c3a3e);background:var(--bg,#12191b);font-size:12px;color:var(--muted,#8fa3a8)">📷 Фото в памяти терминала (' + safeLabel + ')</div>';
  }
  if (!/^(data:|blob:|https?:\/\/)/i.test(u)) return '';
  let imgSrc = u;
  let linkHref = u;
  const drvMatch = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i.exec(u) || /[?&]id=([a-zA-Z0-9_-]+)/i.exec(u);
  if (drvMatch && drvMatch[1]) {
    imgSrc = 'https://drive.google.com/thumbnail?id=' + drvMatch[1] + '&sz=w1000';
    linkHref = 'https://drive.google.com/file/d/' + drvMatch[1] + '/view';
  }
  const safeImg = window.escapeAttr ? window.escapeAttr(imgSrc) : imgSrc;
  const safeHref = window.escapeAttr ? window.escapeAttr(linkHref) : linkHref;
  if (/^data:video\/|\.(mp4|webm|mov)(\?|$)/i.test(u)) {
    return '<video src="' + safeHref + '" controls playsinline style="max-width:160px;max-height:110px;border-radius:8px;border:1px solid var(--border);background:#000;margin-top:6px"></video>';
  }
  return '<a href="' + safeHref + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;text-decoration:none">' +
    '<img class="ph" src="' + safeImg + '" alt="' + safeLabel + '" loading="lazy" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'inline-flex\'">' +
    '<span style="display:none;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;border:1px solid var(--line,#2c3a3e);background:var(--bg,#12191b);font-size:12px;color:var(--ink,#f6ece2)">📎 Открыть медиафайл (' + safeLabel + ') ↗</span>' +
  '</a>';
};
