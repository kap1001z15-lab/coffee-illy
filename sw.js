/* Service Worker — Cache-First с фоновым обновлением для статики (CSS/JS/иконки) и Network-First для HTML и GAS API (T7) */
importScripts('./version.js');
const CACHE_NAME = self.COFFEE_CACHE_NAME;
const STATIC_ASSETS = [
  './',
  './index.html',
  './version.js',
  './dashboard.html',
  './report.html',
  './admin.html',
  './owner.html',
  './barista.html',
  './diag.html',
  './owner_admin_app.html',
  './barista_terminal.html',
  './css/tokens.css',
  './css/components.css',
  './icons/ui.svg',
  './css/styles.css',
  './css/terminal.css',
  './css/owner.css',
  './css/light.css',
  './config.js',
  './app.js',
  './js/theme.js',
  './js/defaults.js',
  './js/security.js',
  './js/storage.js',
  './js/analytics.js',
  './js/sales-reconciliation.js',
  './js/material-design.js',
  './js/camera-permission.js',
  './js/sync.js',
  './js/telegram.js',
  './js/camera.js',
  './js/page-terminal.js',
  './js/page-admin.js',
  './js/page-owner.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg'
];

function isCacheFirstStaticAsset(pathname) {
  return /\/(css|js|icons)\//.test(pathname) ||
    /\/(version|config|app)\.js$/.test(pathname) ||
    /manifest\.webmanifest$/.test(pathname);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. Запросы к Google Apps Script API — Network-First с офлайн-ответом
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true, error: 'Офлайн-режим: запрос к серверу недоступен; локальная очередь API используется приложением' }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      )
    );
    return;
  }

  // 2. Статические ресурсы (css/, js/, icons/, manifest.webmanifest, version.js) — Cache-First с фоновым обновлением
  if (isCacheFirstStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req, { ignoreSearch: true }).then((cachedResponse) => {
          const networkUpdate = fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              cache.put(req, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          }).catch(() => cachedResponse);
          return cachedResponse || networkUpdate;
        })
      )
    );
    return;
  }

  // 3. HTML-документы и навигация — Network-First с резервным возвратом из кэша
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || caches.match('./index.html')))
  );
});
