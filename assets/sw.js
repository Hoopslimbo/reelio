/* Reelio service worker — STRICTLY manual updates. A new deploy only ever
   takes over when the user taps Update (the banner button, or the
   Settings button after it relabels to "Update to vX"); that tap is what
   makes the page clear caches and cache-bust. A worker that activates on
   its own (browsers activate a waiting worker once every app window has
   closed — no tap involved) must change NOTHING the user sees: it keeps
   older caches, keeps serving the shell the user last chose, never claims
   open pages, and its fetch handler never writes a fresher shell or asset
   over a cached one — the network only fills slots that are empty. Bump
   VERSION together with version.json and APP_VERSION in index.html. */
const VERSION = "1.5.16";
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

self.addEventListener("activate", () => {
  // Do NOT delete older reelio caches here, and do NOT clients.claim().
  // If this worker activated on its own, the older cache still holds the
  // shell the user last chose, and the fetch handler below keeps serving
  // it. Caches are cleared only by the page, only when the user taps
  // Update.
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

  // One-time update navigations (the page's forced reload after an
  // Update tap) carry a random "r" nonce: ALWAYS straight to the network,
  // never answered from a cache. The cache-first match below deliberately
  // uses ignoreSearch, so without this bypass a cache-busted update URL
  // would still be served the old shell and the update would silently
  // not take. (The page also unregisters every registration before
  // navigating, so this is a second line of defense.)
  if (req.mode === "navigate" && url.searchParams.has("r")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
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
          // No cache anywhere holds this shell: pass the network response
          // through WITHOUT writing it into a cache. Caching it here would
          // silently swap in whatever version the server is newest on —
          // a background install with no tap.
          return fetch(req, { cache: "no-store" }).catch(() => caches.match(req));
        })
    );
    return;
  }

  // Everything else (icons, images): cache-first, across every reelio
  // cache. A cached asset is NEVER swapped for a fresher network copy in
  // the background (no stale-while-revalidate) — the network only fills a
  // slot that is completely empty, so new asset versions can only arrive
  // with an update the user tapped (the page clears all caches then).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
