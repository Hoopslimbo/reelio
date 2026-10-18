/* Reelio service worker — STRICTLY manual updates. A new deploy only ever
   takes over when the user taps Update on the banner or Check for Updates
   in Settings; that tap is what makes the page clear caches and cache-bust.
   A worker that activates on its own (browsers activate a waiting worker
   once every app window has closed — no tap involved) must change NOTHING
   the user sees: it keeps older caches and keeps serving the shell the
   user last chose. Bump VERSION together with version.json and
   APP_VERSION in index.html. */
const VERSION = "1.5.2";
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
  // Do NOT delete older reelio caches here. If this worker activated on
  // its own, the older cache still holds the shell the user last chose,
  // and the fetch handler below keeps serving it. Caches are cleared only
  // by the page, only when the user taps Update.
  event.waitUntil(self.clients.claim());
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

  // Page navigations + the app shell: cache-first, across EVERY reelio
  // cache — this worker's own first, then any older one. The shell the
  // user last chose keeps serving until they tap Update (the page clears
  // all caches and cache-busts, so the next navigation lands here with no
  // cached shell and fetches the new one). The network is only a fallback
  // for a first-ever load, and that response becomes the cached shell.
  if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) {
    event.respondWith(
      caches.open(CACHE)
        .then((c) => c.match(req, { ignoreSearch: true }))
        .then((hit) => hit || caches.match(req, { ignoreSearch: true }))
        .then((cached) => {
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
