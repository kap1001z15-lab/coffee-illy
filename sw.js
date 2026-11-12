/* Service Worker v22 — Offline-First PWA с раздельным кэшированием модулей JS, CSS, HTML и иконок */
const CACHE_NAME = 'kofeinya-enterprise-v22.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './report.html',
  './admin.html',
  './owner.html',
  './barista.html',
  './css/styles.css',
  './css/terminal.css',
  './css/dashboard.css',
  './css/report.css',
  './css/admin.css',
  './css/owner.css',
  './config.js',
  './app.js',
  './js/defaults.js',
  './js/security.js',
  './js/storage.js',
  './js/analytics.js',
  './js/sync.js',
  './js/telegram.js',
  './js/page-terminal.js',
  './js/page-admin.js',
  './js/page-dashboard.js',
  './js/page-report.js',
  './js/page-owner.js',
  './tests/unit-tests.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
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

  // Запросы к Google Apps Script API никогда не берём из статики — только сеть с офлайн-ответом
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true, error: 'Офлайн-режим: запрос к серверу недоступен; локальная очередь API используется приложением' }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      )
    );
    return;
  }

  // Для локальной статики (CSS, JS, иконки, HTML) — Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const netFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || netFetch;
    })
  );
});
