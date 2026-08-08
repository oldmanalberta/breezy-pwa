/* Service worker: cache the app shell so Breezy opens instantly and works
   offline (the last forecast is kept separately in localStorage). */

const VERSION = 'breezy-v14';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './fonts/Aileron-Light.otf',
  './fonts/Aileron-Regular.otf',
  './fonts/Aileron-Bold.otf',
  './js/app.js',
  './js/store.js',
  './js/icons.js',
  './js/render.js',
  './js/fx.js',
  './js/radar.js',
  './js/flow.js',
  './js/wind.js',
  './js/sources/index.js',
  './js/sources/eccc.js',
  './js/sources/openmeteo.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('precache failed', err)),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache weather APIs — always go to the network, and fail fast to the
  // app's own localStorage cache rather than serving a stale forecast here.
  if (url.origin !== self.location.origin) return;

  // App shell: network-first, falling back to cache when offline.
  //
  // Cache-first would launch a few milliseconds faster, but it also means an
  // edited file keeps serving the old copy until the *next* load — which makes
  // "I changed the code and nothing happened" the normal experience. This app
  // needs the network for a forecast anyway, and the whole shell is well under
  // 100 KB, so preferring the network costs nothing real and keeps updates
  // instant. Offline still works: every successful response is cached below.
  /* cache: 'reload' matters more than it looks.
   *
   * GitHub Pages serves every file with Cache-Control: max-age=600, and a plain
   * fetch() inside a service worker still consults the browser's HTTP cache. So
   * "network-first" was quietly serving up to ten-minute-old JavaScript after a
   * deploy — which produced the genuinely baffling combination of a fresh
   * index.html running against a stale app.js, where new markup existed but
   * nothing was wired to it. Bypass the HTTP cache and let the Cache Storage
   * copy below be the only fallback. */
  e.respondWith(
    fetch(new Request(request, { cache: 'reload' }))
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
