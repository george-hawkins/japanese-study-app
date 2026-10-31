// Network-first service worker: when online the latest deployed version is
// always used (so there's no version number to bump), and the cached copy is
// used when offline or when the network is too slow. App data lives in
// localStorage and is never touched by updates.

const CACHE = 'daruma-shell';
const TIMEOUT = 3000;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/sync.js', 'js/github.js', 'js/markdown.js',
  'js/settings.js', 'js/ui.js', 'js/version.js', 'js/merge.js', 'js/kanji.js', 'js/corrections.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // e.g. api.github.com
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request.url, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT)),
    ]);
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request.url, { ignoreSearch: true })) ||
      (request.mode === 'navigate' && (await cache.match('index.html')));
    return cached || Response.error();
  }
}
