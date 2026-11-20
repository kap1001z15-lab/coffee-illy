const CACHE_NAME = 'coffee-illy-v931-m3soft-prod';
const CORE = ['./', './index.html', './owner.html', './config.js', './js/pos-csv-parser-v93.js', './js/cloud-sync-v95.js', './js/m3-controls-v95.js', './js/finance-analytics-v95.js', './js/camera-v94.js', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url || '';
  if (url.indexOf('script.google.com') >= 0 || url.indexOf('telegram.org') >= 0 || url.indexOf('drive.google.com') >= 0) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
