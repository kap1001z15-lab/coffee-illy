const CACHE = 'coffee-illy-v94-premium-minimal';
const ASSETS = ['./', './index.html', './owner.html', './dashboard.html', './css/coffee-illy-v94.css', './config.js', './version.js', './js/cloud-sync-v94.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('script.google.com')) return;
  e.respondWith(fetch(e.request).then((r) => {
    const cp = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, cp)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request)));
});
