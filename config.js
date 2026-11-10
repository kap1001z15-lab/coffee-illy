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

window.coffeeMediaHtml = function (url, label) {
  const resolved = window.CoffeeIDB ? window.CoffeeIDB.getPhotoSync(url) : url;
  const u = String(resolved || '').trim();
  const safeLabel = window.escapeAttr ? window.escapeAttr(label || 'Фото') : 'Фото';
  if (!u) return '';
  const safeUrl = window.escapeAttr ? window.escapeAttr(u) : u;
  if (/^data:video\/|\.(mp4|webm|mov)(\?|$)/i.test(u)) {
    return '<video src="' + safeUrl + '" controls playsinline style="max-width:160px;max-height:110px;border-radius:8px;border:1px solid var(--border);background:#000"></video>';
  }
  return '<a href="' + safeUrl + '" target="_blank" rel="noopener"><img class="ph" src="' + safeUrl + '" alt="' + safeLabel + '" loading="lazy"></a>';
};
