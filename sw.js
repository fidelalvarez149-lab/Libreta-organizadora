/* Libreta Organizadora — service worker (funciona sin internet)
   Sube el número de versión cuando cambies archivos de la app. */
const VERSION = 'libreta-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'
];

// Si un archivo falta en el servidor, el service worker igual se instala
// (antes un solo 404 hacía fallar toda la instalación).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // la tasa del dólar va directo a internet

  // Abre al instante desde el caché y se actualiza en segundo plano.
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
      return new Response('', { status: 504 });
    })
  );
});
