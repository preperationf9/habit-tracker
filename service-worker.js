/*
  HabitTracker Alarm Service Worker

  Constraints:
  - Web apps cannot reliably run JS timers when fully closed.
  - Service Worker can show notifications via push/sync triggers when available.

  This SW is intentionally minimal and safe:
  - Receives alarm events from the page and calls showNotification() when possible.
  - Caches the app shell (basic offline support).

  Integration points are implemented in script.js.
*/

// Bump cache name when changing offline behavior.
const CACHE_NAME = 'habitTracker.shell.v2';

// (Intentionally only used for readability; caching is done via explicit addAll below.)
const SHELL_CACHE_URLS = [
  '/',
  '/index.html',
  '/index_fixed.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icon.png',
  '/privacy.html',
  '/icons',
  '/sounds/alarm1.mp3',
  '/sounds/alarm2.mp3',
  '/sounds/alarm3.mp3',
  '/sounds/alarm4.mp3',
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Cache required app-shell assets only.
      // Note: use absolute paths starting with '/' to match navigator.serviceWorker.register('/service-worker.js') scope.
      await cache.addAll([
        '/',
        '/index.html',
        '/index_fixed.html',
        '/style.css',
        '/script.js',
        '/manifest.json',
        '/icon.png',
        '/privacy.html',
        '/sounds/alarm1.mp3',
        '/sounds/alarm2.mp3',
        '/sounds/alarm3.mp3',
        '/sounds/alarm4.mp3',
      ]);

      // Cache icons directory entries if present (best-effort).
      // If /icons contains multiple files, they will be requested normally and handled by cache-first.

      self.skipWaiting();
    })()
  );
});


self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          // Safe cleanup: remove only old shell caches.
          if (k.startsWith('habitTracker.shell.') && k !== CACHE_NAME) return caches.delete(k);
          return Promise.resolve();
        })
      );
      self.clients.claim();
    })()
  );
});

function isProbablyAppNavigation(request) {
  // For documents and navigations, respond with cached shell.
  return request.mode === 'navigate' || request.destination === 'document' || request.headers.get('accept')?.includes('text/html');
}

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never interfere with external URLs / Firebase / cloud APIs.
  // Only handle same-origin requests.
  if (!isSameOrigin(url)) return;

  // Navigation: offline app shell routing.
  if (request.method === 'GET' && isProbablyAppNavigation(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          // If online, try network first (keeps fresh).
          const networkResp = await fetch(request);
          return networkResp;
        } catch (e) {
          // Offline: return cached index_fixed.html (preferred).
          const fixed = await cache.match('/index_fixed.html');
          if (fixed) return fixed;
          const fallback = await cache.match('/index.html');
          if (fallback) return fallback;
          // Final fallback: if nothing cached, let the request fail.
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // Assets: cache-first for same-origin static app shell assets.
  if (request.method !== 'GET') return;

  const assetCache = caches.open(CACHE_NAME);

  event.respondWith(
    (async () => {
      const cache = await assetCache;

      // Only do cache-first for likely static assets.
      const accept = request.headers.get('accept') || '';
      const path = url.pathname;
      const isAsset =
        path.startsWith('/sounds/') ||
        path.startsWith('/icons/') ||
        path === '/style.css' ||
        path === '/script.js' ||
        path === '/manifest.json' ||
        path === '/icon.png' ||
        path === '/privacy.html' ||
        path === '/index.html' ||
        path === '/index_fixed.html' ||
        accept.includes('text/css') ||
        accept.includes('application/javascript');

      if (!isAsset) {
        // Don’t cache/app-shell-route unknown same-origin requests.
        // Let network handle them.
        return fetch(request);
      }

      const cached = await cache.match(url.pathname);
      if (cached) return cached;

      try {
        const resp = await fetch(request);
        // Best-effort: cache the fetched asset.
        if (resp && resp.ok) cache.put(url.pathname, resp.clone());
        return resp;
      } catch (e) {
        // Offline and not in cache: fail naturally for non-shell assets.
        return cached || Promise.reject(e);
      }
    })()
  );
});


self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== 'object') return;

  // Expected message shape:
  // { kind: 'ALARM_NOTIFICATION', payload: { title, body, tag, icon } }
  if (data.kind !== 'ALARM_NOTIFICATION') return;

  const payload = data.payload || {};
  const title = typeof payload.title === 'string' ? payload.title : 'Habit reminder';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'habit-alarm';
  const icon = typeof payload.icon === 'string' ? payload.icon : './icon.png';

  const options = {
    body,
    tag,
    icon,
    renotify: true,
    // Do not add actions to keep it minimal and cross-browser.
  };

  event.waitUntil(self.registration.showNotification(title, options));
});


