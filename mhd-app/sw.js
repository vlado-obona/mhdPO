// Service worker — offline cache aplikácie aj cestovných poriadkov.
// Shell: cache-first s aktualizáciou na pozadí. Dataset: podľa version.json.
const SHELL = 'mhd-shell-v2';
const DATA = 'mhd-data-v1';
const SHELL_FILES = [
  './', 'index.html', 'app.css', 'app.js', 'raptor.js', 'simple.css', 'simple.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' – do novej cache nesmie ísť stará index.html z HTTP cache vedľa nového app.js
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // mapové dlaždice a pod. — necháme sieti

  // dataset: stale-while-revalidate (query ?v= zabezpečí novú verziu)
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      caches.open(DATA).then(async (c) => {
        const hit = await c.match(e.request);
        const net = fetch(e.request).then((res) => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }

  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
