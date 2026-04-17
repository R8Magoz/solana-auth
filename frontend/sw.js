/* Solana PWA — app shell + fonts. Cross-origin API calls are not intercepted (network + app offline queue). */
const CACHE = 'solana-shell-v4';

const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

const FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap';

/** Same-origin API-style paths (if ever co-hosted); always bypass SW cache. */
const NET_ONLY_PREFIXES = ['/auth', '/expenses', '/reports', '/admin', '/ai', '/health'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all([
          ...SHELL.map((u) => cache.add(u).catch(() => {})),
          cache.add(FONT_STYLESHEET).catch(() => {}),
        ])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/sw.js') return;

  if (NET_ONLY_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))) {
    return;
  }

  const isNavigation = req.mode === 'navigate';
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation || wantsHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
