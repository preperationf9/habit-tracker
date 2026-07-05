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
const CACHE_NAME = "habitTracker.shell.v3";

// (Intentionally only used for readability; caching is done via explicit addAll below.)
const SHELL_CACHE_URLS = [
  "/",
  "/index.html",
  "/style.css",

  "/script.js",

  "/manifest.json",
  "/icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Cache required app-shell assets only.
      // IMPORTANT: keep these files fresh; cache shell only, no auth redirect handlers.
      // Note: use absolute paths starting with '/' to match navigator.serviceWorker.register('/service-worker.js') scope.
      await cache.addAll([
        "/",
        "/index.html",
        "/style.css",
        "/script.js",
        "/firebaseConfig.js",
        "/manifest.json",
        "/icon.png",
      ]);


      // Cache icons directory entries if present (best-effort).
      // If /icons contains multiple files, they will be requested normally and handled by cache-first.

      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          // Safe cleanup: remove only old shell caches.
          if (k.startsWith("habitTracker.shell.") && k !== CACHE_NAME) {
            return caches.delete(k);
          }
          return Promise.resolve();
        }),
      );
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

  // Never interfere with external URLs / Firebase / cloud APIs.
  // Only handle same-origin requests.
  if (!isSameOrigin(url)) return;

  // Navigation: offline app shell routing.
  if (request.method === "GET" && isProbablyAppNavigation(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          // If online, try network first (keeps fresh).
          const networkResp = await fetch(request);
          return networkResp;
        } catch (e) {
          // Offline: return cached index_fixed.html (preferred).
          const fixed = await cache.match("/index.html");

          if (fixed) return fixed;
          const fallback = await cache.match("/index.html");

          if (fallback) return fallback;
          // Final fallback: if nothing cached, let the request fail.
          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
          });
        }
      })(),
    );
    return;
  }

  // Assets: network-first for the app shell (fixes stale auth JS on mobile).
  if (request.method !== "GET") return;

  const assetCache = caches.open(CACHE_NAME);

  event.respondWith(
    (async () => {
      const cache = await assetCache;

      const accept = request.headers.get("accept") || "";
      const path = url.pathname;

      const isLikelyStatic =
        path.startsWith("/sounds/") ||
        path.startsWith("/icons/") ||
        path === "/style.css" ||
        path === "/script.js" ||
        path === "/firebaseConfig.js" ||
        path === "/manifest.json" ||
        path === "/icon.png" ||
        path === "/privacy.html" ||
        path === "/index.html" ||
        accept.includes("text/css") ||
        accept.includes("application/javascript");

      if (!isLikelyStatic) {
        // Don’t cache/app-shell-route unknown same-origin requests.
        return fetch(request);
      }

      // Never cache/serve Firebase auth handler URLs.
      // If a request looks like a redirect/handler endpoint, bypass SW.
      const looksLikeAuthHandler =
        path.includes("/__/auth") ||
        path.includes("identitytoolkit") ||
        path.includes("securetoken") ||
        path.includes("oauth") ||
        path.includes("/__/redirect") ||
        path.includes("/__/auth/handler");
      if (looksLikeAuthHandler) {
        return fetch(request);
      }

      // Network-first only for navigation + critical shell scripts/styles.
      const isCriticalShell =
        path === "/index.html" ||
        path === "/script.js" ||
        path === "/firebaseConfig.js" ||
        path === "/style.css" ||
        path === "/manifest.json" ||
        path === "/icon.png";

      if (isCriticalShell) {
        try {
          const resp = await fetch(request);
          if (resp && resp.ok) cache.put(path, resp.clone());
          return resp;
        } catch (e) {
          const cached = await cache.match(path);
          if (cached) return cached;
          return Promise.reject(e);
        }
      }

      // For remaining static assets, cache-first.
      const cached = await cache.match(path);
      if (cached) return cached;

      try {
        const resp = await fetch(request);
        if (resp && resp.ok) cache.put(path, resp.clone());
        return resp;
      } catch (e) {
        return cached || Promise.reject(e);
      }
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
