/*
 * Carbon POS service worker — lets already-visited POS pages reload while
 * the store's internet is down (offline cash sales, lib/offline-queue).
 *
 * Deliberately conservative:
 *   - page navigations: network first; on network failure, the last copy
 *     of that page from this device;
 *   - /_next/static/* (content-hashed build files) and Google font files:
 *     cache first;
 *   - everything else (all /api calls, data fetches): untouched.
 */
const CACHE = "carbon-pos-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (hit) =>
              hit ||
              new Response(
                "<h1 style='font-family:sans-serif'>Offline</h1><p style='font-family:sans-serif'>This page hasn't been opened on this register before, so it can't load without internet. Go back to the sale screen.</p>",
                { headers: { "content-type": "text/html" }, status: 503 },
              ),
          ),
        ),
    );
    return;
  }

  const staticAsset =
    (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com";
  if (staticAsset) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === "opaque") {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
