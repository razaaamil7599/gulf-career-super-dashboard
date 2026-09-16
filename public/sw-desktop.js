// sw-desktop.js — offline cache for the Gulf Career Gateway DESKTOP app only.
//
// The web dashboard itself is NOT a PWA and does not register this file —
// see app/layout.tsx's DesktopSyncClient, which only calls
// navigator.serviceWorker.register() when it detects the Electron wrapper's
// user agent marker. That keeps this entirely opt-in and invisible to normal
// browser users of the dashboard.
//
// Strategy: network-first for every same-origin GET (page shell, JS/CSS
// chunks, and API responses). Every successful response is cached; when the
// network fails (offline / net down), the last cached copy is served instead
// so the app still opens and shows the last-known candidates/chats instead
// of a blank screen.

const CACHE_NAME = 'gcg-desktop-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// getCandidates() etc. append a `_t=<timestamp>` cache-buster so every call
// has a unique URL — strip it (and any other one-off params) before using
// the URL as a cache key, otherwise nothing would ever hit the cache.
function cacheKeyFor(request) {
  const url = new URL(request.url);
  url.searchParams.delete('_t');
  return new Request(url.toString(), { method: 'GET' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Firebase/Meta/Google calls

  const cacheKey = cacheKeyFor(request);

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(cacheKey);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('/dashboard');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
