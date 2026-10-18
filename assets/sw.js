/* Reelio service worker — cache-first shell so the app NEVER updates itself
   in the background. A new deploy only takes over when the user taps Update
   (the page clears caches and cache-busts). Bump VERSION together with
   version.json and APP_VERSION in index.html. */
const VERSION = "1.5.0";
const CACHE = "reelio-v" + VERSION;
const CORE = [
  "./manifest.webmanifest",
  "./version.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE).catch(() => {})).then(() => {
      // Do NOT skipWaiting here — the page shows "Update Available"
      // and only activates the new worker when the user taps Update.
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("reelio-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION") {
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // version.json: always fresh from the network, never cached.
  if (url.pathname.endsWith("version.json")) {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => caches.match(req)));
    return;
  }

  // Page navigations + the app shell: cache-first. The cached shell keeps
  // serving until the user taps Update, so reopening Reelio never silently
  // swaps in a new version. The network is only a fallback for a first load
  // (or offline fill), and that response becomes the cached shell.
  if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(req, { cache: "no-store" })
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(req));
      })
    );
    return;
  }

  // Everything else (icons, images): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
