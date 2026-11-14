/* ЕДИНСТВЕННОЕ место с номером версии. Меняйте командой: node tools/bump-version.js 53
   Используется страницами (очистка старых кэшей) и sw.js (имя кэша через importScripts). */
(function (g) {
  g.COFFEE_VERSION = 'v65';
  g.COFFEE_CACHE_NAME = 'kofeinya-enterprise-' + g.COFFEE_VERSION;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    /* При смене версии один раз удаляем старые кэши (в т.ч. в Telegram WebView) и обновляем сервис-воркер. */
    if (localStorage.getItem('coffee_sw_ver') === g.COFFEE_VERSION) return;
    localStorage.setItem('coffee_sw_ver', g.COFFEE_VERSION);
    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then(function (ks) { ks.forEach(function (k) { if (k !== g.COFFEE_CACHE_NAME) caches.delete(k); }); });
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { try { r.update(); } catch (_) {} }); });
    }
  } catch (_) {}
})(typeof self !== 'undefined' ? self : this);
