/* Service Worker v48 — Network-First для мгновенной синхронизации в Telegram Mini App (ILLY_BOT) и браузере */
const CACHE_NAME = 'kofeinya-enterprise-v48-tg-sync';
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
  './css/light.css',
  './config.js',
  './app.js',
  './js/defaults.js',
  './js/security.js',
  './js/storage.js',
  './js/analytics.js',
  './js/sync.js',
  './js/telegram.js',
  './js/camera.js',
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

  // Запросы к Google Apps Script API всегда идут напрямую в сеть без кэша
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

  // Network-First для HTML, JS, CSS (чтобы Telegram Mini App ILLY_BOT всегда получал актуальный код)
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
