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
// NOTE: bump is required to avoid mobile getting stale cached auth code / index.
// v6: Spatial Glass 3D asset cache — stale-while-revalidate so returning
//     users pick up the new UI on their next visit without waiting for a
//     full SW reinstall round-trip.
const CACHE_NAME = "habitTracker.shell.v6";

// (Intentionally only used for readability; caching is done via explicit addAll below.)
// Keep list for readability (install uses a concrete addAll for guaranteed required files)
const SHELL_CACHE_URLS = [
  "/",
  "/index.html",
  "/style.css?v=3d-2026",
  "/script.js?v=3d-2026",
  "/spatial-effects.js?v=3d-2026",
  "/manifest.json",
  "/privacy.html",
  "/icon.png",
  "/icon-192.png",
  "/icon-512.png",

  // Sounds (used by app)
  "/sounds/alarm1.mp3",
  "/sounds/alarm2.mp3",
  "/sounds/alarm3.mp3",
  "/sounds/alarm4.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Skip waiting so the new SW activates immediately after install.
      const cache = await caches.open(CACHE_NAME);

      // Cache required app-shell assets.
      // IMPORTANT: keep this list limited to app shell + static assets (no auth endpoints).
      // Note: use absolute paths starting with '/' to match navigator.serviceWorker.register('/service-worker.js') scope.
      // Cache with graceful failure: ignore missing assets (e.g., some mp3s)
      // so install/install-prompt never fails in offline DevTools mode.
      const urlsToCache = [
        '/',
        '/index.html',
        '/style.css?v=3d-2026',
        '/script.js?v=3d-2026',
        '/spatial-effects.js?v=3d-2026',
        '/manifest.json',
        '/privacy.html',
        '/firebaseConfig.js',
        '/icon.png',
        '/icon-512.png',

        '/sounds/alarm1.mp3',
        '/sounds/alarm2.mp3',
        '/sounds/alarm3.mp3',
        '/sounds/alarm4.mp3',
      ];

      await Promise.all(
        urlsToCache.map(async (u) => {
          try {
            const resp = await fetch(u, { cache: 'no-store' });
            if (resp && resp.ok) await cache.put(u, resp.clone());
          } catch {
            // ignore
          }
        })
      );

      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove only old shell caches (automatic cache versioning).
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (k.startsWith("habitTracker.shell.") && k !== CACHE_NAME) {
            return caches.delete(k);
          }
          return Promise.resolve();
        }),
      );

      // Activate new SW immediately.
      self.clients.claim();
    })(),
  );
});

function isProbablyAppNavigation(request) {
  // For documents and navigations, respond with cached shell.
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    request.headers.get("accept")?.includes("text/html")
  );
}

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Hard bypass: never intercept /api/* (no respondWith, no caching, no index fallback).
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Never interfere with external URLs / Firebase / cloud APIs.
  // Only handle same-origin requests.
  if (!isSameOrigin(url)) return;

// Network-first with cache fallback for the app shell navigation.
  // Requirement: app must open without internet after first load/install.
  if (request.method === "GET" && isProbablyAppNavigation(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          // If online, try network first.
          const networkResp = await fetch(request);
          return networkResp;
        } catch (e) {
          // Offline: always return cached shell (index).
          const cachedIndex = await cache.match("/index.html");
          if (cachedIndex) return cachedIndex;

          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
          });
        }
      })(),
    );
    return;
  }

  // Stale-while-revalidate for static assets (CSS/JS/images/icons/sounds).
  //
  // WHY: cache-first caused the Spatial Glass 3D upgrade to be invisible for
  // returning users/PWAs — the old style.css/script.js stayed in the cache and
  // was served forever (until a full SW reinstall round-trip). Stale-while-
  // revalidate serves the cached copy instantly for offline/performance, but
  // ALWAYS re-fetches from the network in the background and refreshes the
  // cache. Returning users therefore see the new UI on their next visit.
  if (request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const accept = request.headers.get("accept") || "";
      const path = url.pathname;

      // Do NOT cache/serve Firebase authentication endpoints or OAuth redirects.
      const looksLikeFirebaseAuthEndpoint =
        path.includes("/__/auth") ||
        path.includes("/__/redirect") ||
        path.includes("/__/auth/handler") ||
        path.includes("identitytoolkit") ||
        path.includes("securetoken") ||
        // googleapis auth + OAuth redirect flows
        path.includes("googleapis") ||
        path.includes("oauth") ||
        path.includes("/oauth") ||
        path.includes("/__auth") ||
        path.includes("/__redirect");

      if (looksLikeFirebaseAuthEndpoint) {
        return fetch(request);
      }

      const isStaticAsset =
        path === "/style.css" ||
        path === "/script.js" ||
        path === "/spatial-effects.js" ||
        path === "/firebaseConfig.js" ||
        path === "/manifest.json" ||
        path === "/privacy.html" ||
        path === "/icon.png" ||
        path === "/icon-192.png" ||
        path === "/icon-512.png" ||
        path.startsWith("/sounds/") ||
        path.startsWith("/icons/") ||
        accept.includes("text/css") ||
        accept.includes("application/javascript") ||
        accept.includes("image/") ||
        path.endsWith(".png") ||
        path.endsWith(".jpg") ||
        path.endsWith(".jpeg") ||
        path.endsWith(".svg") ||
        path.endsWith(".mp3");

      if (!isStaticAsset) {
        return fetch(request);
      }

      // Match against BOTH the exact URL and the plain path so that
      // cache-busted requests (e.g. style.css?v=3d) can reuse the cached
      // copy while still being revalidated against the network.
      const cacheKey = url.href;
      const cached = (await cache.match(cacheKey)) || (await cache.match(path));

      // Kick off a background revalidation of this asset.
      const revalidate = fetch(request)
        .then((resp) => {
          if (resp && resp.ok) {
            cache.put(cacheKey, resp.clone());
          }
          return resp;
        })
        .catch(() => null);

      // If we already have something cached, serve it instantly and let the
      // revalidation update the cache in the background.
      if (cached) {
        // Don't await — fire-and-forget, but keep the worker alive enough.
        event.waitUntil(revalidate.then(() => {}));
        return cached;
      }

      // Nothing cached yet: wait for the network (or fail).
      const fresh = await revalidate;
      if (fresh) return fresh;

      // Fully offline and nothing cached: try path-keyed cache then fail.
      const pathCached = await cache.match(path);
      return pathCached || Promise.reject(new Error("Offline: not cached"));
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;

  // Expected message shape:
  // { kind: 'ALARM_NOTIFICATION', payload: { title, body, tag, icon } }
  if (data.kind !== "ALARM_NOTIFICATION") return;

  const payload = data.payload || {};
  const title =
    typeof payload.title === "string" ? payload.title : "Habit reminder";
  const body = typeof payload.body === "string" ? payload.body : "";
  const tag = typeof payload.tag === "string" ? payload.tag : "habit-alarm";
  const icon = typeof payload.icon === "string" ? payload.icon : "./icon.png";

  const options = {
    body,
    tag,
    icon,
    renotify: true,
    // Do not add actions to keep it minimal and cross-browser.
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

