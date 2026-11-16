/* ЕДИНЫЙ ИСТОЧНИК ВЕРСИИ ПРИЛОЖЕНИЯ COFFEE ILLY (v86)
   Используется всеми HTML-страницами, модулями JS и Service Worker (sw.js). */
(function (g) {
  g.COFFEE_VERSION = 'v86';
  g.COFFEE_APP_VERSION = 'v86';
  g.COFFEE_BUILD_NUMBER = 86;
  g.COFFEE_DESIGN_SYSTEM = 'Material Design 3 (Coffee Illy Premium v86)';
  g.COFFEE_CACHE_NAME = 'kofeinya-enterprise-' + g.COFFEE_VERSION;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
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
