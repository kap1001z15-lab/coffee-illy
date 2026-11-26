/* Coffee Illy ERP & Checklist — Service Worker v98.4.0 */
const CACHE_NAME = 'coffee-illy-v98-4-0';
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
  './js/custom-select.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

function fetchWithSwTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SW_NET_TIMEOUT')), ms || 4000);
    fetch(req).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.allSettled(CORE_ASSETS.map((u) => cache.add(u).catch(() => {}))))
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

  // Никогда не кэшируем API-запросы Google Apps Script / Google APIs / Telegram SDK
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com') || url.hostname.includes('telegram.org') || url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    return;
  }

  const isNav = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  const isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isNav) {
    const isDash = url.pathname.endsWith('dashboard.html') || url.pathname.endsWith('owner.html');
    event.respondWith(
      fetchWithSwTimeout(req, 4000)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match(isDash ? './dashboard.html' : './index.html')))
    );
    return;
  }

  if (isCode) {
    // Для JS/CSS никогда не возвращаем index.html в качестве фолбэка (иначе SyntaxError)
    event.respondWith(
      fetchWithSwTimeout(req, 4000)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((cached) => cached || new Response('', { status: 503, statusText: 'Offline' })))
    );
    return;
  }

  // Stale-while-revalidate для иконок и манифеста
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
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
