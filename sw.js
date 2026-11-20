/* Coffee Illy ERP & Checklist — Service Worker v97.9.0 */
const CACHE_NAME = 'coffee-illy-v97-9-0';
const CORE_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './owner.html',
  './config.js',
  './version.js',
  './manifest.webmanifest',
  './css/m3-soft.css',
  './js/camera.js',
  './js/cloud-sync.js',
  './js/pos-csv-parser.js',
  './js/time-picker.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Никогда не кэшируем API-запросы Google Apps Script / Google APIs
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com') || url.hostname.includes('telegram.org')) {
    return;
  }

  // Network-first для HTML и config.js (чтобы обновления приходили мгновенно, но офлайн всё открывалось)
  const isHtmlOrConfig = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (isHtmlOrConfig) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Stale-while-revalidate для JS/CSS/иконок
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
