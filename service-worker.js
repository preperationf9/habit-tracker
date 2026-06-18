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

const CACHE_NAME = 'habitTracker.shell.v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Cache core shell assets; do not attempt to precache large blobs.
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(['./', './index.html', './index_fixed.html', './style.css', './manifest.json', './icon.png', './script.js']);
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
          if (k !== CACHE_NAME) return caches.delete(k);
          return Promise.resolve();
        })
      );
      self.clients.claim();
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

