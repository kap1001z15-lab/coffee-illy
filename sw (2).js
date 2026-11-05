/* Кофейня: офлайн-оболочка. Страницы и скрипты — сначала из сети (всегда свежая версия), при плохой связи за 3 с — из кэша.
   Картинки — из кэша. Данные (Google Apps Script) идут напрямую в сеть и сюда не попадают. */
const V = 'kofeinya-v6', SHELL = ['./', 'index.html', 'dashboard.html', 'report.html', 'admin.html', 'config.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
const key = (r) => r.url.split('?')[0];
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.search.indexOf('action=') >= 0) return;   // запросы к API не кэшируем
  const fresh = r.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/');
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(key(r), { ignoreSearch: true });
    if (!fresh && hit) return hit;
    const net = fetch(r).then((res) => { if (res.ok) c.put(key(r), res.clone()); return res; });
    try { return await Promise.race([net, new Promise((_, no) => setTimeout(no, hit ? 3000 : 15000))]); }
    catch (err) { return hit || (r.mode === 'navigate' ? c.match('index.html') : Response.error()); }
  }));
});
